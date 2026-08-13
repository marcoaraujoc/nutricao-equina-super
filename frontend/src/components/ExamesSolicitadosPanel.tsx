// src/components/ExamesSolicitadosPanel.tsx
//
// Exames PEDIDOS na tela de Atendimento > Pedido de Exames (/clinica/exames/:animalId)
// que ainda aguardam resultado, listados aqui na tela de RESULTADO DE EXAME
// (/exames/:animalId?tipo=laboratorial|imagem).
//
// POR QUE EXISTE: quem pede o exame e quem lança o resultado costumam ser pessoas (e
// momentos) diferentes. Sem esta lista, quem chegava com o laudo na mão não tinha como
// saber o que havia sido pedido, e o resultado acabava lançado solto — sem vínculo com
// o pedido, com a evolução e com a fatura que nasceram dele.
//
// Cada pedido oferece os DOIS caminhos, porque o laboratório às vezes entrega o PDF e
// às vezes só dita os valores por telefone:
//   • Carregar resultado    → anexa o laudo; a tabela é lida do arquivo (IA)
//   • Preencher manualmente → digita a tabela (Lab) ou o laudo (Imagem), sem arquivo
//
// Ambos caem no MESMO endpoint (PATCH /clinica/exames/:id/resultado), que transita o
// exame para REALIZADO. O gate é o slug de RESULTADO (exames.laboratorial.editar /
// exames.imagem.editar), distinto do slug do PEDIDO — ver CLAUDE.md, armadilha 29.
//
// Exame NÃO PEDIDO (ExameNaoPedidoModal, mais abaixo): achado antigo, laudo externo, ou
// resultado que chegou sem passar pelo Pedido de Exames. Não exige evolução — é um
// registro AVULSO, como o exame de Compra — e cria + já REALIZA num único passo
// (POST /clinica/exames/nao-pedido), com todos os campos revisáveis antes de salvar.

import { useState, useEffect, useCallback, useRef } from 'react';
import { ClipboardList, Scan, Upload, PencilLine, Loader2, X, Plus, Trash2, CheckCircle2, FilePlus2, Camera } from 'lucide-react';
import api from '../services/api';
import InlineError from './InlineError';
import { usePermissoes } from '../hooks/usePermissoes';
import { isMobile } from '../services/whisperService';

type TipoExame = 'Laboratorial' | 'Bioquímico' | 'Imagem' | 'Compra';

interface ResultadoItem {
  id:         number;
  parametro:  string;
  valor:      string | null;
  unidade:    string | null;
  referencia: string | null;
}

export interface ExameSolicitado {
  id:              number;
  numero:          number | null;
  tipo:            TipoExame;
  descricao:       string;
  status:          string;
  ativo:           boolean;
  dataSolicitacao: string;
  dataResultado:   string | null;
  resultado:       string | null;
  arquivoUrl:      string | null;
  /** Extraído de `observacao` pelo backend (JSON) — null quando o laudo não tem
   *  laboratório identificado (ou é do tipo Imagem, que não usa esse campo). */
  laboratorio?:    string | null;
  resultadoItens:  ResultadoItem[];
  imagens:         { id: number; nome: string | null; arquivoUrl: string }[];
  veterinario:     { id: number; fullName: string } | null;
}

interface ItemManual {
  parametro:  string;
  valor:      string;
  unidade:    string;
  referencia: string;
}

interface Props {
  animalId: string;
  /** Aba da tela de resultado: 'laboratorial' | 'imagem' (vazio = todas) */
  tipo:     string;
  /** Chamado após salvar um resultado — a tela recarrega o que exibe */
  onSalvo?: () => void;
  /** Exames REALIZADOS/CONCLUIDOS desta aba, a cada recarga — a tela-mãe (Exames.tsx)
   *  os exibe dentro do card "Resultados do Exame", que é onde o usuário espera ver
   *  o que acabou de salvar (não é reexibido aqui, para não duplicar a mesma lista
   *  em dois lugares da página). */
  onRealizadosChange?: (lista: ExameSolicitado[]) => void;
}

const LINHA_VAZIA: ItemManual = { parametro: '', valor: '', unidade: '', referencia: '' };

const formatData = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const numeroExame = (ex: ExameSolicitado) =>
  ex.numero != null ? `EX-${String(ex.numero).padStart(4, '0')}` : `#${ex.id}`;

/** Tipos que a aba atual mostra. A aba Laboratorial cobre Bioquímico — é o mesmo
 *  laudo de bancada e o mesmo slug de permissão (exames.laboratorial.*). */
function tiposDaAba(tipo: string): TipoExame[] {
  if (tipo === 'imagem')       return ['Imagem'];
  if (tipo === 'laboratorial') return ['Laboratorial', 'Bioquímico'];
  return ['Laboratorial', 'Bioquímico', 'Imagem'];
}

// ─── Tabela de resultado (editável) ────────────────────────────────────────────
// Compartilhada pelo "Preencher manualmente" (pedido) e pelo exame NÃO PEDIDO —
// mesma grade, mesmo comportamento de adicionar/remover linha.

function TabelaResultadoEditavel({ itens, setItens }: {
  itens:    ItemManual[];
  setItens: (fn: (prev: ItemManual[]) => ItemManual[]) => void;
}) {
  const setItem = (idx: number, campo: keyof ItemManual, valor: string) =>
    setItens(prev => prev.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l)));

  const remover = (idx: number) =>
    setItens(prev => (prev.length === 1 ? [{ ...LINHA_VAZIA }] : prev.filter((_, i) => i !== idx)));

  const inputClass = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500';

  return (
    <div>
      {/* Cabeçalho só no desktop: no mobile cada linha vira um bloco com rótulos
          próprios (regra mobile-first da aplicação). */}
      <div className="hidden md:grid grid-cols-[1.6fr_1fr_0.8fr_1.2fr_auto] gap-2 mb-1 px-1">
        {['Parâmetro', 'Valor', 'Unidade', 'Referência'].map(h => (
          <span key={h} className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{h}</span>
        ))}
        <span />
      </div>
      <div className="space-y-2">
        {itens.map((linha, idx) => (
          <div key={idx}>
            {/* Mobile — Parâmetro sozinho, Valor+Unidade lado a lado, Referência e o
                botão de remover na MESMA linha via flex (não uma 3ª coluna de grid —
                era isso que deixava uma caixa vazia ao lado da Referência). */}
            <div className="md:hidden space-y-2 border border-gray-200 rounded-xl p-3">
              <input value={linha.parametro} onChange={e => setItem(idx, 'parametro', e.target.value)}
                placeholder="Hemoglobina" aria-label="Parâmetro" className={inputClass} />
              <div className="grid grid-cols-2 gap-2">
                <input value={linha.valor} onChange={e => setItem(idx, 'valor', e.target.value)}
                  placeholder="12,4" aria-label="Valor" className={inputClass} />
                <input value={linha.unidade} onChange={e => setItem(idx, 'unidade', e.target.value)}
                  placeholder="g/dL" aria-label="Unidade" className={inputClass} />
              </div>
              <div className="flex items-center gap-2">
                <input value={linha.referencia} onChange={e => setItem(idx, 'referencia', e.target.value)}
                  placeholder="11 – 17" aria-label="Referência" className={`flex-1 min-w-0 ${inputClass}`} />
                <button type="button" title="Remover linha" onClick={() => remover(idx)}
                  className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Desktop — grid proporcional de 5 colunas (Parâmetro maior, Unidade
                menor, botão só do tamanho do ícone). */}
            <div className="hidden md:grid grid-cols-[1.6fr_1fr_0.8fr_1.2fr_auto] gap-2 items-center">
              <input value={linha.parametro} onChange={e => setItem(idx, 'parametro', e.target.value)}
                placeholder="Hemoglobina" aria-label="Parâmetro" className={inputClass} />
              <input value={linha.valor} onChange={e => setItem(idx, 'valor', e.target.value)}
                placeholder="12,4" aria-label="Valor" className={inputClass} />
              <input value={linha.unidade} onChange={e => setItem(idx, 'unidade', e.target.value)}
                placeholder="g/dL" aria-label="Unidade" className={inputClass} />
              <input value={linha.referencia} onChange={e => setItem(idx, 'referencia', e.target.value)}
                placeholder="11 – 17" aria-label="Referência" className={inputClass} />
              <button type="button" title="Remover linha" onClick={() => remover(idx)}
                className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors justify-self-end">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setItens(prev => [...prev, { ...LINHA_VAZIA }])}
        className="mt-2 flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-semibold hover:bg-emerald-50 transition-colors">
        <Plus size={13} /> Adicionar parâmetro
      </button>
    </div>
  );
}

// ─── Seletor de arquivo, com opção de câmera em mobile/tablet ─────────────────
// `isMobile()` (whisperService — mesmo detector já usado no reconhecimento de voz)
// cobre Android/iPhone/iPad + touch: em desktop some o botão de câmera, já que não
// há câmera para acionar. "Tirar foto" e "Escolher arquivo" são inputs SEPARADOS —
// um `<input capture>` só tira UMA foto por vez, então quem chama decide se ela
// substitui a seleção (Laboratorial/Bioquímico, 1 arquivo) ou se acrescenta
// (Imagem, várias fotos de exame).
function SeletorArquivo({ multiple, onEscolher, onFoto }: {
  multiple:   boolean;
  onEscolher: (arquivos: File[]) => void;
  onFoto:     (foto: File) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      <input type="file" accept="image/*,application/pdf" multiple={multiple}
        onChange={e => { onEscolher(Array.from(e.target.files ?? [])); e.target.value = ''; }}
        className="flex-1 min-w-0 text-xs text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:text-xs file:font-semibold" />
      {isMobile() && (
        <>
          <input type="file" accept="image/*" capture="environment" ref={cameraRef}
            onChange={e => {
              const foto = e.target.files?.[0];
              if (foto) onFoto(foto);
              e.target.value = '';
            }}
            className="hidden" />
          <button type="button" onClick={() => cameraRef.current?.click()}
            title="Tirar foto" aria-label="Tirar foto"
            className="flex-shrink-0 p-2 border border-gray-200 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors">
            <Camera size={16} />
          </button>
        </>
      )}
    </div>
  );
}

// ─── Modal do resultado (exame PEDIDO) ─────────────────────────────────────────
// `modo` decide o corpo: 'upload' pede o arquivo, 'manual' abre o editor.

function ResultadoModal({ ex, modo, saving, onClose, onSalvar }: {
  ex:       ExameSolicitado;
  modo:     'upload' | 'manual';
  saving:   boolean;
  onClose:  () => void;
  onSalvar: (data: { laudo: string; arquivos: File[]; itens: ItemManual[] }) => void;
}) {
  const isImagem = ex.tipo === 'Imagem';
  const [laudo,    setLaudo]    = useState('');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [itens,    setItens]    = useState<ItemManual[]>([{ ...LINHA_VAZIA }]);
  const [erro,     setErro]     = useState<string | null>(null);

  const preenchidos = itens.filter(i => i.parametro.trim());

  const confirmar = () => {
    if (modo === 'upload' && arquivos.length === 0) {
      setErro(isImagem ? 'Anexe as imagens ou o laudo do exame' : 'Anexe o arquivo do laudo'); return;
    }
    if (modo === 'manual' && isImagem && !laudo.trim()) {
      setErro('Escreva o laudo do exame'); return;
    }
    if (modo === 'manual' && !isImagem && preenchidos.length === 0) {
      setErro('Informe ao menos um parâmetro do resultado'); return;
    }
    setErro(null);
    onSalvar({ laudo: laudo.trim(), arquivos, itens: modo === 'manual' ? preenchidos : [] });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl border border-gray-100 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {isImagem ? <Scan size={16} className="text-emerald-700 flex-shrink-0" />
                      : <ClipboardList size={16} className="text-emerald-700 flex-shrink-0" />}
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900">
                {modo === 'upload' ? 'Carregar resultado' : 'Preencher manualmente'}
              </h3>
              <p className="text-[11px] text-gray-500 truncate">
                {numeroExame(ex)} · {ex.tipo} · {ex.descricao}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {modo === 'upload' ? (
            <>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                  {isImagem ? 'Imagens / laudo (PDF ou imagem) *' : 'Arquivo do laudo (PDF/imagem) *'}
                </label>
                <SeletorArquivo multiple={isImagem}
                  onEscolher={lista => setArquivos(lista)}
                  onFoto={foto => setArquivos(prev => isImagem ? [...prev, foto] : [foto])} />
                {arquivos.length > 0 && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    {arquivos.length === 1 ? arquivos[0].name : `${arquivos.length} arquivo(s) selecionado(s)`}
                  </p>
                )}
                {!isImagem && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    O laudo é lido e salvo em tabela (parâmetro / valor / referência); o arquivo fica armazenado.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                  {isImagem ? 'Laudo (exatamente como escrito)' : 'Observação (opcional)'}
                </label>
                <textarea value={laudo} onChange={e => setLaudo(e.target.value)} rows={isImagem ? 5 : 2}
                  placeholder={isImagem ? 'Salvo literalmente, sem interpretação da IA.' : 'Notas adicionais sobre o resultado...'}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 resize-none" />
              </div>
            </>
          ) : isImagem ? (
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Laudo *</label>
              <textarea value={laudo} onChange={e => setLaudo(e.target.value)} rows={8}
                placeholder="Digite o laudo do exame de imagem — salvo literalmente, sem interpretação da IA."
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 resize-none" />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                  Resultado *
                </label>
                <TabelaResultadoEditavel itens={itens} setItens={setItens} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Observação (opcional)</label>
                <textarea value={laudo} onChange={e => setLaudo(e.target.value)} rows={2}
                  placeholder="Notas adicionais sobre o resultado..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 resize-none" />
              </div>
            </>
          )}

          <InlineError message={erro} />
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Salvar resultado
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal do exame NÃO PEDIDO ──────────────────────────────────────────────────
// Uma tela só, com TODOS os campos editáveis — anexar o laudo é opcional e só serve
// para a IA pré-preencher tipo/descrição/laboratório/data/tabela; nada é salvo até o
// usuário revisar e confirmar. Cria + já REALIZA num único POST (sem evolução).

function ExameNaoPedidoModal({ tipoAba, animalId, saving, erroSalvar, onClose, onSalvar }: {
  /** Aba atual ('laboratorial' | 'imagem') — decide o tipo padrão/opções do exame. */
  tipoAba:  string;
  animalId: string;
  saving:   boolean;
  /** Erro do POST de criação (ex.: "Este exame já foi carregado"), vindo do painel —
   *  precisa aparecer AQUI dentro, não atrás do overlay (regra de erro em modal). */
  erroSalvar: string | null;
  onClose:  () => void;
  onSalvar: (data: {
    tipo: TipoExame; descricao: string; laboratorio: string; dataExame: string;
    laudo: string; itens: ItemManual[]; arquivos: File[];
  }) => void;
}) {
  const [tipo,        setTipo]        = useState<TipoExame>(tipoAba === 'imagem' ? 'Imagem' : 'Laboratorial');
  const [descricao,   setDescricao]   = useState('');
  const [laboratorio, setLaboratorio] = useState('');
  const [dataExame,   setDataExame]   = useState('');
  const [laudo,       setLaudo]       = useState('');
  const [itens,       setItens]       = useState<ItemManual[]>([{ ...LINHA_VAZIA }]);
  const [arquivos,    setArquivos]    = useState<File[]>([]);
  const [analisando,  setAnalisando]  = useState(false);
  // Progresso SIMULADO (a chamada de IA não emite eventos de progresso real) — mesmo
  // padrão de CriaComposicaoAlimentar.tsx/CriaExameNutricional.tsx: sobe até 90% em
  // ticks enquanto a requisição está no ar, salta para 100% quando ela responde.
  const [progresso,   setProgresso]   = useState(0);
  const [erro,        setErro]        = useState<string | null>(null);

  const isImagem = tipo === 'Imagem';
  const preenchidos = itens.filter(i => i.parametro.trim());

  // Lê o laudo com a IA e pré-preenche tipo/descrição/laboratório/data/tabela — tudo
  // continua editável logo abaixo. Falha ou indisponibilidade da IA não bloqueia nada:
  // os campos seguem em branco para preenchimento manual.
  const analisarArquivo = async (file: File) => {
    setAnalisando(true);
    setProgresso(0);
    setErro(null);
    const interval = setInterval(() => setProgresso(p => (p >= 90 ? 90 : p + 10)), 300);
    try {
      const fd = new FormData();
      fd.append('arquivo', file);
      fd.append('animalId', animalId);
      const res = await api.post('/clinica/exames/analisar', fd);
      setProgresso(100);
      const d = res.data?.dados;
      if (d) {
        if (d.tipoSugerido === 'Bioquímico' || d.tipoSugerido === 'Laboratorial') setTipo(d.tipoSugerido);
        if (d.descricao)   setDescricao(d.descricao);
        if (d.laboratorio) setLaboratorio(d.laboratorio);
        if (d.dataExame)   setDataExame(d.dataExame);
        if (Array.isArray(d.itens) && d.itens.length > 0) {
          setItens(d.itens.map((i: { parametro: string; valor: string | null; unidade: string | null; referencia: string | null }) => ({
            parametro: i.parametro ?? '', valor: i.valor ?? '', unidade: i.unidade ?? '', referencia: i.referencia ?? '',
          })));
        }
      }
    } catch (err: unknown) {
      // best-effort para falha/indisponibilidade da IA (ver comentário acima) — mas
      // "o arquivo não é um exame" e "esse exame já foi carregado" são diagnóstico,
      // não indisponibilidade, e precisam aparecer: sem isto, o usuário confirmaria
      // uma tabela vazia (ou duplicada) sem entender por quê.
      const resp = (err as { response?: { data?: { code?: string; error?: string } } })?.response;
      if (resp?.data?.code === 'ARQUIVO_NAO_E_EXAME' || resp?.data?.code === 'EXAME_JA_CARREGADO') {
        setErro(resp.data.error ?? 'Não foi possível analisar o arquivo.');
      }
    } finally {
      clearInterval(interval);
      setAnalisando(false);
    }
  };

  const confirmar = () => {
    if (!descricao.trim()) { setErro('Informe a descrição do exame'); return; }
    if (isImagem && arquivos.length === 0 && !laudo.trim()) {
      setErro('Anexe as imagens ou escreva o laudo'); return;
    }
    if (!isImagem && preenchidos.length === 0) {
      setErro('Informe ao menos um parâmetro do resultado'); return;
    }
    setErro(null);
    onSalvar({
      tipo, descricao: descricao.trim(), laboratorio: laboratorio.trim(), dataExame,
      laudo: laudo.trim(), itens: preenchidos, arquivos,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl border border-gray-100 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FilePlus2 size={16} className="text-emerald-700 flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900">Exame não pedido</h3>
              <p className="text-[11px] text-gray-500 truncate">
                Achado antigo ou laudo externo — sem passar pelo Pedido de Exames
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {tipoAba !== 'imagem' && (
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                Tipo do exame
              </label>
              <select value={tipo} onChange={e => setTipo(e.target.value as TipoExame)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 bg-white">
                <option value="Laboratorial">Laboratorial</option>
                <option value="Bioquímico">Bioquímico</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
              Descrição do exame *
            </label>
            <input type="text" value={descricao} onChange={e => setDescricao(e.target.value)}
              placeholder="Ex: Hemograma completo, Raio-X de tórax..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500" />
          </div>

          {!isImagem && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Laboratório</label>
                <input type="text" value={laboratorio} onChange={e => setLaboratorio(e.target.value)}
                  placeholder="Identificado ao anexar o laudo"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Data do exame</label>
                <input type="date" value={dataExame} onChange={e => setDataExame(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
              {isImagem ? 'Imagens / laudo (PDF ou imagem)' : 'Anexar laudo (opcional)'}
            </label>
            <SeletorArquivo multiple={isImagem}
              onEscolher={lista => {
                setArquivos(lista);
                if (!isImagem && lista[0]) analisarArquivo(lista[0]);
              }}
              onFoto={foto => {
                if (isImagem) {
                  setArquivos(prev => [...prev, foto]);
                } else {
                  setArquivos([foto]);
                  analisarArquivo(foto);
                }
              }} />
            {arquivos.length > 0 && (
              <p className="text-[11px] text-gray-500 mt-1">
                {arquivos.length === 1 ? arquivos[0].name : `${arquivos.length} arquivo(s) selecionado(s)`}
              </p>
            )}
            {analisando && (
              <div className="mt-2">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-600 transition-all duration-300" style={{ width: `${progresso}%` }} />
                </div>
                <p className="text-center text-[11px] text-gray-500 mt-1">
                  Lendo o laudo com IA — identificando tipo, composto, laboratório, data e resultado… {progresso}%
                </p>
              </div>
            )}
            {!isImagem && (
              <p className="text-[11px] text-gray-400 mt-1">
                Sem arquivo, preencha a tabela abaixo à mão. Com arquivo, a IA sugere a
                tabela — revise antes de salvar, tudo continua editável.
              </p>
            )}
          </div>

          {isImagem ? (
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                Laudo (exatamente como escrito) {arquivos.length === 0 ? '*' : ''}
              </label>
              <textarea value={laudo} onChange={e => setLaudo(e.target.value)} rows={6}
                placeholder="Digite o laudo do exame de imagem — salvo literalmente, sem interpretação da IA."
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 resize-none" />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                  Resultado *
                </label>
                <TabelaResultadoEditavel itens={itens} setItens={setItens} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Observação (opcional)</label>
                <textarea value={laudo} onChange={e => setLaudo(e.target.value)} rows={2}
                  placeholder="Notas adicionais sobre o resultado..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 resize-none" />
              </div>
            </>
          )}

          <InlineError message={erro ?? erroSalvar} />
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Salvar exame
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Painel ───────────────────────────────────────────────────────────────────

export default function ExamesSolicitadosPanel({ animalId, tipo, onSalvo, onRealizadosChange }: Props) {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  // Gate do RESULTADO — distinto do gate do PEDIDO (armadilha 29 do CLAUDE.md)
  const podeResultadoLab = isGestor || podeExecutar('exames.laboratorial.editar');
  const podeResultadoImg = isGestor || podeExecutar('exames.imagem.editar');
  const podeLancar = (ex: ExameSolicitado) => (ex.tipo === 'Imagem' ? podeResultadoImg : podeResultadoLab);
  // Encerrar o PEDIDO é ação do pedido, não do resultado: usa o slug do Atendimento.
  // Sem filtro por autoria — quem tem a ação concedida opera o registro (CLAUDE.md 28-c).
  const podeFinalizar = isGestor || podeExecutar('atendimento.exames.finalizar');

  const [pendentes,  setPendentes]  = useState<ExameSolicitado[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro,       setErro]       = useState<string | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [alvo,       setAlvo]       = useState<{ ex: ExameSolicitado; modo: 'upload' | 'manual' } | null>(null);
  const [naoPedidoAberto, setNaoPedidoAberto] = useState(false);
  // Erro do POST de criação do "não pedido" — separado do `erro` do painel (topo da
  // página) porque precisa aparecer DENTRO do modal, que cobre a tela toda.
  const [erroNaoPedido, setErroNaoPedido] = useState<string | null>(null);
  // Confirmação do "Finalizar": encerrar sem resultado é decisão que não se desfaz
  // pela tela, então não pode sair de um clique solto.
  const [finalizando,   setFinalizando]   = useState<ExameSolicitado | null>(null);
  const [salvandoFinal, setSalvandoFinal] = useState(false);

  const carregar = useCallback(async () => {
    if (!animalId) return;
    setCarregando(true);
    try {
      const res = await api.get(`/clinica/exames/animal/${animalId}`);
      // GET 403 resolve com data null (interceptor) — sem guard, estoura TypeError
      if (!res.data) { setPendentes([]); onRealizadosChange?.([]); return; }
      const permitidos = tiposDaAba(tipo);
      const lista = ((res.data.dados ?? []) as ExameSolicitado[])
        .filter(ex => ex.ativo && permitidos.includes(ex.tipo));
      // Encerrado (REALIZADO/CONCLUIDO) sai da fila de espera — senão o pedido
      // finalizado continuaria pedindo resultado para sempre. Não é reexibido AQUI:
      // sobe para a tela-mãe via onRealizadosChange, que o mostra dentro do card
      // "Resultados do Exame" — é lá que o usuário espera ver o que acabou de salvar.
      const encerrado = (ex: ExameSolicitado) => ex.status === 'REALIZADO' || ex.status === 'CONCLUIDO';
      setPendentes(lista.filter(ex => !encerrado(ex)));
      onRealizadosChange?.(lista.filter(encerrado));
    } catch {
      setErro('Erro ao carregar os exames solicitados');
    } finally {
      setCarregando(false);
    }
  }, [animalId, tipo, onRealizadosChange]);

  useEffect(() => {
    if (loadingPerms) return;   // evita 403 antes de as permissões carregarem
    carregar();
  }, [carregar, loadingPerms]);

  const salvarResultado = async ({ laudo, arquivos, itens }: { laudo: string; arquivos: File[]; itens: ItemManual[] }) => {
    if (!alvo) return;
    setSaving(true);
    setErro(null);
    try {
      // multipart no mesmo endpoint dos dois modos: no manual não vai arquivo, só a
      // tabela em JSON (todo campo de multipart é texto — o backend faz o parse).
      const fd = new FormData();
      if (laudo) fd.append('resultado', laudo);
      arquivos.forEach(a => fd.append('arquivos', a));
      if (itens.length > 0) fd.append('itens', JSON.stringify(itens));
      await api.patch(`/clinica/exames/${alvo.ex.id}/resultado`, fd);
      setAlvo(null);
      await carregar();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErro(msg ?? 'Erro ao salvar o resultado');
    } finally {
      setSaving(false);
    }
  };

  // Exame NÃO PEDIDO: cria e já REALIZA num único POST — sem evolução (registro
  // avulso, mesma categoria do exame de Compra). Nenhuma segunda chamada de IA: a
  // tabela já veio revisada pelo modal.
  const salvarNaoPedido = async (
    { tipo: tipoNovo, descricao, laboratorio, dataExame, laudo, itens, arquivos }:
    { tipo: TipoExame; descricao: string; laboratorio: string; dataExame: string; laudo: string; itens: ItemManual[]; arquivos: File[] }
  ) => {
    setSaving(true);
    setErroNaoPedido(null);
    try {
      const fd = new FormData();
      fd.append('animalId', animalId);
      fd.append('tipo', tipoNovo);
      fd.append('descricao', descricao);
      if (laboratorio) fd.append('laboratorio', laboratorio);
      if (dataExame)   fd.append('dataExame', dataExame);
      if (laudo)       fd.append('resultado', laudo);
      if (itens.length > 0) fd.append('itens', JSON.stringify(itens));
      arquivos.forEach(a => fd.append('arquivos', a));
      await api.post('/clinica/exames/nao-pedido', fd);
      setNaoPedidoAberto(false);
      await carregar();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroNaoPedido(msg ?? 'Erro ao criar o exame');
    } finally {
      setSaving(false);
    }
  };

  // Encerra o PEDIDO sem resultado: o exame passa a FINALIZADO SEM RESULTADO aqui e na
  // tela de Pedido de Exames, e sai da fila de espera.
  const finalizarSemResultado = async () => {
    if (!finalizando) return;
    setSalvandoFinal(true);
    setErro(null);
    try {
      await api.patch(`/clinica/exames/${finalizando.id}/finalizar`);
      setFinalizando(null);
      await carregar();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErro(msg ?? 'Erro ao finalizar o exame');
    } finally {
      setSalvandoFinal(false);
    }
  };

  if (loadingPerms) return null;
  // O painel some só para quem não pode NEM lançar resultado NEM encerrar o pedido.
  // Quem tem apenas `atendimento.exames.finalizar` continua vendo a fila — é dele a
  // decisão de encerrar o pedido que nunca vai receber laudo.
  const podeLancarNaAba = tipo === 'imagem' ? podeResultadoImg : podeResultadoLab;
  if (!podeLancarNaAba && !podeFinalizar) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
          Exames solicitados aguardando resultado{pendentes.length > 0 ? ` (${pendentes.length})` : ''}
        </p>
        <div className="flex items-center gap-2">
          {/* Exame NÃO PEDIDO — abre a tela de cadastro completa (tipo, descrição,
              laboratório, data, tabela), tudo editável antes de salvar. */}
          {podeLancarNaAba && (
            <button onClick={() => { setErroNaoPedido(null); setNaoPedidoAberto(true); }}
              title="Incluir exame não pedido" aria-label="Incluir exame não pedido"
              className="flex items-center gap-1 px-2 py-1 text-emerald-700 hover:bg-emerald-50 rounded-lg text-[11px] font-semibold transition-colors">
              <FilePlus2 size={13} /> Exame não pedido
            </button>
          )}
          {carregando && <Loader2 size={14} className="animate-spin text-emerald-600" />}
        </div>
      </div>

      <InlineError message={erro} className="mx-4 mt-3" />

      {pendentes.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-400 text-center">
          Nenhum exame pedido aguardando resultado. Os pedidos feitos no Atendimento aparecem aqui.
        </p>
      ) : (
        <>
          {/* Mobile — cards */}
          <div className="md:hidden divide-y divide-gray-50">
            {pendentes.map(ex => (
              <div key={ex.id} className="px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">{ex.descricao}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {numeroExame(ex)} · {formatData(ex.dataSolicitacao)}
                  {ex.veterinario ? ` · ${ex.veterinario.fullName}` : ''}
                </p>
                {/* Só ícones, mesma linha — ver o bloco equivalente do desktop */}
                <div className="flex items-center gap-1 mt-2 flex-nowrap">
                  {podeLancar(ex) && (
                    <>
                      <button onClick={() => setAlvo({ ex, modo: 'upload' })}
                        title="Carregar resultado" aria-label="Carregar resultado"
                        className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors">
                        <Upload size={15} />
                      </button>
                      <button onClick={() => setAlvo({ ex, modo: 'manual' })}
                        title="Preencher manualmente" aria-label="Preencher manualmente"
                        className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                        <PencilLine size={15} />
                      </button>
                    </>
                  )}
                  {podeFinalizar && (
                    <button onClick={() => setFinalizando(ex)}
                      title="Finalizar sem resultado" aria-label="Finalizar sem resultado"
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                      <CheckCircle2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop — tabela */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Pedido</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Exame</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Solicitado em</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Solicitante</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pendentes.map(ex => (
                  <tr key={ex.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-500">{numeroExame(ex)}</td>
                    <td className="px-4 py-3">
                      {/* Só o NOME do exame. O tipo (Laboratorial/Bioquímico/Imagem)
                          saiu a pedido — e é redundante: a própria aba da tela já diz
                          qual é (?tipo=laboratorial | imagem). */}
                      <p className="text-sm text-gray-800">{ex.descricao}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatData(ex.dataSolicitacao)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{ex.veterinario?.fullName ?? '—'}</td>
                    <td className="px-4 py-3">
                      {/* Só ÍCONES, numa linha só. `title` + `aria-label` em cada um
                          não são opcionais: sem rótulo visível, é o que dá nome ao
                          botão para leitor de tela e no hover. */}
                      <div className="flex items-center gap-1 flex-nowrap">
                        {podeLancar(ex) && (
                          <>
                            <button onClick={() => setAlvo({ ex, modo: 'upload' })}
                              title="Carregar resultado" aria-label="Carregar resultado"
                              className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors">
                              <Upload size={15} />
                            </button>
                            <button onClick={() => setAlvo({ ex, modo: 'manual' })}
                              title="Preencher manualmente" aria-label="Preencher manualmente"
                              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                              <PencilLine size={15} />
                            </button>
                          </>
                        )}
                        {podeFinalizar && (
                          <button onClick={() => setFinalizando(ex)}
                            title="Finalizar sem resultado" aria-label="Finalizar sem resultado"
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                            <CheckCircle2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* "Exames encerrados" foi removido a pedido (2026-08) — duplicava a leitura
          de "Resultados do Exame" (mesma página) e confundia sobre qual seção era a
          fonte de verdade. O exame REALIZADO por aqui continua consultável no
          Histórico do paciente (AnimalDetail). */}

      {alvo && (
        <ResultadoModal
          ex={alvo.ex}
          modo={alvo.modo}
          saving={saving}
          onClose={() => setAlvo(null)}
          onSalvar={salvarResultado}
        />
      )}

      {naoPedidoAberto && (
        <ExameNaoPedidoModal
          tipoAba={tipo}
          animalId={animalId}
          saving={saving}
          erroSalvar={erroNaoPedido}
          onClose={() => setNaoPedidoAberto(false)}
          onSalvar={salvarNaoPedido}
        />
      )}

      {finalizando && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md border border-gray-100">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Finalizar sem resultado</h3>
              <button onClick={() => setFinalizando(null)} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-2">
              <p className="text-sm text-gray-700">
                Encerrar <span className="font-semibold">{finalizando.descricao}</span> sem lançar resultado?
              </p>
              <p className="text-xs text-gray-500">
                O pedido sai da fila de espera e passa a constar como
                <span className="font-semibold"> Finalizado sem Resultado</span> aqui e no Pedido de Exames.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5 pt-3 border-t border-gray-100">
              <button onClick={() => setFinalizando(null)} disabled={salvandoFinal}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={finalizarSemResultado} disabled={salvandoFinal}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors">
                {salvandoFinal ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Finalizar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

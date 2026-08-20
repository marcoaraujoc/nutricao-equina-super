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
// Cada pedido oferece "Carregar Resultados": anexa o laudo; a IA lê o arquivo e vira
// TABELA (Lab) ou TEXTO TRANSCRITO literal, nunca interpretado (Imagem). O laudo digitado
// à mão continua disponível como campo dentro dessa mesma tela (Imagem). Na aba
// Laboratorial existe AINDA um segundo caminho, "Preencher manualmente" — digita a
// tabela direto, sem arquivo (nem todo laboratório entrega laudo em PDF/foto).
//
// Cai no endpoint (PATCH /clinica/exames/:id/resultado), que transita o
// exame para REALIZADO. O gate é o slug de RESULTADO (exames.laboratorial.editar /
// exames.imagem.editar), distinto do slug do PEDIDO — ver CLAUDE.md, armadilha 29.
//
// Exame NÃO PEDIDO (mesmo componente ResultadoModal, mais abaixo, com `ex={null}`):
// achado antigo, laudo externo, ou resultado que chegou sem passar pelo Pedido de
// Exames. Não exige evolução — é um registro AVULSO, como o exame de Compra — e
// cria + já REALIZA num único passo (POST /clinica/exames/nao-pedido), com todos
// os campos revisáveis antes de salvar.
//
// Cancelar (Ban): soft delete do PEDIDO (DELETE, motivo obrigatório) — mesmo endpoint
// do "Cancelar exame" da tela de Pedido de Exames, então reflete lá como CANCELADA.

import { useState, useEffect, useCallback, useRef } from 'react';
import { ClipboardList, Scan, Upload, Table2, Loader2, X, Plus, Trash2, CheckCircle2, FilePlus2, Camera, Ban, Eye } from 'lucide-react';
import api from '../services/api';
import InlineError from './InlineError';
import ModalJustificativa from './ModalJustificativa';
import { usePermissoes } from '../hooks/usePermissoes';
import { isMobile } from '../services/whisperService';
import { comprimirImagensAteLimite } from '../utils/imageCompress';
import { temResultadoExame } from '../utils/exameClinico';

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

export interface ItemManual {
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
// Usada pelo exame NÃO PEDIDO (Carregar Exames sem Pedido) para digitar a tabela
// à mão — mesma grade, mesmo comportamento de adicionar/remover linha.

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
  // Input nativo fica OCULTO — o texto do botão/"nenhum arquivo escolhido" é do
  // navegador (idioma do SO, não controlável por CSS) e ficava em inglês mesmo com o
  // resto da tela em português. O gatilho é um botão nosso, com o texto que queremos.
  //
  // SEM `accept` no input principal: com o filtro, o seletor de arquivo do Windows
  // acusava "Nenhum dos arquivos desta pasta é compatível" sempre que a pasta tinha
  // algo fora de imagem/PDF — mensagem do próprio SO, incontrolável por aqui. O
  // formato ainda é validado no servidor (`fileFilter` de `routes/clinica-exames.js`).
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [comprimindo, setComprimindo] = useState(false);

  const processarSelecao = async (files: File[]): Promise<File[]> => {
    if (files.length === 0) return files;
    setComprimindo(true);
    try {
      return await comprimirImagensAteLimite(files);
    } finally {
      setComprimindo(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input type="file" multiple={multiple} ref={arquivoRef}
        onChange={async e => {
          const lista = Array.from(e.target.files ?? []);
          e.target.value = '';
          onEscolher(await processarSelecao(lista));
        }}
        className="hidden" />
      <button type="button" onClick={() => arquivoRef.current?.click()} disabled={comprimindo}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-60 transition-colors">
        {comprimindo && <Loader2 size={12} className="animate-spin" />}
        {comprimindo ? 'Otimizando imagens...' : 'Carregar Arquivos'}
      </button>
      {isMobile() && (
        <>
          <input type="file" accept="image/*" capture="environment" ref={cameraRef}
            onChange={async e => {
              const foto = e.target.files?.[0];
              e.target.value = '';
              if (foto) {
                const [comprimida] = await processarSelecao([foto]);
                onFoto(comprimida);
              }
            }}
            className="hidden" />
          <button type="button" onClick={() => cameraRef.current?.click()} disabled={comprimindo}
            title="Tirar foto" aria-label="Tirar foto"
            className="flex-shrink-0 p-2 border border-gray-200 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition-colors">
            <Camera size={16} />
          </button>
        </>
      )}
    </div>
  );
}

// ─── Modal do resultado — PEDIDO existente e NÃO PEDIDO, tela ÚNICA ────────────
// Mesmo formulário, sempre, nas DUAS situações — `ex` só muda o TÍTULO/subtítulo,
// o endpoint (PATCH .../resultado × POST /nao-pedido, decidido por quem chama), o
// `exameId` mandado à IA (evita falso "já carregado" contra o próprio pedido) e
// SE os campos vêm pré-preenchidos:
//   descrição/laboratório → sempre que `ex` existe, mesmo PENDENTE — são dados do
//     PEDIDO (capturados na Evolução/Pedido de Exames, antes de existir qualquer
//     resultado), não do resultado; reaproveitá-los evita reescrever o que já foi
//     informado e é por isso que o campo não carrega mais um exemplo genérico
//     (Hemograma/Raio-X de tórax) — o valor real já chega pronto.
//   laudo/tabela → só quando `ex` JÁ TEM um resultado salvo (edição, via "Editar"
//     em Exames.tsx); a fila de pendentes nunca tem, então começa em branco por
//     definição (ver `jaTemResultado` no corpo) — é o RESULTADO em si, que ainda
//     não existe.
// Data do exame fica sem uso quando `ex` existe — é a data IMPRESSA no laudo
// (que a IA extrai do arquivo), não a data em que o pedido foi feito. SEM
// seletor de "Tipo do exame" — o tipo é sempre conhecido (o do pedido) ou
// detectado pela IA, nunca escolhido.
export function ResultadoModal({ ex, tipoAba, animalId, saving, erroSalvar, somenteLeitura, arquivosSalvos, onVerArquivo, onClose, onSalvar }: {
  /** Exame PEDIDO — presente quando é "Carregar/Editar Resultados"; `null` no
   *  fluxo avulso "Carregar Exames sem Pedido". Decide texto do cabeçalho,
   *  endpoint (via quem chama), o `exameId` da análise, e pré-preenche
   *  descrição/laboratório (dados do PEDIDO, disponíveis mesmo pendente) — o
   *  laudo/tabela só vêm quando já existe um resultado salvo (ver
   *  `jaTemResultado` no corpo). */
  ex:       ExameSolicitado | null;
  /** Aba atual ('laboratorial' | 'imagem') — só usada quando `ex` é `null`, para
   *  decidir o tipo padrão (a IA pode corrigir para Bioquímico depois). */
  tipoAba?: string;
  animalId: string;
  saving:   boolean;
  /** Erro do POST de criação no fluxo avulso (ex.: "Este exame já foi
   *  carregado"), vindo de fora — precisa aparecer AQUI dentro, não atrás do
   *  overlay (regra de erro em modal). */
  erroSalvar?: string | null;
  /** Visualizar (não editar) — usado pelo "olho" de um resultado já salvo em
   *  Exames.tsx. `<fieldset disabled>` trava todo campo; a seção de anexar
   *  arquivo some, no lugar entra a lista de `arquivosSalvos` (cada um abre o
   *  visualizador de verdade via `onVerArquivo`). Rodapé vira só "Fechar". */
  somenteLeitura?: boolean;
  arquivosSalvos?: { nome: string }[];
  onVerArquivo?:   (indice: number) => void;
  onClose:  () => void;
  onSalvar: (data: {
    tipo: TipoExame; descricao: string; laboratorio: string; dataExame: string;
    laudo: string; itens: ItemManual[]; arquivos: File[];
  }) => void;
}) {
  // `ex` PENDENTE (fila de "aguardando resultado") já tem descrição/laboratório
  // (do pedido), mas nunca tem laudo/tabela salvos ainda — esses começam em
  // branco por definição. `ex` JÁ REALIZADO (aberto pelo "Editar" em Exames.tsx)
  // tem os dois, e é isso que esta tela edita: tem de vir com o que já foi
  // salvo, senão "editar" apaga o resultado por engano. `temResultadoExame`
  // (mesmo critério do badge "Realizado"/"Finalizado sem Resultado") é o que
  // distingue os dois — não dá para usar só `!!ex`.
  const jaTemResultado = !!ex && temResultadoExame(ex);

  const [tipo,        setTipo]        = useState<TipoExame>(ex ? ex.tipo : (tipoAba === 'imagem' ? 'Imagem' : 'Laboratorial'));
  // Descrição/laboratório vêm do PEDIDO (já existem antes do resultado) — ver
  // comentário do componente. `ex` cobre pendente E já realizado.
  const [descricao,   setDescricao]   = useState(ex?.descricao ?? '');
  const [dataExame,   setDataExame]   = useState('');
  const [laudo,       setLaudo]       = useState(jaTemResultado ? (ex?.resultado ?? '') : '');
  const [laboratorio, setLaboratorio] = useState(ex?.laboratorio ?? '');
  const [itens,       setItens]       = useState<ItemManual[]>(
    jaTemResultado && ex && ex.resultadoItens.length > 0
      ? ex.resultadoItens.map(i => ({ parametro: i.parametro, valor: i.valor ?? '', unidade: i.unidade ?? '', referencia: i.referencia ?? '' }))
      : [{ ...LINHA_VAZIA }]
  );
  const [arquivos,    setArquivos]    = useState<File[]>([]);
  const [analisando,  setAnalisando]  = useState(false);
  // Progresso SIMULADO (a chamada de IA não emite eventos de progresso real) — mesmo
  // padrão de CriaComposicaoAlimentar.tsx/CriaExameNutricional.tsx.
  const [progresso,   setProgresso]   = useState(0);
  const [erro,        setErro]        = useState<string | null>(null);
  // Nomes dos arquivos aceitos no upload mas sem transcrição automática (.doc) —
  // aviso, não erro: o arquivo é anexado normalmente ao salvar (mesmo loop de
  // upload de qualquer outro), só não teve prévia da IA.
  const [naoTranscritos, setNaoTranscritos] = useState<string[]>([]);

  const isImagem = tipo === 'Imagem';
  const preenchidos = itens.filter(i => i.parametro.trim());

  // Lê os arquivos com a IA e pré-preenche laboratório + tabela (ou o laudo
  // transcrito, em Imagem) — tudo continua editável logo abaixo. `exameId`
  // (só quando `ex` existe) exclui o PRÓPRIO pedido da checagem de duplicidade lá
  // dentro: sem ele, todo upload bateria com o pedido que está recebendo o
  // resultado e devolveria 409.
  const analisarArquivo = async (files: File[]) => {
    if (files.length === 0) return;
    // RESETA antes de analisar: cada novo lote de arquivos parte do zero. Sem isto,
    // um campo que a IA não detectasse desta vez continuaria mostrando o valor do
    // lote ANTERIOR — parecendo (errado) que veio do arquivo que acabou de ser
    // anexado.
    setDescricao('');
    setLaboratorio('');
    setDataExame('');
    setLaudo('');
    setItens([{ ...LINHA_VAZIA }]);
    setNaoTranscritos([]);
    setAnalisando(true);
    setProgresso(0);
    setErro(null);
    const interval = setInterval(() => setProgresso(p => (p >= 90 ? 90 : p + 10)), 300);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('arquivos', f));
      fd.append('animalId', animalId);
      if (isImagem) fd.append('tipo', 'Imagem');
      if (ex) fd.append('exameId', String(ex.id));
      const res = await api.post('/clinica/exames/analisar', fd);
      setProgresso(100);
      const d = res.data?.dados;
      if (d) {
        if (Array.isArray(d.naoTranscritos) && d.naoTranscritos.length > 0) setNaoTranscritos(d.naoTranscritos);
        if (isImagem) {
          if (d.laudo)     setLaudo(d.laudo);
          if (d.dataExame) setDataExame(d.dataExame);
        } else {
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
      }
    } catch (err: unknown) {
      // best-effort para falha/indisponibilidade da IA — mas "nenhum arquivo é um
      // exame", "esse exame já foi carregado" e "formato não suportado" são
      // diagnóstico, não indisponibilidade, e precisam aparecer: sem isto, o
      // usuário confirmaria uma tabela vazia (ou duplicada) sem entender por quê.
      const resp = (err as { response?: { data?: { code?: string; error?: string } } })?.response;
      if (['ARQUIVO_NAO_E_EXAME', 'EXAME_JA_CARREGADO', 'FORMATO_ARQUIVO_NAO_SUPORTADO'].includes(resp?.data?.code ?? '')) {
        setErro(resp?.data?.error ?? 'Não foi possível analisar o(s) arquivo(s).');
      }
    } finally {
      clearInterval(interval);
      setAnalisando(false);
    }
  };

  const confirmar = () => {
    if (!descricao.trim()) { setErro('Informe a descrição do exame'); return; }
    if (isImagem) {
      if (arquivos.length === 0 && !laudo.trim()) { setErro('Anexe as imagens ou escreva o laudo'); return; }
    } else if (preenchidos.length === 0) {
      setErro('Informe ao menos um parâmetro do resultado');
      return;
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
            {isImagem ? <Scan size={16} className="text-emerald-700 flex-shrink-0" />
                      : ex ? <ClipboardList size={16} className="text-emerald-700 flex-shrink-0" />
                           : <FilePlus2 size={16} className="text-emerald-700 flex-shrink-0" />}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-900">{ex ? 'Carregar Resultados' : 'Carregar Exames sem Pedido'}</h3>
                {somenteLeitura && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 flex-shrink-0">
                    Somente leitura
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500 truncate">
                {ex ? `${numeroExame(ex)} · ${ex.tipo} · ${ex.descricao}` : 'Achado antigo ou laudo externo — sem passar pelo Pedido de Exames'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* `somenteLeitura`: dois <fieldset disabled> em volta dos campos — a
              lista de arquivos SALVOS, entre eles, fica DE FORA de propósito
              (senão o "ver arquivo" também travaria; fieldset desabilita todo
              controle de formulário descendente, `<button>` incluso). Nunca usar
              `className="contents"` no fieldset — quebra o `space-y-*`, que
              seleciona só filho direto (mesma armadilha da tela de Exame de
              Compra, CLAUDE.md). */}
          <fieldset disabled={somenteLeitura} className="min-w-0 space-y-4 border-0 p-0 m-0">
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                Descrição do exame *
              </label>
              <input type="text" value={descricao} onChange={e => setDescricao(e.target.value)}
                placeholder="Nome do exame"
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
          </fieldset>

          {somenteLeitura ? (
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                Arquivos anexados
              </label>
              {arquivosSalvos && arquivosSalvos.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {arquivosSalvos.map((a, idx) => (
                    <button key={idx} type="button" onClick={() => onVerArquivo?.(idx)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-xl text-xs text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 transition-colors">
                      <Eye size={12} /> {a.nome}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">Nenhum arquivo anexado.</p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                {isImagem ? 'Imagens / laudo (PDF ou imagem)' : 'Anexar laudo(s) (opcional)'}
              </label>
              <SeletorArquivo multiple
                onEscolher={lista => {
                  // A cada mudança na seleção, a IA lê o LOTE INTEIRO de novo — é o que
                  // garante que todo arquivo anexado seja tratado (inclusive ao trocar
                  // a seleção por uma nova, que substitui a anterior).
                  setArquivos(lista);
                  if (lista.length > 0) analisarArquivo(lista);
                }}
                onFoto={foto => {
                  const nova = [...arquivos, foto];
                  setArquivos(nova);
                  analisarArquivo(nova);
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
                    {isImagem
                      ? `Lendo o laudo com IA — transcrevendo o texto… ${progresso}%`
                      : `Lendo o laudo com IA — identificando laboratório e resultado… ${progresso}%`}
                  </p>
                </div>
              )}
              {naoTranscritos.length > 0 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2">
                  {naoTranscritos.length === 1
                    ? `O arquivo "${naoTranscritos[0]}" não é suportado para ser interpretado, ele será somente salvo no resultado. Os formatos suportados para leitura automática são ${isImagem ? 'PDF, DOCX ou TXT' : 'PDF, DOCX, TXT ou imagem'}.`
                    : `Os arquivos ${naoTranscritos.map(n => `"${n}"`).join(', ')} não são suportados para serem interpretados, eles serão somente salvos no resultado. Os formatos suportados para leitura automática são ${isImagem ? 'PDF, DOCX ou TXT' : 'PDF, DOCX, TXT ou imagem'}.`}
                </p>
              )}
            </div>
          )}

          <fieldset disabled={somenteLeitura} className="min-w-0 space-y-4 border-0 p-0 m-0">
            {isImagem ? (
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                  Laudo {arquivos.length === 0 ? '*' : ''}
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
          </fieldset>

          <InlineError message={erro ?? erroSalvar} />
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          {somenteLeitura ? (
            <button onClick={onClose}
              className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              Fechar
            </button>
          ) : (
            <>
              <button onClick={onClose} disabled={saving}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={confirmar} disabled={saving}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {ex ? 'Salvar resultado' : 'Salvar exame'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal de preenchimento MANUAL do resultado (só Laboratorial/Bioquímico) ──
// Nem todo laboratório entrega arquivo — às vezes só dita os valores por telefone.
// Digita a tabela direto, sem anexar nada. Some do fluxo de Imagem: lá o laudo
// digitado já cabe dentro do "Carregar Resultados" (campo Laudo), sem precisar de
// uma tabela estruturada.

export function ResultadoManualModal({ ex, saving, onClose, onSalvar }: {
  ex:       ExameSolicitado;
  saving:   boolean;
  onClose:  () => void;
  onSalvar: (data: { laudo: string; itens: ItemManual[] }) => void;
}) {
  const [itens, setItens] = useState<ItemManual[]>([{ ...LINHA_VAZIA }]);
  const [laudo, setLaudo] = useState(ex.resultado ?? '');
  const [erro,  setErro]  = useState<string | null>(null);

  const confirmar = () => {
    const preenchidos = itens.filter(i => i.parametro.trim());
    if (preenchidos.length === 0) { setErro('Informe ao menos um parâmetro do resultado'); return; }
    setErro(null);
    onSalvar({ laudo: laudo.trim(), itens: preenchidos });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl border border-gray-100 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardList size={16} className="text-emerald-700 flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900">Preencher manualmente</h3>
              <p className="text-[11px] text-gray-500 truncate">
                {numeroExame(ex)} · {ex.tipo} · {ex.descricao}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
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

// ─── Painel ───────────────────────────────────────────────────────────────────

export default function ExamesSolicitadosPanel({ animalId, tipo, onSalvo, onRealizadosChange }: Props) {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  // Gate do RESULTADO — distinto do gate do PEDIDO (armadilha 29 do CLAUDE.md)
  const podeResultadoLab = isGestor || podeExecutar('exames.laboratorial.editar');
  const podeResultadoImg = isGestor || podeExecutar('exames.imagem.editar');
  const podeLancar = (ex: ExameSolicitado) => (ex.tipo === 'Imagem' ? podeResultadoImg : podeResultadoLab);
  // Cancelar o PEDIDO (soft delete, ativo:false) é ação do pedido, não do resultado:
  // usa o mesmo slug/endpoint do "Cancelar" da tela de Pedido de Exames — é o que faz
  // o cancelamento aparecer como CANCELADA no Histórico de Exames de lá também.
  // Sem filtro por autoria — quem tem a ação concedida opera o registro (CLAUDE.md 28-c).
  const podeCancelar = isGestor || podeExecutar('atendimento.exames.deletar');
  // "Preencher manualmente" (tabela sem arquivo) só na aba Laboratorial — na aba
  // Imagem o laudo digitado já cabe dentro do "Carregar Resultados" (upload).
  const permiteManual = tipo === 'laboratorial';

  const [pendentes,  setPendentes]  = useState<ExameSolicitado[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro,       setErro]       = useState<string | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [alvo,       setAlvo]       = useState<ExameSolicitado | null>(null);
  const [alvoManual, setAlvoManual] = useState<ExameSolicitado | null>(null);
  const [naoPedidoAberto, setNaoPedidoAberto] = useState(false);
  // Erro do POST de criação do "não pedido" — separado do `erro` do painel (topo da
  // página) porque precisa aparecer DENTRO do modal, que cobre a tela toda.
  const [erroNaoPedido, setErroNaoPedido] = useState<string | null>(null);
  // Confirmação do "Cancelar": é uma exclusão (soft delete) e exige motivo, como toda
  // exclusão/cancelamento da aplicação (ModalJustificativa).
  const [cancelando,        setCancelando]        = useState<ExameSolicitado | null>(null);
  const [salvandoCancelamento, setSalvandoCancelamento] = useState(false);
  const [erroCancelamento,  setErroCancelamento]  = useState<string | null>(null);

  // Guarda a chamada MAIS RECENTE — trocar de aba (Laboratorial ↔ Imagem no submenu
  // do Sidebar) refaz o fetch com o `tipo` novo, mas a resposta da aba ANTERIOR pode
  // chegar DEPOIS (rede fora de ordem). Sem este guard, a resposta atrasada
  // sobrescrevia a lista com o `tipo` errado — era assim que um pedido de Imagem
  // aparecia na tela de resultado Laboratorial (ou vice-versa) depois de trocar de
  // aba rápido. Só a chamada cujo id ainda é o mais recente pode gravar estado.
  const requestIdRef = useRef(0);

  const carregar = useCallback(async () => {
    if (!animalId) return;
    const meuRequestId = ++requestIdRef.current;
    setCarregando(true);
    try {
      const res = await api.get(`/clinica/exames/animal/${animalId}`);
      if (requestIdRef.current !== meuRequestId) return; // resposta desatualizada
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
      if (requestIdRef.current !== meuRequestId) return;
      setErro('Erro ao carregar os exames solicitados');
    } finally {
      if (requestIdRef.current === meuRequestId) setCarregando(false);
    }
  }, [animalId, tipo, onRealizadosChange]);

  useEffect(() => {
    if (loadingPerms) return;   // evita 403 antes de as permissões carregarem
    carregar();
  }, [carregar, loadingPerms]);

  const salvarResultado = async ({ laudo, laboratorio, itens, arquivos }: { laudo: string; laboratorio: string; itens: ItemManual[]; arquivos: File[] }) => {
    if (!alvo) return;
    setSaving(true);
    setErro(null);
    try {
      const fd = new FormData();
      if (laudo) fd.append('resultado', laudo);
      fd.append('laboratorio', laboratorio);
      if (itens.length > 0) fd.append('itens', JSON.stringify(itens));
      arquivos.forEach(a => fd.append('arquivos', a));
      await api.patch(`/clinica/exames/${alvo.id}/resultado`, fd);
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

  // Preenchimento MANUAL (só Laboratorial) — mesmo endpoint, só a tabela em JSON,
  // sem arquivo nenhum.
  const salvarResultadoManual = async ({ laudo, itens }: { laudo: string; itens: ItemManual[] }) => {
    if (!alvoManual) return;
    setSaving(true);
    setErro(null);
    try {
      const fd = new FormData();
      if (laudo) fd.append('resultado', laudo);
      fd.append('itens', JSON.stringify(itens));
      await api.patch(`/clinica/exames/${alvoManual.id}/resultado`, fd);
      setAlvoManual(null);
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

  // Cancela o PEDIDO (soft delete, ativo:false) — mesmo endpoint/comportamento do
  // "Cancelar exame" da tela de Pedido de Exames: sai da fila de espera aqui E passa
  // a constar CANCELADA no Histórico de Exames de lá (getStatusExame usa !ativo).
  const cancelarExame = async (motivo: string) => {
    if (!cancelando) return;
    setSalvandoCancelamento(true);
    setErroCancelamento(null);
    try {
      await api.delete(`/clinica/exames/${cancelando.id}`, { data: { motivo } });
      setCancelando(null);
      await carregar();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroCancelamento(msg ?? 'Erro ao cancelar o exame');
    } finally {
      setSalvandoCancelamento(false);
    }
  };

  if (loadingPerms) return null;
  // O painel some só para quem não pode NEM lançar resultado NEM cancelar o pedido.
  // Quem tem apenas `atendimento.exames.deletar` continua vendo a fila — é dele a
  // decisão de cancelar o pedido que nunca vai receber laudo.
  const podeLancarNaAba = tipo === 'imagem' ? podeResultadoImg : podeResultadoLab;
  if (!podeLancarNaAba && !podeCancelar) return null;

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
              <FilePlus2 size={13} /> Carregar Exames sem Pedido
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
                    <button onClick={() => setAlvo(ex)}
                      title="Carregar Resultados" aria-label="Carregar Resultados"
                      className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors">
                      <Upload size={15} />
                    </button>
                  )}
                  {permiteManual && podeLancar(ex) && (
                    <button onClick={() => setAlvoManual(ex)}
                      title="Preencher manualmente" aria-label="Preencher manualmente"
                      className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                      <Table2 size={15} />
                    </button>
                  )}
                  {podeCancelar && (
                    <button onClick={() => { setErroCancelamento(null); setCancelando(ex); }}
                      title="Cancelar" aria-label="Cancelar"
                      className="p-1.5 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Ban size={15} />
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
                          <button onClick={() => setAlvo(ex)}
                            title="Carregar Resultados" aria-label="Carregar Resultados"
                            className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors">
                            <Upload size={15} />
                          </button>
                        )}
                        {permiteManual && podeLancar(ex) && (
                          <button onClick={() => setAlvoManual(ex)}
                            title="Preencher manualmente" aria-label="Preencher manualmente"
                            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                            <Table2 size={15} />
                          </button>
                        )}
                        {podeCancelar && (
                          <button onClick={() => { setErroCancelamento(null); setCancelando(ex); }}
                            title="Cancelar" aria-label="Cancelar"
                            className="p-1.5 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Ban size={15} />
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
          ex={alvo}
          animalId={animalId}
          saving={saving}
          onClose={() => setAlvo(null)}
          onSalvar={salvarResultado}
        />
      )}

      {alvoManual && (
        <ResultadoManualModal
          ex={alvoManual}
          saving={saving}
          onClose={() => setAlvoManual(null)}
          onSalvar={salvarResultadoManual}
        />
      )}

      {naoPedidoAberto && (
        <ResultadoModal
          ex={null}
          tipoAba={tipo}
          animalId={animalId}
          saving={saving}
          erroSalvar={erroNaoPedido}
          onClose={() => setNaoPedidoAberto(false)}
          onSalvar={salvarNaoPedido}
        />
      )}

      <ModalJustificativa
        aberto={cancelando != null}
        titulo="Cancelar exame"
        descricao={cancelando ? `${cancelando.tipo}: ${cancelando.descricao}` : undefined}
        acaoLabel="Cancelar exame"
        processando={salvandoCancelamento}
        erro={erroCancelamento}
        onConfirmar={cancelarExame}
        onFechar={() => setCancelando(null)}
      />
    </div>
  );
}

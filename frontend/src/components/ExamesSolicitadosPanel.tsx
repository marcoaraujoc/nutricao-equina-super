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

import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, Scan, Upload, PencilLine, Loader2, X, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import api from '../services/api';
import InlineError from './InlineError';
import { usePermissoes } from '../hooks/usePermissoes';
// Mesma regra de "tem resultado?" da tela de Pedido de Exames — o rótulo
// "Finalizado sem Resultado" tem de ser idêntico nas duas telas.
import { temResultadoExame } from '../utils/exameClinico';

type TipoExame = 'Laboratorial' | 'Bioquímico' | 'Imagem' | 'Compra';

interface ResultadoItem {
  id:         number;
  parametro:  string;
  valor:      string | null;
  unidade:    string | null;
  referencia: string | null;
}

interface ExameSolicitado {
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

// ─── Modal do resultado ───────────────────────────────────────────────────────
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

  const setItem = (idx: number, campo: keyof ItemManual, valor: string) =>
    setItens(prev => prev.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l)));

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
                <input type="file" accept="image/*,application/pdf" multiple={isImagem}
                  onChange={e => setArquivos(Array.from(e.target.files ?? []))}
                  className="w-full text-xs text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:text-xs file:font-semibold" />
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
                {/* Cabeçalho só no desktop: no mobile cada linha vira um bloco com
                    rótulos próprios (regra mobile-first da aplicação). */}
                <div className="hidden md:grid grid-cols-[1.6fr_1fr_0.8fr_1.2fr_auto] gap-2 mb-1 px-1">
                  {['Parâmetro', 'Valor', 'Unidade', 'Referência'].map(h => (
                    <span key={h} className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{h}</span>
                  ))}
                  <span />
                </div>
                <div className="space-y-2">
                  {itens.map((linha, idx) => (
                    <div key={idx} className="grid grid-cols-2 md:grid-cols-[1.6fr_1fr_0.8fr_1.2fr_auto] gap-2 items-center">
                      <input value={linha.parametro} onChange={e => setItem(idx, 'parametro', e.target.value)}
                        placeholder="Hemoglobina" aria-label="Parâmetro"
                        className="col-span-2 md:col-span-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                      <input value={linha.valor} onChange={e => setItem(idx, 'valor', e.target.value)}
                        placeholder="12,4" aria-label="Valor"
                        className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                      <input value={linha.unidade} onChange={e => setItem(idx, 'unidade', e.target.value)}
                        placeholder="g/dL" aria-label="Unidade"
                        className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                      <input value={linha.referencia} onChange={e => setItem(idx, 'referencia', e.target.value)}
                        placeholder="11 – 17" aria-label="Referência"
                        className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                      <button type="button" title="Remover linha"
                        onClick={() => setItens(prev => (prev.length === 1 ? [{ ...LINHA_VAZIA }] : prev.filter((_, i) => i !== idx)))}
                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors justify-self-end">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setItens(prev => [...prev, { ...LINHA_VAZIA }])}
                  className="mt-2 flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-semibold hover:bg-emerald-50 transition-colors">
                  <Plus size={13} /> Adicionar parâmetro
                </button>
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

// ─── Painel ───────────────────────────────────────────────────────────────────

export default function ExamesSolicitadosPanel({ animalId, tipo, onSalvo }: Props) {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  // Gate do RESULTADO — distinto do gate do PEDIDO (armadilha 29 do CLAUDE.md)
  const podeResultadoLab = isGestor || podeExecutar('exames.laboratorial.editar');
  const podeResultadoImg = isGestor || podeExecutar('exames.imagem.editar');
  const podeLancar = (ex: ExameSolicitado) => (ex.tipo === 'Imagem' ? podeResultadoImg : podeResultadoLab);
  // Encerrar o PEDIDO é ação do pedido, não do resultado: usa o slug do Atendimento.
  // Sem filtro por autoria — quem tem a ação concedida opera o registro (CLAUDE.md 28-c).
  const podeFinalizar = isGestor || podeExecutar('atendimento.exames.finalizar');

  const [pendentes,  setPendentes]  = useState<ExameSolicitado[]>([]);
  // Os já lançados ficam logo abaixo, em leitura: o resultado salvo aqui pertence ao
  // ExameClinico, que NÃO aparece na lista de exames nutricionais desta página — sem
  // este bloco, quem acabou de lançar o laudo veria a linha sumir e nada no lugar.
  const [realizados, setRealizados] = useState<ExameSolicitado[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro,       setErro]       = useState<string | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [alvo,       setAlvo]       = useState<{ ex: ExameSolicitado; modo: 'upload' | 'manual' } | null>(null);
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
      if (!res.data) { setPendentes([]); setRealizados([]); return; }
      const permitidos = tiposDaAba(tipo);
      const lista = ((res.data.dados ?? []) as ExameSolicitado[])
        .filter(ex => ex.ativo && permitidos.includes(ex.tipo));
      // Encerrado é encerrado: REALIZADO (veio resultado) e CONCLUIDO (finalizado sem
      // que viesse) saem da fila de espera — senão o pedido finalizado continuaria
      // pedindo resultado para sempre.
      const encerrado = (ex: ExameSolicitado) => ex.status === 'REALIZADO' || ex.status === 'CONCLUIDO';
      setPendentes(lista.filter(ex => !encerrado(ex)));
      setRealizados(lista.filter(encerrado));
    } catch {
      setErro('Erro ao carregar os exames solicitados');
    } finally {
      setCarregando(false);
    }
  }, [animalId, tipo]);

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
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
          Exames solicitados aguardando resultado{pendentes.length > 0 ? ` (${pendentes.length})` : ''}
        </p>
        {carregando && <Loader2 size={14} className="animate-spin text-emerald-600" />}
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

      {/* Resultados já lançados nesta aba — leitura. Fecha o ciclo da tela: o pedido
          sai da lista de cima e reaparece aqui com o que foi carregado. */}
      {realizados.length > 0 && (
        <div className="border-t border-gray-100">
          <p className="px-4 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">
            Exames encerrados ({realizados.length})
          </p>
          <div className="divide-y divide-gray-50">
            {realizados.map(ex => (
              <div key={ex.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{ex.descricao}</span>
                  {/* Mesmo vocabulário da tela de Pedido de Exames: sem conteúdo
                      nenhum, o pedido foi encerrado VAZIO e isso precisa aparecer. */}
                  {!temResultadoExame(ex) ? (
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">
                      Finalizado sem Resultado
                    </span>
                  ) : (
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">
                      {ex.status === 'REALIZADO' ? 'Realizado' : 'Finalizado'}
                    </span>
                  )}
                  {ex.arquivoUrl && (
                    <a href={ex.arquivoUrl} target="_blank" rel="noreferrer"
                      className="text-[11px] font-semibold text-emerald-700 hover:underline">
                      ver laudo
                    </a>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {numeroExame(ex)}
                  {ex.dataResultado ? ` · resultado em ${formatData(ex.dataResultado)}` : ''}
                </p>

                {ex.resultado && (
                  <p className="text-xs text-gray-600 mt-1.5 whitespace-pre-wrap">{ex.resultado}</p>
                )}

                {ex.resultadoItens?.length > 0 && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-400">
                          <th className="py-1 pr-3 font-semibold">Parâmetro</th>
                          <th className="py-1 pr-3 font-semibold">Valor</th>
                          <th className="py-1 pr-3 font-semibold">Unidade</th>
                          <th className="py-1 font-semibold">Referência</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-700">
                        {ex.resultadoItens.map(it => (
                          <tr key={it.id} className="border-t border-gray-50">
                            <td className="py-1 pr-3">{it.parametro}</td>
                            <td className="py-1 pr-3 font-medium">{it.valor ?? '—'}</td>
                            <td className="py-1 pr-3 text-gray-500">{it.unidade ?? '—'}</td>
                            <td className="py-1 text-gray-500">{it.referencia ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {ex.imagens?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {ex.imagens.map(img => (
                      <a key={img.id} href={img.arquivoUrl} target="_blank" rel="noreferrer"
                        className="text-[11px] px-2 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
                        {img.nome ?? `imagem ${img.id}`}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {alvo && (
        <ResultadoModal
          ex={alvo.ex}
          modo={alvo.modo}
          saving={saving}
          onClose={() => setAlvo(null)}
          onSalvar={salvarResultado}
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

// frontend/src/pages/SubModuloExames.tsx — requisições de exames clínicos com catálogo

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FlaskConical, Scan, Ban, Eye, Loader2, X, Pencil,
  ChevronLeft, ChevronRight, FileText, Check, Plus,
  ChevronDown, Printer, Mail, MessageCircle, CheckCircle2, Clock,
} from 'lucide-react';
import api from '../services/api';
import { hojeISO } from '../utils/dateUtils';
import toast from 'react-hot-toast';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import ModalJustificativa from '../components/ModalJustificativa';
import ConfirmModal from '../components/ConfirmModal';
import DateInput from '../components/DateInput';
import type { AnimalInfo } from './SubModuloEvolucao';
import { imprimirExame as imprimirExameUtil } from '../utils/ExamePrint';
import { abrirWhatsApp, abrirEmail } from '../utils/compartilhar';
import InlineError from '../components/InlineError';
import JustificativaCancelamento from '../components/JustificativaCancelamento';
import LaudoTexto from '../components/LaudoTexto';


// ─── Types catálogo ───────────────────────────────────────────────────────────

interface LabItem      { id: number; nome: string; contato?: string | null }
interface GrupoItem    { id: number; nome: string; ordem: number }
interface ExameItemCat { id: number; nome: string; sigla?: string | null; tiposAmostra: string[] }

const TIPOS_AMOSTRA = [
  { value: 'Sangue Total com EDTA',  label: 'Sangue Total com EDTA (Tubo Roxo)' },
  { value: 'Soro Sanguíneo',         label: 'Soro Sanguíneo (Tubo Amarelo/Vermelho)' },
  { value: 'Plasma Fluoreto',        label: 'Plasma Fluoreto (Tubo Cinza) — Glicose / Lactato' },
  { value: 'Plasma Citratado',       label: 'Plasma Citratado (Tubo Azul) — Coagulograma' },
  { value: 'Urina',                  label: 'Urina' },
  { value: 'Fezes',                  label: 'Fezes Frescas' },
  { value: 'Swab',                   label: 'Swab / Secreção / Suabe' },
  { value: 'Raspado Cutâneo',        label: 'Raspado Cutâneo' },
  { value: 'Líquido Cavitário',      label: 'Líquido Cavitário (Pleural / Peritoneal / Sinovial)' },
  { value: 'Líquor',                 label: 'Líquor (LCR)' },
  { value: 'Fragmento / Biópsia',    label: 'Fragmento / Biópsia' },
] as const;

// ─── Catalog imagem (dinâmico via API) ───────────────────────────────────────

interface ImagemGrupoItem { id: number; nome: string; categoria: string; ordem: number }
interface ImagemExameItemCat { id: number; codigo: string; nome: string; sigla: string | null; especie: string }

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoExame  = 'Laboratorial' | 'Bioquímico' | 'Imagem' | 'Compra';
type MainTab    = 'laboratorial' | 'imagem';

interface GrupoExtraInfo {
  tipo:             TipoExame;
  laboratorio:      string | null;
  dataHoraColeta:   string | null;
  nome:             string | null;
  exames:           string[] | null;
  tipoAmostra:      string | null;
  qtdAmostra:       number | null;
  indicacaoClinica: string | null;
  obs:              string | null;
}

interface ExtraInfo {
  laboratorio:      string | null;
  dataHoraColeta:   string | null;
  tipoAmostra:      string | null;
  indicacaoClinica: string | null;
  obs:              string | null;
  grupoNome?:       string | null;
  grupos?:          GrupoExtraInfo[] | null;
}

interface PendingExamGroup {
  localId:          string;
  tipo:             TipoExame;
  descricao:        string;
  laboratorio:      string | null;
  dataHoraColeta:   string | null;
  tipoAmostra:      string | null;
  qtdAmostra:       number | null;
  indicacaoClinica: string | null;
  observacao:       string | null;
  grupoNome:        string | null;
  dataSolicitacao:  string;
  laudoCompra:      null;
  examsDisplay:     string[];
  labNomeDisplay:   string;
}

interface ExameResultadoItem { id: number; parametro: string; valor: string | null; unidade: string | null; referencia: string | null; ordem: number }
interface ExameImagemAnexo  { id: number; nome: string | null; arquivoUrl: string }

interface ExameClinico {
  id:              number;
  numero:          number | null;
  tipo:            TipoExame;
  descricao:       string;
  status:          string;
  ativo:           boolean;
  evolucaoId?:     number | null;
  observacao:      string | null;
  qtdAmostra:      number | null;
  dataSolicitacao: string;
  dataResultado?:  string | null;
  resultado?:      string | null;
  resultadoItens?: ExameResultadoItem[];
  imagens?:        ExameImagemAnexo[];
  veterinario:     { id: number; fullName: string } | null;
  // Justificativa do cancelamento (exame INATIVO, ativo:false). O registro não tem
  // coluna própria para isso — o backend a resolve a partir do AuditLog na listagem.
  justificativa?:  string | null;
}

const fmtNumero = (n: number | null | undefined) =>
  n != null ? `#${String(n).padStart(3, '0')}` : '—';

interface Props {
  animalId:           number;
  animal:             AnimalInfo | null;
  evolucaoId?:        number;
  /** Evolução ativa existe, mas pertence a OUTRO profissional (não assumida por
   *  mim, e eu não sou gestor) — bloqueia a CRIAÇÃO de pedido de exame nela.
   *  O backend já recusa com 403 (ExameClinicoController.criar); isto só evita o
   *  formulário inteiro preenchido pra falhar no fim. */
  evolucaoDeOutro?:   boolean;
  atendimentoNumero?: string;
  onSalvo?:           () => void;
  openItemId?:        number;
  onViewConsumed?:    () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// `hojeISO()` (utils/dateUtils) e nao `toISOString().slice(0,10)`: este ultimo
// devolve o dia em UTC, que a noite ja e AMANHA em qualquer fuso do Brasil.
const hoje = () => hojeISO();

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

function parseExtra(obs: string | null): ExtraInfo {
  if (!obs) return { laboratorio: null, dataHoraColeta: null, tipoAmostra: null, indicacaoClinica: null, obs: null };
  try   { return JSON.parse(obs) as ExtraInfo; }
  catch { return { laboratorio: null, dataHoraColeta: null, tipoAmostra: null, indicacaoClinica: null, obs }; }
}

// Nomes INDIVIDUAIS dos exames de um registro do histórico — usa os grupos
// estruturados (multi-lab) quando existem, senão cai no split da `descricao`
// (mesmo fallback que `ViewModal` já usa para o registro "simples").
function nomesExamesDoRegistro(ex: ExameClinico): string[] {
  const extra  = parseExtra(ex.observacao);
  const grupos = (extra.grupos ?? []).filter(g => g.exames && g.exames.length > 0);
  if (grupos.length > 0) return grupos.flatMap(g => g.exames ?? []);
  return ex.descricao.split(', ').filter(Boolean);
}

// ─── ViewModal ────────────────────────────────────────────────────────────────

const TIPOS_META: Record<TipoExame, { badge: string }> = {
  Laboratorial: { badge: 'bg-blue-100 text-blue-700' },
  Bioquímico:   { badge: 'bg-violet-100 text-violet-700' },
  Imagem:       { badge: 'bg-emerald-100 text-emerald-700' },
  Compra:       { badge: 'bg-amber-100 text-amber-700' },
};

// Ciclo do PEDIDO de exame: SALVA (solicitado) → FINALIZADA (concluído) /
// REALIZADA (resultado carregado). CANCELADA = pedido cancelado (soft delete).
type StatusExameUI    = 'SALVA' | 'FINALIZADA' | 'REALIZADA' | 'CANCELADA';
type FiltroStatusExame = 'todos' | 'SALVA' | 'FINALIZADA' | 'REALIZADA' | 'CANCELADA';

function getStatusExame(ex: ExameClinico): StatusExameUI {
  if (!ex.ativo) return 'CANCELADA';
  if (ex.status === 'REALIZADO') return 'REALIZADA';
  return ex.status === 'CONCLUIDO' ? 'FINALIZADA' : 'SALVA';
}

const FILTROS_EXAME: { key: FiltroStatusExame; label: string }[] = [
  { key: 'todos',      label: 'Todos'       },
  { key: 'SALVA',      label: 'Solicitados' },
  { key: 'FINALIZADA', label: 'Finalizados' },
  { key: 'REALIZADA',  label: 'Realizados'  },
  { key: 'CANCELADA',  label: 'Cancelados'  },
];

function StatusExameBadge({ status }: { status: StatusExameUI }) {
  if (status === 'CANCELADA') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-600">
        <Ban size={9} /> CANCELADO
      </span>
    );
  }
  if (status === 'REALIZADA') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-teal-100 text-teal-700">
        <CheckCircle2 size={9} /> REALIZADO
      </span>
    );
  }
  if (status === 'FINALIZADA') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">
        <CheckCircle2 size={9} /> FINALIZADO
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700">
      <Clock size={9} /> SOLICITADO
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-gray-400 w-32 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 font-medium">{value}</span>
    </div>
  );
}

function ViewModal({ ex, onFechar }: { ex: ExameClinico; onFechar: () => void }) {
  const extra    = parseExtra(ex.observacao);
  const tipoMeta = TIPOS_META[ex.tipo];

  // Grupos estruturados (multi-lab) salvos no observacao
  const grupos   = (extra.grupos ?? []).filter(g => g.exames && g.exames.length > 0);

  // Agrupa por laboratório preservando ordem de aparição
  const labOrder: string[]                          = [];
  const labMap:   Map<string, GrupoExtraInfo[]>     = new Map();
  for (const g of grupos) {
    const key = g.laboratorio?.trim() || 'Sem laboratório';
    if (!labMap.has(key)) { labMap.set(key, []); labOrder.push(key); }
    labMap.get(key)!.push(g);
  }
  const temBlocos = labOrder.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-blue-600" />
            <h3 className="font-bold text-gray-900">Detalhes do Exame</h3>
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {/* Cabeçalho: tipo + status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${tipoMeta?.badge ?? 'bg-gray-100 text-gray-600'}`}>
              {ex.tipo}
            </span>
            <StatusExameBadge status={getStatusExame(ex)} />
            <span className="text-xs text-gray-400 ml-auto">{formatDate(ex.dataSolicitacao)}</span>
          </div>

          {/* Blocos por laboratório (quando há grupos estruturados) */}
          {temBlocos ? (
            <div className="space-y-3">
              {labOrder.map(lab => {
                const gs = labMap.get(lab)!;
                const dataColeta = gs.find(g => g.dataHoraColeta)?.dataHoraColeta;
                const amostra    = gs.find(g => g.tipoAmostra)?.tipoAmostra;
                const indicacao  = gs.map(g => g.indicacaoClinica).filter(Boolean).join('; ');
                return (
                  <div key={lab} className="border border-blue-100 rounded-xl overflow-hidden">
                    {/* Cabeçalho do laboratório */}
                    <div className="flex items-center gap-2 bg-blue-50 px-3 py-2 border-b border-blue-100">
                      <FlaskConical size={13} className="text-blue-500 flex-shrink-0" />
                      <span className="text-xs font-bold text-blue-800 uppercase tracking-wide">{lab}</span>
                    </div>

                    {/* Grupos deste laboratório */}
                    <div className="divide-y divide-gray-50">
                      {gs.map((g, gi) => (
                        <div key={gi} className="px-3 py-2.5">
                          {g.nome && (
                            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                              {g.nome}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1">
                            {g.exames!.map((e, ei) => (
                              <span key={ei} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                                {e}
                              </span>
                            ))}
                          </div>
                          {g.obs && (
                            <p className="text-[11px] text-gray-400 mt-1.5">Preparo: {g.obs}</p>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Metadados comuns do lab */}
                    {(dataColeta || amostra || indicacao) && (
                      <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 space-y-0.5">
                        {dataColeta && (
                          <p className="text-[11px] text-gray-500">
                            <span className="font-medium">Coleta:</span> {new Date(dataColeta).toLocaleString('pt-BR')}
                          </p>
                        )}
                        {amostra && (
                          <p className="text-[11px] text-gray-500">
                            <span className="font-medium">Amostra:</span> {amostra}
                          </p>
                        )}
                        {indicacao && (
                          <p className="text-[11px] text-gray-500">
                            <span className="font-medium">Indicação:</span> {indicacao}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Fallback: exame simples sem grupos estruturados */
            <>
              {extra.laboratorio      && <Row label="Laboratório"       value={extra.laboratorio} />}
              {extra.dataHoraColeta   && <Row label="Data/Hora Coleta"  value={new Date(extra.dataHoraColeta).toLocaleString('pt-BR')} />}
              {extra.tipoAmostra      && <Row label="Tipo de Amostra"   value={extra.tipoAmostra} />}
              {ex.qtdAmostra != null && (ex.tipo === 'Imagem'
                ? <Row label="Qtd. de Imagens"  value={`${ex.qtdAmostra} imagem${ex.qtdAmostra !== 1 ? 's' : ''}`} />
                : <Row label="Qtd. de Amostras" value={`${ex.qtdAmostra} amostra${ex.qtdAmostra !== 1 ? 's' : ''}`} />)}
              {extra.indicacaoClinica && <Row label="Indicação Clínica" value={extra.indicacaoClinica} />}
              {extra.obs              && <Row label="Preparo / Obs."    value={extra.obs} />}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Exames solicitados</p>
                <div className="flex flex-wrap gap-1.5">
                  {ex.descricao.split(', ').map(e => (
                    <span key={e} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">{e}</span>
                  ))}
                </div>
              </div>
            </>
          )}

          {ex.veterinario && (
            <p className="text-[11px] text-gray-400 pt-1">
              Solicitado por <span className="font-medium text-gray-600">{ex.veterinario.fullName}</span>
            </p>
          )}

          {/* ── Resultado carregado ─────────────────────────────────────── */}
          {((ex.resultadoItens?.length ?? 0) > 0 || (ex.imagens?.length ?? 0) > 0 || (ex.resultado ?? '').trim()) && (
            <div className="border-t border-gray-100 pt-3 space-y-3">
              <p className="text-xs font-semibold text-teal-700 uppercase tracking-wide flex items-center gap-1.5">
                <CheckCircle2 size={13} /> Resultado
              </p>

              {(ex.resultadoItens?.length ?? 0) > 0 && (
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500">
                        <th className="text-left px-3 py-2 font-semibold">Parâmetro</th>
                        <th className="text-left px-3 py-2 font-semibold">Valor</th>
                        <th className="text-left px-3 py-2 font-semibold">Unidade</th>
                        <th className="text-left px-3 py-2 font-semibold">Referência</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {ex.resultadoItens!.map(it => (
                        <tr key={it.id}>
                          <td className="px-3 py-2 text-gray-800 font-medium">{it.parametro}</td>
                          <td className="px-3 py-2 text-gray-700">{it.valor ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-500">{it.unidade ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-500">{it.referencia ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(ex.resultado ?? '').trim() && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Laudo</p>
                  <LaudoTexto texto={ex.resultado ?? ''} className="text-sm text-gray-800 whitespace-pre-wrap" />
                </div>
              )}

              {(ex.imagens?.length ?? 0) > 0 && (
                <div>
                  {/* Rótulo genérico: além das fotos do exame de Imagem, este mesmo
                      anexo passou a guardar TODOS os arquivos de um Laboratorial/
                      Bioquímico com mais de um arquivo carregado (ver CLAUDE.md,
                      seção do exame clínico) — nem sempre é uma "imagem". */}
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Arquivos ({ex.imagens!.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {ex.imagens!.map(img => {
                      // PDF não renderiza em <img> — vira ícone + nome, não uma
                      // miniatura quebrada. Laboratorial anexa PDF com frequência.
                      const ehPdf = /\.pdf(\?|$)/i.test(img.nome ?? img.arquivoUrl ?? '');
                      return (
                        <a key={img.id} href={img.arquivoUrl} target="_blank" rel="noreferrer"
                          className="block w-20 h-20 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 hover:border-blue-300 transition-colors"
                          title={img.nome ?? 'Arquivo'}>
                          {ehPdf ? (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-1">
                              <FileText size={22} className="text-gray-400" />
                              <span className="text-[9px] text-gray-500 truncate w-full text-center">{img.nome ?? 'PDF'}</span>
                            </div>
                          ) : (
                            <img src={img.arquivoUrl} alt={img.nome ?? 'Arquivo'} className="w-full h-full object-cover" />
                          )}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 pb-5 pt-2 border-t border-gray-100">
          <button onClick={onFechar}
            className="w-full py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EditExameModal ───────────────────────────────────────────────────────────
// "Alterar" do PEDIDO — mesma lógica da Prescrição (ícone laranja, abre em cima do
// registro existente). Diferente da Prescrição, aqui não há um componente de
// criação reaproveitável: o formulário de criar monta vários grupos por
// laboratório num único POST em lote, mas o PUT /clinica/exames/:id
// (ExameClinicoController.atualizar) só edita OS CAMPOS PLANOS de UM registro
// (descricao/laboratorio/tipoAmostra/indicacaoClinica/observacao/dataSolicitacao/
// qtdAmostra) — por isso o formulário de edição é deliberadamente mais simples
// que o de criação, mapeado 1:1 no que o backend aceita.
function EditExameModal({ ex, onFechar, onSalvo }: { ex: ExameClinico; onFechar: () => void; onSalvo: () => void }) {
  const extra = parseExtra(ex.observacao);
  const isImagem = ex.tipo === 'Imagem';

  const [descricao,        setDescricao]        = useState(ex.descricao);
  const [laboratorio,      setLaboratorio]      = useState(extra.laboratorio ?? '');
  const [tipoAmostra,      setTipoAmostra]      = useState(extra.tipoAmostra ?? '');
  const [indicacaoClinica, setIndicacaoClinica] = useState(extra.indicacaoClinica ?? '');
  const [obsForm,          setObsForm]          = useState(extra.obs ?? '');
  const [dataSolicitacao,  setDataSolicitacao]  = useState(ex.dataSolicitacao.slice(0, 10));
  const [qtdAmostra,       setQtdAmostra]       = useState(ex.qtdAmostra != null ? String(ex.qtdAmostra) : '');
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState<string | null>(null);

  const handleSalvar = async () => {
    if (!descricao.trim()) { setErro('Descrição é obrigatória.'); return; }
    setSalvando(true);
    setErro(null);
    try {
      await api.put(`/clinica/exames/${ex.id}`, {
        descricao:        descricao.trim(),
        laboratorio:      laboratorio.trim()      || null,
        tipoAmostra:      tipoAmostra.trim()      || null,
        indicacaoClinica: indicacaoClinica.trim() || null,
        observacao:       obsForm.trim()          || null,
        dataSolicitacao,
        qtdAmostra: qtdAmostra ? Number(qtdAmostra) : null,
      });
      toast.success('Exame atualizado');
      onSalvo();
      onFechar();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { error?: string; mensagem?: string } } })?.response?.data;
      setErro(data?.mensagem ?? data?.error ?? 'Erro ao atualizar exame');
    } finally { setSalvando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Pencil size={16} className="text-orange-500" />
            <h3 className="font-bold text-gray-900">Alterar Exame</h3>
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Descrição *</label>
            <input
              type="text"
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500"
            />
          </div>

          {!isImagem && (
            <div className="flex flex-wrap gap-2">
              <div className="flex-1 min-w-[160px]">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Laboratório</label>
                <input
                  type="text"
                  value={laboratorio}
                  onChange={e => setLaboratorio(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500"
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Tipo de Amostra</label>
                <input
                  type="text"
                  value={tipoAmostra}
                  onChange={e => setTipoAmostra(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Data da Solicitação</label>
              <DateInput
                value={dataSolicitacao}
                onChange={setDataSolicitacao}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus-within:border-orange-500"
              />
            </div>
            <div className="w-28">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                {isImagem ? 'Qtd. Imagens' : 'Qtd. Amostras'}
              </label>
              <input
                type="number"
                min={1}
                value={qtdAmostra}
                onChange={e => setQtdAmostra(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Indicação Clínica</label>
            <input
              type="text"
              value={indicacaoClinica}
              onChange={e => setIndicacaoClinica(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Preparo / Observação</label>
            <textarea
              rows={2}
              value={obsForm}
              onChange={e => setObsForm(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500 resize-none"
            />
          </div>

          <InlineError message={erro} />
        </div>

        <div className="px-5 pb-5 pt-2 border-t border-gray-100 flex gap-2">
          <button
            onClick={onFechar}
            disabled={salvando}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={salvando}
            className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 rounded-xl text-sm text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {salvando ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />} Salvar Alterações
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PendingGroupCard ─────────────────────────────────────────────────────────

function PendingGroupCard({ group, onRemove }: { group: PendingExamGroup; onRemove: () => void }) {
  const tipoMeta = TIPOS_META[group.tipo];
  return (
    <div className="flex items-start gap-3 p-3 bg-white border border-amber-200 rounded-xl">
      <div className="w-7 h-7 bg-amber-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
        {group.tipo === 'Imagem' ? <Scan size={13} className="text-emerald-700" /> : <FlaskConical size={13} className="text-blue-700" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-1">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tipoMeta?.badge ?? 'bg-gray-100 text-gray-600'}`}>
            {group.tipo}
          </span>
          {group.labNomeDisplay && (
            <span className="text-[10px] text-gray-500">{group.labNomeDisplay}</span>
          )}
          {group.grupoNome && (
            <span className="text-[10px] text-gray-500">· {group.grupoNome}</span>
          )}
        </div>
        {group.examsDisplay.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {group.examsDisplay.slice(0, 5).map(e => (
              <span key={e} className="text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded-full">{e}</span>
            ))}
            {group.examsDisplay.length > 5 && (
              <span className="text-[10px] text-gray-400">+{group.examsDisplay.length - 5} mais</span>
            )}
          </div>
        )}
        {group.tipoAmostra && group.tipoAmostra !== 'Exame Físico' && (
          <p className="text-[10px] text-gray-500 mt-0.5">Amostra: {group.tipoAmostra}</p>
        )}
      </div>
      <button onClick={onRemove} className="text-red-500 hover:text-red-600 p-1 flex-shrink-0 transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}

// ─── SubModuloExames ──────────────────────────────────────────────────────────

export default function SubModuloExames({
  animalId, animal, evolucaoId, evolucaoDeOutro, atendimentoNumero: _atendimentoNumero, onSalvo, openItemId, onViewConsumed,
}: Props) {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const { user } = useAuth();

  const procDropdownRef    = useRef<HTMLDivElement>(null);
  const procSearchRef      = useRef<HTMLInputElement>(null);
  const imagemDropdownRef  = useRef<HTMLDivElement>(null);
  const imagemSearchRef    = useRef<HTMLInputElement>(null);
  const isRestoringRef     = useRef(false);

  const DRAFT_KEY = `s2vet_exames_draft_${animalId}`;

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [mainTab,      setMainTab]      = useState<MainTab>('laboratorial');
  const [showProcDrop, setShowProcDrop] = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [procSearch,   setProcSearch]   = useState('');

  // ── Catálogo dinâmico de laboratórios ─────────────────────────────────────
  const OUTROS_ID = -1; // sentinela para "Outros laboratórios"
  const [labs,          setLabs]          = useState<LabItem[]>([]);
  const [labId,         setLabId]         = useState<number | null>(null);
  const [outroLabNome,  setOutroLabNome]  = useState('');
  const [grupos,        setGrupos]        = useState<GrupoItem[]>([]);
  const [grupoId,       setGrupoId]       = useState<number | null>(null);
  const [grupoNome,     setGrupoNome]     = useState('');
  const [examesCat,     setExamesCat]     = useState<ExameItemCat[]>([]);
  const [loadingLabs,   setLoadingLabs]   = useState(false);
  const [loadingGrupos, setLoadingGrupos] = useState(false);
  const [loadingExames, setLoadingExames] = useState(false);

  // ── Catálogo dinâmico de exames de imagem ─────────────────────────────────
  const [imagemGrupos,        setImagemGrupos]        = useState<ImagemGrupoItem[]>([]);
  const [imagemGrupoId,       setImagemGrupoId]       = useState<number | null>(null);
  const [imagemGrupoNome,     setImagemGrupoNome]     = useState('');
  const [imagemExamesCat,     setImagemExamesCat]     = useState<ImagemExameItemCat[]>([]);
  const [loadingImagemGrupos, setLoadingImagemGrupos] = useState(false);
  const [loadingImagemExames, setLoadingImagemExames] = useState(false);
  const [imagemProcSearch,    setImagemProcSearch]    = useState('');
  const [showImagemProcDrop,  setShowImagemProcDrop]  = useState(false);

  // ── Selection ──────────────────────────────────────────────────────────────
  const [selectedExams,   setSelectedExams]   = useState<string[]>([]);
  const [customExamText,  setCustomExamText]  = useState('');
  const [customExamCategoria, setCustomExamCategoria] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  // ── Common form fields ────────────────────────────────────────────────────
  const [dataSolicitacao,  setDataSolicitacao]  = useState(hoje());
  const [dataHoraColeta,   setDataHoraColeta]   = useState('');
  const [tipoAmostra,      setTipoAmostra]      = useState('');
  const [qtdAmostra,       setQtdAmostra]       = useState<number>(1);
  const [indicacaoClinica, setIndicacaoClinica] = useState('');
  const [observacao,       setObservacao]       = useState('');

  // ── Data state ─────────────────────────────────────────────────────────────
  const [historico,    setHistorico]    = useState<ExameClinico[]>([]);
  const [loadingHist,  setLoadingHist]  = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [viewingEx,    setViewingEx]    = useState<ExameClinico | null>(null);
  const [editingEx,    setEditingEx]    = useState<ExameClinico | null>(null);
  const [duplicataPendente, setDuplicataPendente] = useState<{
    nomes: string[]; resolve: (ok: boolean) => void;
  } | null>(null);
  const [confirmId,    setConfirmId]    = useState<number | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatusExame>('todos');
  // Visualização vinda do Histórico de Evolução Clínica: popula os campos do
  // formulário da página em SOMENTE LEITURA (sem abrir popup).
  const [exameVisualizando, setExameVisualizando] = useState<ExameClinico | null>(null);

  const [pendingGroups, setPendingGroups] = useState<PendingExamGroup[]>([]);

  const [page,      setPage]    = useState(1);
  const limit                   = 10;

  // Filtro por status + paginação no cliente (mesmo padrão da tela de Vacina)
  const historicoFiltrado = historico.filter(ex =>
    filtroStatus === 'todos' ? true : getStatusExame(ex) === filtroStatus);
  const totalPags     = Math.ceil(historicoFiltrado.length / limit);
  const historicoPage = historicoFiltrado.slice((page - 1) * limit, page * limit);
  const counts = historico.reduce(
    (acc, ex) => { acc[getStatusExame(ex)]++; return acc; },
    { SALVA: 0, FINALIZADA: 0, REALIZADA: 0, CANCELADA: 0 } as Record<StatusExameUI, number>,
  );

  const podeCriar     = isGestor || podeExecutar('atendimento.exames.criar');
  const podeEditar    = isGestor || podeExecutar('atendimento.exames.editar');
  const podeDeletar   = isGestor || podeExecutar('atendimento.exames.deletar');
  // Imprimir a requisição e compartilhá-la (WhatsApp/e-mail) são a mesma coisa:
  // conteúdo saindo do sistema. Quem só tem VER não faz nenhum dos três.
  const podeImprimir  = isGestor || podeExecutar('atendimento.exames.imprimir');
  // Só o gestor exclui exame de outro; os demais só os que solicitaram.
  const meuExame        = (ex: ExameClinico) => isGestor || ex.veterinario?.id === user?.id;
  // Cancelar o PEDIDO seguia só o slug, sem autoria — o backend (`podeOperarRegistro`)
  // recusa, então o botão aparecia para dar 403 no clique.
  const podeCancelarEx  = (ex: ExameClinico) => podeDeletar && meuExame(ex);
  // "Alterar" — mesma lógica da Prescrição: só o pedido ainda ABERTO (SALVA) pode ser
  // editado, e só quem criou (ou o gestor). "Compra" nunca entra aqui — não nasce
  // nesta tela (ver pages/ExameCompra.tsx) e sua `observacao` tem outro formato.
  const podeEditarEx = (ex: ExameClinico) =>
    podeEditar && meuExame(ex) && ex.ativo && ex.tipo !== 'Compra' && getStatusExame(ex) === 'SALVA';
  // O PEDIDO de exame (Laboratorial e Imagem) é controlado APENAS por
  // `atendimento.exames.*` — mesmo padrão de evolução/prescrição/vacina/encaminhamento.
  // Os slugs `exames.laboratorial.*` / `exames.imagem.*` pertencem a outro fluxo
  // (o RESULTADO/laudo do exame) e não gateiam o pedido.
  const podeCriarLab = podeCriar;
  const podeCriarImg = podeCriar;

  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável.`);

  // Tipos de amostra que têm pelo menos um exame no grupo carregado
  // Fallback para lista completa enquanto os dados não estão populados (tiposAmostra=[])
  const tiposDisponiveisNoGrupo = useMemo(() => {
    if (examesCat.length === 0) return TIPOS_AMOSTRA;
    const set = new Set(examesCat.flatMap(e => e.tiposAmostra ?? []));
    return set.size === 0 ? TIPOS_AMOSTRA : TIPOS_AMOSTRA.filter(t => set.has(t.value));
  }, [examesCat]);

  // Quantidade de exames do grupo compatíveis com cada tipo de amostra
  const countPorTipoAmostra = useMemo(() => {
    const map: Record<string, number> = {};
    for (const exam of examesCat) {
      for (const tipo of (exam.tiposAmostra ?? [])) {
        map[tipo] = (map[tipo] ?? 0) + 1;
      }
    }
    return map;
  }, [examesCat]);

  // Nome do laboratório que vai para o registro salvo
  const laboratorioNomeSalvo = labId === OUTROS_ID
    ? (outroLabNome.trim() || 'Outro laboratório')
    : (labs.find(l => l.id === labId)?.nome ?? '');

  // Exame digitado no campo "não listado" mas ainda não confirmado (Enter/botão) é
  // considerado efetivo — libera o Inserir e é incluído ao salvar, sem exigir Enter.
  const customExamPendente = customExamText.trim();
  const examesEfetivos = customExamPendente && !selectedExams.includes(customExamPendente)
    ? [...selectedExams, customExamPendente]
    : selectedExams;

  // ── Effects ────────────────────────────────────────────────────────────────

  // Carrega lista de labs ao montar
  useEffect(() => {
    setLoadingLabs(true);
    api.get('/clinica/laboratorios')
      .then(res => { if (res.data) setLabs(res.data.dados ?? []); })
      .catch(() => {})
      .finally(() => setLoadingLabs(false));
  }, []);

  // Restaura rascunho do localStorage (usado ao montar e ao fechar a visualização)
  const restaurarRascunho = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        mainTab?: MainTab;
        labId?: number | null;
        outroLabNome?: string;
        grupoId?: number | null;
        grupoNome?: string;
        selectedExams?: string[];
        dataSolicitacao?: string;
        dataHoraColeta?: string;
        tipoAmostra?: string;
        qtdAmostra?: number;
        indicacaoClinica?: string;
        observacao?: string;
        imagemGrupoId?: number | null;
        imagemGrupoNome?: string;
        pendingGroups?: PendingExamGroup[];
      };
      isRestoringRef.current = true;
      if (draft.mainTab)                  setMainTab(draft.mainTab);
      if (draft.labId != null)            setLabId(draft.labId);
      if (draft.outroLabNome)             setOutroLabNome(draft.outroLabNome);
      if (draft.grupoId != null)          setGrupoId(draft.grupoId);
      if (draft.grupoNome)                setGrupoNome(draft.grupoNome);
      if (draft.selectedExams?.length)    setSelectedExams(draft.selectedExams);
      if (draft.dataSolicitacao)          setDataSolicitacao(draft.dataSolicitacao);
      if (draft.dataHoraColeta)           setDataHoraColeta(draft.dataHoraColeta);
      if (draft.tipoAmostra)              setTipoAmostra(draft.tipoAmostra);
      if (draft.qtdAmostra)               setQtdAmostra(draft.qtdAmostra);
      if (draft.indicacaoClinica)         setIndicacaoClinica(draft.indicacaoClinica);
      if (draft.observacao)               setObservacao(draft.observacao);
      if (draft.imagemGrupoId != null)    setImagemGrupoId(draft.imagemGrupoId);
      if (draft.imagemGrupoNome)          setImagemGrupoNome(draft.imagemGrupoNome);
      if (draft.pendingGroups?.length)    setPendingGroups(draft.pendingGroups);
      // Libera os guards de cascata depois que todos os efeitos do render atual rodarem
      setTimeout(() => { isRestoringRef.current = false; }, 0);
    } catch { isRestoringRef.current = false; }
  };

  useEffect(() => {
    restaurarRascunho();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aba padrão respeita a permissão por tipo: se não pode criar Laboratorial mas
  // pode Imagem, começa em Imagem (e vice-versa).
  useEffect(() => {
    if (loadingPerms) return;
    if (mainTab === 'laboratorial' && !podeCriarLab && podeCriarImg) setMainTab('imagem');
    else if (mainTab === 'imagem' && !podeCriarImg && podeCriarLab)  setMainTab('laboratorial');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingPerms, podeCriarLab, podeCriarImg]);

  // Carrega grupos de exames de imagem quando a aba imagem é ativada
  useEffect(() => {
    if (mainTab !== 'imagem' || imagemGrupos.length > 0) return;
    setLoadingImagemGrupos(true);
    api.get('/clinica/imagem-exames/grupos')
      .then(res => { if (res.data) setImagemGrupos(res.data.dados ?? []); })
      .catch(() => {})
      .finally(() => setLoadingImagemGrupos(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  // Carrega itens ao trocar grupo de imagem
  useEffect(() => {
    if (!isRestoringRef.current) { setImagemExamesCat([]); setSelectedExams([]); }
    if (imagemGrupoId == null) return;
    setLoadingImagemExames(true);
    api.get(`/clinica/imagem-exames/grupos/${imagemGrupoId}/itens`)
      .then(res => { if (res.data) setImagemExamesCat(res.data.dados ?? []); })
      .catch(() => {})
      .finally(() => setLoadingImagemExames(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagemGrupoId]);

  // Carrega grupos ao trocar de lab. NÃO limpa selectedExams — os exames já escolhidos
  // (inclusive os inseridos manualmente) são preservados ao escolher/trocar o laboratório,
  // senão o Inserir nunca habilitava quando o exame era adicionado antes do laboratório.
  useEffect(() => {
    if (!isRestoringRef.current) {
      setGrupos([]);
      setGrupoId(null);
      setGrupoNome('');
      setExamesCat([]);
    }
    if (labId == null) return;

    setLoadingGrupos(true);
    const url = labId === OUTROS_ID
      ? '/clinica/laboratorios/grupos-todos'
      : `/clinica/laboratorios/${labId}/grupos`;
    api.get(url)
      .then(res => {
        if (res.data) setGrupos(res.data.dados ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingGrupos(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labId]);

  // Carrega exames ao trocar de grupo. NÃO limpa selectedExams — permite acumular
  // exames de áreas diferentes e preserva os inseridos manualmente.
  useEffect(() => {
    if (!isRestoringRef.current) { setExamesCat([]); }
    if (grupoId == null || grupos.length === 0) return;

    setLoadingExames(true);
    const url = labId === OUTROS_ID
      ? `/clinica/laboratorios/itens-todos?grupo=${encodeURIComponent(grupoNome)}`
      : `/clinica/laboratorios/grupos/${grupoId}/itens`;
    api.get(url)
      .then(res => { if (res.data) setExamesCat(res.data.dados ?? []); })
      .catch(() => {})
      .finally(() => setLoadingExames(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupoId, grupoNome]);


  useEffect(() => {
    if (isRestoringRef.current) return;
    setSelectedExams([]);
    setCustomExamText('');
    setShowCustomInput(false);
  }, [mainTab]);

  useEffect(() => {
    if (!showProcDrop) { setProcSearch(''); return; }
    const handler = (e: MouseEvent) => {
      if (!procDropdownRef.current?.contains(e.target as Node)) {
        setShowProcDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProcDrop]);

  // Click-outside para dropdown de exames de imagem
  useEffect(() => {
    if (!showImagemProcDrop) { setImagemProcSearch(''); return; }
    const handler = (e: MouseEvent) => {
      if (!imagemDropdownRef.current?.contains(e.target as Node)) {
        setShowImagemProcDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showImagemProcDrop]);

  // Persiste rascunho no localStorage sempre que o estado relevante mudar
  // (pausado enquanto um exame está populado em visualização — não sobrescreve o rascunho)
  useEffect(() => {
    if (isRestoringRef.current || exameVisualizando) return;
    const draft = {
      mainTab, labId, outroLabNome, grupoId, grupoNome,
      selectedExams, dataSolicitacao, dataHoraColeta,
      tipoAmostra, qtdAmostra, indicacaoClinica, observacao,
      imagemGrupoId, imagemGrupoNome, pendingGroups,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [
    mainTab, labId, outroLabNome, grupoId, grupoNome,
    selectedExams, dataSolicitacao, dataHoraColeta,
    tipoAmostra, qtdAmostra, indicacaoClinica, observacao,
    imagemGrupoId, imagemGrupoNome, pendingGroups,
    DRAFT_KEY, exameVisualizando,
  ]);

  // ── Loader ─────────────────────────────────────────────────────────────────

  const carregarHistorico = useCallback(async () => {
    setLoadingHist(true);
    try {
      const res = await api.get(`/clinica/exames/animal/${animalId}`);
      if (!res.data) return;
      setHistorico(res.data?.dados ?? []);
    } catch { /* silencioso */ }
    finally { setLoadingHist(false); }
  }, [animalId]);

  useEffect(() => {
    if (loadingPerms) return;
    carregarHistorico();
  }, [carregarHistorico, loadingPerms]);

  // Volta para a primeira página ao trocar o filtro de status
  useEffect(() => { setPage(1); }, [filtroStatus]);

  useEffect(() => {
    if (!openItemId) return;
    api.get(`/clinica/exames/${openItemId}`)
      .then(res => { if (res.data?.dados) abrirVisualizacaoExame(res.data.dados as ExameClinico); })
      .catch(() => {})
      .finally(() => onViewConsumed?.());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openItemId]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const toggleExam = (name: string) =>
    setSelectedExams(prev => prev.includes(name) ? prev.filter(e => e !== name) : [...prev, name]);

  // Popula os campos do formulário com um exame já registrado (somente leitura).
  // Usa o mesmo guard de cascata do restore de rascunho para os efeitos de
  // labId/mainTab não limparem os exames populados.
  const viewTopRef = useRef<HTMLDivElement>(null);
  const abrirVisualizacaoExame = (ex: ExameClinico) => {
    const extra = parseExtra(ex.observacao);
    const tipos: TipoExame[] = extra.grupos && extra.grupos.length > 0
      ? [...new Set(extra.grupos.map(g => g.tipo))]
      : [ex.tipo];
    isRestoringRef.current = true;
    setExameVisualizando(ex);
    setMainTab(tipos.length === 1 && tipos[0] === 'Imagem' ? 'imagem' : 'laboratorial');
    if (extra.laboratorio) {
      const lab = labs.find(l => l.nome === extra.laboratorio);
      if (lab) { setLabId(lab.id); setOutroLabNome(''); }
      else     { setLabId(OUTROS_ID); setOutroLabNome(extra.laboratorio); }
    } else {
      setLabId(null); setOutroLabNome('');
    }
    setSelectedExams(ex.descricao.split(',').map(s => s.trim()).filter(Boolean));
    setDataSolicitacao(ex.dataSolicitacao.slice(0, 10));
    if (extra.dataHoraColeta) setDataHoraColeta(extra.dataHoraColeta);
    setTipoAmostra(extra.tipoAmostra ?? '');
    setQtdAmostra(ex.qtdAmostra ?? 1);
    setIndicacaoClinica(extra.indicacaoClinica ?? '');
    setObservacao(extra.obs ?? '');
    setTimeout(() => { isRestoringRef.current = false; }, 0);
    setTimeout(() => viewTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  // Fecha a visualização: limpa os campos e devolve o rascunho do usuário (se havia).
  const fecharVisualizacaoExame = () => {
    setExameVisualizando(null);
    isRestoringRef.current = true;
    setMainTab('laboratorial');
    setLabId(null); setOutroLabNome('');
    setGrupoId(null); setGrupoNome(''); setExamesCat([]);
    setImagemGrupoId(null); setImagemGrupoNome('');
    setSelectedExams([]); setCustomExamText(''); setCustomExamCategoria(''); setShowCustomInput(false);
    setDataSolicitacao(hoje());
    setDataHoraColeta('');
    setTipoAmostra(''); setQtdAmostra(1); setIndicacaoClinica(''); setObservacao('');
    setTimeout(() => { isRestoringRef.current = false; }, 0);
    restaurarRascunho();
  };

  const addCustomExam = () => {
    const trimmed = customExamText.trim();
    if (!trimmed) return;
    if (!selectedExams.includes(trimmed)) setSelectedExams(prev => [...prev, trimmed]);
    // Categoria informada para o exame NÃO LISTADO → define a categoria do grupo
    // (grupoNome no laboratorial, imagemGrupoNome na imagem) quando ainda vazia,
    // para o pedido sair categorizado mesmo sem estar no catálogo.
    const cat = customExamCategoria.trim();
    if (cat) {
      if (mainTab === 'imagem') { if (!imagemGrupoNome.trim()) setImagemGrupoNome(cat); }
      else                      { if (!grupoNome.trim())       setGrupoNome(cat); }
    }
    setCustomExamText('');
    setCustomExamCategoria('');
    setShowCustomInput(false);
  };

  const removeSelectedExam = (name: string) =>
    setSelectedExams(prev => prev.filter(e => e !== name));

  // Exames já inseridos no pedido para o laboratório atualmente selecionado —
  // não podem ser incluídos de novo (sem exames repetidos por laboratório)
  const examesJaInseridosNoLab = useMemo(() => {
    const lab = laboratorioNomeSalvo.trim().toLowerCase();
    if (!lab) return new Set<string>();
    return new Set(
      pendingGroups
        .filter(g => (g.laboratorio ?? '').trim().toLowerCase() === lab)
        .flatMap(g => g.examsDisplay.map(n => n.trim().toLowerCase()))
    );
  }, [pendingGroups, laboratorioNomeSalvo]);

  // Exames já solicitados NESTA MESMA EVOLUÇÃO (em outro pedido, ativo/não
  // cancelado) — aviso, nunca bloqueio (pedido explícito). `historico` já é
  // completo/sem paginação para o animal (ver carregarHistorico), então não
  // precisa de uma busca nova: só filtra por evolucaoId + ativo.
  const examesNaEvolucao = useMemo(() => {
    if (!evolucaoId) return new Set<string>();
    return new Set(
      historico
        .filter(ex => ex.evolucaoId === evolucaoId && ex.ativo)
        .flatMap(nomesExamesDoRegistro)
        .map(n => n.trim().toLowerCase())
    );
  }, [historico, evolucaoId]);

  // Pergunta (não bloqueia) antes de inserir exame(s) já solicitados em OUTRO
  // pedido desta evolução — resolve na hora (sem duplicata) ou só depois que o
  // usuário decidir no ConfirmModal (ver render no fim do componente).
  const confirmarDuplicataSeNecessario = (nomes: string[]): Promise<boolean> => {
    const repetidos = nomes.filter(n => examesNaEvolucao.has(n.trim().toLowerCase()));
    if (repetidos.length === 0) return Promise.resolve(true);
    return new Promise(resolve => setDuplicataPendente({ nomes: repetidos, resolve }));
  };

  const validateCurrentForm = (): boolean => {
    if (examesEfetivos.length === 0)                               { setErroInline('Selecione ao menos um exame'); return false; }
    if (mainTab === 'laboratorial' && !laboratorioNomeSalvo.trim()) { setErroInline('Selecione o laboratório de destino'); return false; }
    if (mainTab === 'laboratorial') {
      const repetidos = examesEfetivos.filter(n => examesJaInseridosNoLab.has(n.trim().toLowerCase()));
      if (repetidos.length > 0) {
        setErroInline(`Exame(s) já incluído(s) para este laboratório: ${repetidos.join(', ')}`);
        return false;
      }
    }
    return true;
  };

  const buildCurrentGroup = (): PendingExamGroup => {
    const tipo: TipoExame = mainTab === 'imagem' ? 'Imagem' : 'Laboratorial';
    return {
      localId:          `${Date.now()}-${Math.random()}`,
      tipo,
      descricao:        examesEfetivos.join(', '),
      laboratorio:      laboratorioNomeSalvo.trim() || null,
      dataHoraColeta:   dataHoraColeta || null,
      tipoAmostra:      tipoAmostra.trim() || null,
      // qtdAmostra guarda a quantidade: nº de amostras (laboratorial) ou nº de imagens (imagem)
      qtdAmostra:       (mainTab === 'laboratorial' || mainTab === 'imagem') ? qtdAmostra : null,
      indicacaoClinica: indicacaoClinica.trim() || null,
      observacao:       observacao.trim() || null,
      grupoNome:        mainTab === 'laboratorial' ? (grupoNome || null) : (imagemGrupoNome || null),
      dataSolicitacao,
      laudoCompra:      null,
      examsDisplay:     [...selectedExams],
      labNomeDisplay:   mainTab === 'laboratorial' ? laboratorioNomeSalvo : (outroLabNome || ''),
    };
  };

  const resetCurrentForm = () => {
    if (mainTab === 'imagem') {
      setSelectedExams([]);
      setOutroLabNome('');
      setImagemGrupoId(null);
      setImagemGrupoNome('');
      setImagemExamesCat([]);
      setImagemProcSearch('');
      setShowImagemProcDrop(false);
      // Faltavam aqui — só o ramo laboratorial (abaixo) resetava. "Quantidade de
      // imagens" usa o MESMO estado `qtdAmostra` de "Qtd. de Amostras" (só muda o
      // rótulo conforme a aba), então ficava com o valor do exame anterior depois de
      // Inserir/Salvar na aba Imagem.
      setDataHoraColeta('');
      setTipoAmostra('');
      setQtdAmostra(1);
      setIndicacaoClinica('');
      setObservacao('');
    } else {
      setSelectedExams([]);
      setLabId(null);
      setOutroLabNome('');
      setGrupoId(null);
      setGrupoNome('');
      setExamesCat([]);
      setGrupos([]);
      setDataHoraColeta('');
      setTipoAmostra('');
      setQtdAmostra(1);
      setIndicacaoClinica('');
      setObservacao('');
    }
    // Estados transitórios de UI — para o Inserir limpar a tela por completo.
    setShowCustomInput(false);
    setCustomExamText('');
    setCustomExamCategoria('');
    setShowProcDrop(false);
    setProcSearch('');
    setShowImagemProcDrop(false);
    setImagemProcSearch('');
    setDataSolicitacao(hoje());
  };

  const handleInserir = async () => {
    if (!podeCriar)  { semPermissao('registrar exames'); return; }
    if (!evolucaoId) { setErroInline('Inicie uma evolução antes de registrar um exame.'); return; }
    if (evolucaoDeOutro) { setErroInline('Esta evolução pertence a outro profissional — assuma-a na aba Evolução antes de pedir exames.'); return; }
    if (!validateCurrentForm()) return;
    if (!(await confirmarDuplicataSeNecessario(examesEfetivos))) return;
    setPendingGroups(prev => [...prev, buildCurrentGroup()]);
    resetCurrentForm();
  };

  // Salvar — cria o pedido com o grupo do formulário + grupos inseridos
  // (mesmo padrão da Prescrição: apenas Inserir e Salvar, sem botão Finalizar)
  const handleSalvar = async () => {
    if (!podeCriar)  { semPermissao('registrar exames'); return; }
    if (!evolucaoId) { setErroInline('Inicie uma evolução antes de registrar um exame.'); return; }
    if (evolucaoDeOutro) { setErroInline('Esta evolução pertence a outro profissional — assuma-a na aba Evolução antes de pedir exames.'); return; }

    let rawGroups = [...pendingGroups];
    if (canSave) {
      if (!validateCurrentForm()) return;
      rawGroups = [...rawGroups, buildCurrentGroup()];
    }
    if (rawGroups.length === 0) { setErroInline('Selecione ao menos um exame para salvar'); return; }

    // Um pedido (registro no histórico) por LABORATÓRIO distinto — exames solicitados
    // de laboratórios diferentes viram entradas separadas, mesmo na mesma evolução.
    // Grupos sem laboratório (ex.: imagem) ficam juntos num único registro.
    const porLaboratorio = new Map<string, PendingExamGroup[]>();
    for (const g of rawGroups) {
      const chave = (g.laboratorio || '').trim().toLowerCase() || '__sem_laboratorio__';
      const arr = porLaboratorio.get(chave) ?? [];
      arr.push(g);
      porLaboratorio.set(chave, arr);
    }

    setSaving(true);
    try {
      for (const gruposDoLab of porLaboratorio.values()) {
        const gruposPayload = gruposDoLab.map(g => ({
          tipo:             g.tipo,
          laboratorio:      g.laboratorio,
          dataHoraColeta:   g.dataHoraColeta,
          nome:             g.grupoNome,
          exames:           g.examsDisplay,
          tipoAmostra:      g.tipoAmostra,
          qtdAmostra:       g.qtdAmostra,
          indicacaoClinica: g.indicacaoClinica,
          obs:              g.observacao,
          laudoCompra:      g.laudoCompra,
        }));
        await api.post('/clinica/exames', {
          animalId,
          tipo:             gruposDoLab[0].tipo,
          evolucaoId,
          descricao:        gruposDoLab.map(g => g.descricao).filter(Boolean).join(', '),
          laboratorio:      gruposDoLab.find(g => g.laboratorio)?.laboratorio ?? null,
          dataHoraColeta:   gruposDoLab.find(g => g.dataHoraColeta)?.dataHoraColeta ?? null,
          tipoAmostra:      gruposDoLab.find(g => g.tipoAmostra)?.tipoAmostra ?? null,
          qtdAmostra:       gruposDoLab.reduce<number | null>((s, g) => g.qtdAmostra != null ? (s ?? 0) + g.qtdAmostra : s, null),
          indicacaoClinica: gruposDoLab.map(g => g.indicacaoClinica).filter(Boolean).join('; ') || null,
          observacao:       null,
          grupoNome:        null,
          dataSolicitacao:  gruposDoLab[0].dataSolicitacao,
          grupos:           gruposPayload,
        });
      }
      const nRegistros = porLaboratorio.size;
      const nExames = rawGroups.reduce((s, g) => s + g.examsDisplay.length, 0);
      const msg = nRegistros > 1
        ? `${nRegistros} pedidos criados (${nExames} exames)`
        : 'Pedido de exame criado com sucesso';
      toast.success(msg);
      localStorage.removeItem(DRAFT_KEY);
      setPendingGroups([]);
      resetCurrentForm();
      setPage(1);
      carregarHistorico();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao salvar exames');
    } finally { setSaving(false); }
  };

  const handleExcluirSolicitado = (id: number) => {
    const ex = historico.find(e => e.id === id);
    if (!ex || !podeCancelarEx(ex)) { semPermissao('cancelar exame'); return; }
    setConfirmId(id);
  };

  const handleExcluirConfirmado = async (motivo: string) => {
    if (confirmId == null) return;
    const id = confirmId;
    setConfirmId(null);
    try {
      await api.delete(`/clinica/exames/${id}`, { data: { motivo } });
      toast.success('Exame cancelado');
      carregarHistorico();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao remover');
    }
  };

  const imprimirExame = (ex: ExameClinico) => {
    if (!podeImprimir) { semPermissao('imprimir exame'); return; }
    imprimirExameUtil(ex, animal);
  };

  const compartilharWhatsApp = (ex: ExameClinico) => {
    if (!podeImprimir) { semPermissao('compartilhar exame'); return; }
    const extra = parseExtra(ex.observacao);
    const examList = ex.descricao.split(', ');
    const texto = [
      `*Requisição de Exame Clínico*`,
      `Tipo: ${ex.tipo}`,
      `Data: ${formatDate(ex.dataSolicitacao)}`,
      extra.laboratorio      ? `Laboratório: ${extra.laboratorio}` : '',
      extra.tipoAmostra      ? `Amostra: ${extra.tipoAmostra}` : '',
      extra.indicacaoClinica ? `Indicação: ${extra.indicacaoClinica}` : '',
      `\n*Exames (${examList.length}):*`,
      ...examList.map(e => `• ${e}`),
      extra.obs ? `\n${extra.obs}` : '',
    ].filter(Boolean).join('\n');
    abrirWhatsApp(texto);
  };

  const compartilharEmail = (ex: ExameClinico) => {
    if (!podeImprimir) { semPermissao('compartilhar exame'); return; }
    const extra = parseExtra(ex.observacao);
    const examList = ex.descricao.split(', ');
    const assunto = `Requisição de Exame - ${ex.tipo} - ${formatDate(ex.dataSolicitacao)}`;
    const corpo = [
      `Requisição de Exame Clínico`,
      `Tipo: ${ex.tipo}`,
      `Data: ${formatDate(ex.dataSolicitacao)}`,
      extra.laboratorio      ? `Laboratório: ${extra.laboratorio}` : '',
      extra.dataHoraColeta   ? `Data/Hora coleta: ${new Date(extra.dataHoraColeta).toLocaleString('pt-BR')}` : '',
      extra.tipoAmostra      ? `Tipo de amostra: ${extra.tipoAmostra}` : '',
      extra.indicacaoClinica ? `Indicação clínica: ${extra.indicacaoClinica}` : '',
      extra.obs              ? `Instruções/Preparo: ${extra.obs}` : '',
      `\nExames Solicitados (${examList.length}):`,
      ...examList.map(e => `• ${e}`),
    ].filter(Boolean).join('\n');
    abrirEmail(assunto, corpo);
  };

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.exames.ler')) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <FlaskConical size={32} className="mb-3" />
        <p className="text-sm">Sem permissão para visualizar exames</p>
      </div>
    );
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const canSave = mainTab === 'imagem'
    ? examesEfetivos.length > 0
    : examesEfetivos.length > 0 && laboratorioNomeSalvo.trim().length > 0;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <InlineError message={erroInline} className="mb-4" />

      {/* ── Formulário ────────────────────────────────────────────────────── */}
      <div ref={viewTopRef} />
      {(podeCriar || exameVisualizando) && (
        // Alterou qualquer campo → o erro anterior some (change borbulha)
        <div className="border-b border-gray-100"
          onChange={() => setErroInline(null)}
          onInput={() => setErroInline(null)}>
          {exameVisualizando && (
            <div className="flex items-center justify-between px-4 pt-3">
              <div className="flex items-center gap-1.5">
                <Eye size={12} className="text-gray-400" />
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Exame {fmtNumero(exameVisualizando.numero)} — somente leitura
                </p>
              </div>
              <button onClick={fecharVisualizacaoExame} title="Fechar visualização"
                className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                <X size={16} />
              </button>
            </div>
          )}
          {!evolucaoId && !exameVisualizando ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 px-4">
              <FileText size={28} className="mb-2 text-gray-200" />
              <p className="font-medium text-sm text-gray-500">Evolução necessária</p>
              <p className="text-xs mt-1 text-center max-w-xs">
                Inicie uma evolução na aba Evolução para poder registrar exames neste atendimento.
              </p>
            </div>
          ) : evolucaoDeOutro && !exameVisualizando ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 px-4">
              <FileText size={28} className="mb-2 text-gray-200" />
              <p className="font-medium text-sm text-gray-500">Evolução de outro profissional</p>
              <p className="text-xs mt-1 text-center max-w-xs">
                Você só pode pedir exames dentro de um atendimento seu. Assuma esta evolução na aba Evolução para registrar exames aqui.
              </p>
            </div>
          ) : (
            <fieldset disabled={!!exameVisualizando} className="p-4 space-y-4 border-0 m-0 min-w-0">

                {/* Main tabs — cada tipo é exibido conforme a permissão do tipo */}
                <div className="flex flex-wrap gap-2">
                  {podeCriarLab && (
                    <button type="button" onClick={() => setMainTab('laboratorial')}
                      className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                        mainTab === 'laboratorial'
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      <FlaskConical size={12} /> Laboratorial
                    </button>
                  )}
                  {podeCriarImg && (
                    <button type="button" onClick={() => setMainTab('imagem')}
                      className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                        mainTab === 'imagem'
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      <Scan size={12} /> Imagem / Complementar
                    </button>
                  )}
                </div>

                {/* ── Laboratorial / Imagem ───────────────────────────── */}
                {/* A antiga aba "compra" foi extraída para pages/ExameCompra.tsx (2026-08-04);
                    este bloco é o que resta e sempre se aplica a laboratorial/imagem. */}
                <div className="space-y-4">

                    {/* Laboratório de Análises */}
                    <div className="space-y-2">
                      {mainTab === 'laboratorial' && (labId === OUTROS_ID ? (
                        /* Outro Laboratório: select + nome + datas na mesma linha */
                        <div className="flex flex-wrap gap-2 items-end">
                          <div className="relative flex-[2] min-w-[160px]">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                              Laboratório *
                            </label>
                            {loadingLabs ? (
                              <div className="flex items-center gap-1.5 h-10 px-3 border border-gray-200 rounded-xl text-xs text-gray-400">
                                <Loader2 size={12} className="animate-spin" /> Carregando...
                              </div>
                            ) : (
                              <>
                                <select
                                  value={labId ?? ''}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setLabId(val === '' ? null : Number(val));
                                    setOutroLabNome('');
                                  }}
                                  className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500 pr-8 bg-white"
                                >
                                  <option value="">Selecione o laboratório...</option>
                                  {labs.map(lab => (
                                    <option key={lab.id} value={lab.id}>{lab.nome}</option>
                                  ))}
                                  <option value={OUTROS_ID}>Outro Laboratório</option>
                                </select>
                                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                              </>
                            )}
                          </div>
                          <div className="flex-[2] min-w-[140px]">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                              Nome do Laboratório *
                            </label>
                            <input
                              type="text"
                              value={outroLabNome}
                              onChange={e => setOutroLabNome(e.target.value)}
                              placeholder="Nome do laboratório..."
                              autoFocus
                              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                          <div className="flex-1 min-w-[130px]">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                              Data da Solicitação *
                            </label>
                            <DateInput
                              value={dataSolicitacao}
                              onChange={setDataSolicitacao}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus-within:border-blue-500"
                            />
                          </div>
                          <div className="flex-[1.5] min-w-[170px]">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                              Data e Hora da Coleta
                            </label>
                            <DateInput
                              withTime
                              value={dataHoraColeta}
                              onChange={setDataHoraColeta}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus-within:border-blue-500"
                            />
                          </div>
                        </div>
                      ) : (
                        /* Laboratorial: select + datas na mesma linha */
                        <div className="flex flex-wrap gap-2 items-end">
                          <div className="relative flex-[2] min-w-[160px]">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                              Laboratório
                            </label>
                            {loadingLabs ? (
                              <div className="flex items-center gap-1.5 h-10 px-3 border border-gray-200 rounded-xl text-xs text-gray-400">
                                <Loader2 size={12} className="animate-spin" /> Carregando...
                              </div>
                            ) : (
                              <>
                                <select
                                  value={labId ?? ''}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setLabId(val === '' ? null : Number(val));
                                    setOutroLabNome('');
                                  }}
                                  className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500 pr-8 bg-white"
                                >
                                  <option value="">Selecione o laboratório...</option>
                                  {labs.map(lab => (
                                    <option key={lab.id} value={lab.id}>{lab.nome}</option>
                                  ))}
                                  <option value={OUTROS_ID}>Outro Laboratório</option>
                                </select>
                                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                              </>
                            )}
                          </div>
                          <div className="flex-1 min-w-[130px]">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                              Data da Solicitação *
                            </label>
                            <DateInput
                              value={dataSolicitacao}
                              onChange={setDataSolicitacao}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus-within:border-blue-500"
                            />
                          </div>
                          <div className="flex-[1.5] min-w-[170px]">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                              Data e Hora da Coleta
                            </label>
                            <DateInput
                              withTime
                              value={dataHoraColeta}
                              onChange={setDataHoraColeta}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus-within:border-blue-500"
                            />
                          </div>
                        </div>
                      ))}

                    </div>

                    {/* Área de Exame + Tipo de Amostra + Qtd — só laboratorial */}
                    {mainTab === 'laboratorial' && (
                      <div className="flex flex-wrap gap-3 items-end">
                        {/* Área de Exame — só para laboratorial (já garantido pelo `mainTab === 'laboratorial'` acima) */}
                        <div className="flex-[2] min-w-[160px]">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                              Área de Exame *
                            </label>
                            {loadingGrupos ? (
                              <div className="flex items-center gap-1.5 h-10 px-3 border border-gray-200 rounded-xl text-xs text-gray-400">
                                <Loader2 size={12} className="animate-spin" /> Carregando grupos...
                              </div>
                            ) : (
                              <div className="relative">
                                <select
                                  value={grupoId ?? ''}
                                  onChange={e => {
                                    const gid = Number(e.target.value);
                                    const g = grupos.find(x => x.id === gid);
                                    setGrupoId(gid || null);
                                    setGrupoNome(g?.nome ?? '');
                                    setShowProcDrop(false);
                                  }}
                                  disabled={labId == null || grupos.length === 0}
                                  className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500 pr-8 bg-white disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50"
                                >
                                  <option value="">
                                    {labId == null
                                      ? 'Selecione primeiro o laboratório...'
                                      : grupos.length === 0
                                        ? 'Nenhuma área disponível'
                                        : 'Selecione a área...'}
                                  </option>
                                  {grupos.map(g => (
                                    <option key={g.id} value={g.id}>{g.nome}</option>
                                  ))}
                                </select>
                                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                              </div>
                            )}
                          </div>
                        {/* Tipo de Amostra */}
                        <div className="flex-[2] min-w-[160px]">
                          <div className="h-5 flex items-center gap-2 mb-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">
                              Tipo de Amostra
                            </label>
                            {tipoAmostra && countPorTipoAmostra[tipoAmostra] != null && (
                              <span className="text-[11px] font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full border border-violet-200 whitespace-nowrap">
                                {countPorTipoAmostra[tipoAmostra]} exame{countPorTipoAmostra[tipoAmostra] !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          <div className="relative">
                            <select
                              value={tipoAmostra}
                              onChange={e => setTipoAmostra(e.target.value)}
                              className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500 pr-8 bg-white"
                            >
                              <option value="">Selecione o tipo de amostra...</option>
                              {tiposDisponiveisNoGrupo.map(t => {
                                const cnt = countPorTipoAmostra[t.value];
                                return (
                                  <option key={t.value} value={t.value}>
                                    {t.label}{cnt != null ? ` — ${cnt} exame${cnt !== 1 ? 's' : ''}` : ''}
                                  </option>
                                );
                              })}
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          </div>
                        </div>
                        {/* Qtd. Amostras */}
                        <div className="flex-1 min-w-[100px]">
                          <div className="h-5 flex items-center mb-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">
                              Qtd. de Amostras *
                            </label>
                          </div>
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={qtdAmostra}
                            onChange={e => setQtdAmostra(Math.max(1, Number(e.target.value) || 1))}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 text-center focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                    )}

                    {/* Exames do grupo selecionado */}
                    {mainTab === 'laboratorial' && (() => {
                      // Oculta exames já inseridos no pedido para o MESMO laboratório
                      const examesFiltrados = examesCat.filter(
                        e => !examesJaInseridosNoLab.has(e.nome.trim().toLowerCase())
                      );
                      const totalDisp = examesFiltrados.length;
                      return (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                              {grupoNome ? `Exames — ${grupoNome}` : 'Exames'}
                            </label>
                            {grupoId != null && !loadingExames && (
                              <span className="text-[11px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                                {totalDisp} disponíveis
                              </span>
                            )}
                          </div>
                          <div>
                            {grupoId == null ? (
                              <p className="text-xs text-gray-400 italic py-2">
                                Selecione a área de exame acima para ver os exames disponíveis.
                              </p>
                            ) : loadingExames ? (
                              <div className="flex items-center gap-1.5 text-xs text-gray-400 py-2">
                                <Loader2 size={12} className="animate-spin" /> Carregando exames...
                              </div>
                            ) : totalDisp === 0 ? (
                              <p className="text-xs text-gray-400 italic py-2">
                                Nenhum exame cadastrado neste grupo.
                              </p>
                            ) : (
                              <>
                                <div className="relative" ref={procDropdownRef}>
                                  {/* Trigger / campo de busca */}
                                  {showProcDrop ? (
                                    <div className="flex items-center gap-2 px-3 py-2.5 border border-blue-400 rounded-xl bg-white">
                                      <FlaskConical size={14} className="text-blue-400 flex-shrink-0" />
                                      <input
                                        ref={procSearchRef}
                                        autoFocus
                                        type="text"
                                        value={procSearch}
                                        onChange={e => setProcSearch(e.target.value)}
                                        placeholder={`Buscar em ${grupoNome}...`}
                                        className="flex-1 text-sm text-gray-900 outline-none placeholder:text-gray-400 placeholder:italic"
                                      />
                                      {procSearch && (
                                        <button
                                          type="button"
                                          onMouseDown={e => { e.preventDefault(); setProcSearch(''); procSearchRef.current?.focus(); }}
                                          className="text-gray-400 hover:text-gray-600"
                                        >
                                          <X size={12} />
                                        </button>
                                      )}
                                      <ChevronDown size={14} className="text-gray-400 rotate-180 flex-shrink-0" />
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setShowProcDrop(true)}
                                      className="w-full flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm hover:border-blue-400 transition-colors"
                                    >
                                      <div className="flex items-center gap-2 text-gray-400 italic">
                                        <FlaskConical size={14} className="text-gray-300 flex-shrink-0" />
                                        <span className="text-left truncate">
                                          {selectedExams.length === 0
                                            ? `Clique e digite para buscar em ${grupoNome}...`
                                            : `${selectedExams.length} de ${totalDisp} exame(s) marcado(s)`
                                          }
                                        </span>
                                      </div>
                                      <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
                                    </button>
                                  )}

                                  {/* Lista filtrada */}
                                  {showProcDrop && (() => {
                                    const visíveis = procSearch.trim()
                                      ? examesFiltrados.filter(e =>
                                          e.nome.toLowerCase().includes(procSearch.toLowerCase())
                                        )
                                      : examesFiltrados;
                                    return (
                                      <div className="absolute top-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-56 overflow-y-auto">
                                        {visíveis.length === 0 ? (
                                          <p className="text-xs text-gray-400 italic px-4 py-3">
                                            Nenhum resultado para &ldquo;{procSearch}&rdquo;
                                          </p>
                                        ) : visíveis.map(item => {
                                          const checked = selectedExams.includes(item.nome);
                                          return (
                                            <label
                                              key={item.id}
                                              onMouseDown={e => e.preventDefault()}
                                              onClick={() => toggleExam(item.nome)}
                                              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${checked ? 'bg-blue-50/60' : ''}`}
                                            >
                                              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                                checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                                              }`}>
                                                {checked && <Check size={10} className="text-white" strokeWidth={3} />}
                                              </div>
                                              <span className={`text-sm ${checked ? 'text-blue-800 font-medium' : 'text-gray-700'}`}>{item.nome}</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Imagem: catálogo dinâmico por grupo */}
                    {mainTab === 'imagem' && (
                      <div className="space-y-3">
                        {/* Seletor de grupo */}
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                            Categoria de Exame
                          </label>
                          {loadingImagemGrupos ? (
                            <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                              <Loader2 size={13} className="animate-spin" /> Carregando categorias...
                            </div>
                          ) : (
                            <select
                              value={imagemGrupoId ?? ''}
                              onChange={e => {
                                const gid = Number(e.target.value);
                                const g = imagemGrupos.find(x => x.id === gid);
                                setImagemGrupoId(gid || null);
                                setImagemGrupoNome(g?.nome ?? '');
                                setShowImagemProcDrop(false);
                              }}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-emerald-400 bg-white"
                            >
                              <option value="">Selecione a categoria...</option>
                              {imagemGrupos.map(g => (
                                <option key={g.id} value={g.id}>{g.nome}</option>
                              ))}
                            </select>
                          )}
                        </div>

                        {/* Busca de exame — mesmo padrão do laboratorial */}
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                              {imagemGrupoNome ? `Exames — ${imagemGrupoNome}` : 'Exames'}
                            </label>
                            {imagemGrupoId != null && !loadingImagemExames && (
                              <span className="text-[11px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
                                {imagemExamesCat.length} disponíveis
                              </span>
                            )}
                          </div>
                          <div>
                            {imagemGrupoId == null ? (
                              <p className="text-xs text-gray-400 italic py-2">
                                Selecione a categoria acima para ver os exames disponíveis.
                              </p>
                            ) : loadingImagemExames ? (
                              <div className="flex items-center gap-1.5 text-xs text-gray-400 py-2">
                                <Loader2 size={12} className="animate-spin" /> Carregando exames...
                              </div>
                            ) : imagemExamesCat.length === 0 ? (
                              <p className="text-xs text-gray-400 italic py-2">
                                Nenhum exame cadastrado nesta categoria.
                              </p>
                            ) : (
                              <div className="relative" ref={imagemDropdownRef}>
                                {showImagemProcDrop ? (
                                  <div className="flex items-center gap-2 px-3 py-2.5 border border-emerald-400 rounded-xl bg-white">
                                    <Scan size={14} className="text-emerald-400 flex-shrink-0" />
                                    <input
                                      ref={imagemSearchRef}
                                      autoFocus
                                      type="text"
                                      value={imagemProcSearch}
                                      onChange={e => setImagemProcSearch(e.target.value)}
                                      placeholder={`Buscar em ${imagemGrupoNome}...`}
                                      className="flex-1 text-sm text-gray-900 outline-none placeholder:text-gray-400 placeholder:italic"
                                    />
                                    {imagemProcSearch && (
                                      <button
                                        type="button"
                                        onMouseDown={e => { e.preventDefault(); setImagemProcSearch(''); imagemSearchRef.current?.focus(); }}
                                        className="text-gray-400 hover:text-gray-600"
                                      >
                                        <X size={12} />
                                      </button>
                                    )}
                                    <ChevronDown size={14} className="text-gray-400 rotate-180 flex-shrink-0" />
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setShowImagemProcDrop(true)}
                                    className="w-full flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm hover:border-emerald-400 transition-colors"
                                  >
                                    <div className="flex items-center gap-2 text-gray-400 italic">
                                      <Scan size={14} className="text-gray-300 flex-shrink-0" />
                                      <span className="text-left truncate">
                                        {selectedExams.length === 0
                                          ? `Clique e digite para buscar em ${imagemGrupoNome}...`
                                          : `${selectedExams.length} de ${imagemExamesCat.length} exame(s) marcado(s)`
                                        }
                                      </span>
                                    </div>
                                    <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
                                  </button>
                                )}

                                {showImagemProcDrop && (() => {
                                  const visíveis = imagemProcSearch.trim()
                                    ? imagemExamesCat.filter(e =>
                                        e.nome.toLowerCase().includes(imagemProcSearch.toLowerCase()) ||
                                        e.codigo.toLowerCase().includes(imagemProcSearch.toLowerCase())
                                      )
                                    : imagemExamesCat;
                                  return (
                                    <div className="absolute top-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-56 overflow-y-auto">
                                      {visíveis.length === 0 ? (
                                        <p className="text-xs text-gray-400 italic px-4 py-3">
                                          Nenhum resultado para &ldquo;{imagemProcSearch}&rdquo;
                                        </p>
                                      ) : visíveis.map(ex => {
                                        const checked = selectedExams.includes(ex.nome);
                                        return (
                                          <label
                                            key={ex.id}
                                            onMouseDown={e => e.preventDefault()}
                                            onClick={() => toggleExam(ex.nome)}
                                            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${checked ? 'bg-emerald-50/60' : ''}`}
                                          >
                                            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                              checked ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'
                                            }`}>
                                              {checked && <Check size={10} className="text-white" strokeWidth={3} />}
                                            </div>
                                            <span className={`text-sm ${checked ? 'text-emerald-800 font-medium' : 'text-gray-700'}`}>{ex.nome}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Exames selecionados */}
                    {selectedExams.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                            Exames selecionados ({selectedExams.length})
                          </p>
                          <button type="button" onClick={() => setSelectedExams([])}
                            className="text-[11px] text-blue-500 hover:text-blue-700 font-medium">
                            Limpar tudo
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedExams.map((e, idx) => (
                            <span key={e}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 text-xs font-medium">
                              <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-blue-600 text-white text-[9px] font-bold">
                                {idx + 1}
                              </span>
                              {e}
                              <button type="button" onClick={() => removeSelectedExam(e)}
                                className="text-blue-400 hover:text-blue-700 transition-colors flex-shrink-0">
                                <X size={11} />
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Adicionar exame não listado — link clicável */}
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setShowCustomInput(v => !v)}
                        className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
                      >
                        <Plus size={13} />
                        Adicionar exame não listado
                      </button>
                      {showCustomInput && (
                        <div className="flex flex-col sm:flex-row items-stretch gap-2">
                          <input
                            type="text"
                            value={customExamText}
                            onChange={e => setCustomExamText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomExam(); } }}
                            placeholder="Nome do exame..."
                            autoFocus
                            className="flex-1 border border-indigo-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-indigo-400"
                          />
                          <input
                            type="text"
                            value={customExamCategoria}
                            onChange={e => setCustomExamCategoria(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomExam(); } }}
                            placeholder="Categoria do exame (opcional)"
                            className="sm:w-56 border border-indigo-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-indigo-400"
                          />
                          <button
                            type="button"
                            onClick={addCustomExam}
                            disabled={!customExamText.trim()}
                            className="px-3 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex-shrink-0"
                          >
                            Adicionar
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Quantidade de imagens (só na aba Imagem) */}
                    {mainTab === 'imagem' && (
                      <div className="w-40">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                          Quantidade de imagens
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={qtdAmostra}
                          onChange={e => setQtdAmostra(Math.max(1, Number(e.target.value) || 1))}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 text-center focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    )}

                    {/* Indicação / Suspeita Clínica */}
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                        Indicação / Suspeita Clínica
                      </label>
                      <textarea
                        value={indicacaoClinica}
                        onChange={e => setIndicacaoClinica(e.target.value)}
                        placeholder="Ex: Suspeita de hemoparasitose, anemia, check-up anual..."
                        rows={2}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-400 resize-none"
                      />
                    </div>

                    {/* Instruções de Preparo / Obs */}
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                        Instruções de Preparo / Obs
                      </label>
                      <textarea
                        value={observacao}
                        onChange={e => setObservacao(e.target.value)}
                        placeholder="Ex: Jejum hídrico e alimentar de 8h..."
                        rows={2}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-400 resize-none"
                      />
                    </div>

                    {/* Botões Inserir / Solicitar — mesmo padrão da Prescrição */}
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={handleInserir}
                        disabled={saving || !canSave}
                        className="px-5 py-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        Inserir
                      </button>
                      <button
                        onClick={handleSalvar}
                        disabled={saving || (pendingGroups.length === 0 && !canSave)}
                        className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5"
                      >
                        {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                        Solicitar
                      </button>
                    </div>
                  </div>

            </fieldset>
          )}
        </div>
      )}

      {/* ── Grupos pendentes ────────────────────────────────────────────────── */}
      {pendingGroups.length > 0 && (
        <div className="px-4 py-3 border-b border-amber-100 bg-amber-50/40">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full border border-amber-200">
                {pendingGroups.length} grupo{pendingGroups.length !== 1 ? 's' : ''} inserido{pendingGroups.length !== 1 ? 's' : ''} — clique em Solicitar para concluir
              </span>
            </div>
            <button
              onClick={() => { setPendingGroups([]); localStorage.removeItem(DRAFT_KEY); }}
              className="text-xs text-red-400 hover:text-red-600 font-medium transition-colors"
            >
              Limpar
            </button>
          </div>
          <div className="space-y-2">
            {pendingGroups.map(g => (
              <PendingGroupCard
                key={g.localId}
                group={g}
                onRemove={() => setPendingGroups(prev => prev.filter(x => x.localId !== g.localId))}
              />
            ))}
          </div>
        </div>
      )}


      {/* ── Histórico ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico de Exames</p>
        <span className="text-xs text-gray-400">{historico.length} requisição{historico.length !== 1 ? 'ões' : ''}</span>
      </div>

      {/* Filtros de status (mesmo padrão da Vacina) */}
      {historico.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-gray-50">
          {FILTROS_EXAME.map(f => {
            const isActive = filtroStatus === f.key;
            let activeClass = 'bg-blue-600 text-white border-blue-600';
            if (f.key === 'SALVA'     && isActive) activeClass = 'bg-amber-500 text-white border-amber-500';
            if (f.key === 'CANCELADA' && isActive) activeClass = 'bg-red-600 text-white border-red-600';
            return (
              <button
                key={f.key}
                onClick={() => setFiltroStatus(f.key)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  isActive ? activeClass : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}>
                {f.label}
                {f.key === 'SALVA' && !isActive && counts.SALVA > 0 && (
                  <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {counts.SALVA}
                  </span>
                )}
                {f.key === 'CANCELADA' && !isActive && counts.CANCELADA > 0 && (
                  <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {counts.CANCELADA}
                  </span>
                )}
                {f.key === 'todos' && !isActive && (
                  <span className="text-gray-400">({historico.length})</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {loadingHist ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-blue-600" />
        </div>
      ) : historico.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-300">
          <FlaskConical size={36} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhum exame registrado</p>
        </div>
      ) : historicoFiltrado.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-300">
          <FlaskConical size={28} className="mb-2" />
          <p className="text-sm text-gray-400">Nenhum exame com status "{filtroStatus}"</p>
        </div>
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden divide-y divide-gray-50">
            {historicoPage.map(ex => {
              const extra    = parseExtra(ex.observacao);
              const examCount = (ex.descricao.match(/,/g) ?? []).length + 1;
              const tiposUnicos: TipoExame[] = extra.grupos && extra.grupos.length > 0
                ? [...new Set(extra.grupos.map(g => g.tipo))]
                : [ex.tipo];
              return (
                <div key={ex.id} className={`px-4 py-3 ${!ex.ativo ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => setViewingEx(ex)}
                      className="text-[11px] font-bold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-full border border-gray-200 flex-shrink-0 hover:bg-gray-200 hover:text-gray-800 transition-colors">
                      {fmtNumero(ex.numero)}
                    </button>
                    <StatusExameBadge status={getStatusExame(ex)} />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {tiposUnicos.map(tipo => (
                      <span key={tipo} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TIPOS_META[tipo]?.badge ?? ''}`}>
                        {tipo}
                      </span>
                    ))}
                    {examCount > 1 && (
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-200">
                        {examCount} exames
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-semibold text-gray-900 line-clamp-2 mt-1">{ex.descricao}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {extra.laboratorio && <>{extra.laboratorio} · </>}{formatDate(ex.dataSolicitacao)}
                  </p>
                  {ex.veterinario && <p className="text-[11px] text-gray-400 mt-0.5">Por: {ex.veterinario.fullName}</p>}
                  {!ex.ativo && ex.justificativa && (
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Justificativa:{' '}
                      <JustificativaCancelamento texto={ex.justificativa} className="inline-block align-bottom max-w-[70vw]" />
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 mt-2">
                    {podeEditarEx(ex) && (
                      <button onClick={() => setEditingEx(ex)}
                        className="flex items-center gap-1 px-2.5 py-1 border border-orange-200 text-orange-600 rounded-lg text-xs hover:bg-orange-50 transition-colors">
                        <Pencil size={11} /> Alterar
                      </button>
                    )}
                    <button onClick={() => setViewingEx(ex)}
                      className="flex items-center gap-1 px-2.5 py-1 border border-emerald-200 text-emerald-700 rounded-lg text-xs hover:bg-emerald-50 transition-colors">
                      <Eye size={11} /> Ver
                    </button>
                    {podeImprimir && (
                      <button onClick={() => imprimirExame(ex)}
                        className="flex items-center gap-1 px-2.5 py-1 border border-blue-200 text-blue-600 rounded-lg text-xs hover:bg-blue-50 transition-colors">
                        <Printer size={11} /> Imprimir
                      </button>
                    )}
                    {podeImprimir && (
                      <button onClick={() => compartilharWhatsApp(ex)}
                        className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-green-600 rounded-lg text-xs hover:bg-green-50 transition-colors">
                        <MessageCircle size={11} /> WhatsApp
                      </button>
                    )}
                    {podeImprimir && (
                      <button onClick={() => compartilharEmail(ex)}
                        className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-blue-500 rounded-lg text-xs hover:bg-blue-50 transition-colors">
                        <Mail size={11} /> E-mail
                      </button>
                    )}
                    {podeCancelarEx(ex) && ex.ativo && (
                      <button onClick={() => handleExcluirSolicitado(ex.id)}
                        className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors">
                        <Ban size={11} /> Cancelar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Nº</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Data Início</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Data Fim</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Exames</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Laboratório</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Amostra</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Solicitante</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Justificativa</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {historicoPage.map(ex => {
                  const extra    = parseExtra(ex.observacao);
                  const examCount = (ex.descricao.match(/,/g) ?? []).length + 1;
                  const tiposUnicos: TipoExame[] = extra.grupos && extra.grupos.length > 0
                    ? [...new Set(extra.grupos.map(g => g.tipo))]
                    : [ex.tipo];
                  return (
                    <tr key={ex.id} className={`hover:bg-gray-50/60 transition-colors ${!ex.ativo ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button onClick={() => setViewingEx(ex)}
                          className="text-xs font-bold text-gray-600 bg-gray-100 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-200 hover:text-gray-800 transition-colors">
                          {fmtNumero(ex.numero)}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
                        {formatDate(ex.dataSolicitacao)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
                        {ex.dataResultado ? formatDate(ex.dataResultado) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {tiposUnicos.map(tipo => (
                            <span key={tipo} className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${TIPOS_META[tipo]?.badge ?? 'bg-gray-100 text-gray-600'}`}>
                              {tipo === 'Imagem' ? <Scan size={10} /> : <FlaskConical size={10} />}
                              {tipo}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-[220px]">
                        <p className="text-sm font-medium text-gray-900 line-clamp-2">{ex.descricao}</p>
                        {examCount > 1 && (
                          <span className="text-[10px] text-blue-600 font-semibold">{examCount} exames</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {extra.laboratorio ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {extra.tipoAmostra ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {ex.veterinario?.fullName ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <StatusExameBadge status={getStatusExame(ex)} />
                      </td>
                      <td className="px-4 py-3">
                        {!ex.ativo
                          ? <JustificativaCancelamento texto={ex.justificativa} />
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {podeEditarEx(ex) && (
                            <button onClick={() => setEditingEx(ex)} title="Alterar"
                              className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors">
                              <Pencil size={14} />
                            </button>
                          )}
                          <button onClick={() => setViewingEx(ex)} title="Ver detalhes"
                            className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                            <Eye size={14} />
                          </button>
                          {podeImprimir && (
                            <button onClick={() => imprimirExame(ex)} title="Imprimir requisição"
                              className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
                              <Printer size={14} />
                            </button>
                          )}
                          {podeImprimir && (
                            <button onClick={() => compartilharWhatsApp(ex)} title="Enviar por WhatsApp"
                              className="p-1.5 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors">
                              <MessageCircle size={14} />
                            </button>
                          )}
                          {podeImprimir && (
                            <button onClick={() => compartilharEmail(ex)} title="Enviar por e-mail"
                              className="p-1.5 text-blue-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                              <Mail size={14} />
                            </button>
                          )}
                          {podeCancelarEx(ex) && ex.ativo && (
                            <button onClick={() => handleExcluirSolicitado(ex.id)} title="Cancelar exame"
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                              <Ban size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPags > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
              <span className="text-xs text-gray-400">{historicoFiltrado.length} requisição{historicoFiltrado.length !== 1 ? 'ões' : ''}</span>
              <div className="flex items-center gap-3">
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-gray-500">{page} / {totalPags}</span>
                <button disabled={page >= totalPags} onClick={() => setPage(p => p + 1)}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {viewingEx && <ViewModal ex={viewingEx} onFechar={() => setViewingEx(null)} />}
      {editingEx && (
        <EditExameModal
          ex={editingEx}
          onFechar={() => setEditingEx(null)}
          onSalvo={() => { carregarHistorico(); onSalvo?.(); }}
        />
      )}

      <ModalJustificativa
        aberto={confirmId != null}
        titulo="Cancelar exame"
        descricao="O pedido será marcado como CANCELADO. Informe o motivo do cancelamento."
        acaoLabel="Cancelar exame"
        onConfirmar={handleExcluirConfirmado}
        onFechar={() => setConfirmId(null)}
      />

      {duplicataPendente && (
        <ConfirmModal
          open
          variante="aviso"
          titulo="Exame já solicitado nesta evolução"
          mensagem={
            <>
              {duplicataPendente.nomes.length === 1 ? (
                <>O exame <strong>{duplicataPendente.nomes[0]}</strong> já foi solicitado nesta evolução (em outro pedido).</>
              ) : (
                <>Os exames <strong>{duplicataPendente.nomes.join(', ')}</strong> já foram solicitados nesta evolução (em outro pedido).</>
              )}
              {' '}Deseja continuar mesmo assim?
            </>
          }
          labelConfirmar="Continuar mesmo assim"
          labelCancelar="Cancelar"
          onConfirmar={() => { duplicataPendente.resolve(true); setDuplicataPendente(null); }}
          onCancelar={() => { duplicataPendente.resolve(false); setDuplicataPendente(null); }}
        />
      )}
    </>
  );
}

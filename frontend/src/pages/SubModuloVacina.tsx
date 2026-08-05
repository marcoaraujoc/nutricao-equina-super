// frontend/src/pages/SubModuloVacina.tsx — registro clínico de vacinas

import { useState, useEffect, useCallback, useRef } from 'react';
import { Syringe, Ban, Eye, Loader2, X, ChevronLeft, ChevronRight, ChevronDown, AlertCircle, CheckCircle2, Clock, Printer, MessageCircle, Mail, Receipt, Pencil, Check } from 'lucide-react';
import { abrirWhatsApp, abrirEmail } from '../utils/compartilhar';
import api from '../services/api';
import ImportarOrcamentoModal, { type OrcamentoItemImport, marcarOrcamentoImportado } from '../components/ImportarOrcamentoModal';
import DateInput from '../components/DateInput';
import { formatDate } from '../utils/dateUtils';
import toast from 'react-hot-toast';
import { useEmpresa } from '../contexts/EmpresaContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import type { AnimalInfo } from './SubModuloEvolucao';
import {
  imprimirPrescricao as imprimirPrescricaoPrint,
  type PrintAnimalPrescricao, type PrintGrupoPrescricao, type PrintItemPrescricao,
} from '../utils/PrescricaoPrint';
import InlineError from '../components/InlineError';
import ErroAcao, { classeErro, type ErroAcaoDados } from '../components/ErroAcao';
import { formatNumeroClinico, numeroClinicoComHash } from '../utils/numeroClinico';


// ─── Types ────────────────────────────────────────────────────────────────────

interface MedicamentoCatalogo {
  id:                number;
  nome:              string;
  formaFarmaceutica: string;
  valorUnitario:     number | null;
  vias:              { id: number; via: string }[];
  emEstoque:         boolean;
}

interface LoteDisponivel {
  id:            number;
  lote:          string | null;
  validade:      string | null;
  qtdDisponivel: number;
  valorPorDose:  number;
}

// Vacina em edição, importada do orçamento (mesma abordagem da prescrição: cada item
// do orçamento vira uma linha editável, salva em lote). Guarda os próprios lotes.
interface VacImport {
  key:              string;
  orcamentoItemId:  number;         // item de orçamento de origem (marcar só após salvar)
  medicamentoCatId: number | null; // refId do catálogo; null = manual sem cadastro
  nome:             string;
  quantidade:       number;
  dataAplicacao:    string;
  dose:             string;
  via:              string;
  loteId:           number | '';
  cliente:          boolean;
  aplicadaPeloProprietario: boolean;
  observacao:       string;
  emEstoque:        boolean;
  vias:             string[];
  lotes:            LoteDisponivel[];
  loadingLotes:     boolean;
}

interface VacinaClinica {
  id:                number;
  numero:            number | null;
  tipoAtendimento:   string | null;
  nome:              string;
  fabricante:        string | null;
  lote:              string | null;
  dose:              string | null;
  via:               string | null;
  quantidade:        number | null;
  valor:             number | null;
  cliente:           boolean;
  aplicadaPeloProprietario: boolean;
  ativo:             boolean;
  status:            string | null;   // SALVA (rascunho) | FINALIZADA
  dataAplicacao:     string;
  dataReforco:       string | null;
  observacao:        string | null;
  motivoInativacao:  string | null;
  veterinario:       { id: number; fullName: string } | null;
  vacina:            { id: number; nome: string; via: string } | null;
  loteVacina:        { id: number; lote: string; validade: string } | null;
}

// Ciclo de vida da vacina — mesma lógica da Prescrição:
// SALVA (rascunho) → FINALIZADA (vai para a Execução de Prescrição) →
// EXECUTADA (aplicada no plantão: debita estoque + lança na fatura).
// CANCELADA = registro cancelado (soft delete com justificativa).
type StatusVacina = 'SALVA' | 'FINALIZADA' | 'EXECUTADA' | 'CANCELADA';
type FiltroStatus = 'todos' | StatusVacina;

// Rótulo + cor de cada status — fonte única do selo e das abas de filtro,
// espelhando STATUS_GRUPO da prescrição (mesmas cores por significado:
// rascunho = âmbar, em execução = emerald, executado = azul, cancelado = vermelho).
const STATUS_VACINA: Record<StatusVacina, { label: string; cls: string }> = {
  SALVA:      { label: 'Salva',       cls: 'bg-amber-100 text-amber-700'     },
  FINALIZADA: { label: 'Em Execução', cls: 'bg-emerald-100 text-emerald-700' },
  EXECUTADA:  { label: 'Executada',   cls: 'bg-blue-100 text-blue-700'       },
  CANCELADA:  { label: 'Cancelada',   cls: 'bg-red-100 text-red-700'         },
};

// Ordem das abas de filtro no histórico (mesma progressão do ciclo de vida)
const STATUS_ORDER: StatusVacina[] = ['SALVA', 'FINALIZADA', 'EXECUTADA', 'CANCELADA'];

// ─── Constants ────────────────────────────────────────────────────────────────

// Tipo de dose, em ordem CRESCENTE. "Reforço Mensal"/"Reforço Anual" disparam o
// agendamento automático das doses seguintes na execução (ver INTERVALO_REFORCO_MESES).
const DOSES = [
  '1ª Dose',
  '2ª Dose',
  '3ª Dose',
  'Dose Única',
  'Reforço Mensal',
  'Reforço Anual',
];

// Reforço periódico → intervalo entre as doses, em MESES. Tipo fora deste mapa não
// gera agendamento automático (dose avulsa//série sem periodicidade definida).
const INTERVALO_REFORCO_MESES: Record<string, number> = {
  'Reforço Mensal': 1,
  'Reforço Anual':  12,
};

const VIAS_PADRAO = [
  'Subcutânea (SC)',
  'Intramuscular (IM)',
  'Intranasal (IN)',
  'Intravenosa (IV)',
  'Oral',
];

const VIA_PREFIXES: [string, string][] = [
  ['SUBCUTÂNEA',    'Subcutânea (SC)'],
  ['SC',            'Subcutânea (SC)'],
  ['INTRAMUSCULAR', 'Intramuscular (IM)'],
  ['IM',            'Intramuscular (IM)'],
  ['INTRANASAL',    'Intranasal (IN)'],
  ['IN',            'Intranasal (IN)'],
  ['INTRAVENOSA',   'Intravenosa (IV)'],
  ['IV',            'Intravenosa (IV)'],
  ['ORAL',          'Oral'],
];

function normalizeVia(via: string): string {
  const u = via.trim().toUpperCase();
  for (const [prefix, canonical] of VIA_PREFIXES) {
    if (u === prefix || u.startsWith(prefix + ' ') || u.startsWith(prefix + '(') || u.startsWith(prefix + ',')) {
      return canonical;
    }
  }
  return via;
}

// Impressão da vacina reutiliza o MESMO gerador de HTML da prescrição
// (gerarHtmlPrescricao/imprimirPrescricao em PrescricaoPrint.ts) — a vacina vira
// um "grupo" de um único item, para sair com o mesmo layout/cabeçalho/rodapé.
function imprimirVacina(v: VacinaClinica, animal: AnimalInfo | null) {
  const vcNum   = formatVcNum(v.numero);
  const status  = getStatus(v);

  const animalPrint: PrintAnimalPrescricao = {
    nome:     animal?.nome ?? v.nome,
    photoUrl: typeof animal?.photoUrl === 'string' ? animal.photoUrl : null,
    peso:     null,
    baia:     null,
    especie:  null,
    raca:     animal?.raca ?? null,
    logoUrl:  animal?.logoUrl ?? null,
  };

  const item: PrintItemPrescricao = {
    id:              v.id,
    tipo:            'MEDICAMENTO',
    medicamento:     v.nome,
    dosagem:         v.dose,
    unidade:         v.quantidade != null && v.quantidade > 1 ? `${v.quantidade} doses` : null,
    via:             v.via ?? '—',
    frequencia:      v.dataReforco ? `Reforço em ${formatDate(v.dataReforco)}` : 'Dose única',
    horaInicio:      null,
    horariosGerados: null,
    duracaoDias:     1,
    observacao:      [v.fabricante ? `Fabricante: ${v.fabricante}` : null, v.lote ? `Lote: ${v.lote}` : null, v.observacao]
      .filter(Boolean).join(' · ') || null,
    dataInicio:      v.dataAplicacao,
  };

  const grupo: PrintGrupoPrescricao = {
    numero:          v.numero ?? 0,
    // O template já escreve o "#". Sem número (registro legado) sai "#—" — não se
    // inventa um número a partir do id (viraria "a vacina nº 812" do paciente).
    numeroFormatado: vcNum ?? '—',
    status:          status === 'CANCELADA' ? 'CANCELADA' : status === 'SALVA' ? 'SALVO' : status === 'EXECUTADA' ? 'EXECUTADO' : 'FINALIZADA',
    finalizadoEm:    null,
    finalizadoPor:   null,
    executadoPor:    v.veterinario ? { fullName: v.veterinario.fullName } : null,
    veterinario:     v.veterinario ? { fullName: v.veterinario.fullName } : { fullName: '—' },
    animal:          animalPrint,
    itens:           [item],
  };

  imprimirPrescricaoPrint(grupo);
}

const hoje = () => new Date().toISOString().slice(0, 10);

function montarTextoVacina(v: VacinaClinica): string {
  // Cabeçalho no mesmo molde do `montarTextoPrescricao`: "*Vacina #074*"
  const vcNum = numeroClinicoComHash(v.numero);
  return [
    `*Vacina${vcNum ? ` ${vcNum}` : ''}*`,
    `Vacina: ${v.nome}`,
    v.fabricante ? `Fabricante: ${v.fabricante}` : '',
    v.lote ? `Lote: ${v.lote}` : '',
    v.dose ? `Dose: ${v.dose}` : '',
    v.quantidade != null && v.quantidade > 1 ? `Qtd doses: ${v.quantidade}` : '',
    v.via ? `Via: ${v.via}` : '',
    `Aplicação: ${formatDate(v.dataAplicacao)}`,
    v.dataReforco ? `Reforço: ${formatDate(v.dataReforco)}` : '',
    v.veterinario ? `Executor: ${v.veterinario.fullName}` : '',
    v.observacao ? `\nObs: ${v.observacao}` : '',
  ].filter(Boolean).join('\n');
}
// Nº da vacina = MESMA formatação e lógica do Nº da prescrição (#074) — ver
// utils/numeroClinico.ts. Não montar o número à mão em tela nenhuma.
const formatVcNum = (num: number | null) => formatNumeroClinico(num);

function getStatus(v: VacinaClinica): StatusVacina {
  if (!v.ativo) return 'CANCELADA';
  if (v.status === 'EXECUTADA')  return 'EXECUTADA';
  if (v.status === 'FINALIZADA') return 'FINALIZADA';
  return 'SALVA';
}

// Reforço com data no passado — apenas destaque visual da data (independente do
// ciclo SALVA/FINALIZADA), preservando o alerta de reforço vencido.
const reforcoVencido = (v: VacinaClinica): boolean =>
  !!v.dataReforco && new Date(v.dataReforco) < new Date();

// ─── StatusBadge ─────────────────────────────────────────────────────────────
// Mesmo modelo da prescrição (STATUS_GRUPO em SubModuloPrescricao): um mapa
// status → { label, cls } alimenta o selo E as abas de filtro. Sem isso, rótulo e
// cor de cada status ficavam escritos duas vezes e divergiam na primeira correção.

function StatusBadge({ status }: { status: StatusVacina }) {
  const st = STATUS_VACINA[status];
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${st.cls}`}>
      {st.label}
    </span>
  );
}

// ─── ViewModal ────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-gray-400 w-28 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 font-medium">{value}</span>
    </div>
  );
}

// Chip compacto rótulo:valor na linha do item — MESMO markup do InfoChip da prescrição
function ChipVac({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <span className="text-[10px] text-gray-500 whitespace-nowrap">
      <span className="text-gray-400 mr-0.5">{label}</span>{value}
    </span>
  );
}

function ViewModal({ v, onFechar }: { v: VacinaClinica; onFechar: () => void }) {
  const vcNum  = formatVcNum(v.numero);
  const status = getStatus(v);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Syringe size={16} className="text-emerald-600" />
            <h3 className="font-bold text-gray-900">Detalhes da Vacina</h3>
            {vcNum && (
              <span className="font-mono font-bold text-emerald-700 text-sm">#{vcNum}</span>
            )}
            <StatusBadge status={status} />
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <Row label="Vacina"         value={v.nome} />
          {v.aplicadaPeloProprietario && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-28 flex-shrink-0">Aplicação</span>
              <span className="text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-lg">Aplicada pelo proprietário</span>
            </div>
          )}
          {v.cliente && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-28 flex-shrink-0">Cliente</span>
              <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">Vacina do cliente</span>
            </div>
          )}
          {v.dose        && <Row label="Tipo Dose"     value={v.dose} />}
          {v.quantidade != null && v.quantidade > 1 && <Row label="Qtd Doses"  value={String(v.quantidade)} />}
          {v.via         && <Row label="Via"            value={v.via} />}
          {v.fabricante  && <Row label="Fabricante"    value={v.fabricante} />}
          {v.lote        && <Row label="Lote"           value={v.lote} />}
          {v.loteVacina  && <Row label="Val. Lote"      value={formatDate(v.loteVacina.validade)} />}
          <Row label="Data Aplicação" value={formatDate(v.dataAplicacao)} />
          {v.dataReforco && <Row label="Reforço"        value={formatDate(v.dataReforco)} />}
          {v.veterinario && <Row label="Executor"       value={v.veterinario.fullName} />}
          {v.observacao  && <Row label="Obs."           value={v.observacao} />}
          {status === 'CANCELADA' && v.motivoInativacao && (
            <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-xl">
              <p className="text-xs font-semibold text-gray-500 mb-1">MOTIVO DO CANCELAMENTO</p>
              <p className="text-sm text-gray-700">{v.motivoInativacao}</p>
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

// ─── DuplicataWarningModal ────────────────────────────────────────────────────

function DuplicataWarningModal({
  nomeVacina,
  data,
  onConfirmar,
  onCancelar,
}: {
  nomeVacina: string;
  data:       string;
  onConfirmar: () => void;
  onCancelar:  () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelar();
      if (e.key === 'Enter')  onConfirmar();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onConfirmar, onCancelar]);

  const dataFormatada = (() => {
    const [y, m, d] = data.split('-');
    return `${d}/${m}/${y}`;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancelar} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-sm border border-gray-100 overflow-hidden">
        <button
          onClick={onCancelar}
          className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <X size={16} />
        </button>
        <div className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-amber-100">
              <AlertCircle size={20} className="text-amber-600" />
            </div>
            <div className="pt-1.5">
              <h3 className="text-base font-bold text-gray-900 leading-snug">Vacina já aplicada hoje</h3>
            </div>
          </div>
          <div className="ml-14 space-y-2">
            <p className="text-sm text-gray-600">
              A vacina <span className="font-semibold text-gray-800">{nomeVacina}</span> já possui um registro ativo para este animal na data <span className="font-semibold text-gray-800">{dataFormatada}</span>.
            </p>
            <p className="text-sm text-gray-500">Deseja registrar mesmo assim?</p>
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2 px-6 pb-6 pt-0">
          <button
            onClick={onCancelar}
            className="flex-1 py-2.5 px-4 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-white transition-colors bg-amber-500 hover:bg-amber-600">
            Registrar mesmo assim
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ExcluirModal ─────────────────────────────────────────────────────────────

function ExcluirModal({
  open,
  onConfirmar,
  onCancelar,
}: {
  open:        boolean;
  onConfirmar: (motivo: string) => void;
  onCancelar:  () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) { setMotivo(''); return; }
    setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelar(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancelar]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancelar} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-sm border border-gray-100 overflow-hidden">
        <button
          onClick={onCancelar}
          className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <X size={16} />
        </button>
        <div className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-red-100">
              <Ban size={20} className="text-red-600" />
            </div>
            <div className="pt-1.5">
              <h3 className="text-base font-bold text-gray-900 leading-snug">Cancelar vacina</h3>
            </div>
          </div>
          <p className="text-sm text-gray-500 ml-14 mb-4">
            A vacina será marcada como <span className="font-semibold text-gray-700">CANCELADA</span>. Informe o motivo:
          </p>
          <textarea
            ref={inputRef}
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            rows={3}
            placeholder="Ex: Registro duplicado, erro de lançamento..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-red-400 resize-none"
          />
          {motivo.trim().length === 0 && (
            <p className="text-xs text-red-500 mt-1">Justificativa obrigatória para cancelar</p>
          )}
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2 px-6 pb-6 pt-0">
          <button
            onClick={onCancelar}
            className="flex-1 py-2.5 px-4 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Fechar
          </button>
          <button
            onClick={() => { if (motivo.trim()) onConfirmar(motivo.trim()); }}
            disabled={!motivo.trim()}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-white transition-colors bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
            Cancelar vacina
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SubModuloVacina ──────────────────────────────────────────────────────────

interface Props {
  animalId:           number;
  animal:             AnimalInfo | null;
  evolucaoId?:        number;
  atendimentoNumero?: string;
  onSalvo?:           () => void;
  openItemId?:        number;
  onViewConsumed?:    () => void;
}

export default function SubModuloVacina({ animalId, animal, evolucaoId, atendimentoNumero, onSalvo, openItemId, onViewConsumed }: Props) {
  const { contextoAtivo } = useEmpresa();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const { user } = useAuth();

  void contextoAtivo;

  // ── Form state ─────────────────────────────────────────────────────────────
  const [medicamentoId,    setMedicamentoId]    = useState<number | ''>('');
  const [loteId,           setLoteId]           = useState<number | ''>('');
  const [lotesDisponiveis, setLotesDisponiveis] = useState<LoteDisponivel[]>([]);
  const [loadingLotes,     setLoadingLotes]     = useState(false);
  const [dose,             setDose]             = useState('');
  const [qtd,              setQtd]              = useState(1);
  const [cliente,          setCliente]          = useState(false);
  // Quem APLICA a dose — decisão IRMÃ de `cliente` (quem FORNECE). Ver a matriz em
  // VacinaClinicaController.finalizar: é o cruzamento das duas que decide plantão e fatura.
  const [aplicadaPeloProprietario, setAplicadaPeloProprietario] = useState(false);
  const [dataAplicacao,    setDataAplicacao]    = useState(hoje());
  const [via,              setVia]              = useState('');
  const [observacao,       setObservacao]       = useState('');

  // ── Combobox medicamento ───────────────────────────────────────────────────
  const [buscaMed,          setBuscaMed]          = useState('');
  const [dropdownMedAberto, setDropdownMedAberto] = useState(false);
  const comboboxRef = useRef<HTMLDivElement>(null);
  const formRef     = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node))
        setDropdownMedAberto(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Data state ─────────────────────────────────────────────────────────────
  const [catalogo,    setCatalogo]    = useState<MedicamentoCatalogo[]>([]);
  const [historico,   setHistorico]   = useState<VacinaClinica[]>([]);
  const [loadingCat,  setLoadingCat]  = useState(true);
  const [loadingHist, setLoadingHist] = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [viewingV,    setViewingV]    = useState<VacinaClinica | null>(null);
  const [excluindoId, setExcluindoId] = useState<number | null>(null);
  const [finalizandoId, setFinalizandoId] = useState<number | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos');

  const [page, setPage] = useState(1);
  const limit = 10;
  const [confirmandoDuplicata, setConfirmandoDuplicata] = useState(false);
  const [showImportOrc, setShowImportOrc] = useState(false);

  // Erro de CARGA da página (falha ao listar) — este sim pertence ao topo.
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro de AÇÃO do FORMULÁRIO — renderizado logo abaixo de Inserir/Finalizar,
  // que é onde o clique aconteceu (mesma regra da prescrição).
  const [erroForm, setErroForm] = useState<ErroAcaoDados | null>(null);
  // Erro de AÇÃO da LISTA — pertence à LINHA cujo botão foi clicado, não ao topo.
  const [erroLinha, setErroLinha] = useState<{ id: number; mensagem: string } | null>(null);
  const erroDaLinha = (id: number) => (erroLinha?.id === id ? erroLinha.mensagem : null);

  // Rascunho das vacinas importadas — persiste ao trocar de tela (mesmo padrão da
  // prescrição). Restaurado na montagem; limpo ao salvar.
  const draftKeyVac = `s2vet_vacina_import_draft_${animalId}_${evolucaoId ?? 'sem'}`;
  const [itensImport, setItensImport] = useState<VacImport[]>(() => {
    try {
      const raw = localStorage.getItem(draftKeyVac);
      if (raw) {
        const arr = JSON.parse(raw);
        // loadingLotes nunca deve voltar "true" (não há fetch em andamento na restauração)
        if (Array.isArray(arr)) return arr.map((x: VacImport) => ({ ...x, loadingLotes: false }));
      }
    } catch { /* ignore */ }
    return [];
  });
  const [editandoKey,   setEditandoKey]   = useState<string | null>(null); // linha importada em edição

  // Importa uma vacina ACEITA do orçamento → pré-preenche o formulário (vacina + qtd).
  // O valor final vem do lote escolhido; se vier mais de uma, usa a primeira.
  const patchImport = (key: string, patch: Partial<VacImport>) =>
    setItensImport(prev => prev.map(x => x.key === key ? { ...x, ...patch } : x));

  // Carrega TODAS as vacinas do orçamento como itens editáveis (mesmo método da
  // prescrição). Cada item já resolve nome/vias do catálogo e busca seus lotes.
  const importarDoOrcamento = (itensOrc: OrcamentoItemImport[]) => {
    const base: VacImport[] = itensOrc.map(i => {
      const med  = i.refId ? catalogo.find(m => m.id === i.refId) ?? null : null;
      const vias = med && med.vias.length > 0
        ? [...new Set(med.vias.map(v => normalizeVia(v.via)))]
        : VIAS_PADRAO;
      return {
        key:              `imp-${i.id}-${Math.random().toString(36).slice(2)}`,
        orcamentoItemId:  i.id,
        medicamentoCatId: i.refId,
        nome:             i.descricao,
        quantidade:       i.quantidade || 1,
        dataAplicacao:    hoje(),
        dose:             '',
        via:              vias.length === 1 ? vias[0] : '',
        loteId:           '',
        cliente:          false,
        aplicadaPeloProprietario: false,
        observacao:       'Importado do orçamento',
        emEstoque:        !!med?.emEstoque,
        vias,
        lotes:            [],
        loadingLotes:     !!med?.emEstoque,
      };
    });
    setItensImport(prev => [...prev, ...base]);

    // Busca os lotes de cada item com estoque, em paralelo (não bloqueia a lista)
    base.forEach(async item => {
      if (!item.emEstoque || !item.medicamentoCatId) return;
      try {
        const res = await api.get('/vacinas/estoque/lotes-disponiveis', {
          params: { medicamentoCatId: item.medicamentoCatId },
        });
        const lotes: LoteDisponivel[] = res.data?.dados ?? [];
        patchImport(item.key, { lotes, loteId: lotes.length === 1 ? lotes[0].id : '', loadingLotes: false });
      } catch {
        patchImport(item.key, { loadingLotes: false });
      }
    });
  };

  // Grava a lista de itens (importados do orçamento e/ou inseridos à mão).
  // Espelha o "Salvar" da prescrição: um POST por item, tudo de uma vez.
  const salvarItens = async (itens: VacImport[]) => {
    if (itens.length === 0) return;
    if (itens.some(i => !i.medicamentoCatId)) {
      setErroForm({ mensagem: 'Há vacina sem cadastro no catálogo — remova a linha.' }); return;
    }
    // Dose e via são OBRIGATÓRIAS — o registro é o que documenta a aplicação. O item
    // vindo do orçamento entra sem elas (o orçamento não tem esses campos), então a
    // checagem precisa varrer a LISTA inteira, não só o formulário: sem isso, dava
    // para importar e salvar a vacina sem dose nem via.
    const semDose = itens.find(i => !String(i.dose ?? '').trim());
    if (semDose) {
      setErroForm({ mensagem: `Informe a dose de "${semDose.nome}" antes de salvar.`, campos: ['dose'] }); return;
    }
    const semVia = itens.find(i => !String(i.via ?? '').trim());
    if (semVia) {
      setErroForm({ mensagem: `Informe a via de administração de "${semVia.nome}" antes de salvar.`, campos: ['via'] }); return;
    }
    setSaving(true);
    let ok = 0;
    try {
      for (const item of itens) {
        await api.post('/clinica/vacinas', {
          animalId,
          medicamentoCatId: item.medicamentoCatId,
          ...(evolucaoId  && { evolucaoId }),
          ...(item.loteId && { loteId: item.loteId }),
          dose:       item.dose || null,
          quantidade: item.quantidade,
          cliente:    item.cliente,
          aplicadaPeloProprietario: item.aplicadaPeloProprietario,
          via:        item.via || null,
          dataAplicacao: item.dataAplicacao,
          observacao: item.observacao.trim() || null,
        });
        ok++;
      }
      // Salvou tudo → só agora marca os itens de ORÇAMENTO como importados
      // (orcamentoItemId 0 = item inserido manualmente, não vem de orçamento)
      await marcarOrcamentoImportado(itens.filter(i => i.orcamentoItemId > 0).map(i => i.orcamentoItemId));
      toast.success(`${ok} vacina(s) registrada(s)`);
      setItensImport([]);
      limparForm();
      setPage(1);
      carregarHistorico();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroForm({ mensagem: `${msg ?? 'Erro ao registrar vacina'}${ok > 0 ? ` — ${ok} já salva(s)` : ''}` });
      // Marca só as que chegaram a ser salvas e remove-as da lista (não duplicar)
      if (ok > 0) await marcarOrcamentoImportado(itens.slice(0, ok).filter(i => i.orcamentoItemId > 0).map(i => i.orcamentoItemId));
      setItensImport(itens.slice(ok));
      carregarHistorico();
    } finally { setSaving(false); }
  };

  const historicoFiltrado = historico.filter(v => {
    if (filtroStatus === 'todos') return true;
    return getStatus(v) === filtroStatus;
  });
  const totalPags    = Math.ceil(historicoFiltrado.length / limit);
  const historicoPage = historicoFiltrado.slice((page - 1) * limit, page * limit);

  const podeCriar     = isGestor || podeExecutar('atendimento.vacinas.criar');
  const podeDeletar   = isGestor || podeExecutar('atendimento.vacinas.deletar');
  const podeImprimir  = isGestor || podeExecutar('atendimento.vacinas.imprimir');
  const podeFinalizar = isGestor || podeExecutar('atendimento.vacinas.finalizar');
  // Só o gestor exclui/finaliza vacina de outro; os demais só as que registraram.
  const podeExcluirVac   = (v: VacinaClinica) => podeDeletar   && (isGestor || v.veterinario?.id === user?.id);
  const podeFinalizarVac = (v: VacinaClinica) => podeFinalizar && (isGestor || v.veterinario?.id === user?.id);

  // Mesma assinatura da prescrição: com id, o aviso nasce NA LINHA; sem id, no formulário.
  const semPermissao = (acao: string, id?: number) => {
    const msg = `Sem permissão para ${acao}. Verifique com o responsável da equipe.`;
    if (id != null) setErroLinha({ id, mensagem: msg });
    else            setErroForm({ mensagem: msg });
  };

  const medSelecionado = catalogo.find(m => m.id === medicamentoId) ?? null;

  const viasDisponiveis: string[] = medSelecionado && medSelecionado.vias.length > 0
    ? [...new Set(medSelecionado.vias.map(v => normalizeVia(v.via)))]
    : VIAS_PADRAO;

  const medsFiltrados = buscaMed.trim().length === 0
    ? catalogo
    : catalogo.filter(m =>
        m.nome.toLowerCase().includes(buscaMed.toLowerCase()) ||
        m.formaFarmaceutica.toLowerCase().includes(buscaMed.toLowerCase())
      );

  // ── Loaders ────────────────────────────────────────────────────────────────

  const carregarCatalogo = useCallback(async () => {
    setLoadingCat(true);
    try {
      const res = await api.get('/medicamentos/para-atendimento', {
        params: { animalId, tipo: 'vacina' },
      });
      if (!res.data) return;
      setCatalogo(res.data?.dados ?? []);
    } catch { /* silencioso */ }
    finally { setLoadingCat(false); }
  }, [animalId]);

  const carregarHistorico = useCallback(async () => {
    setLoadingHist(true);
    try {
      const res = await api.get(`/clinica/vacinas/animal/${animalId}`);
      if (!res.data) return;   // GET 403 → data null (permissão), não é falha de carga
      setHistorico(res.data?.dados ?? []);
      setErroInline(null);
    } catch { setErroInline('Erro ao carregar vacinas'); }
    finally { setLoadingHist(false); }
  }, [animalId]);

  useEffect(() => {
    if (loadingPerms) return;
    carregarCatalogo();
    carregarHistorico();
  }, [carregarCatalogo, carregarHistorico, loadingPerms]);

  useEffect(() => {
    if (!openItemId) return;
    api.get(`/clinica/vacinas/${openItemId}`)
      .then(res => { if (res.data?.dados) setViewingV(res.data.dados as VacinaClinica); })
      .catch(() => {})
      .finally(() => onViewConsumed?.());
  }, [openItemId]);

  // Durante a carga de um item importado no formulário, a vacina é fixada e via/lote
  // são preenchidos a partir do próprio item — os efeitos reativos abaixo (que resetam
  // via/lote ao trocar a vacina) são pulados para não sobrescrever esses valores.
  const carregandoEdicaoRef = useRef(false);

  useEffect(() => {
    if (carregandoEdicaoRef.current) return;
    if (!medicamentoId) { setVia(''); return; }
    const med = catalogo.find(m => m.id === medicamentoId);
    if (med && med.vias.length > 0) {
      const normalizadas = [...new Set(med.vias.map(v => normalizeVia(v.via)))];
      if (normalizadas.length === 1) setVia(normalizadas[0]);
      else setVia('');
    } else {
      setVia('');
    }
  }, [medicamentoId, catalogo]);

  const fetchLotes = useCallback(async (medId: number) => {
    setLoadingLotes(true);
    setLoteId('');
    setLotesDisponiveis([]);
    try {
      const res = await api.get('/vacinas/estoque/lotes-disponiveis', {
        params: { medicamentoCatId: medId },
      });
      if (!res.data) return;
      const lotes: LoteDisponivel[] = res.data?.dados ?? [];
      setLotesDisponiveis(lotes);
      if (lotes.length === 1) setLoteId(lotes[0].id);
    } catch { /* silencioso */ }
    finally { setLoadingLotes(false); }
  }, []);

  useEffect(() => {
    // Libera o flag DEPOIS que os efeitos reativos de medicamentoId rodaram (este é o
    // último deles). Assim a carga de edição não é sobrescrita, mas trocas manuais de
    // vacina seguem recarregando lotes/via normalmente.
    if (carregandoEdicaoRef.current) { carregandoEdicaoRef.current = false; return; }
    if (!medicamentoId) {
      setLoteId('');
      setLotesDisponiveis([]);
      return;
    }
    const med = catalogo.find(m => m.id === medicamentoId);
    if (!med?.emEstoque) {
      setLoteId('');
      setLotesDisponiveis([]);
      return;
    }
    fetchLotes(medicamentoId);
  }, [medicamentoId, fetchLotes, catalogo]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [filtroStatus]);

  // Persiste o rascunho das vacinas importadas a cada mudança (sobrevive à troca de tela)
  useEffect(() => {
    try {
      if (itensImport.length > 0) localStorage.setItem(draftKeyVac, JSON.stringify(itensImport));
      else localStorage.removeItem(draftKeyVac);
    } catch { /* ignore */ }
  }, [itensImport, draftKeyVac]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const limparForm = () => {
    setMedicamentoId('');
    setLoteId('');
    setLotesDisponiveis([]);
    setDose('');
    setQtd(1);
    setCliente(false);
    setAplicadaPeloProprietario(false);
    setDataAplicacao(hoje());
    setVia('');
    setObservacao('');
    setBuscaMed('');
    setDropdownMedAberto(false);
  };

  // Carrega um item importado NO FORMULÁRIO para edição (mesmo fluxo da prescrição).
  const editarNoForm = (item: VacImport) => {
    carregandoEdicaoRef.current = true; // impede os efeitos de resetarem lote/via
    setEditandoKey(item.key);
    setMedicamentoId(item.medicamentoCatId ?? '');
    setLotesDisponiveis(item.lotes);
    setLoteId(item.loteId);
    setDose(item.dose);
    setQtd(item.quantidade);
    setCliente(item.cliente);
    setAplicadaPeloProprietario(item.aplicadaPeloProprietario);
    setDataAplicacao(item.dataAplicacao);
    setVia(item.via);
    setObservacao(item.observacao);
    setBuscaMed('');
    setDropdownMedAberto(false);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const cancelarEdicaoForm = () => { setEditandoKey(null); limparForm(); };

  // Aplica os valores do formulário de volta ao item importado (não salva no servidor;
  // a gravação real continua no botão "Salvar N vacinas").
  const salvarEdicaoForm = () => {
    if (!editandoKey) return;
    if (!medicamentoId) { setErroForm({ mensagem: 'Selecione a vacina', campos: ['medicamento'] }); return; }
    patchImport(editandoKey, {
      medicamentoCatId: typeof medicamentoId === 'number' ? medicamentoId : null,
      nome:             medSelecionado?.nome ?? undefined,
      quantidade:       qtd,
      dataAplicacao,
      dose,
      via,
      loteId,
      cliente,
      aplicadaPeloProprietario,
      observacao,
    });
    cancelarEdicaoForm();
  };

  // Formulário vazio = nada preenchido para inserir/salvar (espelha formEstaVazio
  // da prescrição — é o que decide se o "Salvar" leva também o conteúdo do form).
  const formEstaVazio = () => !medicamentoId;

  // Converte o formulário atual em um item da lista (sem gravar no servidor).
  const itemDoFormulario = (): VacImport => ({
    key:              `man-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    orcamentoItemId:  0,                       // 0 = inserido à mão, não veio de orçamento
    medicamentoCatId: typeof medicamentoId === 'number' ? medicamentoId : null,
    nome:             medSelecionado?.nome ?? '',
    quantidade:       qtd,
    dataAplicacao,
    dose,
    via,
    loteId,
    cliente,
    aplicadaPeloProprietario,
    observacao,
    emEstoque:        !!medSelecionado?.emEstoque,
    vias:             viasDisponiveis,
    lotes:            lotesDisponiveis,
    loadingLotes:     false,
  });

  // "Inserir" — adiciona o item à lista e limpa o formulário para o próximo,
  // igual ao Inserir da prescrição. A gravação acontece só no "Salvar".
  const handleInserir = () => {
    if (!podeCriar)     { semPermissao('registrar vacinas'); return; }
    if (!medicamentoId) { setErroForm({ mensagem: 'Selecione a vacina', campos: ['medicamento'] }); return; }
    setErroForm(null);
    setItensImport(prev => [...prev, itemDoFormulario()]);
    limparForm();
  };

  const executarSalvar = async () => {
    // Salva a lista + o que estiver no formulário, numa única ação.
    // Editando uma linha (`editandoKey`), o formulário SUBSTITUI aquele item — não
    // entra como novo. Mesmo motivo da prescrição: quem preenche a dose/via de um
    // item importado e clica direto em "Salvar" (sem passar por "Atualizar item")
    // salvaria a linha duplicada e a original continuaria sem dose.
    const doForm = formEstaVazio() ? null : itemDoFormulario();
    const itens = !doForm
      ? itensImport
      : (editandoKey
          ? itensImport.map(i => (i.key === editandoKey ? { ...doForm, key: i.key, orcamentoItemId: i.orcamentoItemId } : i))
          : [...itensImport, doForm]);
    await salvarItens(itens);
  };

  const handleSalvar = () => {
    if (!podeCriar) { semPermissao('registrar vacinas'); return; }
    if (formEstaVazio() && itensImport.length === 0) {
      setErroForm({ mensagem: 'Selecione a vacina', campos: ['medicamento'] }); return;
    }
    setErroForm(null);

    // Duplicata só faz sentido para o que está no formulário
    if (!formEstaVazio() && medSelecionado) {
      const nomeBusca = medSelecionado.nome.toLowerCase().trim();
      const duplicata = historico.find(v => {
        if (!v.ativo) return false;
        return v.nome.toLowerCase().trim() === nomeBusca &&
               v.dataAplicacao.slice(0, 10) === dataAplicacao;
      });
      if (duplicata) {
        setConfirmandoDuplicata(true);
        return;
      }
    }

    executarSalvar();
  };

  const handleFinalizar = async (v: VacinaClinica) => {
    if (!podeFinalizarVac(v)) { semPermissao('finalizar vacina', v.id); return; }
    setErroLinha(null);
    setFinalizandoId(v.id);
    try {
      await api.patch(`/clinica/vacinas/${v.id}/finalizar`);
      toast.success('Vacina finalizada');
      carregarHistorico();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroLinha({ id: v.id, mensagem: msg ?? 'Erro ao finalizar vacina' });
    } finally { setFinalizandoId(null); }
  };

  const handleExcluirSolicitado = (id: number) => {
    // Autoria também no handler (o botão já usa `podeExcluirVac`): entrada por outro
    // caminho não pode escapar da regra que o backend aplica de qualquer jeito.
    const v = historico.find(x => x.id === id);
    if (!v || !podeExcluirVac(v)) { semPermissao('cancelar vacina', id); return; }
    setErroLinha(null);
    setExcluindoId(id);
  };

  const handleExcluirConfirmado = async (motivo: string) => {
    if (excluindoId == null) return;
    const id = excluindoId;
    setExcluindoId(null);
    try {
      await api.delete(`/clinica/vacinas/${id}`, { data: { motivo } });
      toast.success('Vacina cancelada');
      carregarHistorico();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroLinha({ id, mensagem: msg ?? 'Erro ao cancelar' });
    }
  };

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.vacinas.ler')) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <Syringe size={32} className="mb-3" />
        <p className="text-sm">Sem permissão para visualizar vacinas</p>
      </div>
    );
  }

  // ── Contadores por status ──────────────────────────────────────────────────

  const counts = historico.reduce(
    (acc, v) => { acc[getStatus(v)]++; return acc; },
    { SALVA: 0, FINALIZADA: 0, EXECUTADA: 0, CANCELADA: 0 } as Record<StatusVacina, number>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <InlineError message={erroInline} className="mx-5 mt-4" />

      {/* ── Formulário de registro ─────────────────────────────────────────── */}
      {podeCriar && (
        // Alterou qualquer campo → o erro anterior some (change borbulha)
        <div ref={formRef} className="p-5 border-b border-gray-100"
          onChange={() => setErroForm(null)}
          onInput={() => setErroForm(null)}>

          {/* Importar orçamento (opcional) */}
          <button onClick={() => setShowImportOrc(true)}
            className="flex items-center gap-1.5 px-3 py-2 mb-3 rounded-xl text-xs font-semibold border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors">
            <Receipt size={13} /> Importar orçamento
          </button>
          {showImportOrc && (
            <ImportarOrcamentoModal
              animalId={animalId}
              tipos={['VACINA']}
              onFechar={() => setShowImportOrc(false)}
              onImportar={importarDoOrcamento}
            />
          )}

          {/* Aviso de edição de item importado */}
          {editandoKey && (
            <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
              <Pencil size={12} />
              Editando um item importado — ajuste os campos e clique em <b>Atualizar item</b>.
            </div>
          )}

          {/* Linha 1: Vacina (combobox) / Lote / Via de aplicação — 3+2+2, mesma
              proporção da linha "Medicamento / Dosagem / Via" da prescrição. */}
          <div className="grid grid-cols-1 sm:grid-cols-7 gap-3 mb-4">

            <div className="sm:col-span-3" ref={comboboxRef}>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">VACINA *</label>
              {loadingCat ? (
                <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl text-xs text-gray-400">
                  <Loader2 size={13} className="animate-spin" /> Carregando…
                </div>
              ) : catalogo.length === 0 ? (
                <div className="px-3 py-2.5 border border-amber-200 rounded-xl text-sm text-amber-600 bg-amber-50 text-xs">
                  Nenhuma vacina cadastrada para esta espécie
                </div>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDropdownMedAberto(v => !v)}
                    className={classeErro(erroForm, 'medicamento', 'w-full flex items-center justify-between border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-emerald-500 text-left')}
                  >
                    {medSelecionado ? (
                      <span className="text-gray-900 truncate">{medSelecionado.nome}</span>
                    ) : (
                      <span className="text-gray-400">Selecione…</span>
                    )}
                    <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
                  </button>

                  {dropdownMedAberto && (
                    <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg">
                      <div className="p-2 border-b border-gray-100">
                        <input
                          autoFocus
                          type="text"
                          value={buscaMed}
                          onChange={e => setBuscaMed(e.target.value)}
                          placeholder="Buscar vacina…"
                          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <ul className="max-h-52 overflow-y-auto">
                        {medsFiltrados.length === 0 ? (
                          <li className="px-3 py-2 text-xs text-gray-400">Nenhum resultado</li>
                        ) : medsFiltrados.map(m => (
                          <li key={m.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setMedicamentoId(m.id);
                                setBuscaMed('');
                                setDropdownMedAberto(false);
                              }}
                              className={`w-full text-left px-3 py-2 hover:bg-emerald-50 transition-colors ${m.id === medicamentoId ? 'bg-emerald-50 text-emerald-700' : 'text-gray-900'}`}
                            >
                              <p className="text-sm font-medium">{m.nome}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {m.formaFarmaceutica && <p className="text-xs text-gray-400">{m.formaFarmaceutica}</p>}
                                {m.emEstoque
                                  ? <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">No estoque</span>
                                  : <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">Sem estoque</span>
                                }
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">LOTE</label>
              {!medicamentoId ? (
                <div className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-300 bg-gray-50">
                  Selecione a vacina primeiro
                </div>
              ) : !medSelecionado?.emEstoque ? (
                <div className="px-3 py-2.5 border border-gray-200 bg-gray-50 rounded-xl text-xs text-gray-500">
                  Sem estoque cadastrado — registro sem débito de estoque
                </div>
              ) : loadingLotes ? (
                <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl text-xs text-gray-400">
                  <Loader2 size={13} className="animate-spin" /> Buscando lotes…
                </div>
              ) : lotesDisponiveis.length === 0 ? (
                <div className="px-3 py-2.5 border border-amber-200 bg-amber-50 rounded-xl text-xs text-amber-600">
                  Sem lotes disponíveis no estoque
                </div>
              ) : lotesDisponiveis.length === 1 ? (
                <div className="px-3 py-2.5 border border-emerald-200 bg-emerald-50 rounded-xl text-sm">
                  <p className="font-semibold text-emerald-900">{lotesDisponiveis[0].lote ?? '—'}</p>
                  <p className="text-[11px] text-emerald-600 mt-0.5">
                    {lotesDisponiveis[0].qtdDisponivel} doses disponíveis
                    {lotesDisponiveis[0].validade
                      ? ` · Val: ${formatDate(lotesDisponiveis[0].validade)}`
                      : ''}
                  </p>
                </div>
              ) : (
                <select
                  value={loteId}
                  onChange={e => setLoteId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 bg-white"
                >
                  <option value="">Selecione o lote…</option>
                  {lotesDisponiveis.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.lote ?? 'S/N'} · {l.qtdDisponivel} doses
                      {l.validade ? ` · Val: ${formatDate(l.validade)}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">VIA APLICAÇÃO</label>
              <select value={via} onChange={e => setVia(e.target.value)}
                className={classeErro(erroForm, 'via', `w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 bg-white ${!via ? 'text-gray-400' : 'text-gray-900'}`)}>
                <option value="">Selecione…</option>
                {viasDisponiveis.map(v => <option key={v} className="text-gray-900">{v}</option>)}
              </select>
            </div>
          </div>

          {/* Linha 2: Tipo Dose / Qtd Doses / Data Aplicação */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">TIPO DOSE</label>
              <select value={dose} onChange={e => setDose(e.target.value)}
                className={classeErro(erroForm, 'dose', `w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 bg-white ${!dose ? 'text-gray-400' : 'text-gray-900'}`)}>
                <option value="">Selecione…</option>
                {DOSES.map(d => <option key={d} className="text-gray-900">{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">QTD DOSES</label>
              <input
                type="number" min={1} value={qtd}
                onChange={e => setQtd(Math.max(1, Number(e.target.value)))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">DATA APLICAÇÃO</label>
              <DateInput value={dataAplicacao} onChange={setDataAplicacao}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus-within:border-emerald-500" />
            </div>
          </div>

          {/* Prévia do agendamento automático — o backend cria os reforços na EXECUÇÃO
              (a 1ª dose é a própria aplicação, por isso qtd-1). */}
          {INTERVALO_REFORCO_MESES[dose] && qtd > 1 && (
            <p className="-mt-1 mb-3 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              Ao executar, serão agendadas as <b>{qtd - 1} doses seguintes</b>, a cada{' '}
              {INTERVALO_REFORCO_MESES[dose] === 1 ? 'mês' : `${INTERVALO_REFORCO_MESES[dose]} meses`}.
              A 1ª dose é esta aplicação.
            </p>
          )}

          {/* Linha 4: Observação */}
          <div className="mb-3">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">OBSERVAÇÃO</label>
            <input
              type="text" value={observacao}
              onChange={e => setObservacao(e.target.value)}
              placeholder="Observações opcionais"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Quem FORNECE × quem APLICA — lado a lado, como na prescrição. São
              decisões irmãs e ambas do ITEM; o cruzamento delas é que decide se a
              dose vai ao plantão e quando é cobrada (matriz em
              VacinaClinicaController.finalizar).
              `items-center`: os botões Inserir/Finalizar dividem esta linha e são bem
              mais altos que o texto do checkbox — com `items-start` os rótulos ficariam
              desalinhados dos botões (mesma correção feita na prescrição). */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={cliente}
                onChange={e => setCliente(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <span className="text-sm text-red-600 font-medium">Vacina fornecida pelo Cliente</span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={aplicadaPeloProprietario}
                onChange={e => setAplicadaPeloProprietario(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <span className="text-sm text-red-600 font-medium">Será aplicada pelo Proprietário</span>
            </label>

            {/* Inserir + Finalizar na MESMA LINHA dos checkboxes, encostados à direita
                (`ml-auto`) — é onde eles vivem na prescrição. Editando um item da lista,
                o par vira Cancelar + Atualizar item. */}
            <div className="flex items-center gap-2 ml-auto">
              {editandoKey ? (
                <>
                  <button onClick={cancelarEdicaoForm}
                    className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors">
                    Cancelar
                  </button>
                  <button
                    onClick={salvarEdicaoForm}
                    disabled={!medicamentoId || loadingLotes || (lotesDisponiveis.length > 1 && !loteId)}
                    className="flex items-center gap-1.5 px-5 py-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold rounded-xl transition-colors">
                    <Check size={13} /> Atualizar item
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleInserir}
                    disabled={saving || !medicamentoId || loadingLotes || (lotesDisponiveis.length > 1 && !loteId)}
                    className="px-5 py-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold rounded-xl transition-colors">
                    Inserir
                  </button>
                  <button
                    onClick={handleSalvar}
                    disabled={saving || loadingLotes || (!medicamentoId && itensImport.length === 0) ||
                              (!!medicamentoId && lotesDisponiveis.length > 1 && !loteId)}
                    className="flex items-center gap-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    Finalizar
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Erro da AÇÃO logo abaixo do botão que a disparou — nunca no topo da tela */}
          <ErroAcao erro={erroForm} className="mt-3" />

          {/* ── Itens da vacina — abaixo do formulário e dos botões, igual à prescrição ── */}
          {itensImport.length > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                ITENS DA VACINA ({itensImport.length})
              </p>

              <div className="space-y-2">
                {itensImport.map(item => {
                  const emEdicao = editandoKey === item.key;
                  const loteLabel = item.loteId
                    ? (item.lotes.find(l => l.id === item.loteId)?.lote ?? null) : null;
                  return (
                  <div key={item.key}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors ${emEdicao ? 'border-emerald-300 bg-emerald-50' : 'border-gray-100 bg-gray-50'}`}>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 bg-emerald-100 text-emerald-700">
                      <Syringe size={9} /> Vacina
                    </span>
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="text-sm font-semibold text-gray-800">{item.nome}</span>
                      {!item.medicamentoCatId && (
                        <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">Sem cadastro</span>
                      )}
                      {item.cliente && (
                        <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">Cliente</span>
                      )}
                      {item.aplicadaPeloProprietario && (
                        <span title="Aplicada pelo proprietário — fora da Execução de Prescrição"
                          className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">Proprietário</span>
                      )}
                      <ChipVac label="Dose:" value={item.dose} />
                      <ChipVac label="Via:"  value={item.via} />
                      <ChipVac label="Qtd:"  value={String(item.quantidade)} />
                      <ChipVac label="Lote:" value={loteLabel} />
                      <ChipVac label="Início:" value={formatDate(item.dataAplicacao)} />
                      <ChipVac label="Obs:"  value={item.observacao.trim()} />
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => emEdicao ? cancelarEdicaoForm() : editarNoForm(item)}
                        title={emEdicao ? 'Em edição no formulário — cancelar' : 'Editar no formulário'}
                        className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors">
                        {emEdicao ? <Check size={13} /> : <Pencil size={12} />}
                      </button>
                      <button onClick={() => { setItensImport(prev => prev.filter(x => x.key !== item.key)); if (emEdicao) cancelarEdicaoForm(); }}
                        title="Cancelar" className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Ban size={12} />
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── Histórico ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico de Vacinação</p>
        <span className="text-xs text-gray-400">{historico.length} registro{historico.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Filtros por status — mesma aba da prescrição: um só realce (emerald), a
          contagem entre parênteses e apenas os status que existem no histórico. */}
      {historico.length > 0 && (() => {
        const statusTabs = STATUS_ORDER.filter(s => counts[s] > 0 || filtroStatus === s);
        return (
          <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-gray-50">
            {(['todos', ...statusTabs] as FiltroStatus[]).map(key => {
              const isActive = filtroStatus === key;
              const label    = key === 'todos' ? 'Todos' : STATUS_VACINA[key].label;
              const count    = key === 'todos' ? historico.length : counts[key];
              return (
                <button key={key} onClick={() => setFiltroStatus(key)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    isActive ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}>
                  {label}
                  <span className={isActive ? 'text-emerald-100' : 'text-gray-400'}>({count})</span>
                </button>
              );
            })}
          </div>
        );
      })()}

      {loadingHist ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-emerald-600" />
        </div>
      ) : historico.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-300">
          <Syringe size={36} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhuma vacina registrada</p>
        </div>
      ) : historicoFiltrado.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-300">
          <Clock size={28} className="mb-2" />
          <p className="text-sm text-gray-400">
            Nenhuma vacina com status "{filtroStatus === 'todos' ? 'Todos' : STATUS_VACINA[filtroStatus].label}"
          </p>
        </div>
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden divide-y divide-gray-50">
            {historicoPage.map(v => {
              const vcNum  = formatVcNum(v.numero);
              const status = getStatus(v);
              return (
                <div key={v.id} className={`px-4 py-3 ${!v.ativo ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {vcNum && (
                        <button onClick={() => setViewingV(v)}
                          className="font-mono font-bold text-emerald-700 hover:underline text-sm flex-shrink-0">
                          #{vcNum}
                        </button>
                      )}
                      <span className="text-sm font-semibold text-gray-900 truncate">{v.nome}</span>
                    </div>
                    <StatusBadge status={status} />
                  </div>

                  <p className="text-xs text-gray-500">
                    {v.cliente && <span className="text-amber-700 font-medium">Cliente · </span>}
                    {v.aplicadaPeloProprietario && <span className="text-amber-700 font-medium">Proprietário · </span>}
                    {v.dose && <>{v.dose} · </>}
                    {v.quantidade != null && v.quantidade > 1 && <>{v.quantidade} doses · </>}
                    {formatDate(v.dataAplicacao)}
                  </p>
                  {v.lote && <p className="text-[11px] text-gray-400 mt-0.5">Lote: {v.lote}</p>}
                  {v.dataReforco && (
                    <p className={`text-[11px] mt-0.5 ${reforcoVencido(v) ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                      Reforço: {formatDate(v.dataReforco)} {reforcoVencido(v) && '⚠'}
                    </p>
                  )}
                  {v.veterinario && <p className="text-[11px] text-gray-400 mt-0.5">Por: {v.veterinario.fullName}</p>}

                  <div className="flex flex-wrap gap-2 mt-2">
                    <button onClick={() => setViewingV(v)}
                      className="flex items-center gap-1 px-2.5 py-1 border border-emerald-200 text-emerald-700 rounded-lg text-xs hover:bg-emerald-50 transition-colors">
                      <Eye size={11} /> Visualizar
                    </button>
                    {status === 'SALVA' && v.ativo && podeFinalizarVac(v) && (
                      <button onClick={() => handleFinalizar(v)} disabled={finalizandoId === v.id}
                        className="flex items-center gap-1 px-2.5 py-1 border border-emerald-200 text-emerald-700 rounded-lg text-xs hover:bg-emerald-50 transition-colors disabled:opacity-50">
                        {finalizandoId === v.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Finalizar
                      </button>
                    )}
                    {/* Compartilhar é saída de conteúdo do sistema: segue IMPRIMIR */}
                    {podeImprimir && (
                      <button onClick={() => abrirWhatsApp(montarTextoVacina(v))}
                        className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-green-600 rounded-lg text-xs hover:bg-green-50 transition-colors">
                        <MessageCircle size={11} /> WhatsApp
                      </button>
                    )}
                    {podeImprimir && (
                      <button onClick={() => abrirEmail(`Vacina - ${v.nome}`, montarTextoVacina(v))}
                        className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-blue-500 rounded-lg text-xs hover:bg-blue-50 transition-colors">
                        <Mail size={11} /> E-mail
                      </button>
                    )}
                    {podeImprimir && (
                      <button onClick={() => imprimirVacina(v, animal)}
                        className="flex items-center gap-1 px-2.5 py-1 border border-blue-200 text-blue-600 rounded-lg text-xs hover:bg-blue-50 transition-colors">
                        <Printer size={11} /> Imprimir
                      </button>
                    )}
                    {podeExcluirVac(v) && v.ativo && (
                      <button onClick={() => handleExcluirSolicitado(v.id)}
                        className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors">
                        <Ban size={11} /> Cancelar
                      </button>
                    )}
                  </div>
                  {/* Erro na superfície da ação: embaixo dos botões deste card */}
                  <ErroAcao
                    erro={erroDaLinha(v.id) ? { mensagem: erroDaLinha(v.id)! } : null}
                    className="mt-2"
                  />
                </div>
              );
            })}
          </div>

          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Vacina</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Dose</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Qtd</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Lote</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Via</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Aplicação</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Executor</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {historicoPage.map(v => {
                  const vcNum  = formatVcNum(v.numero);
                  const status = getStatus(v);
                  return (
                    <tr key={v.id} className={`hover:bg-gray-50/60 transition-colors ${!v.ativo ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        {/* Número clicável abre a visualização — igual ao #Nº da prescrição */}
                        {vcNum
                          ? <button onClick={() => setViewingV(v)}
                              className="font-mono font-bold text-emerald-700 hover:text-emerald-900 text-sm hover:underline">
                              #{vcNum}
                            </button>
                          : <span className="text-gray-300">—</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium text-gray-900">{v.nome}</p>
                          {v.cliente && (
                            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">CLIENTE</span>
                          )}
                          {v.aplicadaPeloProprietario && (
                            <span title="Aplicada pelo proprietário — fora da Execução de Prescrição"
                              className="text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded">PROPRIETÁRIO</span>
                          )}
                        </div>
                        {v.fabricante && <p className="text-xs text-gray-400">{v.fabricante}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{v.dose ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{v.quantidade ?? 1}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {v.lote ?? <span className="text-gray-300">—</span>}
                        {v.loteVacina && (
                          <p className="text-[10px] text-gray-400">Val: {formatDate(v.loteVacina.validade)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{v.via ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
                        {formatDate(v.dataAplicacao)}
                        {v.dataReforco && (
                          <p className={`text-[10px] mt-0.5 ${reforcoVencido(v) ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                            Reforço: {formatDate(v.dataReforco)} {reforcoVencido(v) && '⚠'}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {v.veterinario?.fullName ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {/* Cores por AÇÃO (CLAUDE.md §6): ver/finalizar = emerald,
                            imprimir = azul, cancelar = vermelho. */}
                        <div className="flex items-center gap-1">
                          <button onClick={() => setViewingV(v)} title="Visualizar"
                            className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                            <Eye size={13} />
                          </button>
                          {status === 'SALVA' && v.ativo && podeFinalizarVac(v) && (
                            <button onClick={() => handleFinalizar(v)} disabled={finalizandoId === v.id} title="Finalizar vacina"
                              className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50">
                              {finalizandoId === v.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                            </button>
                          )}
                          {podeImprimir && (
                            <button onClick={() => imprimirVacina(v, animal)} title="Imprimir vacina"
                              className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
                              <Printer size={13} />
                            </button>
                          )}
                          {podeExcluirVac(v) && v.ativo && (
                            <button onClick={() => handleExcluirSolicitado(v.id)} title="Cancelar vacina"
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                              <Ban size={13} />
                            </button>
                          )}
                        </div>
                        {/* Erro na superfície da ação: embaixo dos botões desta linha */}
                        <ErroAcao
                          erro={erroDaLinha(v.id) ? { mensagem: erroDaLinha(v.id)! } : null}
                          className="mt-2 max-w-xs text-left whitespace-normal"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPags > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
              <span className="text-xs text-gray-400">{historicoFiltrado.length} registro{historicoFiltrado.length !== 1 ? 's' : ''}</span>
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

      {viewingV && <ViewModal v={viewingV} onFechar={() => setViewingV(null)} />}

      {confirmandoDuplicata && medSelecionado && (
        <DuplicataWarningModal
          nomeVacina={medSelecionado.nome}
          data={dataAplicacao}
          onConfirmar={() => { setConfirmandoDuplicata(false); executarSalvar(); }}
          onCancelar={() => setConfirmandoDuplicata(false)}
        />
      )}

      <ExcluirModal
        open={excluindoId != null}
        onConfirmar={handleExcluirConfirmado}
        onCancelar={() => setExcluindoId(null)}
      />
    </>
  );
}

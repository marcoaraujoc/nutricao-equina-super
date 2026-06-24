// frontend/src/pages/SubModuloVacina.tsx — registro clínico de vacinas

import { useState, useEffect, useCallback, useRef } from 'react';
import { Syringe, Trash2, Eye, Loader2, X, ChevronLeft, ChevronRight, ChevronDown, AlertCircle, CheckCircle, Clock, Printer } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useEmpresa } from '../contexts/EmpresaContext';
import { usePermissoes } from '../hooks/usePermissoes';
import type { AnimalInfo } from './SubModuloEvolucao';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MedicamentoCatalogo {
  id:                number;
  nome:              string;
  formaFarmaceutica: string;
  valorUnitario:     number | null;
  vias:              { id: number; via: string }[];
}

interface LoteDisponivel {
  id:            number;
  lote:          string | null;
  validade:      string | null;
  qtdDisponivel: number;
  valorPorDose:  number;
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
  ativo:             boolean;
  dataAplicacao:     string;
  dataReforco:       string | null;
  observacao:        string | null;
  motivoInativacao:  string | null;
  veterinario:       { id: number; fullName: string } | null;
  vacina:            { id: number; nome: string; via: string } | null;
  loteVacina:        { id: number; lote: string; validade: string } | null;
}

type StatusVacina = 'VIGENTE' | 'VENCIDA' | 'INATIVA';
type FiltroStatus = 'todos' | 'VIGENTE' | 'VENCIDA' | 'INATIVA';

// ─── Constants ────────────────────────────────────────────────────────────────

const DOSES = [
  '1ª Dose (Filhote)',
  '2ª Dose',
  '3ª Dose',
  'Reforço Anual',
  'Dose Única',
  'Revacinação',
];

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

function imprimirVacina(v: VacinaClinica) {
  const formatD = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
  const vcNum   = formatVcNum(v.numero, v.tipoAtendimento);
  const status  = getStatus(v);
  const statusLabel = status === 'VIGENTE' ? 'Vigente' : status === 'VENCIDA' ? 'Vencida' : 'Inativa';
  const w = window.open('', '_blank', 'width=700,height=600');
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <title>Vacina${vcNum ? ' ' + vcNum : ''}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #111; font-size: 13px; }
      h1 { font-size: 16px; margin-bottom: 4px; }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 700; margin-left: 8px; }
      .VIGENTE { background:#d1fae5; color:#065f46; }
      .VENCIDA { background:#fee2e2; color:#991b1b; }
      .INATIVA { background:#f3f4f6; color:#4b5563; }
      .cliente-badge { background:#fef3c7; color:#92400e; padding: 2px 8px; border-radius: 4px; font-size:11px; font-weight:700; border:1px solid #fde68a; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      td { padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
      td:first-child { color: #9ca3af; width: 140px; }
      @media print { body { margin: 16px; } }
    </style></head><body>
    <h1>Registro de Vacinação${vcNum ? ` <span style="font-size:13px;color:#0d9488">${vcNum}</span>` : ''}
      <span class="badge ${status}">${statusLabel}</span>
      ${v.cliente ? '<span class="cliente-badge">CLIENTE</span>' : ''}
    </h1>
    <table>
      <tr><td>Vacina</td><td><strong>${v.nome}</strong></td></tr>
      ${v.fabricante ? `<tr><td>Fabricante</td><td>${v.fabricante}</td></tr>` : ''}
      ${v.lote ? `<tr><td>Lote</td><td>${v.lote}</td></tr>` : ''}
      ${v.loteVacina ? `<tr><td>Validade lote</td><td>${formatD(v.loteVacina.validade)}</td></tr>` : ''}
      ${v.dose ? `<tr><td>Tipo dose</td><td>${v.dose}</td></tr>` : ''}
      ${v.quantidade != null && v.quantidade > 1 ? `<tr><td>Qtd doses</td><td>${v.quantidade}</td></tr>` : ''}
      ${v.via ? `<tr><td>Via</td><td>${v.via}</td></tr>` : ''}
      <tr><td>Data aplicação</td><td>${formatD(v.dataAplicacao)}</td></tr>
      ${v.dataReforco ? `<tr><td>Reforço</td><td>${formatD(v.dataReforco)}</td></tr>` : ''}
      ${v.veterinario ? `<tr><td>Executor</td><td>${v.veterinario.fullName}</td></tr>` : ''}
      ${v.observacao ? `<tr><td>Observação</td><td>${v.observacao}</td></tr>` : ''}
      ${v.motivoInativacao ? `<tr><td>Motivo inativação</td><td>${v.motivoInativacao}</td></tr>` : ''}
    </table>
    <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
    </body></html>`);
  w.document.close();
}

const hoje = () => new Date().toISOString().slice(0, 10);
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const formatVcNum = (num: number | null, tipo: string | null) =>
  num != null ? `${tipo ?? 'VC'}-${String(num).padStart(4, '0')}` : null;

function getStatus(v: VacinaClinica): StatusVacina {
  if (!v.ativo) return 'INATIVA';
  if (v.dataReforco && new Date(v.dataReforco) < new Date()) return 'VENCIDA';
  return 'VIGENTE';
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: StatusVacina }) {
  if (status === 'INATIVA') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
        <X size={8} /> INATIVA
      </span>
    );
  }
  if (status === 'VENCIDA') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
        <AlertCircle size={8} /> VENCIDA
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700">
      <CheckCircle size={8} /> VIGENTE
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

function ViewModal({ v, onFechar }: { v: VacinaClinica; onFechar: () => void }) {
  const vcNum  = formatVcNum(v.numero, v.tipoAtendimento);
  const status = getStatus(v);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Syringe size={16} className="text-teal-600" />
            <h3 className="font-bold text-gray-900">Detalhes da Vacina</h3>
            {vcNum && (
              <span className="text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-lg">
                {vcNum}
              </span>
            )}
            <StatusBadge status={status} />
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <Row label="Vacina"         value={v.nome} />
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
          {status === 'INATIVA' && v.motivoInativacao && (
            <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-xl">
              <p className="text-xs font-semibold text-gray-500 mb-1">MOTIVO DA INATIVAÇÃO</p>
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
              <Trash2 size={20} className="text-red-600" />
            </div>
            <div className="pt-1.5">
              <h3 className="text-base font-bold text-gray-900 leading-snug">Inativar registro de vacina</h3>
            </div>
          </div>
          <p className="text-sm text-gray-500 ml-14 mb-4">
            O registro será marcado como <span className="font-semibold text-gray-700">INATIVO</span>. Informe o motivo:
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
            <p className="text-xs text-red-500 mt-1">Justificativa obrigatória para inativar</p>
          )}
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2 px-6 pb-6 pt-0">
          <button
            onClick={onCancelar}
            className="flex-1 py-2.5 px-4 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => { if (motivo.trim()) onConfirmar(motivo.trim()); }}
            disabled={!motivo.trim()}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-white transition-colors bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
            Inativar
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
}

const FILTROS: { key: FiltroStatus; label: string }[] = [
  { key: 'todos',    label: 'Todos'    },
  { key: 'VIGENTE',  label: 'Vigentes' },
  { key: 'VENCIDA',  label: 'Vencidas' },
  { key: 'INATIVA',  label: 'Inativas' },
];

export default function SubModuloVacina({ animalId, animal: _animal, evolucaoId, atendimentoNumero, onSalvo, openItemId }: Props) {
  const { contextoAtivo } = useEmpresa();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();

  void contextoAtivo;

  // ── Form state ─────────────────────────────────────────────────────────────
  const [medicamentoId,    setMedicamentoId]    = useState<number | ''>('');
  const [loteId,           setLoteId]           = useState<number | ''>('');
  const [lotesDisponiveis, setLotesDisponiveis] = useState<LoteDisponivel[]>([]);
  const [loadingLotes,     setLoadingLotes]     = useState(false);
  const [dose,             setDose]             = useState('');
  const [qtd,              setQtd]              = useState(1);
  const [cliente,          setCliente]          = useState(false);
  const [dataAplicacao,    setDataAplicacao]    = useState(hoje());
  const [via,              setVia]              = useState('');
  const [observacao,       setObservacao]       = useState('');

  // ── Combobox medicamento ───────────────────────────────────────────────────
  const [buscaMed,          setBuscaMed]          = useState('');
  const [dropdownMedAberto, setDropdownMedAberto] = useState(false);
  const comboboxRef = useRef<HTMLDivElement>(null);

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
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos');

  const [page, setPage] = useState(1);
  const limit = 8;

  const historicoFiltrado = historico.filter(v => {
    if (filtroStatus === 'todos') return true;
    return getStatus(v) === filtroStatus;
  });
  const totalPags    = Math.ceil(historicoFiltrado.length / limit);
  const historicoPage = historicoFiltrado.slice((page - 1) * limit, page * limit);

  const podeCriar    = isGestor || podeExecutar('atendimento.vacinas.criar');
  const podeDeletar  = isGestor || podeExecutar('atendimento.vacinas.deletar');
  const podeImprimir = isGestor || podeExecutar('atendimento.vacinas.imprimir');

  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável.`);

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
      const res = await api.get('/vacinas/estoque/catalogo');
      if (!res.data) return;
      setCatalogo(res.data?.dados ?? []);
    } catch { /* silencioso */ }
    finally { setLoadingCat(false); }
  }, []);

  const carregarHistorico = useCallback(async () => {
    setLoadingHist(true);
    try {
      const res = await api.get(`/clinica/vacinas/animal/${animalId}`);
      if (!res.data) return;
      setHistorico(res.data?.dados ?? []);
    } catch { /* silencioso */ }
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
      .catch(() => {});
  }, [openItemId]);

  useEffect(() => {
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
    if (!medicamentoId) {
      setLoteId('');
      setLotesDisponiveis([]);
      return;
    }
    fetchLotes(medicamentoId);
  }, [medicamentoId, fetchLotes]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [filtroStatus]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const limparForm = () => {
    setMedicamentoId('');
    setLoteId('');
    setLotesDisponiveis([]);
    setDose('');
    setQtd(1);
    setCliente(false);
    setDataAplicacao(hoje());
    setVia('');
    setObservacao('');
    setBuscaMed('');
    setDropdownMedAberto(false);
  };

  const handleSalvar = async () => {
    if (!podeCriar)     { semPermissao('registrar vacinas'); return; }
    if (!medicamentoId) { toast.error('Selecione a vacina'); return; }

    setSaving(true);
    try {
      await api.post('/clinica/vacinas', {
        animalId,
        medicamentoCatId: medicamentoId,
        ...(evolucaoId && { evolucaoId }),
        ...(loteId     && { loteId }),
        dose:      dose || null,
        quantidade: qtd,
        cliente,
        via:       via || null,
        dataAplicacao,
        observacao: observacao.trim() || null,
      });
      toast.success('Vacina registrada com sucesso');
      limparForm();
      setPage(1);
      carregarHistorico();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao registrar vacina');
    } finally { setSaving(false); }
  };

  const handleExcluirSolicitado = (id: number) => {
    if (!podeDeletar) { semPermissao('excluir registros de vacina'); return; }
    setExcluindoId(id);
  };

  const handleExcluirConfirmado = async (motivo: string) => {
    if (excluindoId == null) return;
    const id = excluindoId;
    setExcluindoId(null);
    try {
      await api.delete(`/clinica/vacinas/${id}`, { data: { motivo } });
      toast.success('Registro inativado');
      carregarHistorico();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao inativar');
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
    { VIGENTE: 0, VENCIDA: 0, INATIVA: 0 } as Record<StatusVacina, number>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>

      {/* ── Formulário de registro ─────────────────────────────────────────── */}
      {podeCriar && (
        <div className="p-5 border-b border-gray-100">



          {/* Linha 1: Vacina (combobox) / Lote */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-4">

            <div className="sm:col-span-3" ref={comboboxRef}>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">VACINA *</label>
              {loadingCat ? (
                <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl text-xs text-gray-400">
                  <Loader2 size={13} className="animate-spin" /> Carregando…
                </div>
              ) : catalogo.length === 0 ? (
                <div className="px-3 py-2.5 border border-amber-200 rounded-xl text-sm text-amber-600 bg-amber-50 text-xs">
                  Nenhuma vacina disponível no estoque
                </div>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDropdownMedAberto(v => !v)}
                    className="w-full flex items-center justify-between border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-teal-500 text-left"
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
                          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500"
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
                              className={`w-full text-left px-3 py-2 hover:bg-teal-50 transition-colors ${m.id === medicamentoId ? 'bg-teal-50 text-teal-700' : 'text-gray-900'}`}
                            >
                              <p className="text-sm font-medium">{m.nome}</p>
                              <p className="text-xs text-gray-400">{m.formaFarmaceutica}</p>
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
              ) : loadingLotes ? (
                <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl text-xs text-gray-400">
                  <Loader2 size={13} className="animate-spin" /> Buscando lotes…
                </div>
              ) : lotesDisponiveis.length === 0 ? (
                <div className="px-3 py-2.5 border border-amber-200 bg-amber-50 rounded-xl text-xs text-amber-600">
                  Sem lotes disponíveis no estoque
                </div>
              ) : lotesDisponiveis.length === 1 ? (
                <div className="px-3 py-2.5 border border-teal-200 bg-teal-50 rounded-xl text-sm">
                  <p className="font-semibold text-teal-900">{lotesDisponiveis[0].lote ?? '—'}</p>
                  <p className="text-[11px] text-teal-600 mt-0.5">
                    {lotesDisponiveis[0].qtdDisponivel} doses disponíveis
                    {lotesDisponiveis[0].validade
                      ? ` · Val: ${new Date(lotesDisponiveis[0].validade).toLocaleDateString('pt-BR')}`
                      : ''}
                  </p>
                </div>
              ) : (
                <select
                  value={loteId}
                  onChange={e => setLoteId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-teal-500 bg-white"
                >
                  <option value="">Selecione o lote…</option>
                  {lotesDisponiveis.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.lote ?? 'S/N'} · {l.qtdDisponivel} doses
                      {l.validade ? ` · Val: ${new Date(l.validade).toLocaleDateString('pt-BR')}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Linha 2: Tipo Dose / Via */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">TIPO DOSE</label>
              <select value={dose} onChange={e => setDose(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-teal-500 bg-white">
                <option value="">Selecione…</option>
                {DOSES.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">VIA APLICAÇÃO</label>
              <select value={via} onChange={e => setVia(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-teal-500 bg-white">
                <option value="">Selecione…</option>
                {viasDisponiveis.map(v => <option key={v}>{v}</option>)}
              </select>
            </div>
          </div>

          {/* Linha 3: Data Aplicação / Qtd Doses */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">DATA APLICAÇÃO</label>
              <input type="date" value={dataAplicacao} onChange={e => setDataAplicacao(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-teal-500" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">QTD DOSES</label>
              <input
                type="number" min={1} value={qtd}
                onChange={e => setQtd(Math.max(1, Number(e.target.value)))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>

          {/* Linha 4: Observação */}
          <div className="mb-3">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">OBSERVAÇÃO</label>
            <input
              type="text" value={observacao}
              onChange={e => setObservacao(e.target.value)}
              placeholder="Observações opcionais"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-teal-500"
            />
          </div>

          {/* Checkbox cliente */}
          <div className="mb-5">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={cliente}
                onChange={e => setCliente(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
              />
              <span className="text-sm text-red-600 font-medium">Medicamento fornecido pelo Cliente</span>
            </label>
            {cliente && (
              <p className="text-xs text-amber-600 mt-1.5 ml-6">Sem débito de estoque · Sem lançamento na fatura</p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSalvar}
              disabled={saving || !medicamentoId || loadingLotes || (lotesDisponiveis.length > 1 && !loteId)}
              className="flex items-center gap-2 px-6 py-2.5 bg-teal-700 hover:bg-teal-800 disabled:bg-gray-300 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
              {saving && <Loader2 size={14} className="animate-spin" />}
              <Syringe size={15} />
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {/* ── Histórico ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico de Vacinação</p>
        <span className="text-xs text-gray-400">{historico.length} registro{historico.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Filtros de status */}
      {historico.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-gray-50">
          {FILTROS.map(f => {
            const count = f.key === 'todos'
              ? historico.length
              : counts[f.key as StatusVacina];
            const isActive = filtroStatus === f.key;
            let activeClass = 'bg-teal-600 text-white border-teal-600';
            if (f.key === 'VENCIDA' && isActive) activeClass = 'bg-red-600 text-white border-red-600';
            if (f.key === 'INATIVA' && isActive) activeClass = 'bg-gray-500 text-white border-gray-500';
            return (
              <button
                key={f.key}
                onClick={() => setFiltroStatus(f.key)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  isActive ? activeClass : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}>
                {f.label}
                {f.key === 'VENCIDA' && !isActive && counts.VENCIDA > 0 && (
                  <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {counts.VENCIDA}
                  </span>
                )}
                {f.key === 'INATIVA' && !isActive && counts.INATIVA > 0 && (
                  <span className="w-4 h-4 rounded-full bg-gray-400 text-white text-[9px] font-bold flex items-center justify-center">
                    {counts.INATIVA}
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
          <Loader2 size={22} className="animate-spin text-teal-600" />
        </div>
      ) : historico.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-300">
          <Syringe size={36} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhuma vacina registrada</p>
        </div>
      ) : historicoFiltrado.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-300">
          <Clock size={28} className="mb-2" />
          <p className="text-sm text-gray-400">Nenhum registro com status "{filtroStatus}"</p>
        </div>
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden divide-y divide-gray-50">
            {historicoPage.map(v => {
              const vcNum  = formatVcNum(v.numero, v.tipoAtendimento);
              const status = getStatus(v);
              return (
                <div key={v.id} className={`flex items-start gap-3 px-4 py-3 ${!v.ativo ? 'opacity-60' : ''}`}>
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    status === 'INATIVA' ? 'bg-gray-100' : status === 'VENCIDA' ? 'bg-red-100' : 'bg-teal-100'
                  }`}>
                    <Syringe size={14} className={
                      status === 'INATIVA' ? 'text-gray-400' : status === 'VENCIDA' ? 'text-red-500' : 'text-teal-700'
                    } />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {vcNum && (
                        <span className="text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded">
                          {vcNum}
                        </span>
                      )}
                      <p className="text-sm font-semibold text-gray-900 truncate">{v.nome}</p>
                      {v.cliente && (
                        <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">CLIENTE</span>
                      )}
                      <StatusBadge status={status} />
                    </div>
                    <p className="text-xs text-gray-400">
                      {v.dose && <span>{v.dose} · </span>}
                      {v.quantidade != null && v.quantidade > 1 && <span>{v.quantidade} doses · </span>}
                      {formatDate(v.dataAplicacao)}
                    </p>
                    {v.lote && <p className="text-xs text-gray-400">Lote: {v.lote}</p>}
                    {v.dataReforco && (
                      <p className={`text-xs ${status === 'VENCIDA' ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                        Reforço: {formatDate(v.dataReforco)} {status === 'VENCIDA' && '⚠'}
                      </p>
                    )}
                    {v.veterinario && <p className="text-[11px] text-gray-400">Por: {v.veterinario.fullName}</p>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setViewingV(v)} title="Visualizar"
                      className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg"><Eye size={14} /></button>
                    {podeImprimir && (
                      <button onClick={() => imprimirVacina(v)} title="Imprimir"
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg"><Printer size={14} /></button>
                    )}
                    {podeDeletar && v.ativo && (
                      <button onClick={() => handleExcluirSolicitado(v.id)} title="Inativar"
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
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
                  const vcNum  = formatVcNum(v.numero, v.tipoAtendimento);
                  const status = getStatus(v);
                  return (
                    <tr key={v.id} className={`hover:bg-gray-50/60 transition-colors ${!v.ativo ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        {vcNum
                          ? <span className="text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">{vcNum}</span>
                          : <span className="text-gray-300">—</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium text-gray-900">{v.nome}</p>
                          {v.cliente && (
                            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">CLIENTE</span>
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
                          <p className={`text-[10px] mt-0.5 ${status === 'VENCIDA' ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                            Reforço: {formatDate(v.dataReforco)} {status === 'VENCIDA' && '⚠'}
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
                        <div className="flex items-center gap-1">
                          <button onClick={() => setViewingV(v)} title="Visualizar"
                            className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors">
                            <Eye size={14} />
                          </button>
                          {podeImprimir && (
                            <button onClick={() => imprimirVacina(v)} title="Imprimir"
                              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                              <Printer size={14} />
                            </button>
                          )}
                          {podeDeletar && v.ativo && (
                            <button onClick={() => handleExcluirSolicitado(v.id)} title="Inativar"
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 size={14} />
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

      <ExcluirModal
        open={excluindoId != null}
        onConfirmar={handleExcluirConfirmado}
        onCancelar={() => setExcluindoId(null)}
      />
    </>
  );
}

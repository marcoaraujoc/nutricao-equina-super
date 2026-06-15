// frontend/src/pages/SubModuloExames.tsx — requisições de exames clínicos

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FlaskConical, Scan, Trash2, Eye, Loader2, X,
  ChevronLeft, ChevronRight, Calendar,
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { usePermissoes } from '../hooks/usePermissoes';
import type { AnimalInfo } from './SubModuloEvolucao';

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoExame = 'Laboratorial' | 'Bioquímico' | 'Imagem';

interface ExtraInfo {
  laboratorio:      string | null;
  dataHoraColeta:   string | null;
  tipoAmostra:      string | null;
  indicacaoClinica: string | null;
  obs:              string | null;
}

interface ExameClinico {
  id:              number;
  tipo:            TipoExame;
  descricao:       string;
  status:          string;
  observacao:      string | null;
  dataSolicitacao: string;
  veterinario:     { id: number; fullName: string } | null;
}

interface Props {
  animalId: number;
  animal:   AnimalInfo | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TIPOS: { key: TipoExame; label: string; icon: typeof FlaskConical; badge: string }[] = [
  { key: 'Laboratorial', label: 'Laboratorial', icon: FlaskConical, badge: 'bg-blue-100 text-blue-700'       },
  { key: 'Imagem',       label: 'Imagem',        icon: Scan,         badge: 'bg-emerald-100 text-emerald-700' },
];

const hoje = () => new Date().toISOString().slice(0, 10);
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

// Máscara DD/MM/AAAA HH:MM — sem dependência de locale do SO
function maskDatetime(val: string): string {
  const d = val.replace(/\D/g, '').slice(0, 12);
  let r = d.slice(0, 2);
  if (d.length > 2)  r += '/' + d.slice(2, 4);
  if (d.length > 4)  r += '/' + d.slice(4, 8);
  if (d.length > 8)  r += ' ' + d.slice(8, 10);
  if (d.length > 10) r += ':' + d.slice(10, 12);
  return r;
}

function maskedToISO(masked: string): string | null {
  const d = masked.replace(/\D/g, '');
  if (d.length < 12) return null;
  const h = parseInt(d.slice(8, 10), 10);
  const m = parseInt(d.slice(10, 12), 10);
  if (h > 23 || m > 59) return null;
  return `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}T${d.slice(8, 10)}:${d.slice(10, 12)}`;
}

function parseExtra(obs: string | null): ExtraInfo {
  if (!obs) return { laboratorio: null, dataHoraColeta: null, tipoAmostra: null, indicacaoClinica: null, obs: null };
  try { return JSON.parse(obs) as ExtraInfo; } catch { return { laboratorio: null, dataHoraColeta: null, tipoAmostra: null, indicacaoClinica: null, obs }; }
}

// ─── Row helper ───────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-gray-400 w-32 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 font-medium">{value}</span>
    </div>
  );
}

// ─── ViewModal ────────────────────────────────────────────────────────────────

function ViewModal({ ex, onFechar }: { ex: ExameClinico; onFechar: () => void }) {
  const extra = parseExtra(ex.observacao);
  const tipoMeta = TIPOS.find(t => t.key === ex.tipo);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-blue-600" />
            <h3 className="font-bold text-gray-900">Detalhes do Exame</h3>
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${tipoMeta?.badge ?? 'bg-gray-100 text-gray-600'}`}>
              {ex.tipo}
            </span>
            <span className="text-xs text-gray-400">{ex.status}</span>
          </div>
          <Row label="Exame"        value={ex.descricao} />
          {extra.laboratorio      && <Row label="Laboratório"        value={extra.laboratorio} />}
          {extra.dataHoraColeta   && <Row label="Data/Hora Coleta"   value={new Date(extra.dataHoraColeta).toLocaleString('pt-BR')} />}
          {extra.tipoAmostra      && <Row label="Tipo de Amostra"    value={extra.tipoAmostra} />}
          {extra.indicacaoClinica && <Row label="Indicação Clínica" value={extra.indicacaoClinica} />}
          {extra.obs              && <Row label="Preparo / Obs."    value={extra.obs} />}
          <Row label="Solicitado em" value={formatDate(ex.dataSolicitacao)} />
          {ex.veterinario && <Row label="Solicitado por" value={ex.veterinario.fullName} />}
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

// ─── SubModuloExames ──────────────────────────────────────────────────────────

export default function SubModuloExames({ animalId, animal: _animal }: Props) {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();

  const datePickerRef     = useRef<HTMLInputElement>(null);
  const dataHoraColetaRef = useRef('');
  const pendingDateRef    = useRef('');

  // ── Form state ─────────────────────────────────────────────────────────────
  const [tipo,             setTipo]             = useState<TipoExame>('Laboratorial');
  const [descricao,        setDescricao]        = useState('');
  const [laboratorio,      setLaboratorio]      = useState('');
  const [dataHoraColeta,   setDataHoraColeta]   = useState('');
  dataHoraColetaRef.current = dataHoraColeta;
  const [showTimePicker,   setShowTimePicker]   = useState(false);
  const [pickerH,          setPickerH]          = useState('');
  const [pickerM,          setPickerM]          = useState('');
  const [tipoAmostra,      setTipoAmostra]      = useState('');
  const [indicacaoClinica, setIndicacaoClinica] = useState('');
  const [observacao,       setObservacao]       = useState('');
  const [dataSolicitacao,  setDataSolicitacao]  = useState(hoje());

  // ── Data state ─────────────────────────────────────────────────────────────
  const [historico,   setHistorico]   = useState<ExameClinico[]>([]);
  const [total,       setTotal]       = useState(0);
  const [loadingHist, setLoadingHist] = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [viewingEx,   setViewingEx]   = useState<ExameClinico | null>(null);

  const [page,  setPage]  = useState(1);
  const limit             = 8;
  const totalPags         = Math.ceil(total / limit);

  const podeCriar   = isGestor || podeExecutar('atendimento.exames.criar');
  const podeDeletar = isGestor || podeExecutar('atendimento.exames.deletar');

  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável.`);


  // ── Loader ─────────────────────────────────────────────────────────────────

  const carregarHistorico = useCallback(async (p = 1) => {
    setLoadingHist(true);
    try {
      const res = await api.get(`/clinica/exames/animal/${animalId}?page=${p}&limit=${limit}`);
      if (!res.data) return;
      setHistorico(res.data?.dados ?? []);
      setTotal(res.data?.meta?.total ?? 0);
    } catch { /* silencioso */ }
    finally { setLoadingHist(false); }
  }, [animalId]);

  useEffect(() => {
    if (loadingPerms) return;
    carregarHistorico(page);
  }, [carregarHistorico, loadingPerms, page]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSalvar = async () => {
    if (!podeCriar)            { semPermissao('registrar exames'); return; }
    if (!laboratorio.trim())   { toast.error('Informe o laboratório de destino'); return; }
    if (!maskedToISO(dataHoraColeta)) { toast.error('Informe data e hora da coleta (DD/MM/AAAA HH:MM)'); return; }
    if (!dataSolicitacao)      { toast.error('Informe a data da solicitação'); return; }
    if (!descricao.trim())     { toast.error('Informe o nome do exame'); return; }
    if (!tipoAmostra.trim())   { toast.error('Informe o tipo de amostra'); return; }

    setSaving(true);
    try {
      await api.post('/clinica/exames', {
        animalId,
        tipo,
        descricao:        descricao.trim(),
        laboratorio:      laboratorio.trim()      || null,
        dataHoraColeta:   maskedToISO(dataHoraColeta),
        tipoAmostra:      tipoAmostra.trim()      || null,
        indicacaoClinica: indicacaoClinica.trim() || null,
        observacao:       observacao.trim()        || null,
        dataSolicitacao,
      });
      toast.success('Exame registrado com sucesso');
      setDescricao(''); setLaboratorio(''); setDataHoraColeta(''); setTipoAmostra('');
      setIndicacaoClinica(''); setObservacao(''); setDataSolicitacao(hoje());
      setPage(1);
      carregarHistorico(1);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao registrar exame');
    } finally { setSaving(false); }
  };

  const handleExcluir = async (id: number) => {
    if (!podeDeletar) { semPermissao('excluir registros de exame'); return; }
    if (!confirm('Remover este registro de exame?')) return;
    try {
      await api.delete(`/clinica/exames/${id}`);
      toast.success('Registro removido');
      carregarHistorico(page);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao remover');
    }
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Formulário de registro ─────────────────────────────────────────── */}
      {podeCriar && (
        <div className="p-5 border-b border-gray-100">
          {/* Tipo de exame */}
          <div className="flex gap-2 mb-5">
            {TIPOS.map(t => {
              const Icon  = t.icon;
              const ativo = tipo === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTipo(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl transition-colors ${
                    ativo
                      ? 'bg-emerald-700 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Icon size={11} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Linha 1: Laboratório / Data e Hora Coleta / Data Solicitação */}
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">LABORATÓRIO DE DESTINO *</label>
              <input
                type="text"
                value={laboratorio}
                onChange={e => setLaboratorio(e.target.value)}
                placeholder="Ex: VetLab Diagnósticos"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="shrink-0 w-fit">
              <label className="block text-xs text-gray-500 mb-1.5 font-medium whitespace-nowrap">DATA E HORA COLETA *</label>
              <div className="relative">
                <input
                  type="text"
                  value={dataHoraColeta}
                  onChange={e => setDataHoraColeta(maskDatetime(e.target.value))}
                  placeholder="DD/MM/YYYY HH24:MI"
                  maxLength={16}
                  className="w-full border border-gray-200 rounded-xl pl-3 pr-9 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => datePickerRef.current?.showPicker()}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-900 hover:text-blue-600 transition-colors"
                >
                  <Calendar size={15} />
                </button>
                <input
                  ref={datePickerRef}
                  type="date"
                  tabIndex={-1}
                  className="absolute inset-0 opacity-0 pointer-events-none w-0 h-0"
                  onChange={e => {
                    if (!e.target.value) return;
                    const [y, m, d] = e.target.value.split('-');
                    pendingDateRef.current = `${d}${m}${y}`;
                    const horaDigits = dataHoraColetaRef.current.replace(/\D/g, '').slice(8);
                    setDataHoraColeta(maskDatetime(`${d}${m}${y}${horaDigits}`));
                    setPickerH(''); setPickerM('');
                    setShowTimePicker(true);
                  }}
                />
                {showTimePicker && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-3 min-w-[160px]">
                    <p className="text-[10px] text-gray-400 uppercase font-semibold mb-2 tracking-wide">Hora da coleta</p>
                    <div className="flex items-center gap-1.5 mb-3">
                      <input
                        type="text"
                        value={pickerH}
                        onChange={e => setPickerH(e.target.value.replace(/\D/g, '').slice(0, 2))}
                        placeholder="HH"
                        maxLength={2}
                        className="w-12 text-center border border-gray-200 rounded-lg px-1 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                      />
                      <span className="text-gray-500 font-bold">:</span>
                      <input
                        type="text"
                        value={pickerM}
                        onChange={e => setPickerM(e.target.value.replace(/\D/g, '').slice(0, 2))}
                        placeholder="MM"
                        maxLength={2}
                        className="w-12 text-center border border-gray-200 rounded-lg px-1 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex gap-2">
                      {(['AM', 'PM'] as const).map(period => (
                        <button
                          key={period}
                          type="button"
                          onClick={() => {
                            let h = parseInt(pickerH || '0', 10);
                            const m = (pickerM || '00').padStart(2, '0');
                            if (period === 'PM' && h < 12) h += 12;
                            if (period === 'AM' && h === 12) h = 0;
                            const dateDigits = pendingDateRef.current || dataHoraColetaRef.current.replace(/\D/g, '').slice(0, 8);
                            setDataHoraColeta(maskDatetime(`${dateDigits}${String(h).padStart(2, '0')}${m}`));
                            setShowTimePicker(false);
                          }}
                          className="flex-1 py-1.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-400 hover:text-blue-700 transition-colors"
                        >
                          {period}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="shrink-0 w-fit">
              <label className="block text-xs text-gray-500 mb-1.5 font-medium whitespace-nowrap">DATA DA SOLICITAÇÃO *</label>
              <input
                type="date"
                value={dataSolicitacao}
                onChange={e => setDataSolicitacao(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Linha 2: Exame / Tipo de Amostra */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">EXAME *</label>
              <input
                type="text"
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                placeholder="Ex: Hemograma completo"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">TIPO DE AMOSTRA *</label>
              <input
                type="text"
                value={tipoAmostra}
                onChange={e => setTipoAmostra(e.target.value)}
                placeholder="Ex: Sangue total com EDTA"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Indicação Clínica */}
          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">INDICAÇÃO CLÍNICA</label>
            <input
              type="text"
              value={indicacaoClinica}
              onChange={e => setIndicacaoClinica(e.target.value)}
              placeholder="Ex: Suspeita de infecção, check-up pré-anestésico"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Observação / Preparo */}
          <div className="mb-5">
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">OBSERVAÇÃO / PREPARO</label>
            <textarea
              rows={2}
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              placeholder="Ex: Jejum de 8h. Trazer em caixa de transporte silenciosa."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSalvar}
              disabled={saving || !descricao.trim() || !laboratorio.trim() || !maskedToISO(dataHoraColeta) || !tipoAmostra.trim()}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              <FlaskConical size={15} />
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {/* ── Histórico ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico de Exames</p>
        <span className="text-xs text-gray-400">{total} registro{total !== 1 ? 's' : ''}</span>
      </div>

      {loadingHist ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-blue-600" />
        </div>
      ) : historico.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-300">
          <FlaskConical size={36} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhum exame registrado</p>
        </div>
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden divide-y divide-gray-50">
            {historico.map(ex => {
              const extra    = parseExtra(ex.observacao);
              const tipoMeta = TIPOS.find(t => t.key === ex.tipo);
              return (
                <div key={ex.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                    <FlaskConical size={14} className="text-blue-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tipoMeta?.badge ?? ''}`}>
                        {ex.tipo}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 truncate">{ex.descricao}</p>
                    {extra.laboratorio && (
                      <p className="text-xs text-gray-400">{extra.laboratorio}</p>
                    )}
                    <p className="text-xs text-gray-400">{formatDate(ex.dataSolicitacao)}</p>
                    {ex.veterinario && (
                      <p className="text-[11px] text-gray-400">Por: {ex.veterinario.fullName}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setViewingEx(ex)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                      <Eye size={14} />
                    </button>
                    {podeDeletar && (
                      <button onClick={() => handleExcluir(ex.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                        <Trash2 size={14} />
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Exame</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Laboratório</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Amostra</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Indicação Clínica</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Data</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Solicitante</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {historico.map(ex => {
                  const extra    = parseExtra(ex.observacao);
                  const tipoMeta = TIPOS.find(t => t.key === ex.tipo);
                  return (
                    <tr key={ex.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${tipoMeta?.badge ?? 'bg-gray-100 text-gray-600'}`}>
                          {tipoMeta && <tipoMeta.icon size={10} />}
                          {ex.tipo}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{ex.descricao}</p>
                        <p className="text-[10px] text-gray-400 uppercase">{ex.status}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {extra.laboratorio ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {extra.tipoAmostra ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-[200px]">
                        <span className="line-clamp-2">
                          {extra.indicacaoClinica ?? <span className="text-gray-300">—</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
                        {formatDate(ex.dataSolicitacao)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {ex.veterinario?.fullName ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setViewingEx(ex)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                            <Eye size={14} />
                          </button>
                          {podeDeletar && (
                            <button onClick={() => handleExcluir(ex.id)}
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
              <span className="text-xs text-gray-400">{total} registro{total !== 1 ? 's' : ''}</span>
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
    </>
  );
}

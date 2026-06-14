// frontend/src/pages/SubModuloVacina.tsx — registro clínico de vacinas

import { useState, useEffect, useCallback } from 'react';
import { Syringe, Trash2, Eye, Loader2, X, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useEmpresa } from '../contexts/EmpresaContext';
import { usePermissoes } from '../hooks/usePermissoes';
import type { AnimalInfo } from './SubModuloEvolucao';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VacinaCatalogo {
  id:         number;
  nome:       string;
  fabricante: string | null;
  via:        string;
}

interface LoteDisponivel {
  id:            number;
  lote:          string;
  validade:      string;
  qtdDisponivel: number;
}

interface VacinaClinica {
  id:            number;
  nome:          string;
  fabricante:    string | null;
  lote:          string | null;
  dose:          string | null;
  via:           string | null;
  dataAplicacao: string;
  dataReforco:   string | null;
  observacao:    string | null;
  veterinario:   { id: number; fullName: string } | null;
  vacina:        { id: number; nome: string; via: string } | null;
  loteVacina:    { id: number; lote: string; validade: string } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DOSES = [
  '1ª Dose (Filhote)',
  '2ª Dose',
  '3ª Dose',
  'Reforço Anual',
  'Dose Única',
  'Revacinação',
];

const VIAS = [
  'Subcutânea (SC)',
  'Intramuscular (IM)',
  'Intranasal (IN)',
  'Intravenosa (IV)',
  'Oral',
];

const hoje = () => new Date().toISOString().slice(0, 10);
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

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
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Syringe size={16} className="text-teal-600" />
            <h3 className="font-bold text-gray-900">Detalhes da Vacina</h3>
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <Row label="Vacina"         value={v.nome} />
          {v.dose       && <Row label="Dose"         value={v.dose} />}
          {v.via        && <Row label="Via"           value={v.via} />}
          {v.fabricante && <Row label="Fabricante"    value={v.fabricante} />}
          {v.lote       && <Row label="Lote"          value={v.lote} />}
          {v.loteVacina && <Row label="Val. Lote"     value={formatDate(v.loteVacina.validade)} />}
          <Row label="Data Aplicação" value={formatDate(v.dataAplicacao)} />
          {v.dataReforco && <Row label="Reforço"      value={formatDate(v.dataReforco)} />}
          {v.veterinario && <Row label="Executor"     value={v.veterinario.fullName} />}
          {v.observacao  && <Row label="Obs."         value={v.observacao} />}
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

// ─── SubModuloVacina ──────────────────────────────────────────────────────────

interface Props {
  animalId: number;
  animal:   AnimalInfo | null;
}

export default function SubModuloVacina({ animalId, animal: _animal }: Props) {
  const { contextoAtivo } = useEmpresa();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();

  const empresaId = contextoAtivo?.empresaId ?? null;

  // ── Form state ─────────────────────────────────────────────────────────────
  const [vacinaId,      setVacinaId]      = useState<number | ''>('');
  const [loteId,        setLoteId]        = useState<number | ''>('');
  const [dose,          setDose]          = useState('');
  const [dataAplicacao, setDataAplicacao] = useState(hoje());
  const [via,           setVia]           = useState('');
  const [observacao,    setObservacao]    = useState('');
  const [fabricanteAuto, setFabricanteAuto] = useState('');
  const [validadeAuto,   setValidadeAuto]   = useState('');

  // ── Data state ─────────────────────────────────────────────────────────────
  const [catalogo,    setCatalogo]    = useState<VacinaCatalogo[]>([]);
  const [lotes,       setLotes]       = useState<LoteDisponivel[]>([]);
  const [historico,   setHistorico]   = useState<VacinaClinica[]>([]);
  const [loadingCat,  setLoadingCat]  = useState(true);
  const [loadingHist, setLoadingHist] = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [viewingV,    setViewingV]    = useState<VacinaClinica | null>(null);

  const [page, setPage] = useState(1);
  const limit           = 8;
  const totalPags       = Math.ceil(historico.length / limit);
  const historicoPage   = historico.slice((page - 1) * limit, page * limit);

  const podeCriar   = isGestor || podeExecutar('atendimento.vacinas.criar');
  const podeDeletar = isGestor || podeExecutar('atendimento.vacinas.deletar');

  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável.`);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const carregarCatalogo = useCallback(async () => {
    setLoadingCat(true);
    try {
      const res = await api.get('/clinica/vacinas/catalogo');
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

  const carregarLotes = useCallback(async (vId: number) => {
    try {
      const params = new URLSearchParams();
      if (empresaId) params.set('empresaId', String(empresaId));
      const res = await api.get(`/clinica/vacinas/lotes-disponiveis/${vId}?${params}`);
      if (!res.data) return;
      setLotes(res.data?.dados ?? []);
    } catch { setLotes([]); }
  }, [empresaId]);

  useEffect(() => {
    if (loadingPerms) return;
    carregarCatalogo();
    carregarHistorico();
  }, [carregarCatalogo, carregarHistorico, loadingPerms]);

  useEffect(() => {
    if (!vacinaId) {
      setFabricanteAuto('');
      setVia('');
      setLotes([]);
      setLoteId('');
      setValidadeAuto('');
      return;
    }
    const v = catalogo.find(c => c.id === vacinaId);
    if (v) { setFabricanteAuto(v.fabricante ?? ''); setVia(v.via); }
    setLoteId('');
    setValidadeAuto('');
    carregarLotes(Number(vacinaId));
  }, [vacinaId, catalogo, carregarLotes]);

  useEffect(() => {
    if (!loteId) { setValidadeAuto(''); return; }
    const l = lotes.find(l => l.id === loteId);
    if (l) setValidadeAuto(formatDate(l.validade));
  }, [loteId, lotes]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSalvar = async () => {
    if (!podeCriar)  { semPermissao('registrar vacinas'); return; }
    if (!vacinaId)   { toast.error('Selecione a vacina'); return; }
    if (!loteId)     { toast.error('Selecione o lote'); return; }

    setSaving(true);
    try {
      await api.post('/clinica/vacinas', {
        animalId, vacinaId, loteId,
        dose: dose || null,
        via: via || null,
        dataAplicacao,
        observacao: observacao.trim() || null,
      });
      toast.success('Vacina registrada com sucesso');
      setVacinaId(''); setLoteId(''); setDose('');
      setDataAplicacao(hoje()); setObservacao('');
      setFabricanteAuto(''); setValidadeAuto(''); setLotes([]);
      setPage(1);
      carregarHistorico();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao registrar vacina');
    } finally { setSaving(false); }
  };

  const handleExcluir = async (id: number) => {
    if (!podeDeletar) { semPermissao('excluir registros de vacina'); return; }
    if (!confirm('Remover este registro de vacina?')) return;
    try {
      await api.delete(`/clinica/vacinas/${id}`);
      toast.success('Registro removido');
      carregarHistorico();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao remover');
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

  const loteAtual = lotes.find(l => l.id === loteId);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Formulário de registro ─────────────────────────────────────────── */}
      {podeCriar && (
        <div className="p-5 border-b border-gray-100">

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
            REGISTRAR APLICAÇÃO DA VACINA
          </p>

          {/* Linha 1: Vacina / Dose / Data / Lote */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">

            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">ESCOLHA A VACINA *</label>
              {loadingCat ? (
                <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl text-xs text-gray-400">
                  <Loader2 size={13} className="animate-spin" /> Carregando…
                </div>
              ) : catalogo.length === 0 ? (
                <div className="px-3 py-2.5 border border-amber-200 rounded-xl text-sm text-amber-600 bg-amber-50 text-xs">
                  Nenhuma vacina no catálogo
                </div>
              ) : (
                <select value={vacinaId} onChange={e => setVacinaId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-teal-500 bg-white">
                  <option value="">Selecione…</option>
                  {catalogo.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">DOSE / REFORÇO</label>
              <select value={dose} onChange={e => setDose(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-teal-500 bg-white">
                <option value="">Selecione…</option>
                {DOSES.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">DATA APLICAÇÃO</label>
              <input type="date" value={dataAplicacao} onChange={e => setDataAplicacao(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-teal-500" />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">LOTE DE VACINA DISPONÍVEL *</label>
              {!vacinaId ? (
                <div className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-300 text-xs">
                  Selecione a vacina primeiro
                </div>
              ) : lotes.length === 0 ? (
                <div className="px-3 py-2.5 border border-amber-200 rounded-xl text-sm text-amber-600 bg-amber-50 text-xs">
                  Nenhum lote com saldo disponível
                </div>
              ) : (
                <select value={loteId} onChange={e => setLoteId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-teal-500 bg-white">
                  <option value="">Selecione…</option>
                  {lotes.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.lote} (Saldo: {l.qtdDisponivel} ds)
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Linha 2: Fabricante / Validade / Via */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">

            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">FABRICANTE DA VACINA</label>
              <input value={fabricanteAuto} readOnly placeholder="Preenchido automaticamente"
                className="w-full border border-gray-100 rounded-xl px-3 py-2.5 text-sm text-gray-500 bg-gray-50 cursor-default" />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">DT. VALIDADE LOTE</label>
              <input value={validadeAuto} readOnly placeholder="Preenchido automaticamente"
                className="w-full border border-gray-100 rounded-xl px-3 py-2.5 text-sm text-gray-500 bg-gray-50 cursor-default" />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">VIA DE APLICAÇÃO</label>
              <select value={via} onChange={e => setVia(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-teal-500 bg-white">
                <option value="">Selecione…</option>
                {VIAS.map(v => <option key={v}>{v}</option>)}
              </select>
            </div>
          </div>

          {loteAtual && (
            <p className="text-xs text-gray-400 italic mb-4">
              Ao clicar em salvar, o lote sofrerá baixa de 1 dose do estoque.
            </p>
          )}

          <div className="flex justify-end">
            <button onClick={handleSalvar} disabled={saving || !vacinaId || !loteId}
              className="flex items-center gap-2 px-6 py-2.5 bg-teal-700 hover:bg-teal-800 disabled:bg-gray-300 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
              {saving && <Loader2 size={14} className="animate-spin" />}
              <Syringe size={15} />
              {saving ? 'Salvando…' : 'Salvar Aplicação de Vacina'}
            </button>
          </div>
        </div>
      )}

      {/* ── Histórico ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico de Vacinação</p>
        <span className="text-xs text-gray-400">{historico.length} registro{historico.length !== 1 ? 's' : ''}</span>
      </div>

      {loadingHist ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-teal-600" />
        </div>
      ) : historico.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-300">
          <Syringe size={36} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhuma vacina registrada</p>
        </div>
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden divide-y divide-gray-50">
            {historicoPage.map(v => (
              <div key={v.id} className="flex items-start gap-3 px-4 py-3">
                <div className="w-8 h-8 bg-teal-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Syringe size={14} className="text-teal-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{v.nome}</p>
                  <p className="text-xs text-gray-400">
                    {v.dose && <span>{v.dose} · </span>}
                    {formatDate(v.dataAplicacao)}
                  </p>
                  {v.lote && <p className="text-xs text-gray-400">Lote: {v.lote}</p>}
                  {v.veterinario && <p className="text-[11px] text-gray-400">Por: {v.veterinario.fullName}</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setViewingV(v)}
                    className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg"><Eye size={14} /></button>
                  {podeDeletar && (
                    <button onClick={() => handleExcluir(v.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Vacina</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Dose</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Lote</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Via</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Aplicação</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Reforço</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Executor</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {historicoPage.map(v => (
                  <tr key={v.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{v.nome}</p>
                      {v.fabricante && <p className="text-xs text-gray-400">{v.fabricante}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{v.dose ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {v.lote ?? <span className="text-gray-300">—</span>}
                      {v.loteVacina && (
                        <p className="text-[10px] text-gray-400">Val: {formatDate(v.loteVacina.validade)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{v.via ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">{formatDate(v.dataAplicacao)}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {v.dataReforco ? formatDate(v.dataReforco) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {v.veterinario?.fullName ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setViewingV(v)}
                          className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors">
                          <Eye size={14} />
                        </button>
                        {podeDeletar && (
                          <button onClick={() => handleExcluir(v.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPags > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
              <span className="text-xs text-gray-400">{historico.length} registro{historico.length !== 1 ? 's' : ''}</span>
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
    </>
  );
}

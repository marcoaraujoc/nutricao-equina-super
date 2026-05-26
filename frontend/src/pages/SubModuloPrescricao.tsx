// frontend/src/pages/SubModuloPrescricao.tsx

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Pencil, Trash2, Check, CheckCircle2, X, Loader2,
  ChevronLeft, ChevronRight, Pill, Activity,
  Clock, Calendar, Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TipoPrescricao    = 'MEDICAMENTO' | 'PROCEDIMENTO';
export type StatusPrescricao  = 'RASCUNHO' | 'ATIVA' | 'CANCELADA';

export interface PrescricaoItem {
  id:                  number;
  animalId:            number;
  veterinarioId:       number;
  veterinario:         { id: number; fullName: string };
  tipo:                TipoPrescricao;
  medicamento:         string;
  dosagem:             string | null;
  unidade:             string | null;
  via:                 string;
  frequencia:          string;
  duracaoDias:         number;
  diasAplicacaoInicio: number;
  diasAplicacaoFim:    number | null;
  horaInicio:          string | null;
  observacao:          string | null;
  status:              StatusPrescricao;
  horariosGerados:     string[] | null;
  dataInicio:          string;
  dataFim:             string | null;
  ativo:               boolean;
}

export interface FormPrescricao {
  tipo:                TipoPrescricao;
  medicamento:         string;
  dosagem:             string;
  unidade:             string;
  via:                 string;
  frequencia:          string;
  horaInicio:          string;
  duracaoDias:         number;
  diasAplicacaoInicio: number;
  diasAplicacaoFim:    number | null;
  observacao:          string;
  dataInicio:          string;
}

interface Props {
  animalId:            number;
  onFaturaAtualizada:  () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POSOLOGIAS = [
  { value: '1xDia',        label: 'Uma vez ao dia'    },
  { value: '12em12h',      label: '12 em 12H'         },
  { value: '8em8h',        label: '8 em 8H'           },
  { value: '6em6h',        label: '6 em 6H'           },
  { value: '4em4h',        label: '4 em 4H'           },
  { value: '1em1h',        label: '1 em 1H'           },
  { value: 'continuo',     label: 'Contínuo'           },
  { value: 'agora',        label: 'Agora (dose única)' },
  { value: 'seNecessario', label: 'Se necessário'      },
  { value: 'SOS',          label: 'SOS'                },
  { value: '1x2dias',      label: '1x a cada 2 dias'  },
  { value: '1x3dias',      label: '1x a cada 3 dias'  },
  { value: '1xSemana',     label: '1x por semana'      },
  { value: '1x21dias',     label: '1x a cada 21 dias' },
  { value: '1x30dias',     label: '1x a cada 30 dias' },
  { value: '1x90dias',     label: '1x a cada 90 dias' },
] as const;

const VIAS     = ['Oral', 'Endovenosa', 'Intramuscular', 'Subcutânea', 'Tópica', 'Retal', 'Nasal', 'Oftálmica'];
const UNIDADES = ['mg', 'g', 'mcg', 'mL', 'UI', 'comprimido', 'cápsula', 'gota'];
const LIMIT_OPTIONS = [10, 20, 50];

const STATUS_PRESC: Record<StatusPrescricao, { label: string; cls: string }> = {
  RASCUNHO:  { label: 'Rascunho', cls: 'bg-amber-100 text-amber-700'     },
  ATIVA:     { label: 'Ativa',    cls: 'bg-emerald-100 text-emerald-700' },
  CANCELADA: { label: 'Cancelada',cls: 'bg-red-100 text-red-700'         },
};

const hoje = () => new Date().toISOString().split('T')[0];

const FORM_INICIAL: FormPrescricao = {
  tipo:                'MEDICAMENTO',
  medicamento:         '',
  dosagem:             '',
  unidade:             'mg',
  via:                 'Oral',
  frequencia:          '12em12h',
  horaInicio:          '08:00',
  duracaoDias:         3,
  diasAplicacaoInicio: 1,
  diasAplicacaoFim:    null,
  observacao:          '',
  dataInicio:          hoje(),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatarData = (d: string | null | undefined) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const labelPosologia = (v: string) =>
  POSOLOGIAS.find(p => p.value === v)?.label ?? v;

// ─── NovaPrescricaoModal ──────────────────────────────────────────────────────

function NovaPrescricaoModal({
  editingItem, saving, onSalvar, onFechar,
}: {
  editingItem: PrescricaoItem | null;
  saving:      boolean;
  onSalvar:    (form: FormPrescricao) => Promise<void>;
  onFechar:    () => void;
}) {
  const [form, setForm] = useState<FormPrescricao>(
    editingItem
      ? {
          tipo:                editingItem.tipo,
          medicamento:         editingItem.medicamento,
          dosagem:             editingItem.dosagem ?? '',
          unidade:             editingItem.unidade ?? 'mg',
          via:                 editingItem.via,
          frequencia:          editingItem.frequencia,
          horaInicio:          editingItem.horaInicio ?? '08:00',
          duracaoDias:         editingItem.duracaoDias,
          diasAplicacaoInicio: editingItem.diasAplicacaoInicio,
          diasAplicacaoFim:    editingItem.diasAplicacaoFim,
          observacao:          editingItem.observacao ?? '',
          dataInicio:          editingItem.dataInicio?.split('T')[0] ?? hoje(),
        }
      : FORM_INICIAL,
  );

  const set = <K extends keyof FormPrescricao>(k: K, v: FormPrescricao[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const dataFimCalc = useMemo(() => {
    if (!form.dataInicio || !form.duracaoDias) return '';
    const d = new Date(form.dataInicio);
    d.setDate(d.getDate() + Number(form.duracaoDias));
    return d.toISOString().split('T')[0];
  }, [form.dataInicio, form.duracaoDias]);

  const handleSalvar = async () => {
    if (!form.medicamento.trim()) {
      toast.error(`${form.tipo === 'MEDICAMENTO' ? 'Medicamento' : 'Procedimento'} é obrigatório`);
      return;
    }
    if (!form.frequencia) {
      toast.error('Frequência é obrigatória');
      return;
    }
    await onSalvar(form);
  };

  const isMed = form.tipo === 'MEDICAMENTO';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col border border-gray-100">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-widest">
              {editingItem ? 'Editar' : 'INSERIR'}
            </span>
            <h3 className="font-bold text-gray-900">Nova Prescrição</h3>
            <p className="text-xs text-gray-400">Configure abaixo os parâmetros posológicos e cronograma do item.</p>
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Tabs tipo */}
        <div className="flex gap-2 px-5 pt-4 flex-shrink-0">
          {(['MEDICAMENTO', 'PROCEDIMENTO'] as TipoPrescricao[]).map(t => (
            <button key={t} onClick={() => set('tipo', t)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
                form.tipo === t
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              {t === 'MEDICAMENTO' ? <Pill size={13} /> : <Activity size={13} />}
              {t === 'MEDICAMENTO' ? 'Medicamento' : 'Procedimento'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2 space-y-4">

          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
            <span className="text-emerald-500">↳</span>
            {isMed ? 'CONFIGURAR MEDICAMENTO' : 'CONFIGURAR PROCEDIMENTO CLÍNICO'}
          </p>

          {/* Campo principal */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              {isMed ? 'MEDICAMENTO' : 'PROCEDIMENTO'} *
            </label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={form.medicamento}
                onChange={e => set('medicamento', e.target.value)}
                placeholder={isMed
                  ? 'Busque pelo medicamento... Ex: Dipiro... (ou digite um personalizado)'
                  : 'Busque o procedimento... Ex: Limpeza de ouvido... (ou digite um personalizado)'}
                className="w-full pl-9 pr-3 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Dosagem + Unidade (combinados) / Via — só para medicamento */}
          {isMed && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">DOSAGEM *</label>
                <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-emerald-500 transition-colors">
                  <input
                    type="number" min="0" step="0.001"
                    value={form.dosagem}
                    onChange={e => set('dosagem', e.target.value)}
                    placeholder="Ex: 1.5"
                    className="flex-1 min-w-0 px-3 py-2.5 text-sm text-gray-900 focus:outline-none bg-transparent"
                  />
                  <div className="w-px h-5 bg-gray-200 flex-shrink-0" />
                  <select
                    value={form.unidade}
                    onChange={e => set('unidade', e.target.value)}
                    className="px-2 py-2.5 text-sm text-gray-700 focus:outline-none bg-transparent cursor-pointer">
                    {UNIDADES.map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">VIA DE ADMINISTRAÇÃO *</label>
                <select value={form.via} onChange={e => set('via', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500">
                  {VIAS.map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Frequência / Hora de início */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                {isMed ? 'POSOLOGIA / FREQUÊNCIA *' : 'FREQUÊNCIA *'}
              </label>
              <select value={form.frequencia} onChange={e => set('frequencia', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500">
                {POSOLOGIAS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                <Clock size={10} /> HORA DE INÍCIO *
              </label>
              <input
                type="time"
                value={form.horaInicio}
                onChange={e => set('horaInicio', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Duração / Início / Fim */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">DURAÇÃO (DIAS) *</label>
              <input
                type="number" min="1"
                value={form.duracaoDias}
                onChange={e => set('duracaoDias', Number(e.target.value))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                <Calendar size={10} /> (INÍCIO) *
              </label>
              <input
                type="date"
                value={form.dataInicio}
                onChange={e => set('dataInicio', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                <Calendar size={10} /> (FIM)
              </label>
              <input
                type="date"
                value={dataFimCalc}
                readOnly
                className="w-full border border-gray-100 rounded-xl px-3 py-2.5 text-sm text-gray-400 bg-gray-50 cursor-not-allowed"
              />
            </div>
          </div>

          {/* Observação */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">OBSERVAÇÃO</label>
              {form.observacao && (
                <button onClick={() => set('observacao', '')}
                  className="text-xs text-gray-400 hover:text-gray-600">Limpar</button>
              )}
            </div>
            <textarea
              value={form.observacao}
              onChange={e => set('observacao', e.target.value)}
              placeholder={isMed
                ? 'Diluir em água, suspender em caso de êmese, administrar junto com alimentação úmida…'
                : 'Detalhes do procedimento ou instruções especiais…'}
              rows={3}
              maxLength={1000}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onFechar} disabled={saving}
            className="px-6 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSalvar} disabled={saving}
            className="px-8 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2">
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ConfirmExclusao ──────────────────────────────────────────────────────────

function ConfirmExclusao({ onConfirmar, onCancelar }: {
  onConfirmar: () => void;
  onCancelar:  () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-gray-100">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <Trash2 size={18} className="text-red-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Remover prescrição</h3>
            <p className="text-xs text-gray-500">Esta ação não pode ser desfeita.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancelar}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={onConfirmar}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold">
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SubModuloPrescricao ──────────────────────────────────────────────────────

export default function SubModuloPrescricao({ animalId, onFaturaAtualizada }: Props) {
  const [prescricoes,    setPrescricoes]    = useState<PrescricaoItem[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [total,          setTotal]          = useState(0);
  const [page,           setPage]           = useState(1);
  const [limit,          setLimit]          = useState(10);
  const [busca,          setBusca]          = useState('');
  const [rascunhosCount, setRascunhosCount] = useState(0);
  const [finalizando,    setFinalizando]    = useState(false);
  const [finalizandoId,  setFinalizandoId]  = useState<number | null>(null);
  const [showModal,      setShowModal]      = useState(false);
  const [editingItem,    setEditingItem]    = useState<PrescricaoItem | null>(null);
  const [tipoFiltro,     setTipoFiltro]     = useState<'TODOS' | TipoPrescricao>('TODOS');
  const [deletingId,     setDeletingId]     = useState<number | null>(null);
  const [savingModal,    setSavingModal]    = useState(false);

  const totalPaginas = Math.ceil(total / limit);
  const lista = tipoFiltro === 'TODOS'
    ? prescricoes
    : prescricoes.filter(p => p.tipo === tipoFiltro);

  // ── Loader ──────────────────────────────────────────────────────────────────

  const carregarPrescricoes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (busca.trim()) params.set('busca', busca.trim());
      const res = await api.get(`/clinica/prescricoes/animal/${animalId}?${params}`);
      setPrescricoes(res.data.dados ?? []);
      setTotal(res.data.total ?? 0);
      setRascunhosCount(res.data.rascunhos ?? 0);
    } catch { toast.error('Erro ao carregar prescrições'); }
    finally { setLoading(false); }
  }, [animalId, page, limit, busca]);

  useEffect(() => { carregarPrescricoes(); }, [carregarPrescricoes]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const abrirNova = () => {
    setEditingItem(null);
    setShowModal(true);
  };

  const fecharModal = () => {
    setShowModal(false);
    setEditingItem(null);
  };

  const handleSalvarModal = async (form: FormPrescricao) => {
    setSavingModal(true);
    try {
      if (editingItem) {
        await api.put(`/clinica/prescricoes/${editingItem.id}`, { ...form, animalId });
        toast.success('Prescrição atualizada');
      } else {
        await api.post('/clinica/prescricoes', { ...form, animalId });
        toast.success('Prescrição adicionada ao rascunho');
      }
      fecharModal();
      carregarPrescricoes();
    } finally { setSavingModal(false); }
  };

  const handleExcluir = () => {
    if (deletingId !== null) {
      api.delete(`/clinica/prescricoes/${deletingId}`)
        .then(() => { toast.success('Prescrição removida'); carregarPrescricoes(); })
        .catch(() => toast.error('Erro ao remover prescrição'));
      setDeletingId(null);
    }
  };

  const handleFinalizar = async () => {
    setFinalizando(true);
    try {
      const res = await api.post(`/clinica/prescricoes/finalizar/${animalId}`);
      toast.success(`${res.data.dados.finalizado} prescrição(ões) finalizada(s)`);
      carregarPrescricoes();
      onFaturaAtualizada();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao finalizar prescrições');
    } finally { setFinalizando(false); }
  };

  const handleFinalizarUma = async (id: number) => {
    setFinalizandoId(id);
    try {
      await api.post(`/clinica/prescricoes/finalizar-uma/${id}`);
      toast.success('Prescrição finalizada');
      carregarPrescricoes();
      onFaturaAtualizada();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao finalizar prescrição');
    } finally { setFinalizandoId(null); }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const actionBar = (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
      <button
        onClick={abrirNova}
        className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors flex-shrink-0">
        <Plus size={15} /> Nova Prescrição
      </button>
      <select value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}
        className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:border-emerald-500 flex-shrink-0">
        {LIMIT_OPTIONS.map(l => <option key={l} value={l}>{l} por página</option>)}
      </select>
      <div className="relative flex-1 max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar nas prescrições..."
          value={busca}
          onChange={e => { setBusca(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white transition-colors" />
      </div>
      {busca && (
        <button onClick={() => { setBusca(''); setPage(1); }}
          className="px-3 py-2 text-xs text-gray-500 hover:text-red-500 border border-gray-200 rounded-xl bg-white transition-colors flex-shrink-0">
          Limpar ×
        </button>
      )}
    </div>
  );

  const typeFilterRow = (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 flex-shrink-0">
      <div className="flex gap-1">
        {(['TODOS', 'MEDICAMENTO', 'PROCEDIMENTO'] as const).map(t => (
          <button key={t} onClick={() => setTipoFiltro(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-colors ${
              tipoFiltro === t
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:bg-gray-100'
            }`}>
            {t === 'TODOS' ? 'Todos' : t === 'MEDICAMENTO' ? 'Medicamento' : 'Procedimento'}
          </button>
        ))}
      </div>
      <button
        onClick={handleFinalizar}
        disabled={finalizando || rascunhosCount === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold transition-colors">
        {finalizando
          ? <Loader2 size={11} className="animate-spin" />
          : <Check size={11} />}
        Finalizar Todos ({rascunhosCount})
      </button>
    </div>
  );

  if (loading) {
    return (
      <>
        {actionBar}
        {typeFilterRow}
        <div className="flex items-center justify-center py-20">
          <Loader2 size={22} className="animate-spin text-emerald-600" />
        </div>
      </>
    );
  }

  if (lista.length === 0) {
    return (
      <>
        {actionBar}
        {typeFilterRow}
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <Pill size={38} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhuma prescrição encontrada</p>
          <p className="text-xs text-gray-300 mt-1">Use "+ Nova Prescrição" para adicionar</p>
        </div>
        {showModal && (
          <NovaPrescricaoModal
            editingItem={editingItem}
            saving={savingModal}
            onSalvar={handleSalvarModal}
            onFechar={fecharModal}
          />
        )}
        {deletingId !== null && (
          <ConfirmExclusao onConfirmar={handleExcluir} onCancelar={() => setDeletingId(null)} />
        )}
      </>
    );
  }

  return (
    <>
      {actionBar}
      {typeFilterRow}

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                <span className="flex items-center justify-center gap-1"><Calendar size={11} /> Data Início</span>
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Medicamento / Procedimento</th>
              {tipoFiltro !== 'PROCEDIMENTO' && (
                <>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Via</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Dosagem</th>
                </>
              )}
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Frequência</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                <span className="flex items-center justify-center gap-1"><Clock size={11} /> Horário</span>
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Veterinário</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Observação</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {lista.map(p => {
              const isMed     = p.tipo === 'MEDICAMENTO';
              const editavel  = p.status === 'RASCUNHO';
              return (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">

                  {/* Data início */}
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <p className="text-xs text-gray-700">{formatarData(p.dataInicio)}</p>
                    <p className="text-[10px] text-gray-400">{p.duracaoDias} dias</p>
                  </td>

                  {/* Medicamento / Procedimento */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                        isMed ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {isMed ? <Pill size={9} /> : <Activity size={9} />}
                        {isMed ? 'Med' : 'Proc'}
                      </span>
                      <div className="min-w-0 text-center">
                        <p className="text-xs font-medium text-gray-800 truncate max-w-[160px]">{p.medicamento}</p>
                        <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium ${STATUS_PRESC[p.status].cls}`}>
                          {STATUS_PRESC[p.status].label}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Via + Dosagem — ocultas no filtro Procedimento */}
                  {tipoFiltro !== 'PROCEDIMENTO' && (
                    <>
                      <td className="px-4 py-3 text-center">
                        <p className="text-xs text-gray-700">{isMed && p.via ? p.via : <span className="text-gray-300">—</span>}</p>
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <p className="text-xs text-gray-700">
                          {isMed && p.dosagem
                            ? `${p.dosagem}${p.unidade ? ' ' + p.unidade : ''}`
                            : <span className="text-gray-300">—</span>}
                        </p>
                      </td>
                    </>
                  )}

                  {/* Frequência */}
                  <td className="px-4 py-3 text-center">
                    <p className="text-xs text-gray-700 whitespace-nowrap">{labelPosologia(p.frequencia)}</p>
                  </td>

                  {/* Horário */}
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <p className="text-xs text-gray-700">{p.horaInicio ?? <span className="text-gray-300">—</span>}</p>
                  </td>

                  {/* Veterinário */}
                  <td className="px-4 py-3 text-center">
                    <p className="text-xs font-medium text-gray-800 whitespace-nowrap">{p.veterinario.fullName}</p>
                  </td>

                  {/* Observação */}
                  <td className="px-4 py-3 text-center">
                    <p className="text-xs text-gray-500 max-w-[140px] truncate mx-auto">
                      {p.observacao || <span className="text-gray-300">—</span>}
                    </p>
                  </td>

                  {/* Ações */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={editavel ? () => { setEditingItem(p); setShowModal(true); } : undefined}
                        disabled={!editavel}
                        title="Editar"
                        className={`p-1.5 rounded-lg transition-colors ${editavel ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50' : 'text-gray-300 cursor-not-allowed'}`}>
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={editavel ? () => handleFinalizarUma(p.id) : undefined}
                        disabled={!editavel || finalizandoId === p.id}
                        title="Finalizar esta prescrição"
                        className={`p-1.5 rounded-lg transition-colors ${editavel ? 'text-amber-500 hover:text-amber-700 hover:bg-amber-50' : 'text-gray-300 cursor-not-allowed'} disabled:opacity-40`}>
                        {finalizandoId === p.id
                          ? <Loader2 size={13} className="animate-spin" />
                          : <CheckCircle2 size={13} />}
                      </button>
                      <button
                        onClick={editavel ? () => setDeletingId(p.id) : undefined}
                        disabled={!editavel}
                        title="Remover"
                        className={`p-1.5 rounded-lg transition-colors ${editavel ? 'text-red-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-300 cursor-not-allowed'}`}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-gray-50">
        {lista.map(p => {
          const isMed = p.tipo === 'MEDICAMENTO';
          return (
            <div key={p.id} className="px-4 py-3">
              <div className="flex items-start gap-2 mb-1">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 mt-0.5 ${
                  isMed ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {isMed ? <Pill size={9} /> : <Activity size={9} />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{p.medicamento}</p>
                  {isMed && (p.dosagem || p.via) && (
                    <p className="text-xs text-gray-500">
                      {[p.dosagem, p.unidade, p.via ? `• ${p.via}` : null].filter(Boolean).join(' ')}
                    </p>
                  )}
                </div>
                <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${STATUS_PRESC[p.status].cls}`}>
                  {STATUS_PRESC[p.status].label}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-gray-400 mt-1">
                <span>{labelPosologia(p.frequencia)}{p.horaInicio ? ` • ${p.horaInicio}` : ''}</span>
                <span>{formatarData(p.dataInicio)} • {p.duracaoDias}d</span>
              </div>
              {p.observacao && <p className="text-xs text-gray-500 mt-1 truncate">{p.observacao}</p>}
              {(() => { const ed = p.status === 'RASCUNHO'; return (
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={ed ? () => { setEditingItem(p); setShowModal(true); } : undefined}
                  disabled={!ed}
                  className={`flex items-center gap-1 px-2.5 py-1 border rounded-lg text-xs transition-colors ${ed ? 'border-gray-200 text-emerald-600 hover:bg-emerald-50' : 'border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                  <Pencil size={11} /> Editar
                </button>
                <button
                  onClick={ed ? () => handleFinalizarUma(p.id) : undefined}
                  disabled={!ed || finalizandoId === p.id}
                  className={`flex items-center gap-1 px-2.5 py-1 border rounded-lg text-xs transition-colors disabled:opacity-40 ${ed ? 'border-amber-200 text-amber-600 hover:bg-amber-50' : 'border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                  {finalizandoId === p.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                  Finalizar
                </button>
                <button
                  onClick={ed ? () => setDeletingId(p.id) : undefined}
                  disabled={!ed}
                  className={`flex items-center gap-1 px-2.5 py-1 border rounded-lg text-xs transition-colors ${ed ? 'border-gray-200 text-red-500 hover:bg-red-50' : 'border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                  <Trash2 size={11} /> Remover
                </button>
              </div>
              ); })()}
            </div>
          );
        })}
      </div>

      {/* Paginação */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
          <span className="text-xs text-gray-400">{total} prescrição{total !== 1 ? 'ões' : ''}</span>
          <div className="flex items-center gap-3">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-gray-500">{page} / {totalPaginas}</span>
            <button disabled={page >= totalPaginas} onClick={() => setPage(p => p + 1)}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Modais */}
      {showModal && (
        <NovaPrescricaoModal
          editingItem={editingItem}
          saving={savingModal}
          onSalvar={handleSalvarModal}
          onFechar={fecharModal}
        />
      )}
      {deletingId !== null && (
        <ConfirmExclusao onConfirmar={handleExcluir} onCancelar={() => setDeletingId(null)} />
      )}
    </>
  );
}
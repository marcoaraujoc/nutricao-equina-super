// frontend/src/pages/Procedimentos.tsx

import { useState, useEffect, useCallback } from 'react';
import {
  Pencil, Trash2, X, Loader2, Search,
  Activity, ChevronLeft, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import ModalJustificativa from '../components/ModalJustificativa';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Procedimento {
  id: number;
  codigo: string | null;
  nome: string;
  nomeAbreviado: string | null;
  descricao: string | null;
  categoria: string;
  subcategoria: string | null;
  especialidade: string | null;
  tipoProcedimento: string | null;
  duracao: number | null;
  requerAnestesia: boolean;
  requerInternacao: boolean;
  risco: string | null;
  valorCusto: number | null;
  valorVenda: number | null;
  ativo: boolean;
}

interface FormData {
  codigo: string;
  nome: string;
  nomeAbreviado: string;
  descricao: string;
  categoria: string;
  subcategoria: string;
  especialidade: string;
  tipoProcedimento: string;
  duracao: string;
  requerAnestesia: boolean;
  requerInternacao: boolean;
  risco: string;
  valorCusto: string;
  valorVenda: string;
  ativo: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIAS = [
  'Anestesiologia',
  'Cirurgia',
  'Clínica geral',
  'Diagnóstico por imagem',
  'Exames laboratoriais',
  'Fisioterapia',
  'Internação',
  'Odontologia',
  'Procedimento clínico',
  'Vacinação',
  'Outros',
];

const FORM_VAZIO: FormData = {
  codigo: '', nome: '', nomeAbreviado: '', descricao: '',
  categoria: '', subcategoria: '', especialidade: '', tipoProcedimento: '',
  duracao: '', requerAnestesia: false, requerInternacao: false,
  risco: '', valorCusto: '', valorVenda: '', ativo: true,
};

const formatValor = (v: number | null) =>
  v != null ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';

// ─── Modal ────────────────────────────────────────────────────────────────────

function ProcedimentoModal({
  item, onClose, onSaved,
}: {
  item: Procedimento | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  const [form, setForm] = useState<FormData>(
    item ? {
      codigo:          item.codigo ?? '',
      nome:            item.nome,
      nomeAbreviado:   item.nomeAbreviado ?? '',
      descricao:       item.descricao ?? '',
      categoria:       item.categoria,
      subcategoria:    item.subcategoria ?? '',
      especialidade:   item.especialidade ?? '',
      tipoProcedimento: item.tipoProcedimento ?? '',
      duracao:         item.duracao != null ? String(item.duracao) : '',
      requerAnestesia: item.requerAnestesia,
      requerInternacao: item.requerInternacao,
      risco:           item.risco ?? '',
      valorCusto:      item.valorCusto != null ? String(item.valorCusto) : '',
      valorVenda:      item.valorVenda != null ? String(item.valorVenda) : '',
      ativo:           item.ativo,
    } : { ...FORM_VAZIO }
  );
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormData>(k: K, v: FormData[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const handleSalvar = async () => {
    if (!form.nome.trim())     { toast.error('Nome é obrigatório'); return; }
    if (!form.categoria.trim()) { toast.error('Categoria é obrigatória'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        duracao:   form.duracao   ? Number(form.duracao)   : null,
        valorCusto: form.valorCusto ? Number(form.valorCusto) : null,
        valorVenda: form.valorVenda ? Number(form.valorVenda) : null,
      };
      if (isEdit) {
        await api.put(`/procedimentos/${item!.id}`, payload);
        toast.success('Procedimento atualizado');
      } else {
        await api.post('/procedimentos', payload);
        toast.success('Procedimento criado');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e?.response?.data?.error ?? 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[95vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-widest">
              {isEdit ? 'EDITAR' : 'NOVO'} PROCEDIMENTO
            </span>
            <h3 className="font-bold text-gray-900">{isEdit ? form.nome : 'Cadastrar procedimento'}</h3>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Identificação */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">CÓDIGO</label>
              <input type="text" value={form.codigo} onChange={e => set('codigo', e.target.value)}
                placeholder="Ex: PRO-001"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">NOME *</label>
              <input type="text" value={form.nome} onChange={e => set('nome', e.target.value)}
                placeholder="Nome do procedimento"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">NOME ABREVIADO</label>
              <input type="text" value={form.nomeAbreviado} onChange={e => set('nomeAbreviado', e.target.value)}
                placeholder="Ex: Raio-X"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">CATEGORIA *</label>
              <select value={form.categoria} onChange={e => set('categoria', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
                <option value="">— Selecionar —</option>
                {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">SUBCATEGORIA</label>
              <input type="text" value={form.subcategoria} onChange={e => set('subcategoria', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">ESPECIALIDADE</label>
              <input type="text" value={form.especialidade} onChange={e => set('especialidade', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">DESCRIÇÃO</label>
            <textarea value={form.descricao} onChange={e => set('descricao', e.target.value)}
              rows={2} maxLength={500}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none" />
          </div>

          {/* Dados clínicos */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">DURAÇÃO (min)</label>
              <input type="number" min="0" value={form.duracao} onChange={e => set('duracao', e.target.value)}
                placeholder="Ex: 30"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">RISCO</label>
              <input type="text" value={form.risco} onChange={e => set('risco', e.target.value)}
                placeholder="Ex: Baixo"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 cursor-pointer py-2">
                <input type="checkbox" checked={form.requerAnestesia}
                  onChange={e => set('requerAnestesia', e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 rounded" />
                <span className="text-sm text-gray-700">Req. Anestesia</span>
              </label>
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 cursor-pointer py-2">
                <input type="checkbox" checked={form.requerInternacao}
                  onChange={e => set('requerInternacao', e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 rounded" />
                <span className="text-sm text-gray-700">Req. Internação</span>
              </label>
            </div>
          </div>

          {/* Valores */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">VALOR CUSTO (R$)</label>
              <input type="number" min="0" step="0.01" value={form.valorCusto}
                onChange={e => set('valorCusto', e.target.value)}
                placeholder="0,00"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">VALOR VENDA (R$)</label>
              <input type="number" min="0" step="0.01" value={form.valorVenda}
                onChange={e => set('valorVenda', e.target.value)}
                placeholder="0,00"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.ativo} onChange={e => set('ativo', e.target.checked)}
                className="w-4 h-4 accent-emerald-600 rounded" />
              <span className="text-sm text-gray-700">Procedimento ativo</span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={handleSalvar} disabled={saving}
            className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5">
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            {isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Procedimentos() {
  const { podeExecutar, loading: loadingPerm } = usePermissoes();
  const { user } = useAuth();

  const [procedimentos, setProcedimentos] = useState<Procedimento[]>([]);
  const [total,         setTotal]         = useState(0);
  const [loading,       setLoading]       = useState(false);
  const [busca,         setBusca]         = useState('');
  const [categoria,     setCategoria]     = useState('');
  const [page,          setPage]          = useState(1);
  const [limit]                           = useState(20);
  const [showModal,     setShowModal]     = useState(false);
  const [inativandoId,  setInativandoId]  = useState<number | null>(null);
  const [editingItem,   setEditingItem]   = useState<Procedimento | null>(null);

  const totalPaginas = Math.ceil(total / limit);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ ativo: 'true' });
      if (busca)     params.set('busca', busca);
      if (categoria) params.set('categoria', categoria);
      const res = await api.get(`/procedimentos?${params}`);
      setProcedimentos(res.data.dados ?? []);
      setTotal(res.data.meta?.total ?? res.data.dados?.length ?? 0);
    } catch {
      toast.error('Erro ao carregar procedimentos');
    } finally {
      setLoading(false);
    }
  }, [busca, categoria]);

  useEffect(() => { carregar(); }, [carregar]);

  const abrirNovo   = () => { setEditingItem(null); setShowModal(true); };
  const abrirEdicao = (p: Procedimento) => { setEditingItem(p); setShowModal(true); };
  const fecharModal = () => { setShowModal(false); setEditingItem(null); };

  const handleInativar = async (id: number, motivo: string) => {
    try {
      await api.delete(`/procedimentos/${id}`, { data: { motivo } });
      toast.success('Procedimento inativado');
      carregar();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e?.response?.data?.error ?? 'Erro ao inativar');
    } finally {
      setInativandoId(null);
    }
  };

  if (loadingPerm) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  const isAdminRole = (user?.role ?? '').toUpperCase() === 'ADMIN';
  if (!isAdminRole) return null;

  return (
    <PageContainer maxWidth="7xl">

      <BotaoVoltar className="mb-6" />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <Activity size={20} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Procedimentos Veterinários</h1>
            <p className="text-sm text-gray-500">Catálogo de procedimentos clínicos</p>
          </div>
        </div>
        <button onClick={abrirNovo}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl transition-colors flex-shrink-0">
          Novo Procedimento
        </button>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Filtros */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text" value={busca} onChange={e => { setBusca(e.target.value); setPage(1); }}
                placeholder="Buscar por nome, código..."
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <select value={categoria} onChange={e => { setCategoria(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 bg-white">
              <option value="">Todas as categorias</option>
              {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Desktop table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={22} className="animate-spin text-emerald-600" />
          </div>
        ) : procedimentos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-300">
            <Activity size={38} className="mb-3" />
            <p className="text-sm text-gray-400">Nenhum procedimento encontrado</p>
          </div>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Procedimento</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Categoria</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Duração</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Características</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Valor Venda</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {procedimentos.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{p.nome}</p>
                        {p.codigo && <p className="text-[11px] text-gray-400 font-mono">{p.codigo}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{p.categoria}</td>
                      <td className="px-4 py-3 text-center text-gray-600">
                        {p.duracao ? `${p.duracao} min` : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          {p.requerAnestesia && (
                            <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-[10px] rounded-full font-medium">Anestesia</span>
                          )}
                          {p.requerInternacao && (
                            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded-full font-medium">Internação</span>
                          )}
                          {!p.requerAnestesia && !p.requerInternacao && (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatValor(p.valorVenda)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => abrirEdicao(p)}
                            className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => setInativandoId(p.id)}
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-100">
              {procedimentos.map(p => (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm">{p.nome}</p>
                      <p className="text-xs text-gray-500">{p.categoria}{p.duracao ? ` • ${p.duracao} min` : ''}</p>
                      {(p.requerAnestesia || p.requerInternacao) && (
                        <div className="flex gap-1 mt-1">
                          {p.requerAnestesia  && <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-[10px] rounded-full">Anestesia</span>}
                          {p.requerInternacao && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded-full">Internação</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => abrirEdicao(p)}
                        className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setInativandoId(p.id)}
                        className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Paginação */}
            {totalPaginas > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
                <span className="text-xs text-gray-400">{total} procedimento{total !== 1 ? 's' : ''}</span>
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
          </>
        )}
      </div>

      {showModal && (
        <ProcedimentoModal item={editingItem} onClose={fecharModal} onSaved={carregar} />
      )}

      <ModalJustificativa
        aberto={inativandoId !== null}
        titulo="Inativar procedimento?"
        descricao={procedimentos.find(p => p.id === inativandoId)?.nome}
        acaoLabel="Inativar"
        onConfirmar={(motivo) => { if (inativandoId !== null) handleInativar(inativandoId, motivo); }}
        onFechar={() => setInativandoId(null)}
      />
    </PageContainer>
  );
}
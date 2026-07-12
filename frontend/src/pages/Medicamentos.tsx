// frontend/src/pages/Medicamentos.tsx

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Pencil, Trash2, X, Loader2, Search,
  Pill, ShieldCheck, Package, ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import ModalJustificativa from '../components/ModalJustificativa';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Via {
  id:  number;
  via: string;
}

interface Medicamento {
  id:                number;
  nome:              string;
  fabricante:        string | null;
  formaFarmaceutica: string;
  unidade:           string;
  apresentacao:      string;
  controlado:        boolean;
  ativo:             boolean;
  vias:              Via[];
}

interface FormMedicamento {
  nome:              string;
  fabricante:        string;
  formaFarmaceutica: string;
  unidade:           string;
  apresentacao:      string;
  controlado:        boolean;
  ativo:             boolean;
  vias:              string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FORMAS = [
  'Ampola', 'Bolsa', 'Cápsula', 'Colírio', 'Comprimido', 'Creme',
  'Drágea', 'Frasco-ampola', 'Gel', 'Grânulos', 'Pasta oral',
  'Pomada', 'Pó para suspensão', 'Solução injetável', 'Solução oral',
  'Spray', 'Suspensão oral',
];

const UNIDADES_PAD = ['dose', 'g', 'gota', 'L', 'mcg', 'mg', 'mL', 'UI'];

const VIAS_LISTA = [
  'Oral', 'Endovenosa', 'Intramuscular', 'Intravenosa (IV)', 'Intravenosa (IV) lenta', 'Subcutânea', 'Tópica',
  'Retal', 'Nasal', 'Oftálmica', 'Intradérmica', 'Intraperitoneal',
];

const APRESENTACOES = [
  'Ampola', 'Ampola oral', 'Aplicador intramamario', 'Aerossol',
  'Balde', 'Bisnaga', 'Bloco', 'Blister', 'Bolsa', 'Bombona',
  'Brinco mosquicida', 'Caixa', 'Caneta aplicadora', 'Capsula gelatinosa',
  'Carpule', 'Cartucho', 'Cartucho com blister', 'Coleira', 'Envelope',
  'Flaconete', 'Frasco', 'Frasco ampola', 'Frasco dosador',
  'Frasco gotejador', 'Frasco pump', 'Frasco spray', 'Galao', 'Kit',
  'Lata', 'Pack', 'Pipeta', 'Pote', 'Refil', 'Roll on', 'Sache', 'Saco',
  'Seringa', 'Seringa dosadora', 'Seringa preenchida', 'Seringa intramamaria',
  'Spray', 'Strip', 'Tablete', 'Tambor', 'Tubo', 'Unidade',
];

const FORM_INICIAL: FormMedicamento = {
  nome: '', fabricante: '', formaFarmaceutica: '', unidade: 'mg',
  apresentacao: '', controlado: false, ativo: true, vias: ['Oral'],
};

// ─── SelectDown — combobox com filtro progressivo, sempre abre para baixo ─────

function SelectDown({
  value, onChange, options, placeholder,
}: {
  value:       string;
  onChange:    (v: string) => void;
  options:     string[];
  placeholder: string;
}) {
  const [open,        setOpen]        = useState(false);
  const [search,      setSearch]      = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);
  const listRef      = useRef<HTMLDivElement>(null);

  const filtered = search
    ? options.filter((o) => o.toLowerCase().startsWith(search.toLowerCase()))
    : options;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setSearch('');
      setHighlighted(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const scrollToIdx = (idx: number) => {
    if (listRef.current && idx >= 0)
      (listRef.current.children[idx] as HTMLElement)?.scrollIntoView({ block: 'nearest' });
  };

  const select = (opt: string) => { onChange(opt); setOpen(false); };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setHighlighted(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const n = Math.min(highlighted + 1, filtered.length - 1);
      setHighlighted(n); scrollToIdx(n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(highlighted - 1, 0);
      setHighlighted(n); scrollToIdx(n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlighted]) select(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-left flex items-center justify-between focus:outline-none focus:border-indigo-500 bg-white">
        <span className={value ? 'text-gray-900' : 'text-gray-400'}>{value || placeholder}</span>
        <ChevronDown size={14} className={`text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 flex flex-col">
          <div className="p-2 border-b border-gray-100">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={handleSearchChange}
              onKeyDown={handleKeyDown}
              placeholder="Digitar para filtrar..."
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
            />
          </div>
          <div ref={listRef} className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-gray-400 text-center">Nenhuma opção encontrada</p>
            ) : filtered.map((o, idx) => (
              <button
                key={o}
                type="button"
                onClick={() => select(o)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  highlighted === idx
                    ? 'bg-indigo-100 text-indigo-700 font-medium'
                    : value === o
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-700'
                }`}>
                {o}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MedicamentoModal ─────────────────────────────────────────────────────────

function MedicamentoModal({
  editando, saving, onSalvar, onFechar,
}: {
  editando:  Medicamento | null;
  saving:    boolean;
  onSalvar:  (form: FormMedicamento) => Promise<void>;
  onFechar:  () => void;
}) {
  const [form, setForm] = useState<FormMedicamento>(
    editando
      ? {
          nome:              editando.nome,
          fabricante:        editando.fabricante ?? '',
          formaFarmaceutica: editando.formaFarmaceutica,
          unidade:           editando.unidade,
          apresentacao:      editando.apresentacao,
          controlado:        editando.controlado,
          ativo:             editando.ativo,
          vias:              editando.vias.map(v => v.via),
        }
      : FORM_INICIAL,
  );

  const set = <K extends keyof FormMedicamento>(k: K, v: FormMedicamento[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const toggleVia = (via: string) => {
    setForm(prev => ({
      ...prev,
      vias: prev.vias.includes(via)
        ? prev.vias.filter(v => v !== via)
        : [...prev.vias, via],
    }));
  };

  const handleSalvar = async () => {
    if (!form.nome.trim())              { toast.error('Nome é obrigatório'); return; }
    if (!form.formaFarmaceutica.trim()) { toast.error('Forma farmacêutica é obrigatória'); return; }
    if (!form.unidade.trim())           { toast.error('Unidade é obrigatória'); return; }
    if (!form.apresentacao.trim())      { toast.error('Apresentação é obrigatória'); return; }
    await onSalvar(form);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-b-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg max-h-[92vh] flex flex-col border border-gray-100">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-widest">
              {editando ? 'EDITAR' : 'NOVO'} MEDICAMENTO
            </span>
            <h3 className="font-bold text-gray-900">Catálogo Global</h3>
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Nome */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">NOME *</label>
            <input
              type="text" value={form.nome} onChange={e => set('nome', e.target.value)}
              placeholder="Ex: Dipirona sódica"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Fabricante / Laboratório */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">FABRICANTE / LABORATÓRIO</label>
            <input
              type="text" value={form.fabricante} onChange={e => set('fabricante', e.target.value)}
              placeholder="Ex: Zoetis, MSD, Ceva, Ourofino..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Forma Farmacêutica + Unidade */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">FORMA FARMACÊUTICA *</label>
              <select value={form.formaFarmaceutica} onChange={e => set('formaFarmaceutica', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500">
                <option value="">Selecione...</option>
                {FORMAS.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">UNIDADE *</label>
              <select value={form.unidade} onChange={e => set('unidade', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500">
                <option value="">Selecione...</option>
                {UNIDADES_PAD.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          {/* Apresentação */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">APRESENTAÇÃO *</label>
            <SelectDown
              value={form.apresentacao}
              onChange={(v) => set('apresentacao', v)}
              options={APRESENTACOES}
              placeholder="Selecione..."
            />
          </div>

          {/* Vias de Administração */}
          <div>
            <label className="block text-xs text-gray-500 mb-2">VIAS DE ADMINISTRAÇÃO</label>
            <div className="flex flex-wrap gap-2">
              {VIAS_LISTA.map(v => (
                <button key={v} type="button" onClick={() => toggleVia(v)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    form.vias.includes(v)
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Controlado + Ativo */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.controlado} onChange={e => set('controlado', e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" />
              <span className="text-sm text-gray-700 flex items-center gap-1">
                <ShieldCheck size={13} className="text-orange-500" /> Medicamento controlado
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.ativo} onChange={e => set('ativo', e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" />
              <span className="text-sm text-gray-700">Ativo no catálogo</span>
            </label>
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onFechar} disabled={saving}
            className="px-5 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSalvar} disabled={saving}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2">
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Medicamentos page ────────────────────────────────────────────────────────

export default function Medicamentos() {
  const { podeExecutar, loading: loadingPerm } = usePermissoes();
  const { user } = useAuth();

  const [medicamentos,   setMedicamentos]   = useState<Medicamento[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [loadingMore,    setLoadingMore]    = useState(false);
  const [total,          setTotal]          = useState(0);
  const [totalControl,   setTotalControl]   = useState(0);
  const [busca,          setBusca]          = useState('');
  const [debouncedBusca, setDebouncedBusca] = useState('');
  const [filtroAtivo,    setFiltroAtivo]    = useState<'ativos' | 'todos'>('ativos');
  const loadVersion = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedBusca(busca), 400);
    return () => clearTimeout(t);
  }, [busca]);
  const [showModal,     setShowModal]     = useState(false);
  const [editando,      setEditando]      = useState<Medicamento | null>(null);
  const [saving,        setSaving]        = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadingMore(false);

    const buildParams = (offset: number, limit: number) => {
      const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (debouncedBusca.trim()) p.set('busca', debouncedBusca.trim());
      if (filtroAtivo === 'ativos') p.set('ativo', 'true');
      return p;
    };

    try {
      // Primeira página — 30 registros, libera a tela rapidamente
      const res = await api.get(`/medicamentos?${buildParams(0, 30)}`);
      if (loadVersion.current !== version) return;

      const dados = res.data.dados ?? [];
      setMedicamentos(dados);
      setTotal(res.data.meta?.total ?? 0);
      setTotalControl(res.data.meta?.totalControlados ?? 0);
      setLoading(false);

      // Background: carrega o restante sem bloquear a UI
      if (res.data.meta?.hasMore) {
        setLoadingMore(true);
        try {
          const res2 = await api.get(`/medicamentos?${buildParams(30, 470)}`);
          if (loadVersion.current !== version) return;
          setMedicamentos(prev => [...prev, ...(res2.data.dados ?? [])]);
        } catch { /* silencioso */ }
        finally { if (loadVersion.current === version) setLoadingMore(false); }
      }
    } catch {
      if (loadVersion.current === version) {
        toast.error('Erro ao carregar catálogo');
        setLoading(false);
      }
    }
  }, [debouncedBusca, filtroAtivo]);

  useEffect(() => { carregar(); }, [carregar]);

  const abrirNovo = () => { setEditando(null); setShowModal(true); };
  const abrirEdicao = (m: Medicamento) => { setEditando(m); setShowModal(true); };
  const fecharModal = () => { setShowModal(false); setEditando(null); };

  const handleSalvar = async (form: FormMedicamento) => {
    setSaving(true);
    try {
      if (editando) {
        await api.put(`/medicamentos/${editando.id}`, form);
        toast.success('Medicamento atualizado');
      } else {
        await api.post('/medicamentos', form);
        toast.success('Medicamento cadastrado');
      }
      fecharModal();
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao salvar');
    } finally { setSaving(false); }
  };

  const handleExcluir = async (id: number, motivo: string) => {
    try {
      await api.delete(`/medicamentos/${id}`, { data: { motivo } });
      toast.success('Medicamento desativado');
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao excluir');
    } finally { setConfirmDelete(null); }
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
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <Pill size={20} className="text-indigo-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Catálogo de Medicamentos</h1>
            <p className="text-sm text-gray-500">Cadastro global — compartilhado por todas as clínicas</p>
          </div>
        </div>
        <button onClick={abrirNovo}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors flex-shrink-0">
          Novo Medicamento
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <p className="text-xs text-gray-500 mb-1">Catálogo Ativo</p>
          <p className="text-2xl font-bold text-indigo-600">{total}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
            <ShieldCheck size={11} className="text-orange-500" /> Controlados
          </p>
          <p className="text-2xl font-bold text-orange-500">{totalControl}</p>
        </div>
      </div>

      {/* Filtros + tabela */}
      <div className="bg-white border border-gray-100 rounded-2xl mb-4">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100">
          <div className="flex gap-1">
            {(['ativos', 'todos'] as const).map(f => (
              <button key={f} onClick={() => setFiltroAtivo(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-colors ${
                  filtroAtivo === f ? 'bg-emerald-700 text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}>
                {f === 'ativos' ? 'Ativos' : 'Todos'}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text" placeholder="Buscar medicamento..." value={busca}
              onChange={e => setBusca(e.target.value)}
              className="w-full pl-8 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-indigo-500 bg-white"
            />
          </div>
          {busca && (
            <button onClick={() => setBusca('')}
              className="px-3 py-2 text-xs text-gray-500 hover:text-red-500 border border-gray-200 rounded-xl bg-white">
              Limpar ×
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-indigo-500" />
          </div>
        ) : medicamentos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-300">
            <Package size={38} className="mb-3" />
            <p className="text-sm text-gray-400">Nenhum medicamento encontrado</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</th>
                    <th className="px-4 py-3 text-left   text-xs font-semibold text-gray-500 uppercase tracking-wide">Fabricante</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Forma</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Unidade</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Apresentação</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Vias</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {medicamentos.map(m => (
                    <tr key={m.id} className={`hover:bg-gray-50 transition-colors ${!m.ativo ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900">{m.nome}</p>
                          {m.controlado && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700">
                              <ShieldCheck size={9} /> C
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-gray-500">{m.fabricante ?? <span className="text-gray-300">—</span>}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <p className="text-xs text-gray-700">{m.formaFarmaceutica}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <p className="text-xs text-gray-700">{m.unidade}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <p className="text-xs text-gray-500 max-w-[160px] truncate mx-auto">{m.apresentacao}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-wrap justify-center gap-1">
                          {m.vias.map(v => (
                            <span key={v.id} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px]">
                              {v.via}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          m.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {m.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => abrirEdicao(m)} title="Editar"
                            className="p-1.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => setConfirmDelete(m.id)} title="Desativar"
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
            <div className="md:hidden divide-y divide-gray-50">
              {medicamentos.map(m => (
                <div key={m.id} className={`px-4 py-3 ${!m.ativo ? 'opacity-50' : ''}`}>
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <p className="text-sm font-medium text-gray-900 flex items-center gap-1">
                        {m.nome}
                        {m.controlado && <ShieldCheck size={11} className="text-orange-500 flex-shrink-0" />}
                      </p>
                      <p className="text-xs text-gray-500">{m.fabricante ? `${m.fabricante} · ` : ''}{m.formaFarmaceutica} • {m.unidade}</p>
                    </div>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${
                      m.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {m.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate mb-1">{m.apresentacao}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {m.vias.slice(0, 3).map(v => (
                        <span key={v.id} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px]">{v.via}</span>
                      ))}
                      {m.vias.length > 3 && <span className="text-[10px] text-gray-400">+{m.vias.length - 3}</span>}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => abrirEdicao(m)} className="p-1.5 text-indigo-400 hover:text-indigo-600 rounded-lg">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setConfirmDelete(m.id)} className="p-1.5 text-red-400 hover:text-red-600 rounded-lg">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Indicador de carga em background */}
            {loadingMore && (
              <div className="flex items-center justify-center gap-2 py-3 border-t border-gray-50">
                <Loader2 size={13} className="animate-spin text-indigo-400" />
                <span className="text-xs text-gray-400">Carregando restante do catálogo…</span>
              </div>
            )}
          </>
        )}
      </div>

      {showModal && (
        <MedicamentoModal editando={editando} saving={saving} onSalvar={handleSalvar} onFechar={fecharModal} />
      )}

      <ModalJustificativa
        aberto={confirmDelete !== null}
        titulo="Desativar medicamento"
        descricao="O item será marcado como inativo no catálogo."
        acaoLabel="Desativar"
        onConfirmar={(motivo) => { if (confirmDelete !== null) handleExcluir(confirmDelete, motivo); }}
        onFechar={() => setConfirmDelete(null)}
      />

    </PageContainer>
  );
}
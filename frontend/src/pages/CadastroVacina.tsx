// frontend/src/pages/CadastroVacina.tsx — catálogo de vacinas + lotes (ADMIN only)

import { useState, useEffect, useCallback } from 'react';
import {
  Syringe, Plus, Pencil, Trash2, ChevronDown, ChevronRight,
  X, Check, Loader2, Package, AlertTriangle, ToggleLeft, ToggleRight,
  Building2,
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import { useAuth } from '../contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lote {
  id:            number;
  vacinaId:      number;
  empresaId:     number | null;
  empresa:       { id: number; nome: string } | null;
  lote:          string;
  validade:      string;
  qtdTotal:      number;
  qtdDisponivel: number;
  ativo:         boolean;
}

interface Vacina {
  id:        number;
  nome:      string;
  fabricante: string | null;
  via:        string;
  ativo:      boolean;
  lotes:      Lote[];
  _count:     { aplicacoes: number };
}

interface Empresa { id: number; nome: string }

const VIAS = [
  'Subcutânea (SC)',
  'Intramuscular (IM)',
  'Intranasal (IN)',
  'Intravenosa (IV)',
  'Oral',
];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR');

const isVencido = (iso: string) => new Date(iso) < new Date();

// ─── Modal de vacina ─────────────────────────────────────────────────────────

function VacinaModal({ vacina, onSalvar, onFechar, saving }: {
  vacina:   Vacina | null;
  onSalvar: (data: { nome: string; fabricante: string; via: string }) => void;
  onFechar: () => void;
  saving:   boolean;
}) {
  const [nome,       setNome]       = useState(vacina?.nome       ?? '');
  const [fabricante, setFabricante] = useState(vacina?.fabricante ?? '');
  const [via,        setVia]        = useState(vacina?.via        ?? 'Subcutânea (SC)');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{vacina ? 'Editar Vacina' : 'Nova Vacina'}</h3>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Ex: Múltipla Canina V10"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Fabricante</label>
            <input value={fabricante} onChange={e => setFabricante(e.target.value)}
              placeholder="Ex: Zoetis"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Via de Aplicação</label>
            <select value={via} onChange={e => setVia(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500">
              {VIAS.map(v => <option key={v}>{v}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-3 px-5 pb-5 pt-2 border-t border-gray-100">
          <button onClick={onFechar} disabled={saving}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onSalvar({ nome, fabricante, via })}
            disabled={saving || !nome.trim()}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de lote ────────────────────────────────────────────────────────────

function LoteModal({ vacinaId, lote, empresas, onSalvar, onFechar, saving }: {
  vacinaId:  number;
  lote:      Lote | null;
  empresas:  Empresa[];
  onSalvar:  (data: { empresaId: number | null; lote: string; validade: string; qtdTotal: number }) => void;
  onFechar:  () => void;
  saving:    boolean;
}) {
  const [empresaId, setEmpresaId] = useState<number | ''>(lote?.empresaId ?? '');
  const [numLote,   setNumLote]   = useState(lote?.lote ?? '');
  const [validade,  setValidade]  = useState(lote ? lote.validade.slice(0, 10) : '');
  const [qtd,       setQtd]       = useState(lote ? String(lote.qtdTotal) : '');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{lote ? 'Editar Lote' : 'Novo Lote'}</h3>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Empresa</label>
            <select value={empresaId} onChange={e => setEmpresaId(e.target.value ? Number(e.target.value) : '')}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500">
              <option value="">Global (todas as empresas)</option>
              {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Número do Lote *</label>
            <input value={numLote} onChange={e => setNumLote(e.target.value)}
              placeholder="Ex: 1234"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Validade *</label>
              <input type="date" value={validade} onChange={e => setValidade(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Qtd. Total *</label>
              <input type="number" min="1" value={qtd} onChange={e => setQtd(e.target.value)}
                placeholder="0"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-5 pb-5 pt-2 border-t border-gray-100">
          <button onClick={onFechar} disabled={saving}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onSalvar({ empresaId: empresaId || null, lote: numLote, validade, qtdTotal: Number(qtd) })}
            disabled={saving || !numLote.trim() || !validade || !qtd || Number(qtd) < 1}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CadastroVacina ───────────────────────────────────────────────────────────

export default function CadastroVacina() {
  const { user } = useAuth();
  const isAdmin = (user?.role ?? '').toUpperCase() === 'ADMIN';

  const [vacinas,       setVacinas]       = useState<Vacina[]>([]);
  const [empresas,      setEmpresas]      = useState<Empresa[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [expandido,     setExpandido]     = useState<number | null>(null);
  const [showVacinaModal, setShowVacinaModal] = useState(false);
  const [editandoVacina,  setEditandoVacina]  = useState<Vacina | null>(null);
  const [showLoteModal,   setShowLoteModal]   = useState(false);
  const [editandoLote,    setEditandoLote]    = useState<Lote | null>(null);
  const [vacinaIdLote,    setVacinaIdLote]    = useState<number | null>(null);
  const [saving,          setSaving]          = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [resVacinas, resEmpresas] = await Promise.all([
        api.get('/admin/vacinas'),
        api.get('/equipes/empresas').catch(() => ({ data: { dados: [] } })),
      ]);
      setVacinas(resVacinas.data?.dados ?? []);
      setEmpresas(resEmpresas.data?.dados ?? []);
    } catch {
      toast.error('Erro ao carregar vacinas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso restrito</h2>
          <p className="text-sm text-gray-500">Esta página é exclusiva para administradores.</p>
        </div>
      </PageContainer>
    );
  }

  // ── Handlers vacina ────────────────────────────────────────────────────────

  const handleSalvarVacina = async (data: { nome: string; fabricante: string; via: string }) => {
    setSaving(true);
    try {
      if (editandoVacina) {
        await api.put(`/admin/vacinas/${editandoVacina.id}`, data);
        toast.success('Vacina atualizada');
      } else {
        await api.post('/admin/vacinas', data);
        toast.success('Vacina criada');
      }
      setShowVacinaModal(false);
      setEditandoVacina(null);
      carregar();
    } catch {
      toast.error('Erro ao salvar vacina');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleVacina = async (v: Vacina) => {
    try {
      await api.patch(`/admin/vacinas/${v.id}/toggle`);
      toast.success(v.ativo ? 'Vacina inativada' : 'Vacina reativada');
      carregar();
    } catch {
      toast.error('Erro ao alterar status');
    }
  };

  // ── Handlers lote ──────────────────────────────────────────────────────────

  const abrirNovoLote = (vacinaId: number) => {
    setVacinaIdLote(vacinaId);
    setEditandoLote(null);
    setShowLoteModal(true);
  };

  const handleSalvarLote = async (data: { empresaId: number | null; lote: string; validade: string; qtdTotal: number }) => {
    if (!vacinaIdLote) return;
    setSaving(true);
    try {
      if (editandoLote) {
        await api.put(`/admin/vacinas/lotes/${editandoLote.id}`, data);
        toast.success('Lote atualizado');
      } else {
        await api.post(`/admin/vacinas/${vacinaIdLote}/lotes`, data);
        toast.success('Lote adicionado');
      }
      setShowLoteModal(false);
      setEditandoLote(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao salvar lote');
    } finally {
      setSaving(false);
    }
  };

  const handleInativarLote = async (loteId: number) => {
    if (!confirm('Inativar este lote?')) return;
    try {
      await api.patch(`/admin/vacinas/lotes/${loteId}/inativar`);
      toast.success('Lote inativado');
      carregar();
    } catch {
      toast.error('Erro ao inativar lote');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer maxWidth="7xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-teal-100 rounded-2xl flex items-center justify-center">
            <Syringe size={20} className="text-teal-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Catálogo de Vacinas</h1>
            <p className="text-sm text-gray-400">Gerencie vacinas e lotes do estoque</p>
          </div>
        </div>
        <button
          onClick={() => { setEditandoVacina(null); setShowVacinaModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
          <Plus size={16} /> Nova Vacina
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-teal-600" />
        </div>
      ) : vacinas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <Syringe size={40} className="mb-3" />
          <p className="text-sm text-gray-400 mb-4">Nenhuma vacina cadastrada</p>
          <button
            onClick={() => { setEditandoVacina(null); setShowVacinaModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-xl hover:bg-teal-800 transition-colors">
            <Plus size={14} /> Cadastrar vacina
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {vacinas.map(v => {
            const aberto = expandido === v.id;
            const lotesAtivos = v.lotes.filter(l => l.ativo);
            const saldoTotal  = lotesAtivos.reduce((s, l) => s + l.qtdDisponivel, 0);

            return (
              <div key={v.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${!v.ativo ? 'opacity-60' : ''}`}>
                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4">
                  <button onClick={() => setExpandido(aberto ? null : v.id)}
                    className="flex-1 flex items-center gap-3 text-left">
                    <div className="w-9 h-9 bg-teal-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Syringe size={16} className="text-teal-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{v.nome}</p>
                      <p className="text-xs text-gray-400">
                        {v.fabricante ?? 'Fabricante não informado'} · {v.via}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <Package size={13} className="text-teal-500" />
                        <span className="font-medium text-teal-700">{saldoTotal} ds</span>
                        <span className="text-gray-300">·</span>
                        <span>{lotesAtivos.length} lote{lotesAtivos.length !== 1 ? 's' : ''}</span>
                      </div>
                      {aberto ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                    </div>
                  </button>

                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <button onClick={() => { setEditandoVacina(v); setShowVacinaModal(true); }}
                      className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Editar">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleToggleVacina(v)}
                      className={`p-1.5 rounded-lg transition-colors ${v.ativo ? 'text-emerald-500 hover:text-gray-400 hover:bg-gray-50' : 'text-gray-300 hover:text-emerald-600 hover:bg-emerald-50'}`}
                      title={v.ativo ? 'Inativar' : 'Reativar'}>
                      {v.ativo ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                  </div>
                </div>

                {/* Lotes expandidos */}
                {aberto && (
                  <div className="border-t border-gray-100 px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lotes</p>
                      <button
                        onClick={() => abrirNovoLote(v.id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-teal-50 text-teal-700 text-xs font-semibold rounded-xl hover:bg-teal-100 transition-colors">
                        <Plus size={12} /> Novo Lote
                      </button>
                    </div>

                    {v.lotes.length === 0 ? (
                      <p className="text-xs text-gray-400 py-4 text-center">Nenhum lote cadastrado</p>
                    ) : (
                      <>
                        {/* Mobile */}
                        <div className="md:hidden space-y-2">
                          {v.lotes.map(l => (
                            <div key={l.id} className={`p-3 rounded-xl border ${!l.ativo ? 'opacity-50' : isVencido(l.validade) ? 'border-red-200 bg-red-50/30' : 'border-gray-100 bg-gray-50'}`}>
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="text-xs font-semibold text-gray-800">Lote {l.lote}</p>
                                  {l.empresa && (
                                    <p className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                                      <Building2 size={10} /> {l.empresa.nome}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button onClick={() => { setVacinaIdLote(v.id); setEditandoLote(l); setShowLoteModal(true); }}
                                    className="p-1 text-gray-400 hover:text-emerald-600"><Pencil size={12} /></button>
                                  {l.ativo && <button onClick={() => handleInativarLote(l.id)}
                                    className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                                <span>Val: {formatDate(l.validade)}</span>
                                <span className={`font-semibold ${l.qtdDisponivel === 0 ? 'text-red-500' : 'text-teal-700'}`}>
                                  Saldo: {l.qtdDisponivel}/{l.qtdTotal}
                                </span>
                                {!l.ativo && <span className="text-gray-400 italic">inativo</span>}
                                {isVencido(l.validade) && <span className="text-red-500 font-medium flex items-center gap-1"><AlertTriangle size={10} />Vencido</span>}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Desktop */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-gray-100">
                                <th className="pb-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Lote</th>
                                <th className="pb-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Empresa</th>
                                <th className="pb-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Validade</th>
                                <th className="pb-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Saldo</th>
                                <th className="pb-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                                <th className="pb-2"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {v.lotes.map(l => (
                                <tr key={l.id} className={!l.ativo ? 'opacity-50' : ''}>
                                  <td className="py-2.5 text-xs font-medium text-gray-800">{l.lote}</td>
                                  <td className="py-2.5 text-xs text-gray-500">
                                    {l.empresa ? (
                                      <span className="flex items-center gap-1"><Building2 size={11} />{l.empresa.nome}</span>
                                    ) : <span className="text-gray-300">Global</span>}
                                  </td>
                                  <td className={`py-2.5 text-xs ${isVencido(l.validade) ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                                    {formatDate(l.validade)}
                                    {isVencido(l.validade) && <AlertTriangle size={11} className="inline ml-1 text-red-500" />}
                                  </td>
                                  <td className="py-2.5">
                                    <span className={`text-xs font-semibold ${l.qtdDisponivel === 0 ? 'text-red-500' : 'text-teal-700'}`}>
                                      {l.qtdDisponivel}
                                    </span>
                                    <span className="text-xs text-gray-400">/{l.qtdTotal} ds</span>
                                  </td>
                                  <td className="py-2.5">
                                    {!l.ativo
                                      ? <span className="text-[10px] bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Inativo</span>
                                      : isVencido(l.validade)
                                      ? <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Vencido</span>
                                      : l.qtdDisponivel === 0
                                      ? <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Sem saldo</span>
                                      : <span className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><Check size={9} />OK</span>
                                    }
                                  </td>
                                  <td className="py-2.5">
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => { setVacinaIdLote(v.id); setEditandoLote(l); setShowLoteModal(true); }}
                                        className="p-1 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                                        <Pencil size={13} />
                                      </button>
                                      {l.ativo && (
                                        <button onClick={() => handleInativarLote(l.id)}
                                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                          <Trash2 size={13} />
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showVacinaModal && (
        <VacinaModal
          vacina={editandoVacina}
          onSalvar={handleSalvarVacina}
          onFechar={() => { setShowVacinaModal(false); setEditandoVacina(null); }}
          saving={saving}
        />
      )}

      {showLoteModal && vacinaIdLote && (
        <LoteModal
          vacinaId={vacinaIdLote}
          lote={editandoLote}
          empresas={empresas}
          onSalvar={handleSalvarLote}
          onFechar={() => { setShowLoteModal(false); setEditandoLote(null); }}
          saving={saving}
        />
      )}
    </PageContainer>
  );
}

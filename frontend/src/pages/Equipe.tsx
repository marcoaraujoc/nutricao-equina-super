// src/pages/Equipe.tsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Users2, Mail, Trash2, ToggleLeft, ToggleRight,
  UserCheck, Loader2, X, Send,
} from 'lucide-react';
import { formatDate } from '../utils/dateUtils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Membro {
  id:        number;
  cargo:     string;
  ativo?:    boolean;
  createdAt: string;
  user: {
    id:       number;
    fullName: string;
    email:    string;
    userType: string;
  };
  equipe?: {
    id:   number;
    nome: string;
  };
}

interface ConviteForm {
  email: string;
  cargo: string;
}

const CARGOS = ['Veterinário', 'Estagiário', 'Auxiliar', 'Recepcionista', 'Administrador'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const badgeCargo = (cargo: string) => {
  const map: Record<string, string> = {
    'Veterinário':   'bg-emerald-100 text-emerald-700',
    'Estagiário':    'bg-blue-100 text-blue-700',
    'Auxiliar':      'bg-purple-100 text-purple-700',
    'Recepcionista': 'bg-amber-100 text-amber-700',
    'Administrador': 'bg-red-100 text-red-700',
  };
  return map[cargo] ?? 'bg-gray-100 text-gray-600';
};


// ─── Componente ──────────────────────────────────────────────────────────────

export default function Equipe() {
  const { user }                              = useAuth();
  const [membros,     setMembros]             = useState<Membro[]>([]);
  const [loading,     setLoading]             = useState(true);
  const [showConvite, setShowConvite]         = useState(false);
  const [enviando,    setEnviando]            = useState(false);
  const [togglingId,  setTogglingId]          = useState<number | null>(null);
  const [removendoId, setRemovendoId]         = useState<number | null>(null);
  const [confirmRemover, setConfirmRemover]   = useState<Membro | null>(null);
  const [convite,     setConvite]             = useState<ConviteForm>({ email: '', cargo: 'Veterinário' });

  const carregarMembros = async () => {
    try {
      const res = await api.get('/equipes/membros');
      setMembros(res.data?.dados ?? []);
    } catch {
      // sem equipe ainda — lista vazia
      setMembros([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregarMembros(); }, []);

  // ── Convidar membro ───────────────────────────────────────────────────────
  const handleConvidar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!convite.email.trim()) { toast.error('Informe o e-mail'); return; }

    setEnviando(true);
    try {
      await api.post('/equipes/convites', {
        email: convite.email.trim().toLowerCase(),
        cargo: convite.cargo,
      });
      toast.success(`Convite enviado para ${convite.email}`);
      setConvite({ email: '', cargo: 'Veterinário' });
      setShowConvite(false);
      carregarMembros();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })
        .response?.data?.mensagem ?? 'Erro ao enviar convite';
      toast.error(msg);
    } finally {
      setEnviando(false);
    }
  };

  // ── Toggle ativo/inativo ──────────────────────────────────────────────────
  const handleToggle = async (membro: Membro) => {
    setTogglingId(membro.id);
    try {
      await api.patch(`/equipes/membros/${membro.id}/toggle`);
      toast.success(`${membro.user.fullName} ${membro.ativo === false ? 'ativado' : 'desativado'}`);
      carregarMembros();
    } catch {
      toast.error('Erro ao alterar status');
    } finally {
      setTogglingId(null);
    }
  };

  // ── Remover membro ────────────────────────────────────────────────────────
  const handleRemover = async () => {
    if (!confirmRemover) return;
    setRemovendoId(confirmRemover.id);
    try {
      await api.delete(`/equipes/membros/${confirmRemover.id}`);
      toast.success(`${confirmRemover.user.fullName} removido da equipe`);
      setConfirmRemover(null);
      carregarMembros();
    } catch {
      toast.error('Erro ao remover membro');
    } finally {
      setRemovendoId(null);
    }
  };

  const membrosAtivos   = membros.filter(m => m.ativo !== false);
  const membrosInativos = membros.filter(m => m.ativo === false);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <Users2 size={20} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Minha Equipe</h1>
            <p className="text-sm text-gray-500">
              {membros.length > 0
                ? `${membrosAtivos.length} membro${membrosAtivos.length !== 1 ? 's' : ''} ativo${membrosAtivos.length !== 1 ? 's' : ''}`
                : 'Nenhum membro ainda'}
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowConvite(true)}
          className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold text-sm transition-colors"
        >
          <Mail size={16} /> Convidar membro
        </button>
      </div>

      {/* Lista de membros */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      ) : membros.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Users2 size={40} className="mx-auto mb-4 text-gray-200" />
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Sua equipe está vazia</h2>
          <p className="text-sm text-gray-400 mb-6">
            Convide veterinários, estagiários e colaboradores para colaborar na plataforma.
          </p>
          <button
            onClick={() => setShowConvite(true)}
            className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold text-sm transition-colors"
          >
            Convidar primeiro membro
          </button>
        </div>
      ) : (
        <div className="space-y-4">

          {/* Membros ativos */}
          {membrosAtivos.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-50 bg-gray-50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Membros ativos — {membrosAtivos.length}
                </p>
              </div>
              <div className="divide-y divide-gray-50">
                {membrosAtivos.map(m => (
                  <div key={m.id} className="flex items-center gap-4 px-5 py-4">
                    {/* Avatar */}
                    <div className="w-10 h-10 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {m.user.fullName?.[0]?.toUpperCase() ?? 'U'}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 truncate">{m.user.fullName}</p>
                        {m.user.id === user?.id && (
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Você</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">{m.user.email}</p>
                    </div>

                    {/* Cargo */}
                    <span className={`hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${badgeCargo(m.cargo)}`}>
                      {m.cargo}
                    </span>

                    {/* Data */}
                    <p className="hidden md:block text-xs text-gray-400 flex-shrink-0">
                      Desde {formatDate(m.createdAt)}
                    </p>

                    {/* Ações */}
                    {m.user.id !== user?.id && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleToggle(m)}
                          disabled={togglingId === m.id}
                          className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Desativar"
                        >
                          {togglingId === m.id
                            ? <Loader2 size={15} className="animate-spin" />
                            : <ToggleRight size={18} />
                          }
                        </button>
                        <button
                          onClick={() => setConfirmRemover(m)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remover"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Membros inativos */}
          {membrosInativos.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden opacity-70">
              <div className="px-5 py-3 border-b border-gray-50 bg-gray-50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Inativos — {membrosInativos.length}
                </p>
              </div>
              <div className="divide-y divide-gray-50">
                {membrosInativos.map(m => (
                  <div key={m.id} className="flex items-center gap-4 px-5 py-4">
                    <div className="w-10 h-10 bg-gray-100 text-gray-400 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {m.user.fullName?.[0]?.toUpperCase() ?? 'U'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-500 truncate">{m.user.fullName}</p>
                      <p className="text-xs text-gray-400 truncate">{m.user.email}</p>
                    </div>
                    <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-400">
                      {m.cargo}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleToggle(m)}
                        disabled={togglingId === m.id}
                        className="p-1.5 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Reativar"
                      >
                        {togglingId === m.id
                          ? <Loader2 size={15} className="animate-spin" />
                          : <ToggleLeft size={18} />
                        }
                      </button>
                      <button
                        onClick={() => setConfirmRemover(m)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal — Convidar */}
      {showConvite && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                  <UserCheck size={18} className="text-emerald-700" />
                </div>
                <h2 className="text-lg font-bold text-gray-900">Convidar membro</h2>
              </div>
              <button onClick={() => setShowConvite(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConvidar} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  E-mail <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={convite.email}
                  onChange={e => setConvite(p => ({ ...p, email: e.target.value }))}
                  placeholder="colaborador@email.com"
                  required
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Cargo</label>
                <select
                  value={convite.cargo}
                  onChange={e => setConvite(p => ({ ...p, cargo: e.target.value }))}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-emerald-600 bg-white"
                >
                  {CARGOS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 text-xs text-blue-700">
                <Send size={12} className="flex-shrink-0 mt-0.5" />
                <span>
                  Um e-mail será enviado com o link de aceite.
                  O membro precisará criar uma conta ou fazer login para aceitar o convite.
                </span>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowConvite(false)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={enviando}
                  className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-2xl text-sm font-semibold flex items-center justify-center gap-2"
                >
                  {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {enviando ? 'Enviando...' : 'Enviar convite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal — Confirmar remoção */}
      {confirmRemover && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center">
            <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Remover membro?</h2>
            <p className="text-gray-500 text-sm mb-6">
              <strong className="text-gray-700">{confirmRemover.user.fullName}</strong> perderá
              acesso à plataforma pela sua equipe.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmRemover(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleRemover}
                disabled={removendoId !== null}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white rounded-2xl text-sm font-semibold"
              >
                {removendoId !== null ? 'Removendo...' : 'Remover'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
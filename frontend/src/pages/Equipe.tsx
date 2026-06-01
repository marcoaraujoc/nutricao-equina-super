// src/pages/Equipe.tsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Users2, Mail, Trash2, ToggleLeft, ToggleRight,
  UserCheck, Loader2, X, Send, Clock, CheckCircle2, XCircle,
  AlertCircle, ShieldCheck, Pencil, ChevronDown,
} from 'lucide-react';
import { formatDate } from '../utils/dateUtils';
import PermissoesModal from '../components/PermissoesModal';

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
  equipe?: { nome: string };
}

interface ConviteForm { email: string; cargo: string; }

interface Convite {
  id:        number;
  email:     string;
  cargo:     string;
  status:    'PENDENTE' | 'ACEITO' | 'RECUSADO' | 'CANCELADO';
  createdAt: string;
  expiresAt: string;
}

const CARGO_OPTIONS: { value: string; label: string }[] = [
  { value: 'VETERINARIO',  label: 'Veterinário'  },
  { value: 'ESTAGIARIO',   label: 'Estagiário'   },
  { value: 'ADMIN',        label: 'Administrador' },
  { value: 'MEMBRO',       label: 'Membro'        },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const labelCargo = (cargo: string): string => ({
  VETERINARIO: 'Veterinário', ESTAGIARIO: 'Estagiário',
  ADMIN: 'Administrador', MEMBRO: 'Membro', PROPRIETARIO: 'Proprietário',
} as Record<string,string>)[cargo] ?? cargo;

const badgeCargo = (cargo: string): string => ({
  VETERINARIO:  'bg-emerald-100 text-emerald-700',
  ESTAGIARIO:   'bg-blue-100 text-blue-700',
  ADMIN:        'bg-red-100 text-red-700',
  MEMBRO:       'bg-gray-100 text-gray-600',
  PROPRIETARIO: 'bg-purple-100 text-purple-700',
} as Record<string,string>)[cargo] ?? 'bg-gray-100 text-gray-600';

// ─── Componente ──────────────────────────────────────────────────────────────

export default function Equipe() {
  const { user }                                          = useAuth();
  const [membros,       setMembros]                       = useState<Membro[]>([]);
  const [equipeId,      setEquipeId]                      = useState<number | null>(null);
  const [isSocio,       setIsSocio]                       = useState(false);
  const [loading,       setLoading]                       = useState(true);
  const [showConvite,   setShowConvite]                   = useState(false);
  const [enviando,      setEnviando]                      = useState(false);
  const [togglingId,    setTogglingId]                    = useState<number | null>(null);
  const [removendoId,   setRemovendoId]                   = useState<number | null>(null);
  const [confirmRemover,setConfirmRemover]                = useState<Membro | null>(null);
  const [convites,      setConvites]                      = useState<Convite[]>([]);
  const [loadConvites,  setLoadConvites]                  = useState(false);
  const [removendoConviteId, setRemovendoConviteId]       = useState<number | null>(null);
  const [convite,       setConvite]                       = useState<ConviteForm>({ email: '', cargo: 'VETERINARIO' });
  const [editandoId,    setEditandoId]                    = useState<number | null>(null);
  const [editCargo,     setEditCargo]                     = useState('');
  const [salvandoCargo, setSalvandoCargo]                 = useState(false);
  const [permissoesModal, setPermissoesModal]             = useState<Membro | null>(null);
  const [membroEditando,   setMembroEditando]             = useState<Membro | null>(null);
  const [editNome,          setEditNome]                   = useState('');
  const [editCargoPerfil,   setEditCargoPerfil]            = useState('');
  const [salvandoEdicao,    setSalvandoEdicao]             = useState(false);

  const carregarMembros = async () => {
    try {
      const res = await api.get('/equipes/membros');
      setMembros(res.data?.dados ?? []);
      setEquipeId(res.data?.equipeId ?? null);
      setIsSocio(res.data?.isSocio ?? false);
    } catch { setMembros([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { carregarMembros(); }, []);

  const carregarConvites = async () => {
    setLoadConvites(true);
    try {
      const res = await api.get('/equipes/convites');
      setConvites(res.data?.dados ?? []);
    } catch { setConvites([]); }
    finally { setLoadConvites(false); }
  };

  useEffect(() => { carregarConvites(); }, []);

  const handleConvidar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!convite.email.trim()) { toast.error('Informe o e-mail'); return; }
    setEnviando(true);
    try {
      await api.post('/equipes/convites', { email: convite.email.trim().toLowerCase(), cargo: convite.cargo });
      toast.success(`Convite enviado para ${convite.email}`);
      setConvite({ email: '', cargo: 'VETERINARIO' });
      setShowConvite(false);
      carregarMembros(); carregarConvites();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao enviar convite');
    } finally { setEnviando(false); }
  };

  const handleToggle = async (membro: Membro) => {
    setTogglingId(membro.id);
    try {
      await api.patch(`/equipes/membros/${membro.id}/toggle`);
      toast.success(`${membro.user.fullName} ${membro.ativo === false ? 'ativado' : 'desativado'}`);
      carregarMembros();
    } catch { toast.error('Erro ao alterar status'); }
    finally { setTogglingId(null); }
  };

  const handleRemover = async () => {
    if (!confirmRemover) return;
    setRemovendoId(confirmRemover.id);
    try {
      await api.delete(`/equipes/membros/${confirmRemover.id}`);
      toast.success(`${confirmRemover.user.fullName} removido da equipe`);
      setConfirmRemover(null); carregarMembros();
    } catch { toast.error('Erro ao remover membro'); }
    finally { setRemovendoId(null); }
  };

  const handleSalvarCargo = async (membro: Membro) => {
    if (!equipeId) return;
    setSalvandoCargo(true);
    try {
      await api.patch(`/equipes/${equipeId}/membros/${membro.user.id}/cargo`, { cargo: editCargo });
      toast.success('Cargo atualizado');
      setEditandoId(null); carregarMembros();
    } catch { toast.error('Erro ao atualizar cargo'); }
    finally { setSalvandoCargo(false); }
  };

  const handleSalvarEdicao = async () => {
    if (!membroEditando) return;
    setSalvandoEdicao(true);
    try {
      await api.patch(`/equipes/membros/${membroEditando.id}`, {
        fullName: editNome,
        cargo:    editCargoPerfil,
      });
      toast.success('Perfil atualizado');
      setMembroEditando(null);
      carregarMembros();
    } catch {
      toast.error('Erro ao atualizar perfil');
    } finally {
      setSalvandoEdicao(false);
    }
  };
  const handleRemoverConvite = async (id: number) => {
    setRemovendoConviteId(id);
    try {
      await api.delete(`/equipes/convites/${id}`);
      toast.success('Convite removido');
      setConvites(prev => prev.filter(c => c.id !== id));
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao remover');
    } finally { setRemovendoConviteId(null); }
  };

  const membrosAtivos   = membros.filter(m => m.ativo !== false);
  const membrosInativos = membros.filter(m => m.ativo === false);

  // ─── Render ───────────────────────────────────────────────────────────────

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
              {isSocio && <span className="ml-2 text-[10px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">Sócio</span>}
            </p>
          </div>
        </div>
        {isSocio && (
          <button onClick={() => setShowConvite(true)}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold text-sm transition-colors">
            <Mail size={16} /> Convidar membro
          </button>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      ) : membros.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Users2 size={40} className="mx-auto mb-4 text-gray-200" />
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Sua equipe está vazia</h2>
          <p className="text-sm text-gray-400 mb-6">Convide veterinários, estagiários e colaboradores.</p>
          {isSocio && (
            <button onClick={() => setShowConvite(true)}
              className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold text-sm transition-colors">
              Convidar primeiro membro
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">

          {membrosAtivos.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-50 bg-gray-50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Membros ativos — {membrosAtivos.length}</p>
              </div>
              <div className="divide-y divide-gray-50">
                {membrosAtivos.map(m => (
                  <div key={m.id} className="flex items-center gap-4 px-5 py-4">
                    <div className="w-10 h-10 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {m.user.fullName?.[0]?.toUpperCase() ?? 'U'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 truncate">{m.user.fullName}</p>
                        {m.user.id === user?.id && (
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Você</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">{m.user.email}</p>
                    </div>

                    {/* Cargo editável para Sócio */}
                    {isSocio && editandoId === m.id ? (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <div className="relative">
                          <select value={editCargo} onChange={e => setEditCargo(e.target.value)}
                            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500 appearance-none pr-6">
                            {CARGO_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                          <ChevronDown size={10} className="absolute right-1.5 top-2.5 text-gray-400 pointer-events-none" />
                        </div>
                        <button onClick={() => handleSalvarCargo(m)} disabled={salvandoCargo}
                          className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                          {salvandoCargo ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                        </button>
                        <button onClick={() => setEditandoId(null)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <span
                        className={`hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${badgeCargo(m.cargo)} ${isSocio && m.user.id !== user?.id ? 'cursor-pointer hover:opacity-80' : ''}`}
                        onClick={isSocio && m.user.id !== user?.id ? () => { setEditandoId(m.id); setEditCargo(m.cargo); } : undefined}
                        title={isSocio && m.user.id !== user?.id ? 'Clique para editar cargo' : undefined}
                      >
                        {labelCargo(m.cargo)}
                        {isSocio && m.user.id !== user?.id && <Pencil size={9} className="opacity-50" />}
                      </span>
                    )}

                    <p className="hidden md:block text-xs text-gray-400 flex-shrink-0">Desde {formatDate(m.createdAt)}</p>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => { setMembroEditando(m); setEditNome(m.user.fullName); setEditCargoPerfil(m.cargo); }}
                        className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg"
                        title="Editar perfil">
                        <Pencil size={15} />
                      </button>
                      {m.user.id !== user?.id && (
                        <>
                          {isSocio && equipeId && (
                            <button onClick={() => setPermissoesModal(m)}
                              className="p-1.5 text-purple-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg" title="Controle de acesso">
                              <ShieldCheck size={15} />
                            </button>
                          )}
                          <button onClick={() => handleToggle(m)} disabled={togglingId === m.id}
                            className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg" title="Desativar">
                            {togglingId === m.id ? <Loader2 size={15} className="animate-spin" /> : <ToggleRight size={18} />}
                          </button>
                          <button onClick={() => setConfirmRemover(m)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Remover">
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {membrosInativos.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden opacity-70">
              <div className="px-5 py-3 border-b border-gray-50 bg-gray-50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Inativos — {membrosInativos.length}</p>
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
                      {labelCargo(m.cargo)}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => handleToggle(m)} disabled={togglingId === m.id}
                        className="p-1.5 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg" title="Reativar">
                        {togglingId === m.id ? <Loader2 size={15} className="animate-spin" /> : <ToggleLeft size={18} />}
                      </button>
                      <button onClick={() => setConfirmRemover(m)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
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

      {/* Card Convites */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
              <Mail size={15} className="text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Convites enviados</p>
              <p className="text-[11px] text-gray-400">{convites.length} registro{convites.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {(['PENDENTE','ACEITO','RECUSADO','CANCELADO'] as const).map(val => {
              const count = convites.filter(c => c.status === val).length;
              if (!count) return null;
              const cfg = {
                PENDENTE:  { bg:'bg-amber-50',   text:'text-amber-700',   icon:<Clock size={10}/>,         label:'Pendentes'  },
                ACEITO:    { bg:'bg-emerald-50',  text:'text-emerald-700', icon:<CheckCircle2 size={10}/>,  label:'Aceitos'    },
                RECUSADO:  { bg:'bg-red-50',      text:'text-red-600',     icon:<XCircle size={10}/>,       label:'Recusados'  },
                CANCELADO: { bg:'bg-gray-100',    text:'text-gray-500',    icon:<AlertCircle size={10}/>,   label:'Cancelados' },
              }[val];
              return (
                <span key={val} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
                  {cfg.icon}{count} {cfg.label}
                </span>
              );
            })}
          </div>
        </div>

        {loadConvites ? (
          <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-blue-500" /></div>
        ) : convites.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Nenhum convite enviado ainda.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {convites.map(c => {
              const expirado = c.status === 'PENDENTE' && new Date(c.expiresAt) < new Date();
              const eff = expirado ? 'EXPIRADO' : c.status;
              const cfg = ({
                PENDENTE:  { bg:'bg-amber-100',   text:'text-amber-700',   label:'Pendente',  icon:<Clock size={11}/> },
                EXPIRADO:  { bg:'bg-gray-100',    text:'text-gray-500',    label:'Expirado',  icon:<AlertCircle size={11}/> },
                ACEITO:    { bg:'bg-emerald-100', text:'text-emerald-700', label:'Aceito',    icon:<CheckCircle2 size={11}/> },
                RECUSADO:  { bg:'bg-red-100',     text:'text-red-600',     label:'Recusado',  icon:<XCircle size={11}/> },
                CANCELADO: { bg:'bg-gray-100',    text:'text-gray-500',    label:'Cancelado', icon:<AlertCircle size={11}/> },
              } as Record<string, { bg:string; text:string; label:string; icon:React.ReactNode }>)[eff] ?? { bg:'bg-gray-100', text:'text-gray-500', label:eff, icon:null };
              return (
                <div key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-gray-500">{c.email[0]?.toUpperCase() ?? '?'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{c.email}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Enviado em {new Date(c.createdAt).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' })}
                    </p>
                  </div>
                  <span className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${badgeCargo(c.cargo)}`}>
                    {labelCargo(c.cargo)}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text} flex-shrink-0`}>
                    {cfg.icon}{cfg.label}
                  </span>
                  {c.status !== 'ACEITO' && (
                    <button onClick={() => handleRemoverConvite(c.id)} disabled={removendoConviteId === c.id}
                      className="flex-shrink-0 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                      {removendoConviteId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Permissões */}
      {permissoesModal && equipeId && (
        <PermissoesModal
          equipeId={equipeId}
          membroId={permissoesModal.user.id}
          membroNome={permissoesModal.user.fullName}
          onClose={() => setPermissoesModal(null)}
        />
      )}

      {/* Modal Convidar */}
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
                <label className="block text-sm font-medium text-gray-700 mb-1.5">E-mail <span className="text-red-500">*</span></label>
                <input type="email" value={convite.email} onChange={e => setConvite(p => ({ ...p, email: e.target.value }))}
                  placeholder="colaborador@email.com" required
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Cargo</label>
                <select value={convite.cargo} onChange={e => setConvite(p => ({ ...p, cargo: e.target.value }))}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-600 bg-white">
                  {CARGO_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 text-xs text-blue-700">
                <Send size={12} className="flex-shrink-0 mt-0.5" />
                <span>Um e-mail será enviado com o link de aceite.</span>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowConvite(false)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={enviando}
                  className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-2xl text-sm font-semibold flex items-center justify-center gap-2">
                  {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {enviando ? 'Enviando...' : 'Enviar convite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Membro */}
      {membroEditando && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <Pencil size={18} className="text-blue-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Editar perfil</h2>
                  <p className="text-xs text-gray-400">{membroEditando.user.email}</p>
                </div>
              </div>
              <button onClick={() => setMembroEditando(null)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome</label>
                <input
                  type="text"
                  value={editNome}
                  onChange={e => setEditNome(e.target.value)}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="Nome completo"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Cargo</label>
                <select
                  value={editCargoPerfil}
                  onChange={e => setEditCargoPerfil(e.target.value)}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 bg-white"
                >
                  {CARGO_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setMembroEditando(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSalvarEdicao}
                disabled={salvandoEdicao || !editNome.trim()}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-2xl text-sm font-semibold flex items-center justify-center gap-2"
              >
                {salvandoEdicao ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {salvandoEdicao ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal Confirmar remoção */}
      {confirmRemover && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center">
            <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Remover membro?</h2>
            <p className="text-gray-500 text-sm mb-6">
              <strong className="text-gray-700">{confirmRemover.user.fullName}</strong> perderá acesso à plataforma.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmRemover(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50">Cancelar</button>
              <button onClick={handleRemover} disabled={removendoId !== null}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white rounded-2xl text-sm font-semibold">
                {removendoId !== null ? 'Removendo...' : 'Remover'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
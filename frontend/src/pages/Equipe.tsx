// src/pages/Equipe.tsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Users2, Mail, Trash2, ToggleLeft, ToggleRight,
  Loader2, X, CheckCircle2,
  ShieldCheck, Pencil, ChevronDown, Check,
} from 'lucide-react';
import { formatDate } from '../utils/dateUtils';
import PermissoesModal from '../components/PermissoesModal';
import PageContainer from '../components/PageContainer';
import BotaoVoltar   from '../components/BotaoVoltar';
import UsuarioFormModal, { type UsuarioFormValues } from '../components/UsuarioFormModal';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Membro {
  id:        number;
  cargo:     string;
  createdAt: string;
  user: {
    id:       number;
    fullName: string;
    email:    string;
    userType: string;
    ativo:    boolean;
    phone?:       string | null;
    cep?:         string | null;
    endereco?:    string | null;
    complemento?: string | null;
    bairro?:      string | null;
    cidade?:      string | null;
    estado?:      string | null;
  };
  equipe?: { nome: string };
}

// Perfis de acesso atribuíveis a membros da equipe
const CARGO_OPTIONS: { value: string; label: string }[] = [
  { value: 'VETERINARIO',  label: 'Veterinário'   },
  { value: 'ESTAGIARIO',   label: 'Estagiário'    },
  { value: 'PRESTADOR',    label: 'Fornecedor'    },
  { value: 'SOCIO',        label: 'Sócio'         },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const labelCargo = (cargo: string): string => ({
  SOCIO:        'Sócio',
  VETERINARIO:  'Veterinário',
  ESTAGIARIO:   'Estagiário',
  PRESTADOR:    'Fornecedor',
  ADMIN:        'Administrador',
  MEMBRO:       'Membro',
  PROPRIETARIO: 'Proprietário',
} as Record<string,string>)[cargo] ?? cargo;

const badgeCargo = (cargo: string): string => ({
  SOCIO:        'bg-purple-100 text-purple-700',
  VETERINARIO:  'bg-emerald-100 text-emerald-700',
  ESTAGIARIO:   'bg-blue-100 text-blue-700',
  PRESTADOR:    'bg-teal-100 text-teal-700',
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
  const [editandoId,    setEditandoId]                    = useState<number | null>(null);
  const [editCargo,     setEditCargo]                     = useState('');
  const [salvandoCargo, setSalvandoCargo]                 = useState(false);
  const [permissoesModal, setPermissoesModal]             = useState<Membro | null>(null);
  const [membroEditando,   setMembroEditando]             = useState<Membro | null>(null);
  const [salvandoEdicao,    setSalvandoEdicao]             = useState(false);
  const [nomeEquipe,        setNomeEquipe]                  = useState('');
  const [editandoNome,      setEditandoNome]                = useState(false);
  const [novoNome,          setNovoNome]                    = useState('');
  const [salvandoNome,      setSalvandoNome]                = useState(false);

  const carregarMembros = async () => {
    try {
      const res = await api.get('/equipes/membros');
      const dados = res.data?.dados ?? [];
      setMembros(dados);
      setEquipeId(res.data?.equipeId ?? null);
      setIsSocio(res.data?.isSocio ?? false);
      const nome = dados[0]?.equipe?.nome ?? '';
      setNomeEquipe(nome);
      setNovoNome(nome);
    } catch { setMembros([]); }
    finally { setLoading(false); }
  };

  const handleRenomearEquipe = async () => {
    if (!equipeId || !novoNome.trim() || novoNome.trim() === nomeEquipe) {
      setEditandoNome(false);
      return;
    }
    setSalvandoNome(true);
    try {
      await api.patch(`/equipes/${equipeId}/nome`, { nome: novoNome.trim() });
      setNomeEquipe(novoNome.trim());
      setEditandoNome(false);
      toast.success('Nome da equipe atualizado');
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao renomear equipe');
    } finally { setSalvandoNome(false); }
  };

  useEffect(() => { carregarMembros(); }, []);

  const handleIncluirMembro = async (values: UsuarioFormValues) => {
    setEnviando(true);
    try {
      await api.post('/equipes/incluir-membro', {
        email:       values.email,
        cargo:       values.perfil,
        fullName:    values.fullName,
        phone:       values.phone,
        cep:         values.cep.trim()         || null,
        endereco:    values.endereco.trim()    || null,
        complemento: values.complemento.trim() || null,
        bairro:      values.bairro.trim()      || null,
        cidade:      values.cidade.trim()      || null,
        estado:      values.estado.trim()      || null,
      });
      toast.success('Membro incluído com sucesso!');
      setShowConvite(false);
      carregarMembros();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao incluir membro');
    } finally { setEnviando(false); }
  };

  const handleToggle = async (membro: Membro) => {
    setTogglingId(membro.id);
    try {
      await api.patch(`/equipes/membros/${membro.id}/toggle`);
      toast.success(`${membro.user.fullName} ${membro.user.ativo === false ? 'ativado' : 'desativado'}`);
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

  const handleSalvarEdicao = async (values: UsuarioFormValues) => {
    if (!membroEditando) return;
    setSalvandoEdicao(true);
    try {
      await api.put(`/equipes/membros/${membroEditando.id}`, {
        fullName:    values.fullName,
        cargo:       values.perfil,
        phone:       values.phone,
        ativo:       values.ativo,
        senha:       values.senha || undefined,
        cep:         values.cep.trim()         || null,
        endereco:    values.endereco.trim()    || null,
        complemento: values.complemento.trim() || null,
        bairro:      values.bairro.trim()      || null,
        cidade:      values.cidade.trim()      || null,
        estado:      values.estado.trim()      || null,
      });
      toast.success('Perfil atualizado');
      setMembroEditando(null);
      carregarMembros();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao atualizar perfil');
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const membrosAtivos   = membros.filter(m => m.user.ativo !== false);
  const membrosInativos = membros.filter(m => m.user.ativo === false);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <PageContainer maxWidth="5xl">
      <BotaoVoltar className="mb-6" />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Users2 size={20} className="text-emerald-700" />
          </div>
          <div>
            {editandoNome ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={novoNome}
                  onChange={e => setNovoNome(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRenomearEquipe();
                    if (e.key === 'Escape') { setNovoNome(nomeEquipe); setEditandoNome(false); }
                  }}
                  className="text-xl font-bold text-gray-900 border-b-2 border-emerald-500 bg-transparent outline-none w-56"
                />
                <button onClick={handleRenomearEquipe} disabled={salvandoNome}
                  className="p-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
                  {salvandoNome ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                </button>
                <button onClick={() => { setNovoNome(nomeEquipe); setEditandoNome(false); }}
                  className="p-1 text-gray-400 hover:text-gray-600">
                  <X size={15} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-gray-900">
                  {nomeEquipe || 'Minha Equipe'}
                </h1>
                {isSocio && (
                  <button onClick={() => setEditandoNome(true)}
                    title="Renomear equipe"
                    className="p-1 text-gray-300 hover:text-emerald-600 transition-colors">
                    <Pencil size={14} />
                  </button>
                )}
              </div>
            )}
            <p className="text-sm text-gray-500 mt-0.5">
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
            <Mail size={16} /> Incluir Membro
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
              Incluir primeiro membro
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-50">
            {membros.map(m => {
              const ativo = m.user.ativo !== false;
              return (
                <div key={m.id} className={`flex items-center gap-4 px-5 py-4 transition-colors ${!ativo ? 'opacity-60 bg-gray-50/50' : ''}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                    ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {m.user.fullName?.[0]?.toUpperCase() ?? 'U'}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`font-semibold truncate ${ativo ? 'text-gray-900' : 'text-gray-500'}`}>{m.user.fullName}</p>
                      {m.user.id === user?.id && (
                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Você</span>
                      )}
                      {!ativo && (
                        <span className="text-[10px] font-bold bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">Inativo</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 truncate">{m.user.email}</p>
                  </div>

                  {/* Cargo editável para Sócio (apenas membros não-sócio) */}
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
                      className={`hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        ativo ? badgeCargo(m.cargo) : 'bg-gray-100 text-gray-400'
                      } ${isSocio && m.user.id !== user?.id && m.cargo !== 'SOCIO' ? 'cursor-pointer hover:opacity-80' : ''}`}
                      onClick={isSocio && m.user.id !== user?.id && m.cargo !== 'SOCIO' ? () => { setEditandoId(m.id); setEditCargo(m.cargo); } : undefined}
                      title={isSocio && m.user.id !== user?.id && m.cargo !== 'SOCIO' ? 'Clique para editar cargo' : undefined}
                    >
                      {labelCargo(m.cargo)}
                      {isSocio && m.user.id !== user?.id && m.cargo !== 'SOCIO' && <Pencil size={9} className="opacity-50" />}
                    </span>
                  )}

                  <p className="hidden md:block text-xs text-gray-400 flex-shrink-0">Desde {formatDate(m.createdAt)}</p>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isSocio && m.cargo !== 'SOCIO' && (
                      <button
                        onClick={() => setMembroEditando(m)}
                        className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg"
                        title="Editar perfil">
                        <Pencil size={15} />
                      </button>
                    )}
                    {m.user.id !== user?.id && (
                      <>
                        {isSocio && equipeId && m.cargo !== 'SOCIO' && (
                          <button onClick={() => setPermissoesModal(m)}
                            className="p-1.5 text-purple-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg" title="Controle de acesso">
                            <ShieldCheck size={15} />
                          </button>
                        )}
                        <button onClick={() => handleToggle(m)} disabled={togglingId === m.id}
                          title={ativo ? 'Desativar' : 'Ativar'}
                          className={`p-1.5 rounded-lg transition-colors ${
                            ativo
                              ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50'
                              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                          }`}>
                          {togglingId === m.id
                            ? <Loader2 size={15} className="animate-spin" />
                            : ativo ? <ToggleRight size={18} /> : <ToggleLeft size={18} />
                          }
                        </button>
                        {m.cargo !== 'SOCIO' && (
                          <button onClick={() => setConfirmRemover(m)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Remover">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal Permissões */}
      {permissoesModal && equipeId && (
        <PermissoesModal
          equipeId={equipeId}
          membroId={permissoesModal.user.id}
          membroNome={permissoesModal.user.fullName}
          onClose={() => setPermissoesModal(null)}
        />
      )}

      {/* Modal Incluir Membro */}
      {showConvite && (
        <UsuarioFormModal
          titulo="Incluir Membro"
          infoNota="A pessoa será adicionada imediatamente à equipe. Um e-mail de boas-vindas será enviado."
          textoBotao="Incluir"
          salvando={enviando}
          onClose={() => setShowConvite(false)}
          onSubmit={handleIncluirMembro}
        />
      )}

      {/* Modal Editar Membro — mesmo formulário do Incluir, com opção de senha */}
      {membroEditando && (
        <UsuarioFormModal
          titulo="Editar Membro"
          modoEdicao
          permitirSenha={isSocio}
          emailBloqueado
          textoBotao="Salvar"
          salvando={salvandoEdicao}
          onClose={() => setMembroEditando(null)}
          onSubmit={handleSalvarEdicao}
          initial={{
            fullName:    membroEditando.user.fullName,
            email:       membroEditando.user.email,
            phone:       membroEditando.user.phone       ?? '',
            perfil:      membroEditando.cargo,
            ativo:       membroEditando.user.ativo !== false,
            cep:         membroEditando.user.cep         ?? '',
            endereco:    membroEditando.user.endereco    ?? '',
            complemento: membroEditando.user.complemento ?? '',
            bairro:      membroEditando.user.bairro      ?? '',
            cidade:      membroEditando.user.cidade      ?? '',
            estado:      membroEditando.user.estado      ?? '',
          }}
        />
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

    </PageContainer>
  );
}
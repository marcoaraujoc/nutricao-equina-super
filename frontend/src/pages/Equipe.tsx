// src/pages/Equipe.tsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Users2, Mail, ToggleLeft, ToggleRight,
  Loader2, X, Search,
  Pencil, Check,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar   from '../components/BotaoVoltar';
import UsuarioFormModal, { type UsuarioFormValues } from '../components/UsuarioFormModal';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Membro {
  id:        number;
  cargo:     string;
  cargos?:   string[];
  createdAt: string;
  diasTrabalho?:       string | null;  // CSV 0-6
  horaInicioTrabalho?: string | null;  // HH:MM
  horaFimTrabalho?:    string | null;  // HH:MM
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
    fornecedorPerfil?: { tipoServico?: string | null } | null;
    especialidades?: Array<{ especialidadeId: number; especialidade?: { id: number; nome: string } }>;
  };
  equipe?: { nome: string };
}

// Perfis de acesso atribuíveis a membros da equipe
const CARGO_OPTIONS: { value: string; label: string }[] = [
  { value: 'VETERINARIO', label: 'Veterinário' },
  { value: 'ESTAGIARIO',  label: 'Estagiário'  },
  { value: 'ENFERMEIRO',  label: 'Enfermeiro'  },
  { value: 'SECRETARIA',  label: 'Secretaria'  },
  { value: 'FINANCEIRO',  label: 'Financeiro'  },
  { value: 'FORNECEDOR',  label: 'Fornecedor'  },
  { value: 'GESTOR',      label: 'Gestor'      },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const labelCargo = (cargo: string): string => ({
  GESTOR:       'Gestor',
  VETERINARIO:  'Veterinário',
  ESTAGIARIO:   'Estagiário',
  ENFERMEIRO:   'Enfermeiro',
  SECRETARIA:   'Secretaria',
  FINANCEIRO:   'Financeiro',
  FORNECEDOR:   'Fornecedor',
  ADMIN:        'Administrador',
  MEMBRO:       'Membro',
  PROPRIETARIO: 'Proprietário',
} as Record<string,string>)[cargo] ?? cargo;

const badgeCargo = (cargo: string): string => ({
  GESTOR:       'bg-purple-100 text-purple-700',
  VETERINARIO:  'bg-emerald-100 text-emerald-700',
  ESTAGIARIO:   'bg-blue-100 text-blue-700',
  ENFERMEIRO:   'bg-cyan-100 text-cyan-700',
  SECRETARIA:   'bg-amber-100 text-amber-700',
  FINANCEIRO:   'bg-orange-100 text-orange-700',
  FORNECEDOR:   'bg-teal-100 text-teal-700',
  ADMIN:        'bg-red-100 text-red-700',
  MEMBRO:       'bg-gray-100 text-gray-600',
  PROPRIETARIO: 'bg-purple-100 text-purple-700',
} as Record<string,string>)[cargo] ?? 'bg-gray-100 text-gray-600';

// ─── Componente ──────────────────────────────────────────────────────────────

export default function Equipe() {
  const { user }                                          = useAuth();
  const [membros,       setMembros]                       = useState<Membro[]>([]);
  const [equipeId,      setEquipeId]                      = useState<number | null>(null);
  const [isGestor,       setIsGestor]                       = useState(false);
  const [loading,       setLoading]                       = useState(true);
  const [showConvite,   setShowConvite]                   = useState(false);
  const [enviando,      setEnviando]                      = useState(false);
  const [togglingId,    setTogglingId]                    = useState<number | null>(null);
  const [filtroAtivo,   setFiltroAtivo]                   = useState<'all' | 'ativo' | 'inativo'>('ativo');
  const [busca,         setBusca]                         = useState('');
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
      setIsGestor(res.data?.isGestor ?? false);
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
        email:        values.email,
        cargo:        values.perfil,
        fullName:     values.fullName,
        phone:        values.phone,
        cep:          values.cep.trim()         || null,
        endereco:     values.endereco.trim()    || null,
        complemento:  values.complemento.trim() || null,
        bairro:       values.bairro.trim()      || null,
        cidade:       values.cidade.trim()      || null,
        estado:       values.estado.trim()      || null,
        fornecedorId: values.fornecedorId ?? null,
        tipoServico:  values.tipoServico  ?? null,
        especialidadeIds:   values.especialidadeIds ?? [],
        diasTrabalho:       values.diasTrabalho ?? [],
        horaInicioTrabalho: values.horaInicioTrabalho ?? '',
        horaFimTrabalho:    values.horaFimTrabalho ?? '',
        equipeId,  // inclui na equipe gerenciada nesta tela (não na do contexto ativo)
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

const handleSalvarEdicao = async (values: UsuarioFormValues) => {
    if (!membroEditando) return;
    setSalvandoEdicao(true);
    try {
      const cargos = values.cargos?.length ? values.cargos : [values.perfil];
      await api.put(`/equipes/membros/${membroEditando.id}`, {
        fullName:    values.fullName,
        email:       values.email.trim().toLowerCase(),
        cargo:       cargos[0],
        phone:       values.phone,
        ativo:       values.ativo,
        senha:       values.senha || undefined,
        cep:         values.cep.trim()         || null,
        endereco:    values.endereco.trim()    || null,
        complemento: values.complemento.trim() || null,
        bairro:      values.bairro.trim()      || null,
        cidade:      values.cidade.trim()      || null,
        estado:      values.estado.trim()      || null,
        diasTrabalho:       values.diasTrabalho ?? [],
        horaInicioTrabalho: values.horaInicioTrabalho ?? '',
        horaFimTrabalho:    values.horaFimTrabalho ?? '',
        ...(values.especialidadeIds !== undefined && { especialidadeIds: values.especialidadeIds }),
      });
      if (equipeId) {
        await api.patch(`/equipes/${equipeId}/membros/${membroEditando.user.id}/cargos`, { cargos });
      }
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
  const porStatus = filtroAtivo === 'all' ? membros
    : filtroAtivo === 'ativo' ? membrosAtivos
    : membrosInativos;
  const q = busca.trim().toLowerCase();
  const membrosVisiveis = q
    ? porStatus.filter(m =>
        m.user.fullName.toLowerCase().includes(q) ||
        m.user.email.toLowerCase().includes(q) ||
        (m.user.fornecedorPerfil?.tipoServico ?? '').toLowerCase().includes(q)
      )
    : porStatus;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2 mb-4">
        <div>
          {editandoNome ? (
            <div className="flex items-center gap-2">
              <Users2 size={24} className="text-emerald-600 flex-shrink-0" />
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
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Users2 size={24} className="text-emerald-600" />
              {nomeEquipe || 'Minha Equipe'}
              {isGestor && (
                <button onClick={() => setEditandoNome(true)}
                  title="Renomear equipe"
                  className="p-1 text-gray-300 hover:text-emerald-600 transition-colors">
                  <Pencil size={14} />
                </button>
              )}
            </h1>
          )}
          <p className="text-sm text-gray-500 mt-0.5">
            {membros.length > 0
              ? `${membrosAtivos.length} membro${membrosAtivos.length !== 1 ? 's' : ''} ativo${membrosAtivos.length !== 1 ? 's' : ''}`
              : 'Nenhum membro ainda'}
            {isGestor && <span className="ml-2 text-[10px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">Gestor</span>}
          </p>
        </div>
        {isGestor && (
          <button onClick={() => setShowConvite(true)}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold text-sm transition-colors">
            <Mail size={16} /> Incluir Membro
          </button>
        )}
      </div>

      {/* Busca + Filtro */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            name="busca-equipe"
            autoComplete="off"
            placeholder="Buscar por nome, e-mail ou tipo de serviço..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white transition-colors"
          />
          {busca && (
            <button onClick={() => setBusca('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex border border-gray-200 rounded-xl overflow-hidden text-sm flex-shrink-0">
          {(['all', 'ativo', 'inativo'] as const).map(v => (
            <button key={v} onClick={() => setFiltroAtivo(v)}
              className={`px-4 py-2.5 font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
                filtroAtivo === v ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}>
              {v === 'all' ? 'Todos' : v === 'ativo' ? 'Ativos' : 'Inativos'}
            </button>
          ))}
        </div>
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
          {isGestor && (
            <button onClick={() => setShowConvite(true)}
              className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold text-sm transition-colors">
              Incluir primeiro membro
            </button>
          )}
        </div>
      ) : membrosVisiveis.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
          <Users2 size={32} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-400">
            {busca ? `Nenhum membro encontrado para "${busca}".` : `Nenhum membro ${filtroAtivo === 'ativo' ? 'ativo' : 'inativo'} encontrado.`}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {membrosVisiveis.map(m => {
              const ativo = m.user.ativo !== false;
              const cargos = m.cargos?.length ? m.cargos : [m.cargo];
              return (
                <div key={m.id} className={`bg-white rounded-2xl border p-4 shadow-sm ${!ativo ? 'opacity-60' : 'border-gray-100'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900 truncate">{m.user.fullName}</p>
                        {m.user.id === user?.id && (
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Você</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{m.user.email}</p>
                      {m.user.phone && (
                        <p className="text-xs text-gray-500 mt-0.5">{m.user.phone}</p>
                      )}
                      {m.user.fornecedorPerfil?.tipoServico && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {m.user.fornecedorPerfil.tipoServico.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                            <span key={t} className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {cargos.map(c => (
                          <span key={c} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ativo ? badgeCargo(c) : 'bg-gray-100 text-gray-400'}`}>
                            {labelCargo(c)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  {(isGestor || m.user.id !== user?.id) && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                      {isGestor && m.cargo !== 'GESTOR' && (
                        <button onClick={() => setMembroEditando(m)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                          <Pencil size={11} /> Editar
                        </button>
                      )}
                      {m.user.id !== user?.id && (
                        <button onClick={() => handleToggle(m)} disabled={togglingId === m.id}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                          {togglingId === m.id
                            ? <Loader2 size={11} className="animate-spin" />
                            : ativo ? <ToggleRight size={11} className="text-emerald-600" /> : <ToggleLeft size={11} />
                          }
                          {ativo ? 'Desativar' : 'Ativar'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop */}
          <div className="hidden md:block bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo de Serviço</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Cargo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  {(isGestor) && <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {membrosVisiveis.map(m => {
                  const ativo = m.user.ativo !== false;
                  const cargos = m.cargos?.length ? m.cargos : [m.cargo];
                  return (
                    <tr key={m.id} className={`hover:bg-gray-50 transition-colors ${!ativo ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{m.user.fullName}</p>
                          {m.user.id === user?.id && (
                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Você</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 truncate">{m.user.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {m.user.fornecedorPerfil?.tipoServico
                            ? m.user.fornecedorPerfil.tipoServico.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                                <span key={t} className="text-[11px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">
                                  {t}
                                </span>
                              ))
                            : <span className="text-gray-300 text-xs">—</span>
                          }
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {cargos.map(c => (
                            <span key={c} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ativo ? badgeCargo(c) : 'bg-gray-100 text-gray-400'}`}>
                              {labelCargo(c)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                          {ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      {isGestor && (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {m.cargo !== 'GESTOR' && (
                              <button onClick={() => setMembroEditando(m)} title="Editar perfil"
                                className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                                <Pencil size={14} />
                              </button>
                            )}
                            {m.user.id !== user?.id && (
                              <button onClick={() => handleToggle(m)} disabled={togglingId === m.id}
                                title={ativo ? 'Desativar' : 'Ativar'}
                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                                {togglingId === m.id
                                  ? <Loader2 size={14} className="animate-spin" />
                                  : ativo ? <ToggleRight size={14} className="text-emerald-600" /> : <ToggleLeft size={14} />
                                }
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Modal Incluir Membro */}
      {showConvite && (
        <UsuarioFormModal
          titulo="Incluir Membro"
          equipeId={equipeId}
          infoNota="A pessoa será adicionada imediatamente à equipe. Um e-mail de boas-vindas será enviado."
          textoBotao="Incluir"
          comFornecedor
          comExpediente
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
          equipeId={equipeId}
          permitirSenha={isGestor}
          ocultarPerfil
          comExpediente
          textoBotao="Salvar"
          salvando={salvandoEdicao}
          onClose={() => setMembroEditando(null)}
          onSubmit={handleSalvarEdicao}
          initial={{
            fullName:    membroEditando.user.fullName,
            email:       membroEditando.user.email,
            phone:       membroEditando.user.phone       ?? '',
            perfil:      membroEditando.cargo,
            cargos:      membroEditando.cargos?.length ? membroEditando.cargos : [membroEditando.cargo],
            ativo:       membroEditando.user.ativo !== false,
            cep:         membroEditando.user.cep         ?? '',
            endereco:    membroEditando.user.endereco    ?? '',
            complemento: membroEditando.user.complemento ?? '',
            bairro:      membroEditando.user.bairro      ?? '',
            cidade:      membroEditando.user.cidade      ?? '',
            estado:      membroEditando.user.estado      ?? '',
            diasTrabalho:       membroEditando.diasTrabalho
              ? String(membroEditando.diasTrabalho).split(',').map(Number).filter(n => n >= 0 && n <= 6)
              : [],
            horaInicioTrabalho: membroEditando.horaInicioTrabalho ?? '',
            horaFimTrabalho:    membroEditando.horaFimTrabalho    ?? '',
            especialidadeIds:   (membroEditando.user.especialidades ?? []).map(e => e.especialidadeId),
          }}
        />
      )}
    </PageContainer>
  );
}
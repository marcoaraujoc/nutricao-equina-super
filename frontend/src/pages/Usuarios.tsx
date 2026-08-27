// src/pages/Usuarios.tsx

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import axios from 'axios';
import {
  Pencil, Trash2,
  ToggleLeft, ToggleRight,
  Building2, Users2, AlertCircle, X, Lock, Loader2,
} from 'lucide-react';
import BotaoVoltar from '../components/BotaoVoltar';
import { useAuth } from '../contexts/AuthContext';
import UsuarioFormModal, { type UsuarioFormValues } from '../components/UsuarioFormModal';
import { formatDate as formatarDataBR } from '../utils/dateUtils';
import InlineError from '../components/InlineError';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Vinculo {
  cargos:      string[];
  equipeNome:  string | null;
  empresaId:   number | null;
  empresaNome: string | null;
  dono:        boolean;
}

interface Usuario {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  userType: string;
  cargoEquipe: string | null;
  equipeNome: string | null;
  empresaNome: string | null;
  vinculos?: Vinculo[];
  ativo: boolean;
  /** Conta travada por 6 senhas erradas (lib/bloqueioLogin.js). null = liberada.
   *  Distinto de `ativo`: inativo é decisão de alguém; bloqueado é consequência de
   *  tentativa de acesso. O ADMIN é o ÚNICO que destrava a conta de um GESTOR. */
  bloqueadoEm?: string | null;
  tentativasLogin?: number;
  createdAt: string;
  cep: string | null;
  endereco: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
}

// Perfil de acesso (select do formulário) → userType persistido
const PERFIL_TO_USERTYPE: Record<string, string> = {
  VETERINARIO:  'VETERINARIO',
  ESTAGIARIO:   'ESTAGIARIO',
  FORNECEDOR:   'FORNECEDOR',
  GESTOR:        'VETERINARIO',
  PROPRIETARIO: 'PROPRIETARIO',
  ADMIN:        'ADMIN',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Mesmos badges/labels do Controle de Acesso
const badgeCargo = (cargo: string) =>
  ({ VETERINARIO: 'bg-emerald-100 text-emerald-700', ESTAGIARIO: 'bg-blue-100 text-blue-700',
     ADMIN: 'bg-red-100 text-red-700', MEMBRO: 'bg-gray-100 text-gray-600',
     GESTOR: 'bg-purple-100 text-purple-700', PROPRIETARIO: 'bg-amber-100 text-amber-700',
     FORNECEDOR: 'bg-teal-100 text-teal-700', SECRETARIA: 'bg-amber-100 text-amber-700',
     FINANCEIRO: 'bg-orange-100 text-orange-700', ENFERMEIRO: 'bg-cyan-100 text-cyan-700',
  } as Record<string, string>)[cargo] ?? 'bg-gray-100 text-gray-600';

const CARGO_LABEL: Record<string, string> = {
  GESTOR: 'Gestor', VETERINARIO: 'Veterinário', ESTAGIARIO: 'Estagiário',
  FORNECEDOR: 'Fornecedor', PROPRIETARIO: 'Proprietário', SECRETARIA: 'Secretária',
  FINANCEIRO: 'Financeiro', ENFERMEIRO: 'Enfermeiro(a)', ADMIN: 'Administrador',
};

function BadgePerfil({ cargo }: { cargo: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeCargo(cargo)}`}>
      {(CARGO_LABEL[cargo] ?? cargo).toUpperCase()}
    </span>
  );
}

// Todos os perfis do usuário com as respectivas equipes/empresas
function PerfisEquipes({ u }: { u: Usuario }) {
  const vinculos = u.vinculos ?? [];
  const isAdmin  = u.role === 'ADMIN';
  if (!isAdmin && vinculos.length === 0) {
    // Sem equipe (ex: proprietário, vet autônomo) — mostra o tipo do usuário
    return <BadgePerfil cargo={u.userType} />;
  }
  return (
    <div className="space-y-1.5">
      {isAdmin && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <BadgePerfil cargo="ADMIN" />
          <span className="text-xs text-gray-400">Plataforma</span>
        </div>
      )}
      {vinculos.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5 flex-wrap">
          {v.cargos.map(c => <BadgePerfil key={c} cargo={c} />)}
          <span className="flex items-center gap-1 text-xs text-gray-500">
            {v.equipeNome && <><Users2 size={11} className="text-gray-400 flex-shrink-0" />{v.equipeNome}</>}
            {v.empresaNome && (
              <>
                {v.equipeNome && <span className="text-gray-300">·</span>}
                <Building2 size={11} className="text-indigo-400 flex-shrink-0" />
                {v.empresaNome}{v.dono ? ' (dono)' : ''}
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

// userType/cargo do usuário → valor do select "Perfil de acesso"
const perfilDoUsuario = (u: Usuario): string =>
  u.cargoEquipe === 'GESTOR' ? 'GESTOR'
  : u.userType === 'FORNECEDOR' ? 'FORNECEDOR'
  : u.userType;

// ─── Componente ───────────────────────────────────────────────────────────────

const Usuarios = () => {
  const [usuarios,    setUsuarios]    = useState<Usuario[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [filtroAtivo, setFiltroAtivo] = useState<'todos' | 'ativos' | 'inativos'>('todos');
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [editando,    setEditando]    = useState<Usuario | null>(null);
  const [salvando,    setSalvando]    = useState(false);
  const [erroModal,   setErroModal]   = useState<string | null>(null);
  const [paraExcluir, setParaExcluir] = useState<Usuario | null>(null);
  // Erro fica na SUPERFÍCIE da ação: `erroLinha` na linha do usuário (ativar/inativar)
  // e `erroExclusao` dentro do modal, junto do botão que confirma.
  // Quem está logado — o botão de desbloquear não aparece na PRÓPRIA linha: o
  // backend recusa autodesbloqueio (`AUTO_DESBLOQUEIO`), e oferecer o botão ali
  // seria um clique que só falha depois de dado.
  const { user } = useAuth();
  const [erroLinha,    setErroLinha]    = useState<{ userId: number; mensagem: string } | null>(null);
  const [desbloqueandoId, setDesbloqueandoId] = useState<number | null>(null);
  const [erroExclusao, setErroExclusao] = useState<string | null>(null);
  const [excluindo,    setExcluindo]    = useState(false);

  // ── Loaders ──────────────────────────────────────────────────────────────

  const carregarUsuarios = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/users');
      setUsuarios(res.data?.dados ?? res.data ?? []);
    } catch (err) {
      console.error(err);
      setErroInline('Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregarUsuarios(); }, [carregarUsuarios]);

  // ── Filtro ────────────────────────────────────────────────────────────────

  const filtrados = usuarios.filter(u => {
    const termo = search.toLowerCase();
    const matchTexto = u.fullName.toLowerCase().includes(termo)
      || u.email.toLowerCase().includes(termo)
      || (u.cidade ?? '').toLowerCase().includes(termo);
    const matchAtivo = filtroAtivo === 'todos' ? true
      : filtroAtivo === 'ativos' ? u.ativo : !u.ativo;
    return matchTexto && matchAtivo;
  });

  // ── Modal ─────────────────────────────────────────────────────────────────

  const abrirNovo = () => {
    setEditando(null);
    setModalAberto(true);
  };

  const abrirEditar = (u: Usuario) => {
    setEditando(u);
    setModalAberto(true);
  };

  const fecharModal = () => {
    setModalAberto(false);
    setEditando(null);
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (values: UsuarioFormValues) => {
    setErroModal(null);
    setSalvando(true);
    try {
      // Sem senha na criação: o backend aplica a padrão (Inicial_001)
      // com troca obrigatória no primeiro acesso.
      const payload: Record<string, unknown> = {
        fullName:    values.fullName,
        email:       values.email,
        phone:       values.phone,
        role:        editando?.role ?? 'USER',
        userType:    PERFIL_TO_USERTYPE[values.perfil] ?? values.perfil,
        ativo:       values.ativo,
        cep:         values.cep.trim()         || null,
        endereco:    values.endereco.trim()    || null,
        complemento: values.complemento.trim() || null,
        bairro:      values.bairro.trim()      || null,
        cidade:      values.cidade.trim()      || null,
        estado:      values.estado.trim()      || null,
      };
      // `senha` NUNCA entra no payload: o campo saiu da tela e a edição pelo ADMIN
      // não troca a senha de ninguém. Enviá-la "por via das dúvidas" reabriria pelo
      // corpo da requisição exatamente o que foi retirado da interface.

      if (editando) {
        await api.put(`/users/${editando.id}`, payload);
        toast.success('Usuário atualizado!');
      } else {
        await api.post('/users', payload);
        toast.success('Usuário criado — e-mail de boas-vindas enviado');
      }
      fecharModal();
      carregarUsuarios();
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.mensagem ?? 'Erro ao salvar'
        : 'Erro inesperado';
      // Modal aberto: a mensagem vai PARA ELE (o topo da página fica atrás do overlay).
      // O desvio de mensagens com "senha" para um campo próprio saiu junto com o campo:
      // sem ele na tela, o erro sumiria — o modal exibe o do rodapé, e só.
      setErroModal(msg);
    } finally {
      setSalvando(false);
    }
  };

  // Mensagem do backend (409/400 trazem o motivo real — ex.: usuário é dono de
  // empresa e precisa transferir a gestão antes) com fallback genérico.
  const msgErro = (err: unknown, padrao: string): string =>
    (err as { response?: { data?: { mensagem?: string; error?: string } } })?.response?.data?.mensagem
    ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    ?? padrao;

  // ── Toggle ativo ──────────────────────────────────────────────────────────

  const handleToggle = async (u: Usuario) => {
    setErroLinha(null);
    try {
      await api.patch(`/users/${u.id}/toggle`);
      toast.success(u.ativo ? 'Usuário inativado' : 'Usuário ativado');
      carregarUsuarios();
    } catch (err: unknown) {
      // Erro NA LINHA do usuário — o topo da página fica longe do botão clicado.
      setErroLinha({ userId: u.id, mensagem: msgErro(err, 'Erro ao alterar status') });
    }
  };

  /** Desbloqueia a conta travada por senha errada. O ADMIN alcança qualquer conta —
   *  inclusive a de gestor, que é justamente a que só ele pode destravar. */
  const handleDesbloquear = async (u: Usuario) => {
    setErroLinha(null);
    setDesbloqueandoId(u.id);
    try {
      await api.post(`/equipes/membros/${u.id}/desbloquear`);
      toast.success(`Conta de ${u.fullName} desbloqueada`);
      carregarUsuarios();
    } catch (err: unknown) {
      setErroLinha({ userId: u.id, mensagem: msgErro(err, 'Erro ao desbloquear a conta') });
    } finally {
      setDesbloqueandoId(null);
    }
  };

  // ── Excluir ───────────────────────────────────────────────────────────────

  const confirmarExclusao = async () => {
    if (!paraExcluir) return;
    setErroExclusao(null);
    setExcluindo(true);
    try {
      await api.delete(`/users/${paraExcluir.id}`);
      toast.success('Usuário excluído');
      setParaExcluir(null);
      carregarUsuarios();
    } catch (err: unknown) {
      // Fica DENTRO do modal, junto do "Sim, Excluir" — é onde o usuário está
      // olhando. Mostra a mensagem do backend (ex.: 409 de dono de empresa, que
      // lista as empresas a transferir), não um genérico.
      setErroExclusao(msgErro(err, 'Erro ao excluir usuário'));
    } finally { setExcluindo(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-7xl mx-auto px-4">

        <BotaoVoltar className="mb-6" />

        <InlineError message={erroInline} className="mb-4" />

        {/* Header — título à esquerda, ação à direita (mesmo padrão de Equipe e
            Controle de Acesso). No mobile a ação desce e ocupa a largura toda. */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Users2 size={20} className="text-emerald-700" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Usuários</h1>
              <p className="text-sm text-gray-500">Gestão de usuários do sistema.</p>
            </div>
          </div>
          <button onClick={abrirNovo}
            className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold transition-colors text-sm w-full sm:w-auto flex-shrink-0">
            Novo Usuário
          </button>
        </div>

        {/* Filtros + Busca */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="flex gap-2">
            {(['todos','ativos','inativos'] as const).map(f => (
              <button key={f} onClick={() => setFiltroAtivo(f)}
                className={`px-4 py-2.5 rounded-3xl text-sm font-medium capitalize transition-colors ${
                  filtroAtivo === f ? 'bg-emerald-700 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:border-emerald-500'
                }`}>{f}</button>
            ))}
          </div>
          <div className="flex-1">
            <input type="text" placeholder="Buscar por nome, e-mail ou cidade..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-3xl px-5 py-2.5 text-gray-900 bg-white focus:outline-none focus:border-emerald-600 text-sm" />
          </div>
        </div>

        {/* Tabela */}
        {loading ? (
          <p className="text-center text-gray-500 py-12">Carregando...</p>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full min-w-[960px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Usuário</th>
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Perfis e Equipes</th>
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Cidade/UF</th>
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Cadastro</th>
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtrados.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-400">
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                ) : filtrados.flatMap(u => ([
                  <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                          {u.fullName?.[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{u.fullName}</p>
                          <p className="text-xs text-gray-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <PerfisEquipes u={u} />
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-500 whitespace-nowrap">
                      {u.cidade ? `${u.cidade}${u.estado ? `/${u.estado}` : ''}` : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-500 whitespace-nowrap">{formatarDataBR(u.createdAt)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button onClick={() => handleToggle(u)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                            u.ativo
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-red-50 text-red-600 hover:bg-red-100'
                          }`}>
                          {u.ativo ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                          {u.ativo ? 'Ativo' : 'Desativado'}
                        </button>
                        {/* BLOQUEADO convive com Ativo/Inativo: são estados diferentes.
                            Clicar destrava (o backend confere a autorização de novo). */}
                        {u.bloqueadoEm && u.id !== user?.id && (
                          <button onClick={() => handleDesbloquear(u)} disabled={desbloqueandoId === u.id}
                            title={`Bloqueada em ${formatarDataBR(u.bloqueadoEm)} após ${u.tentativasLogin ?? 0} tentativa(s) de senha inválida — clique para desbloquear`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-50">
                            {desbloqueandoId === u.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Lock size={14} />}
                            Bloqueado
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => abrirEditar(u)}
                          className="p-1.5 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors" title="Editar">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => { setErroLinha(null); setErroExclusao(null); setParaExcluir(u); }}
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Excluir">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>,
                  // Erro da ação NA LINHA em que ela foi disparada
                  erroLinha?.userId === u.id && (
                    <tr key={`erro-${u.id}`}>
                      <td colSpan={6} className="px-5 pb-3 pt-0">
                        <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
                          <AlertCircle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
                          <span className="text-xs text-red-700 leading-snug">{erroLinha.mensagem}</span>
                          <button onClick={() => setErroLinha(null)}
                            className="ml-auto text-red-400 hover:text-red-600 flex-shrink-0">
                            <X size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ),
                ]))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filtrados.length > 0 && (
          <p className="text-center text-sm text-gray-400 mt-4">
            {filtrados.length} {filtrados.length === 1 ? 'usuário encontrado' : 'usuários encontrados'}
          </p>
        )}

      </div>

      {/* ── Modal criar / editar ───────────────────────────────────────────────
          Tela ADMIN-only (as rotas /users/:id exigem authorize('ADMIN')).
          ⚠️ SEM campo de senha (2026-08-04): senha é da PESSOA, e nem o ADMIN a
          troca por ela pela tela. Os caminhos que restam são os do próprio dono —
          "esqueci minha senha" e a troca em Cadastro Pessoal — e a padrão
          `Inicial_001` + troca obrigatória no primeiro acesso, para conta nova.
          Não reintroduzir `permitirSenha` aqui. */}
      {modalAberto && (
        <UsuarioFormModal
          titulo={editando ? 'Editar Usuário' : 'Novo Usuário'}
          modoEdicao={!!editando}
          erroServidor={erroModal}
          salvando={salvando}
          onClose={fecharModal}
          onSubmit={handleSubmit}
          initial={editando ? {
            fullName:    editando.fullName,
            email:       editando.email,
            phone:       editando.phone       ?? '',
            perfil:      perfilDoUsuario(editando),
            ativo:       editando.ativo,
            cep:         editando.cep         ?? '',
            endereco:    editando.endereco    ?? '',
            complemento: editando.complemento ?? '',
            bairro:      editando.bairro      ?? '',
            cidade:      editando.cidade      ?? '',
            estado:      editando.estado      ?? '',
          } : undefined}
        />
      )}

      {/* ── Modal exclusão ───────────────────────────────────────────────────── */}
      {paraExcluir && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-md w-full max-w-md overflow-hidden">
            <div className="bg-emerald-700 text-white px-6 py-5 text-center">
              <h2 className="text-lg font-bold">Excluir usuário?</h2>
              <p className="text-emerald-100 text-sm mt-1">
                Tem certeza que deseja excluir <strong>{paraExcluir.fullName}</strong>?
                Esta ação não pode ser desfeita.
              </p>
            </div>
            <div className="p-6 space-y-3">
              {/* Erro do backend AQUI, colado no botão que o usuário clicou */}
              {erroExclusao && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-red-700 leading-snug">{erroExclusao}</span>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => { setParaExcluir(null); setErroExclusao(null); }}
                  className="flex-1 py-3 border border-gray-300 rounded-2xl text-gray-700 font-medium hover:bg-gray-50 transition-colors text-sm">
                  {erroExclusao ? 'Fechar' : 'Cancelar'}
                </button>
                <button onClick={confirmarExclusao} disabled={excluindo}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-2xl font-semibold transition-colors text-sm">
                  {excluindo ? 'Excluindo...' : 'Sim, Excluir'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Usuarios;

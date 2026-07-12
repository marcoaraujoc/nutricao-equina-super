// src/pages/Usuarios.tsx

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import axios from 'axios';
import {
  Pencil, Trash2,
  ToggleLeft, ToggleRight,
  Building2, Users2,
} from 'lucide-react';
import BotaoVoltar from '../components/BotaoVoltar';
import UsuarioFormModal, { type UsuarioFormValues } from '../components/UsuarioFormModal';
import { formatDate as formatarDataBR } from '../utils/dateUtils';

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
  createdAt: string;
  cep: string | null;
  endereco: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
}

const ROLES = [
  { value: 'USER',  label: 'Usuário'         },
  { value: 'ADMIN', label: 'Administrador'   },
];

const USER_TYPES = [
  { value: 'PROPRIETARIO', label: 'Proprietário'  },
  { value: 'VETERINARIO',  label: 'Veterinário'   },
  { value: 'ESTAGIARIO',   label: 'Estagiário'    },
  { value: 'FORNECEDOR',   label: 'Fornecedor'    },
  { value: 'ADMIN',        label: 'Administrador' },
];

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

const labelUserType = (t: string) => USER_TYPES.find(x => x.value === t)?.label ?? t;

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
  const [modalAberto, setModalAberto] = useState(false);
  const [editando,    setEditando]    = useState<Usuario | null>(null);
  const [salvando,    setSalvando]    = useState(false);
  const [paraExcluir, setParaExcluir] = useState<Usuario | null>(null);

  // ── Loaders ──────────────────────────────────────────────────────────────

  const carregarUsuarios = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/users');
      setUsuarios(res.data?.dados ?? res.data ?? []);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar usuários');
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
      if (editando && values.senha) payload.senha = values.senha;

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
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  };

  // ── Toggle ativo ──────────────────────────────────────────────────────────

  const handleToggle = async (u: Usuario) => {
    try {
      await api.patch(`/users/${u.id}/toggle`);
      toast.success(u.ativo ? 'Usuário inativado' : 'Usuário ativado');
      carregarUsuarios();
    } catch {
      toast.error('Erro ao alterar status');
    }
  };

  // ── Excluir ───────────────────────────────────────────────────────────────

  const confirmarExclusao = async () => {
    if (!paraExcluir) return;
    try {
      await api.delete(`/users/${paraExcluir.id}`);
      toast.success('Usuário excluído');
      setParaExcluir(null);
      carregarUsuarios();
    } catch {
      toast.error('Erro ao excluir usuário');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-7xl mx-auto px-4">

        <BotaoVoltar className="mb-6" />

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Users2 size={20} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Usuários</h1>
            <p className="text-sm text-gray-500">Gestão de usuários do sistema.</p>
          </div>
        </div>

        {/* Botão */}
        <div className="mb-3">
          <button onClick={abrirNovo}
            className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold transition-colors text-sm w-full sm:w-auto">
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
                ) : filtrados.map(u => (
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
                      <button onClick={() => handleToggle(u)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                          u.ativo
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-red-50 text-red-600 hover:bg-red-100'
                        }`}>
                        {u.ativo ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                        {u.ativo ? 'Ativo' : 'Desativado'}
                      </button>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => abrirEditar(u)}
                          className="p-1.5 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors" title="Editar">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setParaExcluir(u)}
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Excluir">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
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

      {/* ── Modal criar / editar ─────────────────────────────────────────────── */}
      {modalAberto && (
        <UsuarioFormModal
          titulo={editando ? 'Editar Usuário' : 'Novo Usuário'}
          modoEdicao={!!editando}
          permitirSenha={!!editando}
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
            <div className="p-6 flex gap-3">
              <button onClick={() => setParaExcluir(null)}
                className="flex-1 py-3 border border-gray-300 rounded-2xl text-gray-700 font-medium hover:bg-gray-50 transition-colors text-sm">
                Cancelar
              </button>
              <button onClick={confirmarExclusao}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-semibold transition-colors text-sm">
                Sim, Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Usuarios;

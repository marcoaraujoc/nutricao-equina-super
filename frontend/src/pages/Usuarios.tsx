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
  PRESTADOR:    'FORNECEDOR',
  SOCIO:        'VETERINARIO',
  PROPRIETARIO: 'PROPRIETARIO',
  ADMIN:        'ADMIN',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const labelRole     = (r: string) => ROLES.find(x => x.value === r)?.label     ?? r;
const labelUserType = (t: string) => USER_TYPES.find(x => x.value === t)?.label ?? t;

// userType/cargo do usuário → valor do select "Perfil de acesso"
const perfilDoUsuario = (u: Usuario): string =>
  u.cargoEquipe === 'SOCIO' ? 'SOCIO'
  : u.userType === 'FORNECEDOR' ? 'PRESTADOR'
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

        <BotaoVoltar className="mb-4 mt-6" />

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Usuários</h1>
          <button onClick={abrirNovo}
            className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold transition-colors text-sm w-full sm:w-auto">
            Novo Usuário
          </button>
        </div>

        {/* Filtros */}
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
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Nome</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">E-mail</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Perfil</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Tipo</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Empresa/Equipe</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Cidade/UF</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Cadastro</th>
                  <th className="text-center px-6 py-4 text-sm font-medium text-gray-500">Status</th>
                  <th className="text-right px-6 py-4 text-sm font-medium text-gray-500">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-gray-400">
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                ) : filtrados.map(u => (
                  <tr key={u.id} className="border-t hover:bg-gray-50">
                    <td className="px-6 py-4 font-semibold text-gray-900">{u.fullName}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{u.email}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        u.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                      }`}>{labelRole(u.role)}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {u.cargoEquipe === 'SOCIO'
                        ? <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">Sócio</span>
                        : labelUserType(u.userType)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {u.cargoEquipe === 'SOCIO' ? (
                        u.empresaNome
                          ? <span className="flex items-center gap-1 text-xs text-gray-500"><Building2 size={11} className="text-indigo-500 flex-shrink-0" />{u.empresaNome}</span>
                          : '—'
                      ) : u.equipeNome ? (
                        <span className="flex items-center gap-1 text-xs text-gray-500"><Users2 size={11} className="text-gray-400 flex-shrink-0" />{u.equipeNome}</span>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {u.cidade ? `${u.cidade}${u.estado ? `/${u.estado}` : ''}` : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{formatarDataBR(u.createdAt)}</td>
                    <td className="px-6 py-4 text-center">
                      <button onClick={() => handleToggle(u)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          u.ativo
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}>
                        {u.ativo ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                        {u.ativo ? 'Ativo' : 'Inativo'}
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-3">
                        <button onClick={() => abrirEditar(u)}
                          className="text-emerald-600 hover:text-emerald-700" title="Editar">
                          <Pencil size={18} />
                        </button>
                        <button onClick={() => setParaExcluir(u)}
                          className="text-red-500 hover:text-red-700" title="Excluir">
                          <Trash2 size={18} />
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

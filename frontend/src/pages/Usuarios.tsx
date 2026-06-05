// src/pages/Usuarios.tsx

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import axios from 'axios';
import {
  Pencil, Trash2,
  ToggleLeft, ToggleRight, X, AlertCircle,
  Building2, Users2,
} from 'lucide-react';
import BotaoVoltar from '../components/BotaoVoltar';
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

interface FormUsuario {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  userType: string;
  senha: string;
  ativo: boolean;
  cep: string;
  endereco: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
}

const FORM_INICIAL: FormUsuario = {
  fullName: '', email: '', phone: '', role: 'USER',
  userType: 'PROPRIETARIO', senha: '', ativo: true,
  cep: '', endereco: '', complemento: '', bairro: '', cidade: '', estado: '',
};

const ROLES = [
  { value: 'USER',  label: 'Usuário'         },
  { value: 'ADMIN', label: 'Administrador'   },
];

const USER_TYPES = [
  { value: 'PROPRIETARIO', label: 'Proprietário' },
  { value: 'VETERINARIO',  label: 'Veterinário'  },
  { value: 'ADMIN',        label: 'Administrador' },
];

const ESTADOS_BR = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA',
  'MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN',
  'RS','RO','RR','SC','SP','SE','TO',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const labelRole     = (r: string) => ROLES.find(x => x.value === r)?.label     ?? r;
const labelUserType = (t: string) => USER_TYPES.find(x => x.value === t)?.label ?? t;

// ─── Componente ───────────────────────────────────────────────────────────────

const Usuarios = () => {
  const [usuarios,    setUsuarios]    = useState<Usuario[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [filtroAtivo, setFiltroAtivo] = useState<'todos' | 'ativos' | 'inativos'>('todos');
  const [modalAberto, setModalAberto] = useState(false);
  const [editandoId,  setEditandoId]  = useState<number | null>(null);
  const [form,        setForm]        = useState<FormUsuario>(FORM_INICIAL);
  const [salvando,    setSalvando]    = useState(false);
  const [paraExcluir, setParaExcluir] = useState<Usuario | null>(null);
  const [abaModal,    setAbaModal]    = useState<'dados' | 'endereco'>('dados');

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
    setEditandoId(null);
    setForm(FORM_INICIAL);
    setAbaModal('dados');
    setModalAberto(true);
  };

  const abrirEditar = (u: Usuario) => {
    setEditandoId(u.id);
    setForm({
      fullName:    u.fullName,
      email:       u.email,
      phone:       u.phone       ?? '',
      role:        u.role,
      userType:    u.userType,
      senha:       '',
      ativo:       u.ativo,
      cep:         u.cep         ?? '',
      endereco:    u.endereco    ?? '',
      complemento: u.complemento ?? '',
      bairro:      u.bairro      ?? '',
      cidade:      u.cidade      ?? '',
      estado:      u.estado      ?? '',
    });
    setAbaModal('dados');
    setModalAberto(true);
  };

  const fecharModal = () => {
    setModalAberto(false);
    setEditandoId(null);
    setForm(FORM_INICIAL);
  };

  const set = (field: keyof FormUsuario, value: string | boolean) =>
    setForm(prev => ({ ...prev, [field]: value }));

  // ── Busca CEP ─────────────────────────────────────────────────────────────

  const buscarCep = async () => {
    const cep = form.cep.replace(/\D/g, '');
    if (cep.length !== 8) { toast.error('CEP inválido'); return; }
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data.erro) { toast.error('CEP não encontrado'); return; }
      setForm(prev => ({
        ...prev,
        endereco: data.logradouro ?? '',
        bairro:   data.bairro    ?? '',
        cidade:   data.localidade ?? '',
        estado:   data.uf        ?? '',
      }));
    } catch {
      toast.error('Erro ao buscar CEP');
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!form.fullName.trim()) { toast.error('Informe o nome');   return; }
    if (!form.email.trim())    { toast.error('Informe o e-mail'); return; }
    if (!editandoId && !form.senha) { toast.error('Informe a senha'); return; }

    setSalvando(true);
    try {
      const payload: Record<string, unknown> = {
        fullName:    form.fullName.trim(),
        email:       form.email.trim(),
        phone:       form.phone.trim()       || null,
        role:        form.role,
        userType:    form.userType,
        ativo:       form.ativo,
        cep:         form.cep.trim()         || null,
        endereco:    form.endereco.trim()    || null,
        complemento: form.complemento.trim() || null,
        bairro:      form.bairro.trim()      || null,
        cidade:      form.cidade.trim()      || null,
        estado:      form.estado.trim()      || null,
      };
      if (form.senha) payload.senha = form.senha;

      if (editandoId) {
        await api.put(`/users/${editandoId}`, payload);
        toast.success('Usuário atualizado!');
      } else {
        await api.post('/users', payload);
        toast.success('Usuário criado!');
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

  const inputClass  = 'w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-emerald-600 text-sm bg-white';
  const selectClass = 'w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-emerald-600 text-sm bg-white';
  const labelClass  = 'block text-xs font-medium text-gray-600 mb-1';

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
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-md w-full max-w-lg overflow-hidden">

            {/* Header */}
            <div className="bg-emerald-700 text-white px-6 py-5 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {editandoId ? 'Editar Usuário' : 'Novo Usuário'}
              </h2>
              <button onClick={fecharModal} className="hover:opacity-70 transition-opacity">
                <X size={22} />
              </button>
            </div>

            {/* Abas */}
            <div className="flex border-b border-gray-100">
              {(['dados','endereco'] as const).map(aba => (
                <button key={aba} onClick={() => setAbaModal(aba)}
                  className={`flex-1 py-3 text-sm font-medium capitalize transition-colors ${
                    abaModal === aba
                      ? 'border-b-2 border-emerald-600 text-emerald-700'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {aba === 'dados' ? 'Dados pessoais' : 'Endereço'}
                </button>
              ))}
            </div>

            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">

              {/* ── Aba: Dados pessoais ────────────────────────────────────── */}
              {abaModal === 'dados' && (
                <>
                  <div>
                    <label className={labelClass}>Nome completo <span className="text-red-400">*</span></label>
                    <input type="text" value={form.fullName}
                      onChange={e => set('fullName', e.target.value)}
                      placeholder="Nome do usuário" className={inputClass} />
                  </div>

                  <div>
                    <label className={labelClass}>E-mail <span className="text-red-400">*</span></label>
                    <input type="email" value={form.email}
                      onChange={e => set('email', e.target.value)}
                      placeholder="email@exemplo.com" className={inputClass} />
                  </div>

                  <div>
                    <label className={labelClass}>Telefone</label>
                    <input type="text" value={form.phone}
                      onChange={e => set('phone', e.target.value)}
                      placeholder="(00) 00000-0000" className={inputClass} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Perfil de acesso</label>
                      <select value={form.role} onChange={e => set('role', e.target.value)} className={selectClass}>
                        {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Tipo de usuário</label>
                      <select value={form.userType} onChange={e => set('userType', e.target.value)} className={selectClass}>
                        {USER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>
                      {editandoId ? 'Nova senha (deixe em branco para manter)' : 'Senha *'}
                    </label>
                    <input type="password" value={form.senha}
                      onChange={e => set('senha', e.target.value)}
                      placeholder={editandoId ? 'Nova senha...' : 'Senha inicial'}
                      className={inputClass} />
                    {editandoId && (
                      <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-400">
                        <AlertCircle size={12} />
                        Deixe em branco para não alterar a senha atual.
                      </div>
                    )}
                  </div>

                  {editandoId && (
                    <div className="flex items-center gap-3 pt-1">
                      <input type="checkbox" id="ativo-modal" checked={form.ativo}
                        onChange={e => set('ativo', e.target.checked)}
                        className="w-4 h-4 accent-emerald-600" />
                      <label htmlFor="ativo-modal" className="text-sm font-medium text-gray-700">
                        Usuário ativo
                      </label>
                    </div>
                  )}
                </>
              )}

              {/* ── Aba: Endereço ─────────────────────────────────────────── */}
              {abaModal === 'endereco' && (
                <>
                  {/* CEP com busca automática */}
                  <div>
                    <label className={labelClass}>CEP</label>
                    <div className="flex gap-2">
                      <input type="text" value={form.cep}
                        onChange={e => set('cep', e.target.value)}
                        onBlur={buscarCep}
                        placeholder="00000-000"
                        className={`${inputClass} flex-1`} />
                      <button onClick={buscarCep}
                        className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm rounded-2xl font-medium transition-colors flex-shrink-0">
                        Buscar
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Endereço</label>
                    <input type="text" value={form.endereco}
                      onChange={e => set('endereco', e.target.value)}
                      placeholder="Rua, Avenida..." className={inputClass} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Complemento</label>
                      <input type="text" value={form.complemento}
                        onChange={e => set('complemento', e.target.value)}
                        placeholder="Apto, Sala..." className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Bairro</label>
                      <input type="text" value={form.bairro}
                        onChange={e => set('bairro', e.target.value)}
                        placeholder="Bairro" className={inputClass} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Cidade</label>
                      <input type="text" value={form.cidade}
                        onChange={e => set('cidade', e.target.value)}
                        placeholder="Cidade" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Estado</label>
                      <select value={form.estado} onChange={e => set('estado', e.target.value)} className={selectClass}>
                        <option value="">UF</option>
                        {ESTADOS_BR.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button onClick={fecharModal}
                className="flex-1 py-3 border border-gray-300 rounded-2xl text-gray-700 font-medium hover:bg-gray-50 transition-colors text-sm">
                Cancelar
              </button>
              <button onClick={handleSubmit} disabled={salvando}
                className="flex-1 py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white rounded-2xl font-semibold transition-colors text-sm">
                {salvando ? 'Salvando...' : editandoId ? 'Atualizar' : 'Criar Usuário'}
              </button>
            </div>
          </div>
        </div>
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
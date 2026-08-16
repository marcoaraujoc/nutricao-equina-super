// frontend/src/pages/CadastroLocalizacao.tsx

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Search, Loader2, X, MapPin, Pencil,
  Phone, User, ToggleLeft, ToggleRight,
  ChevronDown, Info,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';

// ─── Helpers de máscara ──────────────────────────────────────────────────────

function mascaraCNPJ(v: string): string {
  const n = v.replace(/\D/g, '').slice(0, 14);
  return n
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function mascaraCEP(v: string): string {
  const n = v.replace(/\D/g, '').slice(0, 8);
  return n.replace(/(\d{5})(\d)/, '$1-$2');
}

function mascaraTelefone(v: string): string {
  const n = v.replace(/\D/g, '').slice(0, 11);
  if (n.length <= 10) return n.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  return n.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
}

const TIPOS_LOCALIZACAO = [
  'CANIL', 'CENTRO_REPRODUCAO', 'CENTRO_TREINAMENTO', 'CLINICA',
  'CLUBE', 'CLUBE_HIPICO', 'CRIADOR', 'FAZENDA', 'GATIL', 'HARAS',
  'HOSPITAL', 'HOTEL_ANIMAL', 'ONG', 'OUTRO', 'PETSHOP', 'PROPRIETARIO',
];

const formatarTipo = (tipo: string) =>
  tipo.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

// ─── Types ────────────────────────────────────────────────────────────────────

interface Localizacao {
  id:                number;
  nome:              string;
  cnpj:              string | null;
  cep:               string | null;
  endereco:          string | null;
  pessoaResponsavel: string | null;
  telefone:          string | null;
  tipoLocalizacao:   string;
  tipoEntrada:       string;
  ativo:             boolean;
  createdAt:         string;
  updatedAt:         string;
}

interface FormLocalizacao {
  nome:              string;
  cnpj:              string;
  cep:               string;
  endereco:          string;
  pessoaResponsavel: string;
  telefone:          string;
  tipoLocalizacao:   string;
}

const FORM_INICIAL: FormLocalizacao = {
  nome:              '',
  cnpj:              '',
  cep:               '',
  endereco:          '',
  pessoaResponsavel: '',
  telefone:          '',
  tipoLocalizacao:   '',
};

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CadastroLocalizacao() {
  const { user }                            = useAuth();
  const { podeExecutar, loading: loadingPerms } = usePermissoes();

  const isAdmin    = user?.role === 'ADMIN';
  const podeCriar  = isAdmin || podeExecutar('cadastro.localizacao.criar');
  const podeVer    = isAdmin || podeExecutar('cadastro.localizacao.ler');
  // Alteração e inativação de localização são EXCLUSIVAS do ADMIN (catálogo corporativo).
  const podeEditar = isAdmin;
  const podeAtivar = isAdmin;

  const [lista,          setLista]          = useState<Localizacao[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [busca,          setBusca]          = useState('');
  const [filtroAtivo,    setFiltroAtivo]    = useState<'ativo' | 'inativo' | 'all'>('ativo');

  const [modalAberto,    setModalAberto]    = useState(false);
  const [editando,       setEditando]       = useState<Localizacao | null>(null);
  const [form,           setForm]           = useState<FormLocalizacao>(FORM_INICIAL);
  const [salvando,       setSalvando]       = useState(false);

  const [buscandoCEP,    setBuscandoCEP]    = useState(false);
  const [showInfo,       setShowInfo]       = useState(false);
  // Erros inline: da página (lista/ações) e do modal de cadastro/edição
  const [erroInline,     setErroInline]     = useState<string | null>(null);
  const [erroModal,      setErroModal]      = useState<string | null>(null);

  // ── Carregar lista ──────────────────────────────────────────────────────────
  const carregar = useCallback(async () => {
    if (loadingPerms) return;
    setLoading(true);
    try {
      const res = await api.get('/cadastro/localizacoes', {
        // Catálogo grande (importação por CNAE): traz só os primeiros 50 e refina
        // pela busca server-side — evita carregar/renderizar milhares de linhas.
        params: { busca: busca || undefined, ativo: filtroAtivo === 'all' ? 'all' : filtroAtivo === 'ativo' ? 'true' : 'false', limit: 50 },
      });
      if (!res.data) return;
      setLista(res.data.dados ?? []);
    } catch {
      setErroInline('Erro ao carregar localizações');
    } finally {
      setLoading(false);
    }
  }, [busca, filtroAtivo, loadingPerms]);

  // Debounce: evita uma requisição por tecla digitada na busca.
  useEffect(() => {
    const t = setTimeout(() => { carregar(); }, 250);
    return () => clearTimeout(t);
  }, [carregar]);

  // ── Busca CEP via ViaCEP ────────────────────────────────────────────────────
  const buscarCEP = async (cep: string) => {
    const limpo = cep.replace(/\D/g, '');
    if (limpo.length !== 8) return;
    setBuscandoCEP(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
      const data = await res.json();
      if (!data.erro) {
        const end = [data.logradouro, data.bairro, data.localidade, data.uf]
          .filter(Boolean).join(', ');
        setForm(f => ({ ...f, endereco: end }));
      }
    } catch { /* silencioso */ }
    finally { setBuscandoCEP(false); }
  };

  // ── Abrir modal ─────────────────────────────────────────────────────────────
  const abrirNovo = () => {
    setEditando(null);
    setErroInline(null);
    setErroModal(null);
    setForm(FORM_INICIAL);
    setModalAberto(true);
  };

  const abrirEditar = (loc: Localizacao) => {
    if (loc.tipoEntrada === 'SYSTEM' && !isAdmin) {
      setErroInline('Apenas ADMIN pode editar localizações do catálogo global.');
      return;
    }
    if (!podeEditar) {
      setErroInline('Sem permissão para editar localizações.');
      return;
    }
    setErroInline(null);
    setErroModal(null);
    setEditando(loc);
    setForm({
      nome:              loc.nome,
      cnpj:              loc.cnpj ? mascaraCNPJ(loc.cnpj) : '',
      cep:               loc.cep  ? mascaraCEP(loc.cep)   : '',
      endereco:          loc.endereco          ?? '',
      pessoaResponsavel: loc.pessoaResponsavel ?? '',
      telefone:          loc.telefone          ? mascaraTelefone(loc.telefone) : '',
      tipoLocalizacao:   loc.tipoLocalizacao,
    });
    setModalAberto(true);
  };

  // ── Salvar ──────────────────────────────────────────────────────────────────
  const salvar = async () => {
    setErroModal(null);
    if (!form.nome.trim()) { setErroModal('Nome é obrigatório'); return; }
    if (!form.tipoLocalizacao) { setErroModal('Tipo de localização é obrigatório'); return; }

    setSalvando(true);
    try {
      const payload = {
        nome:              form.nome.trim(),
        cnpj:              form.cnpj   || undefined,
        cep:               form.cep    || undefined,
        endereco:          form.endereco.trim()          || undefined,
        pessoaResponsavel: form.pessoaResponsavel.trim() || undefined,
        telefone:          form.telefone                 || undefined,
        tipoLocalizacao:   form.tipoLocalizacao,
      };

      if (editando) {
        await api.put(`/cadastro/localizacoes/${editando.id}`, payload);
        toast.success('Localização atualizada com sucesso');
      } else {
        await api.post('/cadastro/localizacoes', payload);
        const tipoEntrada = isAdmin ? 'SYSTEM' : 'CLIENTE';
        toast.success(`Localização cadastrada como ${tipoEntrada}`);
      }

      setModalAberto(false);
      carregar();
    } catch (err: unknown) {
      const msg = (err as {response?: {data?: {mensagem?: string}}})?.response?.data?.mensagem;
      setErroModal(msg ?? 'Erro ao salvar localização');
    } finally {
      setSalvando(false);
    }
  };

  // ── Toggle ativo ───────────────────────────────────────────────────────────
  const toggleAtivo = async (loc: Localizacao) => {
    if (loc.tipoEntrada === 'SYSTEM' && !isAdmin) { setErroInline('Apenas ADMIN pode ativar/inativar localizações do catálogo global.'); return; }
    if (!podeAtivar) { setErroInline('Sem permissão para ativar/inativar localizações.'); return; }
    setErroInline(null);
    try {
      await api.patch(`/cadastro/localizacoes/${loc.id}/toggle`);
      toast.success(`Localização ${loc.ativo ? 'inativada' : 'ativada'}`);
      carregar();
    } catch {
      setErroInline('Erro ao alterar status');
    }
  };

  // ── Guard de acesso ─────────────────────────────────────────────────────────
  if (!loadingPerms && !podeVer && !isAdmin) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold text-gray-700">Acesso não autorizado</h2>
          <p className="text-gray-500 mt-2">Você não tem permissão para visualizar esta página.</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="7xl">
      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <BotaoVoltar />

      <InlineError message={erroInline} className="mt-3" />

      <div className="flex items-center justify-between gap-3 mt-2 mb-6 flex-wrap">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-gray-900">
          <MapPin size={22} className="text-emerald-600" />
          Localizações de Animais
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowInfo(v => !v)}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-xl"
            title="Informações sobre este cadastro">
            <Info size={18} />
          </button>
          {(podeCriar || isAdmin) && (
            <button onClick={abrirNovo}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-2xl text-sm font-semibold hover:bg-emerald-700 transition-colors">
              <MapPin size={16} /> Nova Localização
            </button>
          )}
        </div>
      </div>

      {/* ── Info banner ─────────────────────────────────────────────────────── */}
      {showInfo && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-2xl text-sm text-blue-800">
          <strong>Regras deste cadastro:</strong>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            <li>O catálogo de localizações é <strong>corporativo</strong> (compartilhado entre todas as empresas).</li>
            <li><strong>Alterar</strong> e <strong>inativar</strong> localizações é exclusivo do <strong>ADMIN</strong>. Os demais usuários apenas visualizam e cadastram novas.</li>
            <li>Localizações nunca são excluídas, apenas inativadas (pelo ADMIN).</li>
          </ul>
        </div>
      )}

      {/* ── Filtros ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, responsável ou endereço…"
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
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

      {!loading && lista.length >= 50 && (
        <p className="text-xs text-gray-400 mb-3">
          Mostrando os primeiros 50 resultados. Use a busca para refinar.
        </p>
      )}

      {/* ── Tabela desktop ────────────────────────────────────────────────────── */}
      <div className="hidden md:block">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-emerald-500" /></div>
        ) : lista.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <MapPin size={48} className="mx-auto mb-3 opacity-30" />
            <p>Nenhuma localização encontrada.</p>
          </div>
        ) : (
          <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Nome</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Tipo</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Responsável</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Contato</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lista.map(loc => (
                    <tr key={loc.id} className={`hover:bg-gray-50 transition-colors ${!loc.ativo ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800">{loc.nome}</p>
                        {loc.endereco && <p className="text-xs text-gray-400 truncate max-w-[200px]">{loc.endereco}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-medium">
                          {formatarTipo(loc.tipoLocalizacao)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{loc.pessoaResponsavel ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{loc.telefone ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-xl text-xs font-medium ${loc.ativo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {loc.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          {loc.tipoEntrada === 'SYSTEM' && !isAdmin ? (
                            <span className="text-xs text-gray-400 italic">Catálogo global</span>
                          ) : (
                            <>
                              {podeEditar && (
                                <button onClick={() => abrirEditar(loc)}
                                  className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"
                                  title="Editar">
                                  <Pencil size={15} />
                                </button>
                              )}
                              {podeAtivar && (
                                <button onClick={() => toggleAtivo(loc)}
                                  className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-colors"
                                  title={loc.ativo ? 'Inativar' : 'Ativar'}>
                                  {loc.ativo ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                                </button>
                              )}
                              {!podeEditar && !podeAtivar && (
                                <span className="text-xs text-gray-400 italic">Somente leitura</span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Cards mobile ──────────────────────────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-emerald-500" /></div>
        ) : lista.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <MapPin size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhuma localização encontrada.</p>
          </div>
        ) : lista.map(loc => (
            <div key={loc.id} className={`bg-white rounded-3xl border border-gray-200 p-4 ${!loc.ativo ? 'opacity-50' : ''}`}>
              <div className="flex justify-between items-start gap-2 mb-2">
                <div>
                  <p className="font-semibold text-gray-800">{loc.nome}</p>
                  <p className="text-xs text-gray-500">{formatarTipo(loc.tipoLocalizacao)}</p>
                </div>
              </div>

              {loc.endereco && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <MapPin size={12} /> {loc.endereco}
                </div>
              )}
              {loc.pessoaResponsavel && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <User size={12} /> {loc.pessoaResponsavel}
                </div>
              )}
              {loc.telefone && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <Phone size={12} /> {loc.telefone}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <span className={`px-2 py-1 rounded-xl text-xs font-medium ${loc.ativo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {loc.ativo ? 'Ativo' : 'Inativo'}
                </span>
                {(loc.tipoEntrada !== 'SYSTEM' || isAdmin) && (podeEditar || podeAtivar) && (
                  <div className="flex gap-2">
                    {podeEditar && (
                      <button onClick={() => abrirEditar(loc)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-emerald-600 border border-emerald-200 rounded-xl hover:bg-emerald-50 transition-colors">
                        <Pencil size={11} /> Editar
                      </button>
                    )}
                    {podeAtivar && (
                      <button onClick={() => toggleAtivo(loc)}
                        className="px-3 py-1.5 text-xs text-amber-600 border border-amber-200 rounded-xl hover:bg-amber-50 transition-colors">
                        {loc.ativo ? 'Inativar' : 'Ativar'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
        ))}
      </div>

      {/* ── Modal de criação / edição ──────────────────────────────────────────── */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          {/* `dvh` (viewport dinâmico), não `vh` — mesmo padrão do modal de Fornecedor:
              no mobile, `90vh` fica preso à altura ANTES do teclado abrir, e com um
              campo em foco o rodapé (Cadastrar/Salvar) ficava atrás do teclado. */}
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg max-h-[92dvh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-800">
                {editando ? 'Editar Localização' : 'Nova Localização'}
              </h2>
              <button onClick={() => setModalAberto(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-xl">
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">

              {/* Banner informativo para não-ADMIN */}
              {!isAdmin && !editando && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800">
                  Esta localização será cadastrada como <strong>CLIENTE</strong>, vinculada à sua empresa/equipe ativa.
                </div>
              )}

              {/* Nome */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.nome}
                  onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Ex.: Haras Santa Clara"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>

              {/* Tipo de Localização */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo de Localização <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={form.tipoLocalizacao}
                    onChange={e => setForm(f => ({ ...f, tipoLocalizacao: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-2xl text-sm appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 pr-8"
                  >
                    <option value="">Selecione…</option>
                    {TIPOS_LOCALIZACAO.map(t => (
                      <option key={t} value={t}>{formatarTipo(t)}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* CNPJ */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ</label>
                <input
                  value={form.cnpj}
                  onChange={e => setForm(f => ({ ...f, cnpj: mascaraCNPJ(e.target.value) }))}
                  placeholder="00.000.000/0000-00"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>

              {/* CEP + Endereço */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CEP</label>
                  <div className="relative">
                    <input
                      value={form.cep}
                      onChange={e => {
                        const v = mascaraCEP(e.target.value);
                        setForm(f => ({ ...f, cep: v }));
                        if (v.replace(/\D/g, '').length === 8) buscarCEP(v);
                      }}
                      placeholder="00000-000"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                    {buscandoCEP && (
                      <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-emerald-500" />
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                  <input
                    value={form.telefone}
                    onChange={e => setForm(f => ({ ...f, telefone: mascaraTelefone(e.target.value) }))}
                    placeholder="(00) 00000-0000"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
              </div>

              {/* Endereço */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Endereço</label>
                <input
                  value={form.endereco}
                  onChange={e => setForm(f => ({ ...f, endereco: e.target.value }))}
                  placeholder="Rua, número, bairro, cidade – UF"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>

              {/* Pessoa Responsável */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pessoa Responsável</label>
                <input
                  value={form.pessoaResponsavel}
                  onChange={e => setForm(f => ({ ...f, pessoaResponsavel: e.target.value }))}
                  placeholder="Nome do responsável pelo local"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
              <button onClick={() => setModalAberto(false)}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button onClick={salvar} disabled={salvando}
                className="flex-1 py-2.5 bg-emerald-600 text-white rounded-2xl text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {salvando && <Loader2 size={15} className="animate-spin" />}
                {editando ? 'Salvar alterações' : 'Cadastrar'}
              </button>
            </div>

            {/* Erro ABAIXO do botão que o disparou (mesmo padrão do modal de
                Fornecedor) — nunca na página atrás do overlay. Fora do corpo
                rolável (`flex-shrink-0`), então nasce sempre à vista. */}
            {erroModal && (
              <div className="px-6 pb-6 flex-shrink-0">
                <InlineError message={erroModal} />
              </div>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}

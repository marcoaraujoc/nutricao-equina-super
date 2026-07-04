// frontend/src/pages/CadastroTratador.tsx

import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Search, Loader2, X, User2, Pencil,
  Phone, ToggleLeft, ToggleRight,
  Info, CheckCircle2, Plus, MapPin,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatarTipo = (tipo: string) =>
  tipo.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

// ─── Helper de máscara ───────────────────────────────────────────────────────

function mascaraTelefone(v: string): string {
  const n = v.replace(/\D/g, '').slice(0, 11);
  if (n.length <= 10) return n.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  return n.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Localizacao {
  id:              number;
  nome:            string;
  tipoLocalizacao: string;
  ativo:           boolean;
}

interface Tratador {
  id:            number;
  nome:          string;
  telefone:      string | null;
  localizacaoId: number | null;
  tipoEntrada:   string;
  ativo:         boolean;
  createdAt:     string;
  updatedAt:     string;
  localizacao:   { id: number; nome: string; tipoLocalizacao: string } | null;
}

interface FormTratador {
  nome:          string;
  telefone:      string;
  localizacaoId: number | null;
}

const FORM_INICIAL: FormTratador = { nome: '', telefone: '', localizacaoId: null };

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CadastroTratador() {
  const { user }                                = useAuth();
  const { podeExecutar, loading: loadingPerms } = usePermissoes();

  const isAdmin    = user?.role === 'ADMIN';
  const podeCriar  = isAdmin || podeExecutar('cadastro.tratador.criar');
  const podeVer    = isAdmin || podeExecutar('cadastro.tratador.ler');
  const podeEditar = isAdmin || podeExecutar('cadastro.tratador.editar');
  const podeAtivar = isAdmin || podeExecutar('cadastro.tratador.ativar');

  const [lista,       setLista]       = useState<Tratador[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [busca,       setBusca]       = useState('');
  const [filtroAtivo, setFiltroAtivo] = useState<'ativo' | 'inativo' | 'all'>('ativo');

  const [modalAberto, setModalAberto] = useState(false);
  const [editando,    setEditando]    = useState<Tratador | null>(null);
  const [form,        setForm]        = useState<FormTratador>(FORM_INICIAL);
  const [salvando,    setSalvando]    = useState(false);
  const [showInfo,    setShowInfo]    = useState(false);

  // ── Combobox de localização no modal ─────────────────────────────────────
  const [localizacoes,         setLocalizacoes]         = useState<Localizacao[]>([]);
  const [locBusca,             setLocBusca]             = useState('');
  const [locDropdownOpen,      setLocDropdownOpen]      = useState(false);
  const [localizacaoSelecionada, setLocalizacaoSelecionada] = useState<Localizacao | null>(null);

  const filteredLocs = useMemo(() => {
    if (!locBusca.trim()) return localizacoes;
    return localizacoes.filter(l =>
      l.nome.toLowerCase().includes(locBusca.trim().toLowerCase()),
    );
  }, [localizacoes, locBusca]);

  // ── Carregar localizações disponíveis ─────────────────────────────────────
  useEffect(() => {
    api.get('/cadastro/localizacoes?ativo=true')
      .then(res => { if (res.data) setLocalizacoes(res.data.dados ?? []); })
      .catch(() => setLocalizacoes([]));
  }, []);

  // ── Carregar lista de tratadores ──────────────────────────────────────────
  const carregar = useCallback(async () => {
    if (loadingPerms) return;
    setLoading(true);
    try {
      const res = await api.get('/cadastro/tratadores', {
        params: {
          busca: busca || undefined,
          ativo: filtroAtivo === 'all' ? 'all' : filtroAtivo === 'ativo' ? 'true' : 'false',
        },
      });
      if (!res.data) return;
      setLista(res.data.dados ?? []);
    } catch {
      toast.error('Erro ao carregar tratadores');
    } finally {
      setLoading(false);
    }
  }, [busca, filtroAtivo, loadingPerms]);

  useEffect(() => { carregar(); }, [carregar]);

  // ── Abrir modal ───────────────────────────────────────────────────────────
  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setLocBusca('');
    setLocalizacaoSelecionada(null);
    setModalAberto(true);
  };

  const abrirEditar = (t: Tratador) => {
    if (t.tipoEntrada === 'SYSTEM' && !isAdmin) { toast.error('Apenas ADMIN pode editar tratadores do catálogo global.'); return; }
    if (!podeEditar) { toast.error('Sem permissão para editar tratadores.'); return; }
    setEditando(t);
    setForm({ nome: t.nome, telefone: t.telefone ? mascaraTelefone(t.telefone) : '', localizacaoId: t.localizacaoId });
    const loc = t.localizacao ? (localizacoes.find(l => l.id === t.localizacaoId) ?? null) : null;
    setLocalizacaoSelecionada(loc);
    setLocBusca(t.localizacao?.nome ?? '');
    setModalAberto(true);
  };

  // ── Salvar ────────────────────────────────────────────────────────────────
  const salvar = async () => {
    if (!form.nome.trim())      { toast.error('Nome é obrigatório'); return; }
    if (!form.localizacaoId)    { toast.error('Local de trabalho é obrigatório'); return; }
    setSalvando(true);
    try {
      const payload = {
        nome:          form.nome.trim(),
        telefone:      form.telefone || undefined,
        localizacaoId: form.localizacaoId ?? undefined,
      };
      if (editando) {
        await api.put(`/cadastro/tratadores/${editando.id}`, payload);
        toast.success('Tratador atualizado com sucesso');
      } else {
        await api.post('/cadastro/tratadores', payload);
        toast.success(`Tratador cadastrado como ${isAdmin ? 'SYSTEM' : 'CLIENTE'}`);
      }
      setModalAberto(false);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      toast.error(msg ?? 'Erro ao salvar tratador');
    } finally {
      setSalvando(false);
    }
  };

  // ── Toggle ativo ───────────────────────────────────────────────────────────
  const toggleAtivo = async (t: Tratador) => {
    if (t.tipoEntrada === 'SYSTEM' && !isAdmin) { toast.error('Apenas ADMIN pode ativar/inativar tratadores do catálogo global.'); return; }
    if (!podeAtivar) { toast.error('Sem permissão para ativar/inativar tratadores.'); return; }
    try {
      await api.patch(`/cadastro/tratadores/${t.id}/toggle`);
      toast.success(`Tratador ${t.ativo ? 'inativado' : 'ativado'}`);
      carregar();
    } catch {
      toast.error('Erro ao alterar status');
    }
  };

  // ── Combobox helpers ──────────────────────────────────────────────────────
  const selecionarLoc = (loc: Localizacao) => {
    setLocalizacaoSelecionada(loc);
    setForm(f => ({ ...f, localizacaoId: loc.id }));
    setLocBusca(loc.nome);
    setLocDropdownOpen(false);
  };

  const limparLoc = () => {
    setLocalizacaoSelecionada(null);
    setForm(f => ({ ...f, localizacaoId: null }));
    setLocBusca('');
  };

  // ── Guard de acesso ───────────────────────────────────────────────────────
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

  const inputModal = 'w-full px-3 py-2.5 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400';

  return (
    <PageContainer maxWidth="7xl">

      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <BotaoVoltar />
      <div className="flex items-center justify-between gap-3 mt-2 mb-6 flex-wrap">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-gray-900">
          <User2 size={22} className="text-emerald-600" /> Tratadores
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
              <User2 size={16} /> Novo Tratador
            </button>
          )}
        </div>
      </div>

      {/* ── Info banner ──────────────────────────────────────────────────────── */}
      {showInfo && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-2xl text-sm text-blue-800">
          <strong>Regras deste cadastro:</strong>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            <li>Entradas <strong>SYSTEM</strong> são criadas pelo ADMIN (catálogo global) e só o ADMIN pode editá-las.</li>
            <li>Entradas <strong>CLIENTE</strong> pertencem à empresa/equipe de quem criou — membros com permissão podem editar e inativar os registros da própria equipe; gestores veem e alteram os de toda a empresa.</li>
            <li>Tratadores nunca são excluídos, apenas inativados.</li>
            <li>Não podem existir dois tratadores com o mesmo nome no mesmo local, dentro da mesma empresa.</li>
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
            placeholder="Buscar por nome ou telefone…"
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

      {/* ── Tabela desktop ───────────────────────────────────────────────────── */}
      <div className="hidden md:block">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-emerald-500" /></div>
        ) : lista.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <User2 size={48} className="mx-auto mb-3 opacity-30" />
            <p>Nenhum tratador encontrado.</p>
          </div>
        ) : (
          <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Nome</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Local de Trabalho</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Telefone</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lista.map(t => (
                  <tr key={t.id} className={`hover:bg-gray-50 transition-colors ${!t.ativo ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-800">{t.nome}</td>
                    <td className="px-4 py-3">
                      {t.localizacao ? (
                        <span className="flex items-center gap-1 text-gray-600">
                          <MapPin size={12} className="text-emerald-500 shrink-0" />
                          {t.localizacao.nome}
                          <span className="text-xs text-gray-400 ml-1">({formatarTipo(t.localizacao.tipoLocalizacao)})</span>
                        </span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{t.telefone ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-xl text-xs font-medium ${t.ativo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {t.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        {t.tipoEntrada === 'SYSTEM' && !isAdmin ? (
                          <span className="text-xs text-gray-400 italic">Catálogo global</span>
                        ) : (
                          <>
                            {podeEditar && (
                              <button onClick={() => abrirEditar(t)}
                                className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"
                                title="Editar">
                                <Pencil size={15} />
                              </button>
                            )}
                            {podeAtivar && (
                              <button onClick={() => toggleAtivo(t)}
                                className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-colors"
                                title={t.ativo ? 'Inativar' : 'Ativar'}>
                                {t.ativo ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
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

      {/* ── Cards mobile ─────────────────────────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-emerald-500" /></div>
        ) : lista.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <User2 size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhum tratador encontrado.</p>
          </div>
        ) : lista.map(t => (
          <div key={t.id} className={`bg-white rounded-3xl border border-gray-200 p-4 ${!t.ativo ? 'opacity-50' : ''}`}>
            <div className="flex justify-between items-start gap-2 mb-2">
              <div>
                <p className="font-semibold text-gray-800">{t.nome}</p>
                {t.localizacao && (
                  <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                    <MapPin size={11} /> {t.localizacao.nome}
                  </p>
                )}
              </div>
            </div>

            {t.telefone && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
                <Phone size={12} /> {t.telefone}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <span className={`px-2 py-1 rounded-xl text-xs font-medium ${t.ativo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {t.ativo ? 'Ativo' : 'Inativo'}
              </span>
              {(t.tipoEntrada !== 'SYSTEM' || isAdmin) && (podeEditar || podeAtivar) && (
                <div className="flex gap-2">
                  {podeEditar && (
                    <button onClick={() => abrirEditar(t)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs text-emerald-600 border border-emerald-200 rounded-xl hover:bg-emerald-50 transition-colors">
                      <Pencil size={11} /> Editar
                    </button>
                  )}
                  {podeAtivar && (
                    <button onClick={() => toggleAtivo(t)}
                      className="px-3 py-1.5 text-xs text-amber-600 border border-amber-200 rounded-xl hover:bg-amber-50 transition-colors">
                      {t.ativo ? 'Inativar' : 'Ativar'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Modal de criação / edição ─────────────────────────────────────────── */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-800">
                {editando ? 'Editar Tratador' : 'Novo Tratador'}
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
                  Este tratador será cadastrado como <strong>CLIENTE</strong>, vinculado à sua empresa/equipe ativa.
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
                  placeholder="Ex.: João da Silva"
                  className={inputModal}
                  autoFocus
                />
              </div>

              {/* Telefone */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                <div className="relative">
                  <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={form.telefone}
                    onChange={e => setForm(f => ({ ...f, telefone: mascaraTelefone(e.target.value) }))}
                    placeholder="(00) 00000-0000"
                    className={`${inputModal} pl-8`}
                  />
                </div>
              </div>

              {/* Local de Trabalho — combobox */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Local de Trabalho <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={locBusca}
                    onChange={e => {
                      setLocBusca(e.target.value);
                      setLocDropdownOpen(true);
                      if (localizacaoSelecionada) {
                        setLocalizacaoSelecionada(null);
                        setForm(f => ({ ...f, localizacaoId: null }));
                      }
                    }}
                    onFocus={() => setLocDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setLocDropdownOpen(false), 200)}
                    placeholder="Buscar localização…"
                    className={`${inputModal} pr-8`}
                    autoComplete="off"
                  />
                  {localizacaoSelecionada ? (
                    <CheckCircle2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
                  ) : locBusca ? (
                    <button type="button"
                      onMouseDown={limparLoc}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-400">
                      <X size={14} />
                    </button>
                  ) : null}

                  {locDropdownOpen && (
                    <div className="absolute z-20 w-full bg-white border border-gray-200 shadow-xl rounded-xl mt-1 max-h-48 overflow-y-auto">
                      {filteredLocs.length === 0 && !locBusca.trim() && (
                        <p className="px-4 py-3 text-xs text-gray-400">Nenhuma localização cadastrada</p>
                      )}
                      {filteredLocs.map(loc => (
                        <button key={loc.id} type="button"
                          onMouseDown={() => selecionarLoc(loc)}
                          className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 flex items-center justify-between text-sm border-b border-gray-50 last:border-0">
                          <span className="font-medium text-gray-800">{loc.nome}</span>
                          <span className="text-xs text-gray-400 ml-2 shrink-0">{formatarTipo(loc.tipoLocalizacao)}</span>
                        </button>
                      ))}
                      {filteredLocs.length === 0 && locBusca.trim() && (
                        <p className="px-4 py-2 text-xs text-gray-400 italic">Nenhum resultado para "{locBusca}"</p>
                      )}
                      {locBusca.trim() && !localizacaoSelecionada && (
                        <div className="px-4 py-2 border-t border-gray-100">
                          <p className="text-xs text-gray-400">
                            <Plus size={11} className="inline mr-1" />
                            Cadastre o local em <strong>Cadastro → Localizações</strong>.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">Selecione o local onde o tratador trabalha.</p>
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
          </div>
        </div>
      )}
    </PageContainer>
  );
}

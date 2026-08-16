// frontend/src/pages/CadastroProcedimento.tsx
// Cadastro > Procedimentos — catálogo por especialidade + preços/combos da empresa.
//   - Seletor de especialidades: vet vê SÓ as suas; GESTOR/ADMIN veem todas.
//   - Incluir procedimento no catálogo: exclusivo do ADMIN.
//   - Empresa (GESTOR): define valor por procedimento e monta combos com valor.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ModalJustificativa from '../components/ModalJustificativa';
import DropdownSelect from '../components/DropdownSelect';
import {
  ListChecks, Search, Pencil, Trash2, X, Loader2, Check, Layers, PackagePlus,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Procedimento {
  id:            number;
  nome:          string;
  nomeAbreviado: string | null;
  categoria:     string;
  subcategoria:  string | null;
  especialidade: string | null;
  tipoProcedimento: string | null;
  duracao:       number | null;
  valorVenda:    number | null;
  descricao:     string | null;
  valorEmpresa:  number | null;
}

interface ComboItem {
  id: number;
  procedimento: { id: number; nome: string; categoria: string; especialidade: string | null; valorVenda: number | null };
}

interface Combo {
  id:            number;
  nome:          string;
  descricao:     string | null;
  especialidade: string | null;
  valor:         number;
  itens:         ComboItem[];
}

interface FormNovoProc {
  nome: string; categoria: string; especialidade: string; valorVenda: string; descricao: string;
}

const FORM_PROC_INICIAL: FormNovoProc = { nome: '', categoria: '', especialidade: '', valorVenda: '', descricao: '' };

const brl = (v: number | null | undefined): string =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Máscara monetária de digitação: "R$ 000.000,00" (mesmo padrão do CadastroProprietario)
const maskBRL = (v: string): string => {
  const nums = v.replace(/\D/g, '');
  if (!nums) return '';
  const n = parseInt(nums, 10) / 100;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const parseBRL = (v: string): number =>
  parseFloat(v.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
const numToMask = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' : maskBRL(String(Math.round(v * 100)));

/**
 * Especialidades REAIS do combo: as dos procedimentos que o compõem, sem repetir.
 *
 * `Combo.especialidade` é só a CLASSIFICAÇÃO gravada no cadastro — a que estava no
 * seletor na hora de salvar. Num combo montado com três áreas, exibi-lo sozinho
 * mostrava apenas a última usada e escondia as outras duas. O campo continua servindo
 * ao filtro do Orçamento; quem descreve o conteúdo do pacote são os itens.
 * Combo cujos procedimentos não têm especialidade cai na classificação (não fica sem
 * nenhum selo).
 */
const especialidadesDoCombo = (c: Combo): string[] => {
  const dosItens = [...new Set(
    c.itens.map(i => i.procedimento.especialidade).filter((e): e is string => !!e?.trim()),
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (dosItens.length > 0) return dosItens;
  return c.especialidade ? [c.especialidade] : [];
};

// ─── Página ───────────────────────────────────────────────────────────────────

export default function CadastroProcedimento() {
  const { user } = useAuth();
  const { isGestor, loading: loadingPerms, podeExecutar } = usePermissoes();
  const isAdmin = (user?.userType ?? '').toUpperCase() === 'ADMIN';

  const [especialidades, setEspecialidades] = useState<string[]>([]);
  const [gestorBackend,  setGestorBackend]  = useState(false);
  const [espSel,         setEspSel]         = useState('');
  const [procedimentos,  setProcedimentos]  = useState<Procedimento[]>([]);
  const [combos,         setCombos]         = useState<Combo[]>([]);
  const [buscaCombos,    setBuscaCombos]    = useState('');
  const [busca,          setBusca]          = useState('');
  const [aba,            setAba]            = useState<'procedimentos' | 'combos'>('procedimentos');
  const [loading,        setLoading]        = useState(true);
  const [loadingProcs,   setLoadingProcs]   = useState(false);

  // Edição inline de valor da empresa (gestor)
  const [editandoValorId, setEditandoValorId] = useState<number | null>(null);
  const [valorEdit,       setValorEdit]       = useState('');
  const [salvandoValor,   setSalvandoValor]   = useState(false);

  // Modal novo procedimento (ADMIN)
  const [showNovoProc, setShowNovoProc] = useState(false);
  const [formProc,     setFormProc]     = useState<FormNovoProc>(FORM_PROC_INICIAL);
  const [salvandoProc, setSalvandoProc] = useState(false);

  // Modal combo (gestor)
  const [showCombo,     setShowCombo]     = useState(false);
  const [comboEditando, setComboEditando] = useState<Combo | null>(null);
  const [comboNome,     setComboNome]     = useState('');
  const [comboEsp,      setComboEsp]      = useState('');
  const [comboValor,    setComboValor]    = useState('');
  const [comboDesc,     setComboDesc]     = useState('');
  const [comboIds,      setComboIds]      = useState<number[]>([]);
  const [comboBusca,    setComboBusca]    = useState('');
  const [todosProcs,    setTodosProcs]    = useState<Procedimento[]>([]);
  const [salvandoCombo, setSalvandoCombo] = useState(false);
  // Erros inline: página (lista/valor), modal de novo procedimento e modal de combo
  const [erroInline,    setErroInline]    = useState<string | null>(null);
  const [erroProc,      setErroProc]      = useState<string | null>(null);
  const [erroCombo,     setErroCombo]     = useState<string | null>(null);
  const [comboExcluir,  setComboExcluir]  = useState<Combo | null>(null);

  // Controle de acesso — slug cadastro.procedimento.* (GESTOR/ADMIN têm bypass via podeExecutar)
  const podeVer    = isAdmin || isGestor || gestorBackend || podeExecutar('cadastro.procedimento.ler');
  const podeEditar = isAdmin || isGestor || gestorBackend || podeExecutar('cadastro.procedimento.editar');
  const podeCriar  = isAdmin || isGestor || gestorBackend || podeExecutar('cadastro.procedimento.criar');
  const podeExcluir = isAdmin || isGestor || gestorBackend || podeExecutar('cadastro.procedimento.deletar');
  // "Gerir" = tem alguma ação de escrita (mostra textos/afford. de gestão)
  const podeGerirEmpresa = podeEditar || podeCriar || podeExcluir;

  // ── Loaders ───────────────────────────────────────────────────────────────

  const carregarEspecialidades = useCallback(async () => {
    try {
      const res = await api.get('/procedimentos/especialidades-minhas');
      if (!res.data) return;
      setEspecialidades(res.data?.dados ?? []);
      setGestorBackend(Boolean(res.data?.gestor));
    } catch { /* silencioso */ }
  }, []);

  const carregarProcedimentos = useCallback(async (especialidade: string) => {
    if (!especialidade) { setProcedimentos([]); return; }
    setLoadingProcs(true);
    try {
      const res = await api.get('/procedimentos/cadastro/lista', { params: { especialidade } });
      if (!res.data) { setProcedimentos([]); return; }
      setProcedimentos(res.data?.dados ?? []);
    } catch { /* silencioso */ }
    finally { setLoadingProcs(false); }
  }, []);

  const carregarCombos = useCallback(async () => {
    try {
      const res = await api.get('/procedimentos/cadastro/combos');
      if (!res.data) return;
      setCombos(res.data?.dados ?? []);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    if (loadingPerms) return;
    setLoading(true);
    Promise.all([carregarEspecialidades(), carregarCombos()]).finally(() => setLoading(false));
  }, [loadingPerms, carregarEspecialidades, carregarCombos]);

  useEffect(() => {
    if (loadingPerms) return;
    carregarProcedimentos(espSel);
  }, [espSel, loadingPerms, carregarProcedimentos]);

  // Auto-seleciona quando há uma única especialidade
  useEffect(() => {
    if (!espSel && especialidades.length === 1) setEspSel(especialidades[0]);
  }, [especialidades, espSel]);

  const procsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return procedimentos;
    return procedimentos.filter(p =>
      p.nome.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q));
  }, [procedimentos, busca]);

  const combosFiltrados = useMemo(() => {
    const q = buscaCombos.trim().toLowerCase();
    if (!q) return combos;
    return combos.filter(c => c.nome.toLowerCase().includes(q));
  }, [combos, buscaCombos]);

  // ── Valor da empresa (gestor) ─────────────────────────────────────────────

  const iniciarEdicaoValor = (p: Procedimento) => {
    setEditandoValorId(p.id);
    setValorEdit(numToMask(p.valorEmpresa));
  };

  const salvarValor = async (p: Procedimento) => {
    setSalvandoValor(true);
    try {
      const res = await api.put(`/procedimentos/cadastro/valor/${p.id}`, {
        valor: valorEdit.trim() === '' ? null : parseBRL(valorEdit),
      });
      const novo = res.data?.dados?.valorEmpresa ?? null;
      setProcedimentos(prev => prev.map(x => x.id === p.id ? { ...x, valorEmpresa: novo } : x));
      setEditandoValorId(null);
      toast.success(novo === null ? 'Valor removido' : 'Valor salvo');
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao salvar valor');
    } finally { setSalvandoValor(false); }
  };

  // ── Novo procedimento (ADMIN) ─────────────────────────────────────────────

  const salvarNovoProc = async () => {
    setErroProc(null);
    if (!formProc.nome.trim())      { setErroProc('Nome é obrigatório'); return; }
    if (!formProc.categoria.trim()) { setErroProc('Categoria é obrigatória'); return; }
    setSalvandoProc(true);
    try {
      await api.post('/procedimentos', {
        nome:          formProc.nome.trim(),
        categoria:     formProc.categoria.trim(),
        especialidade: formProc.especialidade.trim() || null,
        valorVenda:    formProc.valorVenda ? parseBRL(formProc.valorVenda) : null,
        descricao:     formProc.descricao.trim() || null,
      });
      toast.success('Procedimento incluído no catálogo');
      setShowNovoProc(false);
      setFormProc(FORM_PROC_INICIAL);
      if (espSel) carregarProcedimentos(espSel);
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroProc(e.response?.data?.error ?? 'Erro ao incluir procedimento');
    } finally { setSalvandoProc(false); }
  };

  // ── Combos (gestor) ───────────────────────────────────────────────────────

  const abrirNovoCombo = async () => {
    setErroCombo(null);
    setComboEditando(null);
    setComboNome(''); setComboEsp(''); setComboValor(''); setComboDesc(''); setComboIds([]); setComboBusca('');
    setShowCombo(true);
    if (todosProcs.length === 0) {
      try {
        const res = await api.get('/procedimentos/cadastro/lista');
        if (res.data) setTodosProcs(res.data?.dados ?? []);
      } catch { /* silencioso */ }
    }
  };

  const abrirEdicaoCombo = async (c: Combo) => {
    setErroCombo(null);
    setComboEditando(c);
    setComboNome(c.nome);
    setComboEsp(c.especialidade ?? '');
    setComboValor(numToMask(c.valor));
    setComboDesc(c.descricao ?? '');
    setComboIds(c.itens.map(i => i.procedimento.id));
    setComboBusca('');
    setShowCombo(true);
    if (todosProcs.length === 0) {
      try {
        const res = await api.get('/procedimentos/cadastro/lista');
        if (res.data) setTodosProcs(res.data?.dados ?? []);
      } catch { /* silencioso */ }
    }
  };

  const salvarCombo = async () => {
    setErroCombo(null);
    if (!comboNome.trim())            { setErroCombo('Nome do combo é obrigatório'); return; }
    if (!comboEsp.trim())             { setErroCombo('Selecione a especialidade do combo'); return; }
    const valorNum = parseBRL(comboValor);
    if (!valorNum || valorNum <= 0)   { setErroCombo('Informe o valor do combo'); return; }
    if (comboIds.length < 2)          { setErroCombo('Selecione pelo menos 2 procedimentos'); return; }
    setSalvandoCombo(true);
    try {
      const payload = { nome: comboNome.trim(), especialidade: comboEsp.trim(), valor: valorNum, descricao: comboDesc.trim() || undefined, procedimentoIds: comboIds };
      if (comboEditando) await api.put(`/procedimentos/cadastro/combos/${comboEditando.id}`, payload);
      else               await api.post('/procedimentos/cadastro/combos', payload);
      toast.success(comboEditando ? 'Combo atualizado' : 'Combo criado');
      setShowCombo(false);
      carregarCombos();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroCombo(e.response?.data?.error ?? 'Erro ao salvar combo');
    } finally { setSalvandoCombo(false); }
  };

  const excluirCombo = async (motivo: string) => {
    if (!comboExcluir) return;
    try {
      await api.delete(`/procedimentos/cadastro/combos/${comboExcluir.id}`, { data: { motivo } });
      toast.success('Combo excluído');
      setComboExcluir(null);
      carregarCombos();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao excluir combo');
    }
  };

  const somaItensCombo = useMemo(() =>
    todosProcs.filter(p => comboIds.includes(p.id))
      .reduce((acc, p) => acc + (p.valorEmpresa ?? p.valorVenda ?? 0), 0),
  [todosProcs, comboIds]);

  /**
   * Procedimentos LISTADOS na montagem do combo: os da especialidade escolhida no
   * seletor, filtrados pela busca.
   *
   * O seletor de especialidade tem DOIS papéis: classifica o combo (badge do card,
   * filtro do Orçamento) e escolhe o que aparece nesta lista. Trocar a especialidade
   * troca a lista — e **NÃO limpa o que já foi marcado**: é assim que o combo reúne
   * áreas diferentes (marca em Clínica Médica, troca para Anestesiologia, marca mais).
   * O que está selecionado fora da especialidade atual continua visível e removível
   * nos chips de "Selecionados", logo acima da lista; sem eles, item de outra área
   * ficaria preso no combo sem nenhuma forma de tirar.
   */
  const procsCombo = useMemo(() => {
    if (!comboEsp) return [];
    const q = comboBusca.trim().toLowerCase();
    const daEsp = todosProcs.filter(p => (p.especialidade ?? '') === comboEsp);
    const base = q
      ? daEsp.filter(p => p.nome.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q))
      : daEsp;
    return base.slice(0, 60);
  }, [todosProcs, comboBusca, comboEsp]);

  // Tudo que está no combo, de QUALQUER especialidade — a memória da montagem.
  const procsSelecionados = useMemo(
    () => todosProcs.filter(p => comboIds.includes(p.id)),
    [todosProcs, comboIds]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading || loadingPerms) return (
    <PageContainer>
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    </PageContainer>
  );

  if (!podeVer) return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />
      <div className="text-center py-16">
        <h2 className="text-lg font-bold text-gray-900">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500 mt-1">Você não tem permissão para visualizar esta página.</p>
      </div>
    </PageContainer>
  );

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-500';

  return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />

      <InlineError message={erroInline} className="mb-4" />

      {/* Cabeçalho (mesmo padrão de Agendamentos): ícone em box + título + descritivo */}
      <div className="mt-2 mb-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <ListChecks size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Procedimentos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Catálogo por especialidade{podeGerirEmpresa ? ', valores da empresa e combos' : ' e combos da empresa'}.
          </p>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4">
        {([
          { key: 'procedimentos', label: 'Procedimentos', icon: <ListChecks size={14} /> },
          { key: 'combos',        label: 'Combos',        icon: <Layers size={14} /> },
        ] as { key: 'procedimentos' | 'combos'; label: string; icon: React.ReactNode }[]).map(t => (
          <button key={t.key} onClick={() => setAba(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              aba === t.key ? 'bg-emerald-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-emerald-300'
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {aba === 'procedimentos' && (
        <div className="space-y-4">
          {/* Seletor de especialidade + busca + novo (ADMIN) */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Especialidade</label>
                <DropdownSelect value={espSel} onChange={setEspSel} options={especialidades} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Buscar</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
                    placeholder="Nome ou categoria..." className={`${inputCls} pl-8`} />
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() => { setFormProc({ ...FORM_PROC_INICIAL, especialidade: espSel }); setShowNovoProc(true); }}
                  className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
                  Novo Procedimento
                </button>
              )}
            </div>
            {especialidades.length === 0 && (
              <p className="text-xs text-amber-600 mt-3">
                Nenhuma especialidade vinculada ao seu cadastro. Atualize suas especialidades no Cadastro Pessoal.
              </p>
            )}
          </div>

          {/* Lista */}
          {!espSel ? (
            <div className="text-center py-14 text-gray-400 text-sm">Selecione uma especialidade para ver os procedimentos.</div>
          ) : loadingProcs ? (
            <div className="flex justify-center py-14"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
          ) : procsFiltrados.length === 0 ? (
            <div className="text-center py-14 text-gray-400 text-sm">Nenhum procedimento encontrado para {espSel}.</div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                      <th className="px-5 py-3 font-semibold">Procedimento</th>
                      <th className="px-5 py-3 font-semibold">Categoria</th>
                      {/* Só o VALOR da empresa aparece na grade. O "Valor padrão" do
                          catálogo (`valorVenda`) continua existindo e é editado pelo
                          ADMIN no modal do procedimento — na lista ele só concorria
                          com o valor que a clínica realmente cobra. */}
                      <th className="px-5 py-3 font-semibold text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {procsFiltrados.map(p => (
                      <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-900">{p.nome}</p>
                          {p.descricao && <p className="text-[11px] text-gray-400 truncate max-w-md">{p.descricao}</p>}
                        </td>
                        <td className="px-5 py-3 text-gray-500">{p.categoria}{p.subcategoria ? ` · ${p.subcategoria}` : ''}</td>
                        <td className="px-5 py-3 text-right">
                          {editandoValorId === p.id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <input type="text" inputMode="numeric" placeholder="R$ 0,00" value={valorEdit} autoFocus
                                onChange={e => setValorEdit(maskBRL(e.target.value))}
                                onKeyDown={e => { if (e.key === 'Enter') salvarValor(p); if (e.key === 'Escape') setEditandoValorId(null); }}
                                className="w-32 border border-emerald-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-emerald-500" />
                              <button onClick={() => salvarValor(p)} disabled={salvandoValor} className="p-1 text-emerald-700 hover:bg-emerald-50 rounded">
                                {salvandoValor ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                              </button>
                              <button onClick={() => setEditandoValorId(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={14} /></button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <span className={p.valorEmpresa !== null ? 'font-semibold text-emerald-700' : 'text-gray-400'}>
                                {brl(p.valorEmpresa)}
                              </span>
                              {podeEditar && (
                                <button onClick={() => iniciarEdicaoValor(p)} className="p-1 text-gray-400 hover:text-emerald-700 hover:bg-emerald-50 rounded" title="Definir valor">
                                  <Pencil size={13} />
                                </button>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="md:hidden space-y-2">
                {procsFiltrados.map(p => (
                  <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <p className="font-semibold text-gray-900 text-sm">{p.nome}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{p.categoria}{p.subcategoria ? ` · ${p.subcategoria}` : ''}</p>
                    {/* Espelho do desktop: só o VALOR da empresa (o "Padrão" saiu junto
                        com a coluna — card e tabela mostram os mesmos dados). */}
                    <div className="flex items-center justify-between mt-2 text-xs">
                      <span className="text-gray-500">Valor</span>
                      {editandoValorId === p.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <input type="text" inputMode="numeric" placeholder="R$ 0,00" value={valorEdit} autoFocus
                            onChange={e => setValorEdit(maskBRL(e.target.value))}
                            className="w-28 border border-emerald-300 rounded-lg px-2 py-1 text-xs text-right focus:outline-none" />
                          <button onClick={() => salvarValor(p)} disabled={salvandoValor} className="p-1 text-emerald-700"><Check size={14} /></button>
                          <button onClick={() => setEditandoValorId(null)} className="p-1 text-gray-400"><X size={14} /></button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className={p.valorEmpresa !== null ? 'font-semibold text-emerald-700' : 'text-gray-400'}>
                            {brl(p.valorEmpresa)}
                          </span>
                          {podeEditar && (
                            <button onClick={() => iniciarEdicaoValor(p)} className="p-1 text-gray-400"><Pencil size={13} /></button>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {aba === 'combos' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {podeCriar && (
              <button onClick={abrirNovoCombo}
                className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-shrink-0">
                <PackagePlus size={15} /> Novo Combo
              </button>
            )}
            {combos.length > 0 && (
              <div className="relative sm:max-w-xs w-full">
                <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                <input type="text" value={buscaCombos} onChange={e => setBuscaCombos(e.target.value)}
                  placeholder="Buscar combo por nome..." className={`${inputCls} pl-8`} />
              </div>
            )}
          </div>
          {combos.length === 0 ? (
            <div className="text-center py-14 text-gray-400 text-sm">
              Nenhum combo cadastrado{podeGerirEmpresa ? ' — crie o primeiro combo de procedimentos da empresa.' : '.'}
            </div>
          ) : combosFiltrados.length === 0 ? (
            <div className="text-center py-14 text-gray-400 text-sm">
              Nenhum combo encontrado para &ldquo;{buscaCombos}&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
              {combosFiltrados.map(c => (
                <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900 text-sm truncate">{c.nome}</p>
                      {/* TODAS as especialidades do combo, uma por selo — ver
                          `especialidadesDoCombo`. */}
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {especialidadesDoCombo(c).map(esp => (
                          <span key={esp} className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                            {esp}
                          </span>
                        ))}
                      </div>
                      {c.descricao && <p className="text-[11px] text-gray-400 mt-0.5">{c.descricao}</p>}
                    </div>
                    <span className="text-sm font-bold text-emerald-700 flex-shrink-0">{brl(c.valor)}</span>
                  </div>
                  <ul className="mt-2 space-y-1 flex-1">
                    {c.itens.map(i => (
                      <li key={i.id} className="text-xs text-gray-600 flex items-center gap-1.5">
                        <Check size={11} className="text-emerald-500 flex-shrink-0" />
                        <span className="truncate">{i.procedimento.nome}</span>
                      </li>
                    ))}
                  </ul>
                  {(podeEditar || podeExcluir) && (
                    <div className="flex justify-end gap-1 mt-3 pt-2 border-t border-gray-50">
                      {podeEditar && (
                        <button onClick={() => abrirEdicaoCombo(c)} className="p-1.5 text-gray-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg" title="Editar">
                          <Pencil size={14} />
                        </button>
                      )}
                      {podeExcluir && (
                        <button onClick={() => setComboExcluir(c)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Excluir">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modal: novo procedimento (ADMIN) ── */}
      {showNovoProc && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-2xl">
              <h3 className="font-bold text-gray-900">Novo Procedimento (catálogo)</h3>
              <button onClick={() => setShowNovoProc(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nome *</label>
                <input value={formProc.nome} onChange={e => setFormProc(f => ({ ...f, nome: e.target.value }))} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Categoria *</label>
                  <input value={formProc.categoria} onChange={e => setFormProc(f => ({ ...f, categoria: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Valor padrão</label>
                  <input type="text" inputMode="numeric" placeholder="R$ 0,00" value={formProc.valorVenda}
                    onChange={e => setFormProc(f => ({ ...f, valorVenda: maskBRL(e.target.value) }))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Especialidade</label>
                <DropdownSelect
                  value={formProc.especialidade}
                  onChange={especialidade => setFormProc(f => ({ ...f, especialidade }))}
                  options={especialidades}
                  placeholder="— Sem especialidade —"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Descrição</label>
                <textarea value={formProc.descricao} onChange={e => setFormProc(f => ({ ...f, descricao: e.target.value }))}
                  rows={3} className={inputCls} />
              </div>
            </div>
            <InlineError message={erroProc} className="mx-5 mt-3" />

            <div className="flex gap-3 px-5 pb-5 pt-3 border-t border-gray-100">
              <button onClick={() => setShowNovoProc(false)} disabled={salvandoProc}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50">Cancelar</button>
              <button onClick={salvarNovoProc} disabled={salvandoProc}
                className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                {salvandoProc && <Loader2 size={13} className="animate-spin" />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: combo (gestor) ── */}
      {showCombo && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-gray-100 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-2xl">
              <h3 className="font-bold text-gray-900">{comboEditando ? 'Editar Combo' : 'Novo Combo de Procedimentos'}</h3>
              <button onClick={() => setShowCombo(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Nome do combo *</label>
                  <input value={comboNome} onChange={e => setComboNome(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Especialidade *</label>
                  {/* DOIS papéis: classifica o combo (badge do card, filtro do Orçamento)
                      e escolhe o que a lista de procedimentos mostra. Trocá-la troca a
                      lista, mas NÃO limpa o que já foi marcado — é assim que se reúnem
                      áreas diferentes no mesmo pacote. */}
                  <DropdownSelect
                    value={comboEsp}
                    onChange={v => { setComboEsp(v); setComboBusca(''); }}
                    options={especialidades}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Valor do combo *</label>
                  <input type="text" inputMode="numeric" placeholder="R$ 0,00" value={comboValor}
                    onChange={e => setComboValor(maskBRL(e.target.value))} className={inputCls} />
                  {comboIds.length > 0 && somaItensCombo > 0 && (
                    <p className="text-[10px] text-gray-400 mt-1">Soma dos itens avulsos: {brl(somaItensCombo)}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Descrição</label>
                  <input value={comboDesc} onChange={e => setComboDesc(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Procedimentos do combo * <span className="text-gray-400">({comboIds.length} selecionado{comboIds.length !== 1 ? 's' : ''} — mínimo 2)</span>
                </label>
                {/* Selecionados de QUALQUER especialidade. A lista abaixo só mostra a
                    especialidade escolhida no seletor, então sem estes chips o item de
                    outra área ficaria no combo sem forma de conferir nem de remover. */}
                {procsSelecionados.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {procsSelecionados.map(p => (
                      <span key={p.id}
                        className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg pl-2 pr-1 py-0.5 text-[11px] max-w-full">
                        <span className="truncate">{p.nome}</span>
                        {p.especialidade && p.especialidade !== comboEsp && (
                          <span className="text-emerald-600/70 whitespace-nowrap">· {p.especialidade}</span>
                        )}
                        <button type="button" title="Remover do combo"
                          onClick={() => setComboIds(prev => prev.filter(i => i !== p.id))}
                          className="p-0.5 text-emerald-600 hover:text-red-600 rounded">
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input type="text" value={comboBusca} onChange={e => setComboBusca(e.target.value)}
                    disabled={!comboEsp}
                    placeholder={comboEsp ? 'Buscar procedimento...' : 'Selecione a especialidade primeiro'}
                    className={`${inputCls} pl-8 ${!comboEsp ? 'bg-gray-50 cursor-not-allowed' : ''}`} />
                </div>
                <div className="border border-gray-200 rounded-xl max-h-52 overflow-y-auto divide-y divide-gray-50">
                  {!comboEsp ? (
                    <p className="text-xs text-gray-400 p-3">Selecione a especialidade para listar os procedimentos.</p>
                  ) : procsCombo.length === 0 ? (
                    <p className="text-xs text-gray-400 p-3">
                      {comboBusca.trim() ? 'Nenhum procedimento encontrado para a busca.' : `Nenhum procedimento em ${comboEsp}.`}
                    </p>
                  ) : procsCombo.map(p => {
                    const sel = comboIds.includes(p.id);
                    return (
                      <button key={p.id} type="button"
                        onClick={() => setComboIds(prev => sel ? prev.filter(i => i !== p.id) : [...prev, p.id])}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${sel ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                        <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${sel ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
                          {sel && <Check size={11} className="text-white" />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-gray-900 truncate">{p.nome}</span>
                          <span className="block text-[10px] text-gray-400 truncate">
                            {p.categoria} · {brl(p.valorEmpresa ?? p.valorVenda)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {/* Rodapé no padrão da aplicação: ações à DIREITA, tamanho padrão, Cancelar
                ao lado do Salvar. Eram dois botões `flex-1` de largura total — o
                Cancelar com o mesmo peso visual do Salvar. O rótulo é só "Salvar" nos
                dois modos: o que muda é o estado do formulário, não a ação (o título
                do modal já diz se é novo ou edição). */}
            <div className="flex items-center justify-end gap-3 px-5 pb-5 pt-3 border-t border-gray-100">
              <button onClick={() => setShowCombo(false)} disabled={salvandoCombo}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-semibold hover:bg-gray-50 disabled:opacity-50 transition-colors">
                Cancelar
              </button>
              <button onClick={salvarCombo} disabled={salvandoCombo}
                className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2">
                {salvandoCombo && <Loader2 size={13} className="animate-spin" />}
                {salvandoCombo ? 'Salvando…' : 'Salvar'}
              </button>
            </div>

            {/* Erro ABAIXO do botão que o disparou (CLAUDE.md §6) — estava ACIMA do
                rodapé, e num modal que rola o usuário clicava em Salvar sem ver nada. */}
            {erroCombo && (
              <div className="px-5 pb-5">
                <InlineError message={erroCombo} />
              </div>
            )}
          </div>
        </div>
      )}

      <ModalJustificativa
        aberto={comboExcluir !== null}
        titulo="Excluir combo"
        descricao={comboExcluir ? `O combo "${comboExcluir.nome}" será excluído. Esta ação será registrada na auditoria.` : undefined}
        acaoLabel="Excluir"
        onConfirmar={excluirCombo}
        onFechar={() => setComboExcluir(null)}
      />
    </PageContainer>
  );
}

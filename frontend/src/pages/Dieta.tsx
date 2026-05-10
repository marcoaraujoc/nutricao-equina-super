import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import {
  ArrowLeft, Plus, Save, Pencil, Trash2,
  Check, X, Search, ToggleLeft, ToggleRight, Printer,
} from 'lucide-react';
import { gerarHtmlDieta } from '../utils/Dietaprint';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Animal = NonNullable<ReturnType<typeof useSelectedAnimal>['selectedAnimal']>;
type AnimalExtended = Animal & {
  dataNascimento?: string | Date | null;
  raca?: { nome: string } | null;
  user?: { fullName: string; email: string } | null;
};

interface PlanoDieta {
  id: number;
  animalId: number;
  nome: string;
  ativo: boolean;
  dataCriacao: string;
  _count?: { itens: number };
}

interface Alimento {
  id: number;
  nome: string;
}

interface DietaItem {
  id: number;
  alimentoId: number;
  planoDietaId?: number | null;
  alimento?: { nome: string } | null;
  periodicidade: string;
  qtdGramasDia: number;
  unidade: string;
  horario?: string | null;
}

interface EditItemValues {
  alimentoId: string;
  qtdGramasDia: string;
  unidade: string;
  horario: string;
  periodicidade: string;
}

type FeedbackState = { tipo: 'sucesso' | 'info' | 'erro'; mensagem: string } | null;
type FiltroAtivo = 'todos' | 'ativos' | 'inativos';

// ─── Helpers de snapshot ──────────────────────────────────────────────────────

type ItemSnapshot = Pick<DietaItem, 'id' | 'qtdGramasDia' | 'periodicidade' | 'unidade' | 'horario'>;

const snapshotKey = (planoDietaId: string) => `dieta_snapshot_plano_${planoDietaId}`;

const salvarSnapshot = (planoDietaId: string, itens: DietaItem[]) => {
  const snap: ItemSnapshot[] = itens.map(({ id, qtdGramasDia, periodicidade, unidade, horario }) => ({
    id, qtdGramasDia, periodicidade, unidade, horario,
  }));
  sessionStorage.setItem(snapshotKey(planoDietaId), JSON.stringify(snap));
};

const lerSnapshot = (planoDietaId: string): ItemSnapshot[] => {
  try {
    const raw = sessionStorage.getItem(snapshotKey(planoDietaId));
    return raw ? (JSON.parse(raw) as ItemSnapshot[]) : [];
  } catch { return []; }
};

const itensForamAlterados = (snapshot: ItemSnapshot[], atual: DietaItem[]): boolean => {
  if (snapshot.length !== atual.length) return true;
  const sort = <T extends { id: number }>(a: T[]) => [...a].sort((x, y) => x.id - y.id);
  return sort(snapshot).some((s, i) => {
    const c = sort(atual)[i];
    return s.id !== c.id || s.qtdGramasDia !== c.qtdGramasDia
      || s.periodicidade !== c.periodicidade || s.unidade !== c.unidade
      || s.horario !== c.horario;
  });
};

// ─── Helpers de data ──────────────────────────────────────────────────────────

const formatarDataBR = (data: string | Date | null | undefined): string => {
  if (!data) return '-';
  const d = new Date(data instanceof Date ? data.toISOString() : data);
  if (isNaN(d.getTime())) return '-';
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

// ─── Classe base para inputs de edição (fix: texto sempre gray-900) ───────────
const inputClass = 'border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-500 w-full';
const selectClass = 'border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-500 w-full';

// ─── Componente de feedback ───────────────────────────────────────────────────

const FeedbackBanner = ({ feedback, onClose }: { feedback: FeedbackState; onClose: () => void }) => {
  if (!feedback) return null;
  const styles = {
    sucesso: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    erro:    'bg-red-50 text-red-700 border-red-200',
    info:    'bg-blue-50 text-blue-700 border-blue-200',
  };
  const icons = { sucesso: '✅', erro: '❌', info: 'ℹ️' };
  return (
    <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium flex items-center justify-between gap-3 border ${styles[feedback.tipo]}`}>
      <span>{icons[feedback.tipo]} {feedback.mensagem}</span>
      <button onClick={onClose} className="opacity-50 hover:opacity-100 leading-none">✕</button>
    </div>
  );
};

// ─── Card do animal ───────────────────────────────────────────────────────────

const AnimalCard = ({ animal, user }: { animal: AnimalExtended; user: ReturnType<typeof useAuth>['user'] }) => (
  <div className="bg-white rounded-2xl shadow p-2.5 flex gap-3 mb-4">
    <div className="w-24 self-stretch bg-gray-200 rounded-xl overflow-hidden flex-shrink-0">
      <img
        src={animal.photoUrl ?? 'https://picsum.photos/id/1015/400/400'}
        alt={animal.nome}
        className="w-full h-full object-cover"
      />
    </div>
    <div className="flex-1 flex flex-col justify-between">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <span className="text-[11px] text-gray-500">Nome</span>
          <p className="text-lg font-semibold text-gray-900 leading-tight">{animal.nome}</p>
        </div>
        <div>
          <span className="text-[11px] text-gray-500">Nascimento</span>
          <p className="text-xs text-gray-900">{formatarDataBR(animal.dataNascimento)}</p>
        </div>
        <div>
          <span className="text-[11px] text-gray-500">Raça</span>
          <p className="text-xs text-gray-900">{animal.raca?.nome ?? 'Não informada'}</p>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t">
        <span className="text-[11px] text-gray-500 block">Proprietário</span>
        <p className="text-xs font-medium text-gray-900">{animal.user?.fullName ?? user?.fullName}</p>
        <p className="text-[11px] text-gray-500 truncate">{animal.user?.email ?? user?.email}</p>
      </div>
    </div>
  </div>
);

// ─── Componente principal ─────────────────────────────────────────────────────

const Dieta = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal, refreshSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const location = useLocation();
  const { animalId } = useParams<{ animalId?: string }>();

  const effectiveAnimalId = animalId || selectedAnimal?.id?.toString();

  const itensRef = useRef<HTMLDivElement>(null);

  // ── Estado compartilhado ───────────────────────────────────────────────────
  const [animal, setAnimal]                         = useState<AnimalExtended | null>(null);
  const [animaisDoProprietario, setAnimaisDoProprietario] = useState<AnimalExtended[]>([]);
  const [feedback, setFeedback]                     = useState<FeedbackState>(null);
  const [loading, setLoading]                       = useState(true);
  const [loadingItens, setLoadingItens]             = useState(false);

  // ── Planos ────────────────────────────────────────────────────────────────
  const [planos, setPlanos]           = useState<PlanoDieta[]>([]);
  const [search, setSearch]           = useState('');
  const [filtroAtivo, setFiltroAtivo] = useState<FiltroAtivo>('todos');
  const [criandoPlano, setCriandoPlano]     = useState(false);
  const [novoPlanoNome, setNovoPlanoNome]   = useState('');
  const [editandoPlanoId, setEditandoPlanoId] = useState<number | null>(null);
  const [editandoNome, setEditandoNome]         = useState('');

  // ── Plano selecionado + itens ──────────────────────────────────────────────
  const [planoSelecionado, setPlanoSelecionado] = useState<PlanoDieta | null>(null);
  const [itens, setItens]                       = useState<DietaItem[]>([]);
  const [alimentos, setAlimentos]               = useState<Alimento[]>([]);
  const [itemParaExcluir, setItemParaExcluir]   = useState<DietaItem | null>(null);

  // ── Edição inline de itens ─────────────────────────────────────────────────
  const [editingItemId, setEditingItemId]     = useState<number | null>(null);
  const [editItemValues, setEditItemValues]   = useState<EditItemValues>({
    alimentoId: '', qtdGramasDia: '', unidade: '', horario: '', periodicidade: '',
  });
  // Alimentos com frequências conflitantes no plano atual
  const [conflitosFrequencia, setConflitosFrequencia] = useState<string[]>([]);

  // ── Feedback ───────────────────────────────────────────────────────────────
  const exibirFeedback = (tipo: 'sucesso' | 'info' | 'erro', mensagem: string) => {
    setFeedback({ tipo, mensagem });
    setTimeout(() => setFeedback(null), 5000);
  };

  useEffect(() => {
    if (location.state?.mensagem) {
      exibirFeedback('sucesso', location.state.mensagem);
      window.history.replaceState({}, '');
    }
  }, []);

  // ── Loaders ────────────────────────────────────────────────────────────────
  const carregarAnimal = useCallback(async () => {
    if (!effectiveAnimalId) return;
    try {
      const res = await api.get(`/animais/${effectiveAnimalId}`);
      const animalAtual = res.data as AnimalExtended;
      setAnimal(animalAtual);
      setSelectedAnimal(animalAtual);
      await refreshSelectedAnimal?.();
    } catch (err) { console.error('Erro ao carregar animal:', err); }
  }, [effectiveAnimalId]);

  const carregarAnimais = useCallback(async () => {
    try {
      const res = await api.get('/animais');
      setAnimaisDoProprietario(res.data as AnimalExtended[]);
    } catch (err) { console.error('Erro ao carregar animais:', err); }
  }, []);

  const carregarAlimentos = useCallback(async () => {
    try {
      const res = await api.get('/alimentos');
      setAlimentos(res.data as Alimento[]);
    } catch (err) { console.error('Erro ao carregar alimentos:', err); }
  }, []);

  const carregarPlanos = useCallback(async () => {
    if (!effectiveAnimalId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (filtroAtivo !== 'todos') params.set('ativo', filtroAtivo === 'ativos' ? 'true' : 'false');
      const endpoint = search.trim() || filtroAtivo !== 'todos'
        ? `/dietas/planos/animal/${effectiveAnimalId}/buscar?${params}`
        : `/dietas/planos/animal/${effectiveAnimalId}`;
      const res = await api.get(endpoint);
      setPlanos(res.data.dados ?? []);
    } catch (err) {
      console.error(err);
      exibirFeedback('erro', 'Erro ao carregar planos de dieta');
    } finally {
      setLoading(false);
    }
  }, [effectiveAnimalId, search, filtroAtivo]);

  const carregarItens = useCallback(async (planId: number) => {
    setLoadingItens(true);
    setEditingItemId(null);
    setConflitosFrequencia([]);
    try {
      const [planoRes, itensRes] = await Promise.all([
        api.get(`/dietas/planos/${planId}`),
        api.get(`/dietas/plano/${planId}/itens`),
      ]);
      const plano      = planoRes.data.dados as PlanoDieta;
      const itensList  = itensRes.data.dados as DietaItem[];
      setPlanoSelecionado(plano);
      setItens(itensList);

      // ── Detecta alimentos com frequências diferentes no mesmo plano ──────
      const freqPorAlimento  = new Map<number, Set<string>>();
      const nomesPorAlimento = new Map<number, string>();
      itensList.forEach(item => {
        if (!freqPorAlimento.has(item.alimentoId)) {
          freqPorAlimento.set(item.alimentoId, new Set());
        }
        freqPorAlimento.get(item.alimentoId)!.add(item.periodicidade);
        nomesPorAlimento.set(item.alimentoId, item.alimento?.nome ?? String(item.alimentoId));
      });
      const conflitos: string[] = [];
      freqPorAlimento.forEach((freqs, alimentoId) => {
        if (freqs.size > 1) {
          conflitos.push(`${nomesPorAlimento.get(alimentoId)} (${[...freqs].join(' + ')})`);
        }
      });
      setConflitosFrequencia(conflitos);

      const key = snapshotKey(String(planId));
      if (!sessionStorage.getItem(key)) salvarSnapshot(String(planId), itensList);
    } catch (err) {
      console.error(err);
      exibirFeedback('erro', 'Erro ao carregar itens da dieta');
    } finally {
      setLoadingItens(false);
    }
  }, []);

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    carregarAnimal();
    carregarAnimais();
    carregarAlimentos();
  }, [effectiveAnimalId]);

  useEffect(() => { carregarPlanos(); }, [effectiveAnimalId, search, filtroAtivo]);

  // ── Impressão — delega ao utilitário dietaPrint.ts ────────────────────────
  const dispararImpressao = () => {
    if (!planoSelecionado) return;
    const pw = window.open('', '_blank', 'width=900,height=700');
    if (!pw) {
      exibirFeedback('erro', 'Popup bloqueado. Permita popups neste site para imprimir.');
      return;
    }
    pw.document.write(gerarHtmlDieta(animal, planoSelecionado, itens, user));
    pw.document.close();
  };

  // ── Toggle ativo/inativo do plano selecionado ──────────────────────────────
  const handleTogglePlanoSelecionado = async () => {
    if (!planoSelecionado) return;
    try {
      const res      = await api.patch(`/dietas/planos/${planoSelecionado.id}/toggle`);
      const atualizado = res.data.dados as PlanoDieta;
      setPlanoSelecionado(atualizado);
      setPlanos(prev => prev.map(p => p.id === atualizado.id ? { ...p, ativo: atualizado.ativo } : p));
    } catch (err) { console.error(err); exibirFeedback('erro', 'Erro ao alterar status'); }
  };

  // ── Selecionar plano inline ────────────────────────────────────────────────
  const handleSelecionarPlano = (plano: PlanoDieta) => {
    if (planoSelecionado?.id === plano.id) {
      setPlanoSelecionado(null);
      setItens([]);
      setEditingItemId(null);
      return;
    }
    carregarItens(plano.id);
    setTimeout(() => itensRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  };

  // ── Handlers: planos ──────────────────────────────────────────────────────
  const handleCriarPlano = async () => {
    if (!novoPlanoNome.trim()) { exibirFeedback('erro', 'Informe um nome para o plano'); return; }
    try {
      await api.post('/dietas/planos', { animalId: Number(effectiveAnimalId), nome: novoPlanoNome.trim() });
      setNovoPlanoNome(''); setCriandoPlano(false);
      exibirFeedback('sucesso', 'Plano criado com sucesso!');
      carregarPlanos();
    } catch (err) { console.error(err); exibirFeedback('erro', 'Erro ao criar plano'); }
  };

  const handleSalvarNomePlano = async (id: number) => {
    if (!editandoNome.trim()) { exibirFeedback('erro', 'O nome não pode ser vazio'); return; }
    try {
      await api.put(`/dietas/planos/${id}`, { nome: editandoNome.trim() });
      setEditandoPlanoId(null);
      if (planoSelecionado?.id === id) {
        setPlanoSelecionado(prev => prev ? { ...prev, nome: editandoNome.trim() } : prev);
      }
      carregarPlanos();
    } catch (err) { console.error(err); exibirFeedback('erro', 'Erro ao atualizar nome'); }
  };

  const handleTogglePlano = async (plano: PlanoDieta) => {
    try {
      await api.patch(`/dietas/planos/${plano.id}/toggle`);
      carregarPlanos();
      if (planoSelecionado?.id === plano.id) {
        setPlanoSelecionado(prev => prev ? { ...prev, ativo: !prev.ativo } : prev);
      }
    } catch (err) { console.error(err); exibirFeedback('erro', 'Erro ao alterar status do plano'); }
  };

  // ── Handlers: itens ────────────────────────────────────────────────────────

  // Retorna a periodicidade já registrada para este alimento no plano (ignora o item editado).
  // Regra: o mesmo alimento só pode ter UMA periodicidade dentro de um plano.
  const periodicidadeConflitante = (
    alimentoIdNum: number,
    excludeItemId?: number,
  ): string | null => {
    const encontrado = itens.find(
      i => i.alimentoId === alimentoIdNum &&
           (excludeItemId === undefined || i.id !== excludeItemId),
    );
    return encontrado?.periodicidade ?? null;
  };
  const handleStartEditItem = (item: DietaItem) => {
    setEditingItemId(item.id);
    setEditItemValues({
      alimentoId:   String(item.alimentoId),
      qtdGramasDia: String(item.qtdGramasDia),
      unidade:      item.unidade,
      horario:      item.horario ?? '',
      periodicidade: item.periodicidade,
    });
  };

  const handleCancelEditItem = () => {
    setEditingItemId(null);
    setEditItemValues({ alimentoId: '', qtdGramasDia: '', unidade: '', horario: '', periodicidade: '' });
  };

  const handleSaveEditItem = async (id: number) => {
    const alimentoIdNum  = Number(editItemValues.alimentoId);
    const periExistente  = periodicidadeConflitante(alimentoIdNum, id);

    if (periExistente && periExistente !== editItemValues.periodicidade) {
      exibirFeedback(
        'erro',
        `"${alimentos.find(a => a.id === alimentoIdNum)?.nome ?? 'Este alimento'}" já está cadastrado com frequência "${periExistente}". Altere a frequência para "${periExistente}" ou remova o outro item antes de mudar.`,
      );
      return;
    }

    try {
      await api.put(`/dietas/${id}`, {
        alimentoId:   Number(editItemValues.alimentoId),
        qtdGramasDia: Number(editItemValues.qtdGramasDia),
        unidade:      editItemValues.unidade,
        horario:      editItemValues.horario || null,
        periodicidade: editItemValues.periodicidade,
      });
      setEditingItemId(null);
      exibirFeedback('sucesso', 'Alimento atualizado');
      if (planoSelecionado) carregarItens(planoSelecionado.id);
    } catch (err) { console.error(err); exibirFeedback('erro', 'Erro ao atualizar alimento'); }
  };

  const handleExcluirItem = async () => {
    if (!itemParaExcluir || !planoSelecionado) return;
    try {
      await api.delete(`/dietas/${itemParaExcluir.id}`);
      setItemParaExcluir(null);
      sessionStorage.removeItem(snapshotKey(String(planoSelecionado.id)));
      exibirFeedback('sucesso', 'Alimento removido da dieta');
      carregarItens(planoSelecionado.id);
    } catch (err) { console.error(err); exibirFeedback('erro', 'Erro ao excluir alimento'); }
  };

  const handleSalvarDieta = () => {
    if (!planoSelecionado) return;
    if (itens.length === 0) { exibirFeedback('erro', 'Adicione ao menos um alimento antes de salvar'); return; }
    const planId = String(planoSelecionado.id);
    if (!itensForamAlterados(lerSnapshot(planId), itens)) {
      exibirFeedback('info', 'Nenhuma alteração foi realizada na dieta'); return;
    }
    salvarSnapshot(planId, itens);
    exibirFeedback('sucesso', 'Dieta salva com sucesso!');
  };

  const handleAnimalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = animaisDoProprietario.find((a) => a.id === Number(e.target.value));
    if (selected) {
      setSelectedAnimal(selected);
      setPlanoSelecionado(null);
      setItens([]);
      setEditingItemId(null);
      navigate(`/dieta/${selected.id}`);
    }
  };

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!effectiveAnimalId || (!animal && loading)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Carregando...</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 pt-6 pb-10">
      <div className="max-w-3xl mx-auto px-4">

        {/* Voltar */}
        <div className="mb-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
          >
            <ArrowLeft size={20} />
            <span className="text-sm">Voltar</span>
          </button>
        </div>

        {/* Seletor de animal */}
        {animaisDoProprietario.length > 1 && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Animal</label>
            <select
              value={effectiveAnimalId}
              onChange={handleAnimalChange}
              className="w-full rounded-2xl border border-gray-300 p-3 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600"
            >
              {animaisDoProprietario.map((a) => (
                <option key={a.id} value={a.id}>{a.nome}</option>
              ))}
            </select>
          </div>
        )}

        {animal && <AnimalCard animal={animal} user={user} />}

        <FeedbackBanner feedback={feedback} onClose={() => setFeedback(null)} />

        {/* ── Busca + novo plano ──────────────────────────────────────────── */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar plano..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600"
            />
          </div>
          <button
            onClick={() => { setCriandoPlano(true); setNovoPlanoNome(''); }}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-medium transition-colors"
          >
            <Plus size={15} /> Novo plano
          </button>
        </div>

        {/* Filtros */}
        <div className="flex gap-2 mb-4">
          {(['todos', 'ativos', 'inativos'] as FiltroAtivo[]).map((f) => (
            <button
              key={f}
              onClick={() => setFiltroAtivo(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
                filtroAtivo === f
                  ? 'bg-emerald-700 text-white'
                  : 'bg-white border border-gray-300 text-gray-600 hover:border-emerald-500'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Form novo plano */}
        {criandoPlano && (
          <div className="bg-white rounded-2xl shadow border border-emerald-200 p-4 mb-3 flex gap-2 items-center">
            <input
              autoFocus
              type="text"
              placeholder="Nome do plano..."
              value={novoPlanoNome}
              onChange={(e) => setNovoPlanoNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCriarPlano(); if (e.key === 'Escape') setCriandoPlano(false); }}
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600"
            />
            <button onClick={handleCriarPlano} className="p-2 text-emerald-700 hover:text-emerald-800"><Check size={18} /></button>
            <button onClick={() => setCriandoPlano(false)} className="p-2 text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
        )}

        {/* ── Lista de planos ─────────────────────────────────────────────── */}
        {loading ? (
          <p className="text-center py-12 text-gray-400 text-sm">Carregando planos...</p>
        ) : planos.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">Nenhum plano de dieta encontrado.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {planos.map((plano) => {
              const isSelecionado = planoSelecionado?.id === plano.id;

              return (
                <div
                  key={plano.id}
                  className={`bg-white rounded-2xl shadow border transition-colors ${
                    isSelecionado ? 'border-emerald-400' : 'border-gray-100'
                  } p-4`}
                >
                  {editandoPlanoId === plano.id ? (
                    <div className="flex gap-2 items-center">
                      <input
                        autoFocus
                        type="text"
                        value={editandoNome}
                        onChange={(e) => setEditandoNome(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSalvarNomePlano(plano.id);
                          if (e.key === 'Escape') setEditandoPlanoId(null);
                        }}
                        /* FIX: text-gray-900 garante texto visível */
                        className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600"
                      />
                      <button onClick={() => handleSalvarNomePlano(plano.id)} className="p-1.5 text-emerald-700 hover:text-emerald-800"><Check size={16} /></button>
                      <button onClick={() => setEditandoPlanoId(null)} className="p-1.5 text-gray-400 hover:text-gray-600"><X size={16} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">

                      {/* Info clicável */}
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => handleSelecionarPlano(plano)}
                      >
                        <p className="text-sm font-semibold text-gray-900 truncate">{plano.nome}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {plano._count?.itens ?? 0} {plano._count?.itens === 1 ? 'alimento' : 'alimentos'}
                        </p>
                      </div>

                      {/* Status */}
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${
                        plano.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {plano.ativo ? 'Ativo' : 'Inativo'}
                      </span>

                      {/* Ações da linha */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleSelecionarPlano(plano)}
                          className="text-xs text-emerald-700 font-medium hover:underline px-2"
                        >
                          {isSelecionado ? 'Fechar' : 'Ver'}
                        </button>
                        <button
                          onClick={() => navigate(`/dieta/${effectiveAnimalId}/plano/${plano.id}/novo`)}
                          className="text-xs text-emerald-600 font-medium hover:underline px-2 border-l border-gray-200 ml-1 pl-2"
                        >
                          + Alimento
                        </button>
                        <button
                          onClick={() => { setEditandoPlanoId(plano.id); setEditandoNome(plano.nome); }}
                          className="p-1.5 text-gray-400 hover:text-gray-700"
                          aria-label="Editar nome"
                        >
                          <Pencil size={14} />
                        </button>
                        {/* Toggle restaurado na lista */}
                        <button
                          onClick={() => handleTogglePlano(plano)}
                          className="p-1.5 text-gray-400 hover:text-emerald-600"
                          aria-label="Ativar/Desativar"
                        >
                          {plano.ativo ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Seção de itens do plano selecionado ─────────────────────────── */}
        {planoSelecionado && (
          <div ref={itensRef} className="mt-6">

            {/* Cabeçalho do plano — Toggle + Imprimir */}
            <div className="bg-white rounded-2xl shadow p-4 mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Plano de dieta</p>
                <p className="text-base font-semibold text-gray-900">{planoSelecionado.nome}</p>
              </div>
              <div className="flex items-center gap-2">
                {/* Toggle ativo/inativo (restaurado) */}
                <button
                  onClick={handleTogglePlanoSelecionado}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    planoSelecionado.ativo
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {planoSelecionado.ativo
                    ? <><ToggleRight size={15} /> Ativo</>
                    : <><ToggleLeft size={15} /> Inativo</>}
                </button>
                {/* Imprimir */}
                <button
                  onClick={dispararImpressao}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors bg-gray-100 text-gray-600 hover:bg-gray-200"
                  aria-label="Imprimir plano de dieta"
                >
                  <Printer size={14} /> Imprimir
                </button>
              </div>
            </div>

            {/* Aviso de conflito de frequências */}
            {conflitosFrequencia.length > 0 && (
              <div className="mb-4 px-4 py-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-800">
                <p className="font-semibold mb-1">⚠️ Conflito de frequências detectado</p>
                <p className="text-xs">
                  Os seguintes alimentos estão cadastrados com mais de uma frequência no mesmo plano.
                  Isso não é permitido — edite ou remova as entradas duplicadas:
                </p>
                <ul className="mt-1.5 list-disc list-inside text-xs space-y-0.5">
                  {conflitosFrequencia.map(c => <li key={c}>{c}</li>)}
                </ul>
              </div>
            )}

            {/* Botões de ação */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => navigate(`/dieta/${effectiveAnimalId}/plano/${planoSelecionado.id}/novo`)}
                className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <Plus size={16} /> Adicionar alimento
              </button>
              <button
                onClick={handleSalvarDieta}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <Save size={16} /> Salvar dieta
              </button>
            </div>

            {/* Tabela de itens com edição inline */}
            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <div className="px-4 py-3 border-b bg-gray-50">
                <h2 className="text-sm font-semibold text-gray-900">Alimentos da Dieta</h2>
              </div>

              {loadingItens ? (
                <p className="text-center py-8 text-gray-400 text-sm">Carregando...</p>
              ) : itens.length === 0 ? (
                <p className="text-center py-8 text-gray-400 text-sm">Nenhum alimento cadastrado ainda.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left px-4 py-2 font-medium text-gray-500">Alimento</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-500">Horário</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-500">Qtd</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-500">Unidade</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-500">Frequência</th>
                        <th className="text-right px-4 py-2 font-medium text-gray-500 w-24">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itens.map((item) => {
                        const isEditing = editingItemId === item.id;

                        return (
                          <tr key={item.id} className="border-b last:border-none hover:bg-gray-50">
                            {isEditing ? (
                              /* ── Linha em modo edição inline ─────────── */
                              <>
                                <td className="px-2 py-2">
                                  {/* FIX: text-gray-900 via selectClass */}
                                  <select
                                    value={editItemValues.alimentoId}
                                    onChange={(e) => setEditItemValues(v => ({ ...v, alimentoId: e.target.value }))}
                                    className={selectClass}
                                  >
                                    <option value="">— Selecionar —</option>
                                    {alimentos.map(a => (
                                      <option key={a.id} value={a.id}>{a.nome}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-2 py-2">
                                  <input
                                    type="time"
                                    value={editItemValues.horario}
                                    onChange={(e) => setEditItemValues(v => ({ ...v, horario: e.target.value }))}
                                    className={inputClass}
                                  />
                                </td>
                                <td className="px-2 py-2">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={editItemValues.qtdGramasDia}
                                    onChange={(e) => setEditItemValues(v => ({ ...v, qtdGramasDia: e.target.value }))}
                                    className={`${inputClass} w-20`}
                                  />
                                </td>
                                <td className="px-2 py-2">
                                  <select
                                    value={editItemValues.unidade}
                                    onChange={(e) => setEditItemValues(v => ({ ...v, unidade: e.target.value }))}
                                    className={selectClass}
                                  >
                                    {['kg', 'g', 'L', 'mL', 'unidade', 'porção'].map(u => (
                                      <option key={u} value={u}>{u}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-2 py-2">
                                  <select
                                    value={editItemValues.periodicidade}
                                    onChange={(e) => setEditItemValues(v => ({ ...v, periodicidade: e.target.value }))}
                                    className={selectClass}
                                  >
                                    {['Diário', '2x ao dia', '3x ao dia', 'Semanal', 'Quinzenal'].map(f => (
                                      <option key={f} value={f}>{f}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-2 py-2 text-right">
                                  <div className="flex justify-end gap-2">
                                    <button
                                      onClick={() => handleSaveEditItem(item.id)}
                                      className="text-emerald-600 hover:text-emerald-700 font-medium text-xs"
                                    >
                                      Salvar
                                    </button>
                                    <button
                                      onClick={handleCancelEditItem}
                                      className="text-gray-400 hover:text-gray-600 text-xs"
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              /* ── Linha em modo visualização ──────────── */
                              <>
                                <td className="px-4 py-3 text-gray-900">{item.alimento?.nome}</td>
                                <td className="px-4 py-3 text-gray-700">{item.horario ?? '-'}</td>
                                <td className="px-4 py-3 text-gray-700">{item.qtdGramasDia}</td>
                                <td className="px-4 py-3 text-gray-700">{item.unidade}</td>
                                <td className="px-4 py-3 text-gray-700">{item.periodicidade}</td>
                                <td className="px-4 py-3 text-right flex justify-end gap-3">
                                  <button
                                    onClick={() => handleStartEditItem(item)}
                                    className="text-emerald-600 hover:text-emerald-700"
                                    aria-label="Editar"
                                  >
                                    <Pencil size={15} />
                                  </button>
                                  <button
                                    onClick={() => setItemParaExcluir(item)}
                                    className="text-red-500 hover:text-red-700"
                                    aria-label="Excluir"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Modal excluir item */}
      {itemParaExcluir && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5">
            <h3 className="font-semibold text-lg text-gray-900">Excluir alimento?</h3>
            <p className="mt-2 text-sm text-gray-600">{itemParaExcluir.alimento?.nome}</p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setItemParaExcluir(null)}
                className="flex-1 py-2 border rounded-xl text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleExcluirItem}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dieta;
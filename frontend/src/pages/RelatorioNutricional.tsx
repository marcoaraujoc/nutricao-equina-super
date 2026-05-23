// frontend/src/pages/RelatorioNutricional.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import BotaoVoltar from '../components/BotaoVoltar';
import SeletorAnimal from '../components/SeletorAnimal';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import PageContainer from '../components/PageContainer';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface RelatorioItem {
  nutriente: string;
  unidade: string;
  Total_Dieta: number;
  Exigido_NRC: number | string | null;
  Saldo: number | null;
  Percentual_Atendido: number | null;
  status_nutricional: string;
  [key: string]: string | number | null;
}

interface SnapshotRelatorio {
  planoDietaId?: number;
  fonteCalculo?: string;
  alimentos: string[];
  linhas: RelatorioItem[];
  geradoEm: string;
}

interface Animal {
  id: number;
  nome: string;
  photoUrl?: string;
  dataNascimento?: string;
  idadeAnos?: number | null;
  raca?: { nome: string };
  user?: { fullName: string; email: string };
}

type FiltroStatus =
  | 'todos'
  | 'DEFICIÊNCIA CRÍTICA'
  | 'DEFICIÊNCIA'
  | 'ADEQUADO'
  | 'EXCESSO'
  | 'EXCESSO CRÍTICO'
  | 'SEM REFERÊNCIA';

// ─── Constantes ───────────────────────────────────────────────────────────────

const FILTROS: { label: string; value: FiltroStatus }[] = [
  { label: 'Todos',        value: 'todos'              },
  { label: 'Def. Crítica', value: 'DEFICIÊNCIA CRÍTICA'},
  { label: 'Deficiente',   value: 'DEFICIÊNCIA'        },
  { label: 'Adequado',     value: 'ADEQUADO'           },
  { label: 'Excesso',      value: 'EXCESSO'            },
  { label: 'Exc. Crítico', value: 'EXCESSO CRÍTICO'    },
  { label: 'Sem Ref.',     value: 'SEM REFERÊNCIA'     },
];

const COR_STATUS: Record<string, string> = {
  'DEFICIÊNCIA CRÍTICA': 'bg-red-200 text-red-800',
  'DEFICIÊNCIA':         'bg-red-100 text-red-700',
  'ADEQUADO':            'bg-green-100 text-green-700',
  'EXCESSO':             'bg-orange-100 text-orange-700',
  'EXCESSO CRÍTICO':     'bg-orange-200 text-orange-800',
  'SEM REFERÊNCIA':      'bg-gray-100 text-gray-500',
};

const LABEL_STATUS: Record<string, string> = {
  'DEFICIÊNCIA CRÍTICA': 'Def. Crítica',
  'DEFICIÊNCIA':         'Deficiente',
  'ADEQUADO':            'Adequado',
  'EXCESSO':             'Excesso',
  'EXCESSO CRÍTICO':     'Exc. Crítico',
  'SEM REFERÊNCIA':      'Sem Ref.',
};

// ─── Agrupamento de nutrientes ────────────────────────────────────────────────

const normalizarChave = (nome: string) =>
  (nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const GRUPOS_NUTRIENTES: { grupo: string; chaves: string[] }[] = [
  {
    grupo: 'Energia',
    chaves: ['energia digestivel', 'energia digestível', 'de', 'ed', 'digestible energy'],
  },
  {
    grupo: 'Proteínas / Aminoácidos',
    chaves: [
      'proteina bruta', 'proteína bruta', 'pb', 'cp', 'crude protein',
      'lisina', 'leucina', 'isoleucina', 'valina', 'metionina',
      'triptofano', 'treonina', 'fenilalanina', 'histidina',
    ],
  },
  {
    grupo: 'Minerais',
    chaves: [
      'calcio', 'ferro', 'magnesio', 'zinco', 'potassio', 'sodio', 'fosforo',
      'selenio', 'iodo', 'cobre', 'manganes', 'cobalto', 'enxofre',
      'cloro', 'cloreto', 'chloride',
    ],
  },
  {
    grupo: 'Vitaminas',
    chaves: [
      'vitamina a', 'vitamina b1', 'vitamina b2', 'vitamina b3', 'vitamina b5',
      'vitamina b6', 'vitamina b7', 'vitamina b9', 'vitamina b12',
      'vitamina c', 'vitamina d', 'vitamina e', 'vitamina k',
      'tiamina', 'riboflavina', 'niacina', 'piridoxina', 'biotina',
      'acido folico', 'cobalamina', 'acido ascorbico',
    ],
  },
  {
    grupo: 'Carboidratos',
    chaves: ['glicose', 'frutose', 'sacarose', 'lactose', 'maltose', 'amido'],
  },
  {
    grupo: 'Fibras',
    chaves: ['celulose', 'pectina', 'inulina', 'beta-glucana', 'hemicelulose'],
  },
  {
    grupo: 'Lipídios',
    chaves: [
      'omega-3', 'omega-6', 'omega-9', 'gordura saturada',
      'monoinsaturada', 'poli-insaturada', 'colesterol',
    ],
  },
  {
    grupo: 'Água',
    chaves: ['agua'],
  },
  {
    grupo: 'Antioxidantes',
    chaves: ['licopeno', 'luteina', 'zeaxantina', 'resveratrol', 'flavonoides'],
  },
  {
    grupo: 'Enzimas digestivas',
    chaves: ['lactase', 'amilase', 'lipase', 'protease'],
  },
  {
    grupo: 'Aminoácidos não essenciais',
    chaves: ['alanina', 'arginina', 'glutamina', 'glicina', 'tirosina'],
  },
];

const GRUPOS_ORDEM = GRUPOS_NUTRIENTES.map(g => g.grupo).concat(['Outros']);

const NUTRIENTE_PARA_GRUPO = new Map<string, string>();
for (const { grupo, chaves } of GRUPOS_NUTRIENTES) {
  for (const chave of chaves) {
    NUTRIENTE_PARA_GRUPO.set(normalizarChave(chave), grupo);
  }
}

const resolverGrupo = (nutriente: string): string =>
  NUTRIENTE_PARA_GRUPO.get(normalizarChave(nutriente)) ?? 'Outros';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatarDataBR = (data: string | null | undefined): string => {
  if (!data) return '-';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '-';
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

const calcularIdade = (dataNascimento: string): string => {
  const partes  = dataNascimento.split('T')[0].split('-');
  const anoNasc = parseInt(partes[0]);
  const mesNasc = parseInt(partes[1]) - 1;
  const diaNasc = parseInt(partes[2]);
  const hoje    = new Date();
  const diffMs  = hoje.getTime() - new Date(anoNasc, mesNasc, diaNasc).getTime();
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  let diffMeses  = (hoje.getFullYear() - anoNasc) * 12 + (hoje.getMonth() - mesNasc);
  if (hoje.getDate() < diaNasc) diffMeses--;
  let diffAnos = hoje.getFullYear() - anoNasc;
  if (hoje.getMonth() < mesNasc || (hoje.getMonth() === mesNasc && hoje.getDate() < diaNasc)) diffAnos--;
  if (diffDias < 30)  return `${diffDias} ${diffDias  === 1 ? 'dia'  : 'dias'}`;
  if (diffMeses < 12) return `${diffMeses} ${diffMeses === 1 ? 'mês'  : 'meses'}`;
  return `${diffAnos} ${diffAnos === 1 ? 'ano' : 'anos'}`;
};

const formatarNome = (nome: string): string =>
  (nome || '').normalize('NFC').replace(/[_]/g, ' ').replace(/\s+/g, ' ').trim();

const formatarValor = (valor: number | string | null): string => {
  if (valor === null || valor === undefined) return '—';
  const num = typeof valor === 'number' ? valor : parseFloat(String(valor));
  if (isNaN(num)) return String(valor);
  return num.toFixed(1);
};

// ─── Componente ───────────────────────────────────────────────────────────────

const RelatorioNutricional = () => {
  const { user }                              = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate                              = useNavigate();
  const { animalId: paramAnimalId }           = useParams<{ animalId: string }>();

  const [snapshot,              setSnapshot]              = useState<SnapshotRelatorio | null>(null);
  const [animaisDoProprietario, setAnimaisDoProprietario] = useState<Animal[]>([]);
  const [currentAnimal,         setCurrentAnimal]         = useState<Animal | null>(null);
  const [loading,               setLoading]               = useState(true);
  const [generating,            setGenerating]            = useState(false);
  const [filtroStatus,          setFiltroStatus]          = useState<FiltroStatus[]>(['todos']);
  const [filtroSomenteNRC,      setFiltroSomenteNRC]      = useState(false);
  const [gruposColapsados,      setGruposColapsados]      = useState<Set<string>>(new Set());

  const effectiveAnimalId = paramAnimalId || selectedAnimal?.id?.toString();

  const relatorio = snapshot?.linhas ?? [];

  const colunasDinamicas = relatorio.length > 0
    ? Object.keys(relatorio[0]).filter(key =>
        !['nutriente','unidade','Total_Dieta','Exigido_NRC','Saldo','Percentual_Atendido','status_nutricional'].includes(key)
      )
    : [];

  // ── Filtros ───────────────────────────────────────────────────────────────

  const relatorioFiltrado = useMemo(() => {
    let base = filtroSomenteNRC
      ? relatorio.filter(item => item.Exigido_NRC !== null)
      : relatorio;
    if (!filtroStatus.includes('todos')) {
      base = base.filter(item => filtroStatus.includes(item.status_nutricional as FiltroStatus));
    }
    return base;
  }, [relatorio, filtroSomenteNRC, filtroStatus]);

  // ── Agrupamento ───────────────────────────────────────────────────────────

  const relatorioAgrupado = useMemo(() => {
    const grupos: Record<string, RelatorioItem[]> = {};
    for (const item of relatorioFiltrado) {
      const grupo = resolverGrupo(item.nutriente);
      if (!grupos[grupo]) grupos[grupo] = [];
      grupos[grupo].push(item);
    }
    return GRUPOS_ORDEM
      .filter(g => grupos[g]?.length > 0)
      .map(g => ({ grupo: g, itens: grupos[g] }));
  }, [relatorioFiltrado]);

  // ── Loaders ───────────────────────────────────────────────────────────────

  const loadAnimais = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res   = await api.get('/animais');
      const lista = (res.data?.dados ?? res.data ?? []) as Animal[];
      setAnimaisDoProprietario(lista);
      if (lista.length === 1 && !selectedAnimal) {
        setSelectedAnimal({ ...lista[0], photoUrl: lista[0].photoUrl ?? undefined, idadeAnos: lista[0].idadeAnos ?? undefined });
        if (!paramAnimalId) navigate(`/relatorio-nutricional/${lista[0].id}`, { replace: true });
      }
    } catch (error) {
      console.error('Erro ao carregar animais:', error);
    }
  }, [user?.id, selectedAnimal, paramAnimalId, navigate, setSelectedAnimal]);

  const loadCurrentAnimal = useCallback(async () => {
    if (!effectiveAnimalId) return;
    try {
      const res = await api.get(`/animais/${effectiveAnimalId}`);
      setCurrentAnimal(res.data?.dados ?? res.data);
    } catch (error) {
      console.error(error);
    }
  }, [effectiveAnimalId]);

  const gerarRelatorio = useCallback(async () => {
    if (!effectiveAnimalId) return;
    setGenerating(true);
    try {
      const res   = await api.get(`/relatorio/animal/${effectiveAnimalId}`);
      const dados = res.data?.dados;
      setSnapshot(dados ?? null);
    } catch (error) {
      console.error('Erro ao gerar relatório:', error);
    } finally {
      setGenerating(false);
    }
  }, [effectiveAnimalId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAnimais(), loadCurrentAnimal()]).finally(() => setLoading(false));
  }, [loadAnimais, loadCurrentAnimal]);

  useEffect(() => {
    if (effectiveAnimalId) gerarRelatorio();
  }, [effectiveAnimalId, gerarRelatorio]);

  // ── Lógica de filtros ─────────────────────────────────────────────────────

  const handleFiltroClick = (valor: FiltroStatus) => {
    if (valor === 'todos') {
      setFiltroStatus(['todos']);
      return;
    }
    setFiltroStatus(prev => {
      const semTodos = prev.filter(v => v !== 'todos');
      if (semTodos.includes(valor)) {
        const novo = semTodos.filter(v => v !== valor);
        return novo.length === 0 ? ['todos'] : novo;
      }
      return [...semTodos, valor];
    });
  };

  const mensagemVazia = (): string => {
    if (relatorio.length === 0) return 'Nenhum dado disponível.';
    if (filtroSomenteNRC && relatorioFiltrado.length === 0) return 'Nenhum nutriente NRC encontrado.';
    if (filtroStatus.includes('todos')) return 'Nenhum nutriente encontrado.';
    if (filtroStatus.length === 1) {
      const label = FILTROS.find(f => f.value === filtroStatus[0])?.label ?? filtroStatus[0];
      return `Nenhum nutriente com status "${label}".`;
    }
    return `Nenhum nutriente para os ${filtroStatus.length} filtros selecionados.`;
  };

  // ── Guards ────────────────────────────────────────────────────────────────

  if (loading) return (
    <PageContainer maxWidth="7xl">
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    </PageContainer>
  );

  if (!effectiveAnimalId) return (
    <PageContainer maxWidth="7xl">
      <p className="text-center py-10 text-gray-500">Selecione um animal.</p>
    </PageContainer>
  );

  const totalColunas = 1 + colunasDinamicas.length + 5; // nutriente + alimentos + exigido + total + saldo + % + status

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <PageContainer maxWidth="7xl">
      <div className="space-y-4 text-gray-900">

        {/* Voltar */}
        <BotaoVoltar className="mb-4" />

        {/* Seletor de animal */}
        <SeletorAnimal
          animais={animaisDoProprietario}
          animalIdAtual={effectiveAnimalId}
          rotaBase="/relatorio-nutricional"
          className="mb-4"
        />

        {/* Card do animal */}
        {currentAnimal && (
          <div className="bg-white rounded-xl shadow p-2 flex gap-2 mb-4">
            <div className="w-16 self-stretch bg-gray-200 rounded-lg overflow-hidden flex-shrink-0">
              <img
                src={currentAnimal.photoUrl || 'https://picsum.photos/id/1015/400/400'}
                alt={currentAnimal.nome}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-4 gap-x-3">
                {[
                  { label: 'Nome',       value: currentAnimal.nome },
                  { label: 'Nascimento', value: currentAnimal.dataNascimento ? formatarDataBR(currentAnimal.dataNascimento) : '-' },
                  { label: 'Idade',      value: currentAnimal.dataNascimento ? calcularIdade(currentAnimal.dataNascimento) : currentAnimal.idadeAnos ? `${currentAnimal.idadeAnos} anos` : '-' },
                  { label: 'Raça',       value: currentAnimal.raca?.nome || '-' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <span className="text-[10px] text-gray-400 leading-none">{label}</span>
                    <p className="text-xs font-semibold text-gray-900 truncate">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 pt-1.5 border-t border-gray-100 grid grid-cols-2 gap-x-3">
                <div>
                  <span className="text-[10px] text-gray-400 leading-none">Proprietário</span>
                  <p className="text-xs font-medium text-gray-900 truncate">
                    {currentAnimal.user?.fullName || user?.fullName}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 leading-none">E-mail</span>
                  <p className="text-xs text-gray-900 truncate">
                    {currentAnimal.user?.email || user?.email}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Header + botão atualizar */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Relatório Nutricional</h2>
            <div className="flex items-center gap-3 mt-0.5">
              {snapshot?.geradoEm && (
                <p className="text-xs text-gray-400">
                  Gerado em {new Date(snapshot.geradoEm).toLocaleString('pt-BR')}
                </p>
              )}
              {snapshot?.fonteCalculo && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  snapshot.fonteCalculo === 'NRC_2007_CALCULADO'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-blue-100 text-blue-700'
                }`}>
                  {snapshot.fonteCalculo === 'NRC_2007_CALCULADO' ? 'NRC 2007 Dinâmico' : 'Tabela'}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={gerarRelatorio}
            disabled={generating}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
          >
            <RefreshCw size={15} className={generating ? 'animate-spin' : ''} />
            {generating ? 'Gerando...' : 'Atualizar'}
          </button>
        </div>

        {/* Filtros */}
        <div className="flex gap-2 flex-wrap items-center">
          {/* Toggle Somente NRC */}
          <button
            onClick={() => setFiltroSomenteNRC(prev => !prev)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
              filtroSomenteNRC
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white border-blue-300 text-blue-700 hover:border-blue-500'
            }`}
          >
            Somente NRC
          </button>

          <div className="w-px h-5 bg-gray-200" />

          {/* Filtros de status */}
          {FILTROS.map(f => {
            const base = filtroSomenteNRC ? relatorio.filter(i => i.Exigido_NRC !== null) : relatorio;
            const count = f.value === 'todos'
              ? base.length
              : base.filter(i => i.status_nutricional === f.value).length;
            const ativo = filtroStatus.includes(f.value);
            return (
              <button
                key={f.value}
                onClick={() => handleFiltroClick(f.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  ativo
                    ? 'bg-emerald-700 text-white'
                    : 'bg-white border border-gray-300 text-gray-600 hover:border-emerald-500'
                }`}
              >
                {f.label}
                {count > 0 && (
                  <span className={`text-[10px] font-bold px-1 rounded-full ${ativo ? 'bg-white/20' : 'bg-gray-100'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Aviso sem plano */}
        {snapshot && !snapshot.linhas.length && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            Nenhum dado nutricional encontrado. Verifique se o animal possui um plano de dieta ativo com alimentos cadastrados.
          </div>
        )}

        {/* Tabela */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="overflow-auto" style={{ maxHeight: '60vh' }}>
            <table className="whitespace-nowrap text-xs text-gray-900" style={{ minWidth: 'max-content', width: '100%' }}>
              <thead className="bg-gray-100 sticky top-0 z-20">
                <tr>
                  <th className="px-4 py-2.5 text-left text-gray-700 font-semibold sticky left-0 bg-gray-100 z-10">
                    Nutriente
                  </th>
                  {colunasDinamicas.map(col => (
                    <th key={col} className="px-4 py-2.5 text-right text-gray-700 font-semibold">
                      {formatarNome(col)}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right text-gray-700 font-semibold">Exigido</th>
                  <th className="px-4 py-2.5 text-right text-gray-700 font-semibold">Total/dia</th>
                  <th className="px-4 py-2.5 text-right text-gray-700 font-semibold">Saldo</th>
                  <th className="px-4 py-2.5 text-right text-gray-700 font-semibold">%</th>
                  <th className="px-4 py-2.5 text-center text-gray-700 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {relatorioAgrupado.length === 0 ? (
                  <tr>
                    <td colSpan={totalColunas} className="px-4 py-10 text-center text-gray-400">
                      {mensagemVazia()}
                    </td>
                  </tr>
                ) : relatorioAgrupado.map(({ grupo, itens }) => {
                  const colapsado = gruposColapsados.has(grupo);
                  const toggleGrupo = () => setGruposColapsados(prev => {
                    const next = new Set(prev);
                    if (next.has(grupo)) next.delete(grupo); else next.add(grupo);
                    return next;
                  });
                  return (
                  <React.Fragment key={grupo}>
                    {/* Cabeçalho do grupo */}
                    <tr
                      className="bg-gray-50 border-t-2 border-gray-200 cursor-pointer select-none hover:bg-gray-100"
                      onClick={toggleGrupo}
                    >
                      <td
                        colSpan={totalColunas}
                        className="px-4 py-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider"
                      >
                        <span className="flex items-center gap-1.5">
                          {colapsado
                            ? <ChevronRight size={13} className="text-gray-400" />
                            : <ChevronDown  size={13} className="text-gray-400" />}
                          {grupo}
                          <span className="ml-1 text-gray-400 normal-case font-normal">({itens.length})</span>
                        </span>
                      </td>
                    </tr>

                    {/* Linhas do grupo */}
                    {!colapsado && itens.map((item, idx) => (
                      <tr key={idx} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-2 sticky left-0 bg-white z-10 border-r border-gray-100 whitespace-nowrap">
                          <span className="font-medium text-gray-900">{formatarNome(item.nutriente)}</span>
                          {item.unidade && (
                            <span className="text-[10px] text-gray-400 ml-1">({item.unidade})</span>
                          )}
                        </td>
                        {colunasDinamicas.map(col => (
                          <td key={col} className="px-4 py-2 text-right text-gray-700">
                            {formatarValor(item[col] as number | null)}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right text-gray-700">
                          {formatarValor(item.Exigido_NRC)}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-900">
                          {formatarValor(item.Total_Dieta)}
                        </td>
                        <td
                          className="px-4 py-2 text-right font-semibold"
                          style={{ color: item.Saldo === null ? '#9ca3af' : (item.Saldo as number) < 0 ? '#dc2626' : '#16a34a' }}
                        >
                          {item.Saldo === null
                            ? '—'
                            : `${(item.Saldo as number) >= 0 ? '+' : ''}${formatarValor(item.Saldo)}`}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700">
                          {item.Percentual_Atendido !== null
                            ? `${(item.Percentual_Atendido as number).toFixed(1)}%`
                            : '—'}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={`px-2 py-1 rounded-full text-[11px] font-medium ${
                            COR_STATUS[item.status_nutricional] ?? 'bg-gray-100 text-gray-500'
                          }`}>
                            {LABEL_STATUS[item.status_nutricional] ?? item.status_nutricional}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Contagem */}
        {!generating && relatorio.length > 0 && (
          <p className="text-center text-xs text-gray-400">
            {relatorioFiltrado.length} de {relatorio.length} nutrientes
          </p>
        )}

      </div>
    </PageContainer>
  );
};

export default RelatorioNutricional;
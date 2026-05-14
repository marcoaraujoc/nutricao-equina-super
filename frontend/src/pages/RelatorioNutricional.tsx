import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import { ArrowLeft, RefreshCw } from 'lucide-react';

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
  { label: 'Todos',       value: 'todos' },
  { label: 'Def. Crítica',value: 'DEFICIÊNCIA CRÍTICA' },
  { label: 'Deficiente',  value: 'DEFICIÊNCIA' },
  { label: 'Adequado',    value: 'ADEQUADO' },
  { label: 'Excesso',     value: 'EXCESSO' },
  { label: 'Exc. Crítico',value: 'EXCESSO CRÍTICO' },
  { label: 'Sem Ref.',    value: 'SEM REFERÊNCIA' },
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatarDataBR = (data: string | null | undefined): string => {
  if (!data) return '-';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '-';
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

const calcularIdade = (dataNascimento: string): string => {
  const partes = dataNascimento.split('T')[0].split('-');
  const anoNasc = parseInt(partes[0]);
  const mesNasc = parseInt(partes[1]) - 1;
  const diaNasc = parseInt(partes[2]);
  const hoje = new Date();
  const diffMs = hoje.getTime() - new Date(anoNasc, mesNasc, diaNasc).getTime();
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  let diffMeses = (hoje.getFullYear() - anoNasc) * 12 + (hoje.getMonth() - mesNasc);
  if (hoje.getDate() < diaNasc) diffMeses--;
  let diffAnos = hoje.getFullYear() - anoNasc;
  if (hoje.getMonth() < mesNasc || (hoje.getMonth() === mesNasc && hoje.getDate() < diaNasc)) diffAnos--;
  if (diffDias < 30) return `${diffDias} ${diffDias === 1 ? 'dia' : 'dias'}`;
  if (diffMeses < 12) return `${diffMeses} ${diffMeses === 1 ? 'mês' : 'meses'}`;
  return `${diffAnos} ${diffAnos === 1 ? 'ano' : 'anos'}`;
};

const formatarNome = (nome: string): string => {
  if (!nome) return '';
  return nome.normalize('NFC').replace(/[_]/g, ' ').replace(/\s+/g, ' ').trim();
};

const formatarValor = (valor: number | string | null, unidade?: string): string => {
  if (valor === null || valor === undefined) return '—';
  const num = typeof valor === 'number' ? valor : parseFloat(String(valor));
  if (isNaN(num)) return String(valor);
  const formatado = num % 1 === 0 ? String(num) : num.toFixed(4).replace(/\.?0+$/, '');
  return unidade ? `${formatado} ${unidade}` : formatado;
};

// ─── Componente ───────────────────────────────────────────────────────────────

const RelatorioNutricional = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { animalId: paramAnimalId } = useParams<{ animalId: string }>();

  const [snapshot, setSnapshot]                         = useState<SnapshotRelatorio | null>(null);
  const [animaisDoProprietario, setAnimaisDoProprietario] = useState<Animal[]>([]);
  const [currentAnimal, setCurrentAnimal]               = useState<Animal | null>(null);
  const [loading, setLoading]                           = useState(true);
  const [generating, setGenerating]                     = useState(false);
  const [filtroStatus, setFiltroStatus]                 = useState<FiltroStatus[]>(['todos']);

  const effectiveAnimalId = paramAnimalId || selectedAnimal?.id?.toString();

  const relatorio = snapshot?.linhas ?? [];
  const colunasDinamicas = relatorio.length > 0
    ? Object.keys(relatorio[0]).filter((key) =>
        !['nutriente', 'unidade', 'Total_Dieta', 'Exigido_NRC', 'Saldo', 'Percentual_Atendido', 'status_nutricional'].includes(key)
      )
    : [];

  const relatorioFiltrado = filtroStatus.includes('todos')
    ? relatorio
    : relatorio.filter((item) => filtroStatus.includes(item.status_nutricional as FiltroStatus));


  // ── Loaders ──────────────────────────────────────────────────────────────
  const loadAnimais = async () => {
    if (!user?.id) return;
    try {
      const res = await api.get('/animais');
      const lista: Animal[] = res.data?.dados ?? res.data ?? [];
      setAnimaisDoProprietario(lista);

      if (lista.length === 1 && !selectedAnimal) {
        setSelectedAnimal({
          ...lista[0],
          photoUrl:       lista[0].photoUrl       ?? undefined,
          dataNascimento: lista[0].dataNascimento ?? undefined,
          idadeAnos:      lista[0].idadeAnos      ?? undefined,
        });
        if (!paramAnimalId) navigate(`/relatorio-nutricional/${lista[0].id}`, { replace: true });
      }
    } catch (error) {
      console.error('Erro ao carregar animais:', error);
    }
  };

  const loadCurrentAnimal = async () => {
    if (!effectiveAnimalId) return;
    try {
      const res = await api.get(`/animais/${effectiveAnimalId}`);
      setCurrentAnimal(res.data?.dados ?? res.data);
    } catch (error) {
      console.error(error);
    }
  };

  const gerarRelatorio = async () => {
    if (!effectiveAnimalId) return;
    setGenerating(true);
    try {
      const res = await api.get(`/relatorio/animal/${effectiveAnimalId}`);
      const dados = res.data?.dados;
      setSnapshot(dados ?? null);
    } catch (error) {
      console.error('Erro ao gerar relatório:', error);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAnimais(), loadCurrentAnimal()]).finally(() => setLoading(false));
  }, [effectiveAnimalId, user?.id]);

  useEffect(() => {
    if (effectiveAnimalId) gerarRelatorio();
  }, [effectiveAnimalId]);

  const handleAnimalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = animaisDoProprietario.find((a) => a.id === Number(e.target.value));
    if (selected) {
      setSelectedAnimal({
        ...selected,
        photoUrl:       selected.photoUrl       ?? undefined,
        dataNascimento: selected.dataNascimento ?? undefined,
        idadeAnos:      selected.idadeAnos      ?? undefined,
      });
      navigate(`/relatorio-nutricional/${selected.id}`);
    }
  };

  const hasMultipleAnimals = animaisDoProprietario.length > 1;

  // ── Guards ────────────────────────────────────────────────────────────────

  if (loading) return <div className="p-8 text-center text-gray-500">Carregando...</div>;
  if (!effectiveAnimalId) return <div className="p-6 text-center text-gray-900">Selecione um animal.</div>;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 pb-10 text-gray-900">
      <div className="max-w-7xl mx-auto px-4">

        {/* Voltar */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 pt-6 mb-4 text-emerald-700 hover:text-emerald-800 font-medium"
        >
          <ArrowLeft size={18} /> Voltar
        </button>

        {/* Seletor de animal */}
        {hasMultipleAnimals && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-500 mb-1">Animal</label>
            <select
              value={effectiveAnimalId || ''}
              onChange={handleAnimalChange}
              className="w-full rounded-2xl border border-gray-300 p-3 text-sm focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
            >
              {animaisDoProprietario.map((a) => (
                <option key={a.id} value={a.id}>{a.nome}</option>
              ))}
            </select>
          </div>
        )}

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
              <div className="grid grid-cols-4 gap-x-3 gap-y-0">
                <div>
                  <span className="text-[10px] text-gray-400 leading-none">Nome</span>
                  <p className="text-xs font-semibold text-gray-900 truncate">{currentAnimal.nome}</p>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 leading-none">Nascimento</span>
                  <p className="text-xs text-gray-900">
                    {currentAnimal.dataNascimento ? formatarDataBR(currentAnimal.dataNascimento) : '-'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 leading-none">Idade</span>
                  <p className="text-xs text-gray-900">
                    {currentAnimal.dataNascimento
                      ? calcularIdade(currentAnimal.dataNascimento)
                      : currentAnimal.idadeAnos
                        ? `${currentAnimal.idadeAnos} ${currentAnimal.idadeAnos === 1 ? 'ano' : 'anos'}`
                        : '-'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 leading-none">Raça</span>
                  <p className="text-xs text-gray-900 truncate">{currentAnimal.raca?.nome || '-'}</p>
                </div>
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

        {/* Header do relatório + botão atualizar */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Relatório Nutricional</h2>
            {snapshot?.geradoEm && (
              <p className="text-xs text-gray-400 mt-0.5">
                Gerado em {new Date(snapshot.geradoEm).toLocaleString('pt-BR')}
              </p>
            )}
          </div>
          <button
            onClick={gerarRelatorio}
            disabled={generating}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <RefreshCw size={15} className={generating ? 'animate-spin' : ''} />
            {generating ? 'Gerando...' : 'Atualizar'}
          </button>
        </div>

        {/* Filtros de status */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {FILTROS.map((f) => {
            const count = f.value === 'todos'
              ? relatorio.length
              : relatorio.filter((i) => i.status_nutricional === f.value).length;

            const ativo = filtroStatus.includes(f.value);

            const handleClick = () => {
              if (f.value === 'todos') {
                // Todos limpa qualquer seleção múltipla
                setFiltroStatus(['todos']);
                return;
              }
              setFiltroStatus((prev) => {
                // Remove 'todos' ao selecionar um status específico
                const semTodos = prev.filter((v) => v !== 'todos');
                if (semTodos.includes(f.value)) {
                  // Desmarca — se ficar vazio volta para 'todos'
                  const novo = semTodos.filter((v) => v !== f.value);
                  return novo.length === 0 ? ['todos'] : novo;
                }
                return [...semTodos, f.value];
              });
            };

            return (
              <button
                key={f.value}
                onClick={handleClick}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  ativo
                    ? 'bg-emerald-700 text-white'
                    : 'bg-white border border-gray-300 text-gray-600 hover:border-emerald-500'
                }`}
              >
                {f.label}
                {count > 0 && (
                  <span className={`text-[10px] font-bold px-1 rounded-full ${
                    ativo ? 'bg-white/20' : 'bg-gray-100'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Aviso sem plano */}
        {snapshot && !snapshot.linhas.length && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 mb-4">
            Nenhum dado nutricional encontrado. Verifique se o animal possui um plano de dieta ativo com alimentos cadastrados.
          </div>
        )}

        {/* Tabela */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
            <div
              className="overflow-auto"
              style={{ maxHeight: "60vh" }}
            >
            <table className="whitespace-nowrap text-xs text-gray-900" style={{ minWidth: "max-content", width: "100%" }}>
              <thead className="bg-gray-100 sticky top-0 z-20">
              <tr>
                <th className="px-4 py-2.5 text-left text-gray-700 font-semibold sticky left-0 bg-gray-100 z-10">Nutriente</th>
                {colunasDinamicas.map((col) => (
                  <th key={col} className="px-4 py-2.5 text-right text-gray-700 font-semibold">
                    {formatarNome(col)}
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right text-gray-700 font-semibold">Total/dia</th>
                <th className="px-4 py-2.5 text-right text-gray-700 font-semibold">Exigido</th>
                <th className="px-4 py-2.5 text-right text-gray-700 font-semibold">Saldo</th>
                <th className="px-4 py-2.5 text-right text-gray-700 font-semibold">%</th>
                <th className="px-4 py-2.5 text-center text-gray-700 font-semibold">Status</th>
              </tr>
              </thead>
              <tbody>
              {relatorioFiltrado.length === 0 ? (
                <tr>
                  <td
                    colSpan={6 + colunasDinamicas.length}
                    className="px-4 py-10 text-center text-gray-400"
                  >
                    {relatorio.length === 0
                      ? 'Nenhum dado disponível.'
                      : `Nenhum nutriente com status "${FILTROS.find(f => f.value === filtroStatus)?.label}".`}
                  </td>
                </tr>
              ) : (
                relatorioFiltrado.map((item, idx) => (
                  <tr key={idx} className="border-t hover:bg-gray-50">

                    {/* Nutriente */}
                    <td className="px-4 py-2 sticky left-0 bg-white z-10 border-r border-gray-100 whitespace-nowrap">
                      <span className="font-medium text-gray-900">
                        {formatarNome(item.nutriente)}
                      </span>
                      {item.unidade && (
                        <span className="text-[10px] text-gray-900 ml-1">({item.unidade})</span>
                      )}
                    </td>
                    {/* Colunas dinâmicas por alimento */}
                    {colunasDinamicas.map((col) => (
                      <td key={col} className="px-4 py-2 text-right text-gray-700">
                        {formatarValor(item[col] as number | null)}
                      </td>
                    ))}

                    {/* Total/dia */}
                    <td className="px-4 py-2 text-right font-semibold text-gray-900">
                      {formatarValor(item.Total_Dieta)}
                    </td>

                    {/* Exigido NRC */}
                    <td className="px-4 py-2 text-right text-gray-700">
                      {formatarValor(item.Exigido_NRC)}
                    </td>

                    {/* Saldo */}
                    <td
                      className="px-4 py-2 text-right font-semibold"
                      style={{
                        color: item.Saldo === null
                          ? '#9ca3af'
                          : (item.Saldo as number) < 0 ? '#dc2626' : '#16a34a',
                      }}
                    >
                      {item.Saldo === null
                        ? '—'
                        : `${(item.Saldo as number) >= 0 ? '+' : ''}${formatarValor(item.Saldo)}`}
                    </td>

                    {/* Percentual */}
                    <td className="px-4 py-2 text-right text-gray-700">
                      {item.Percentual_Atendido !== null
                        ? `${item.Percentual_Atendido}%`
                        : '—'}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-1 rounded-full text-[11px] font-medium ${
                        COR_STATUS[item.status_nutricional] ?? 'bg-gray-100 text-gray-500'
                      }`}>
                        {LABEL_STATUS[item.status_nutricional] ?? item.status_nutricional}
                      </span>
                    </td>
                  </tr>
                ))
              )}
              </tbody>
           </table>
        </div>
      </div>
    </div>
    </div>
  );
};

export default RelatorioNutricional;
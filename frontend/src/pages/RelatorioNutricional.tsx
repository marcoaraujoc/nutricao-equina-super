import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import { ArrowLeft, RefreshCw } from 'lucide-react';

interface RelatorioItem {
  nutriente: string;
  Total_Dieta: number;
  Exigido_NRC: number;
  Saldo: number;
  Percentual_Atendido: number;
  status_nutricional: string;
  [key: string]: any;
}

interface Animal {
  id: number;
  nome: string;
  photoUrl?: string;
  dataNascimento?: string;
  raca?: { nome: string };
  user?: { fullName: string };
}

const RelatorioNutricional = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { animalId: paramAnimalId } = useParams<{ animalId: string }>();

  const [relatorio, setRelatorio] = useState<RelatorioItem[]>([]);
  const [animaisDoProprietario, setAnimaisDoProprietario] = useState<Animal[]>([]);
  const [currentAnimal, setCurrentAnimal] = useState<Animal | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const effectiveAnimalId = paramAnimalId || selectedAnimal?.id?.toString();

  // 🔥 GARANTE UTF-8
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.setAttribute('charset', 'UTF-8');
    document.head.appendChild(meta);
  }, []);

  // 🔥 FUNÇÃO MELHORADA PARA ACENTUAÇÃO
  const corrigirTexto = (texto: string): string => {
    if (!texto) return '';
    return texto
      .normalize('NFC')                    // Normaliza acentos
      .replace(/�/g, '')                   // Remove caracteres corrompidos
      .trim();
  };

  const formatarNome = (nome: string): string => {
    return corrigirTexto(nome)
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const formatarStatus = (status: string) => {
    if (!status) return '';
    return status
      .replace('DEFICIÊNCIA CRÍTICA', 'CRITICA')
      .replace('EXCESSO ALTO', 'EXCESSO')
      .replace('EXCESSO', 'ALTO');
  };

  const getCorStatus = (status: string) => {
    if (!status) return 'bg-gray-200 text-black';
    if (status.includes('CRITICA') || status.includes('DEFICIÊNCIA')) {
      return 'bg-red-100 text-red-700';
    }
    if (status.includes('ALTO') || status.includes('EXCESSO')) {
      return 'bg-orange-100 text-orange-700';
    }
    return 'bg-green-100 text-green-700';
  };

  const colunasDinamicas = relatorio.length > 0
    ? Object.keys(relatorio[0]).filter(key =>
        !['nutriente', 'Total_Dieta', 'Exigido_NRC', 'Saldo', 'Percentual_Atendido', 'status_nutricional'].includes(key)
      )
    : [];

  const loadAnimais = async () => {
    if (!user?.id) return;
    try {
      const res = await api.get('/animais');
      const lista = res.data || [];
      setAnimaisDoProprietario(lista);

      if (lista.length === 1 && !selectedAnimal) {
        setSelectedAnimal(lista[0]);
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
      setCurrentAnimal(res.data);
    } catch (error) {
      console.error(error);
    }
  };

  const gerarRelatorio = async () => {
    if (!effectiveAnimalId) return;
    setGenerating(true);
    try {
      // ✅ CHAMADA CORRETA (sem duplicar /api)
      const res = await api.get(`/relatorio/animal/${effectiveAnimalId}`);
      setRelatorio(res.data.dados || []);
      console.log('✅ Relatório carregado com sucesso!');
    } catch (error) {
      console.error('Erro ao gerar relatório:', error);
      alert('Erro ao gerar relatório nutricional.\nVerifique se o backend está rodando.');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAnimais(), loadCurrentAnimal()])
      .finally(() => setLoading(false));
  }, [effectiveAnimalId, user?.id]);

  useEffect(() => {
    if (effectiveAnimalId) gerarRelatorio();
  }, [effectiveAnimalId]);

  const handleAnimalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = animaisDoProprietario.find(a => a.id === Number(e.target.value));
    if (selected) {
      setSelectedAnimal(selected);
      navigate(`/relatorio-nutricional/${selected.id}`);
    }
  };

  const hasMultipleAnimals = animaisDoProprietario.length > 1;

  if (loading) return <div className="p-8 text-center">Carregando...</div>;
  if (!effectiveAnimalId) return <div className="p-6 text-center">Selecione um animal.</div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-10 text-gray-900">
      <div className="max-w-7xl mx-auto px-4">

        <button onClick={() => navigate('/')} className="flex items-center gap-2 mb-4 text-emerald-700 hover:text-emerald-800">
          <ArrowLeft size={18} /> Voltar
        </button>

        {hasMultipleAnimals && (
          <div className="mb-6 pt-2">
            <label className="block text-sm font-medium text-gray-500 mb-1">Escolha o Animal</label>
            <select 
              value={effectiveAnimalId || ''} 
              onChange={handleAnimalChange} 
              className="w-full rounded-3xl border border-gray-300 p-3 focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
            >
              {animaisDoProprietario.map((a: any) => (
                <option key={a.id} value={a.id}>{a.nome}</option>
              ))}
            </select>
          </div>
        )}

        {currentAnimal && (
          <div className="bg-white rounded-2xl shadow p-2.5 flex gap-3 mb-6">
            <div className="w-24 self-stretch bg-gray-200 rounded-xl overflow-hidden flex-shrink-0">
              <img 
                src={currentAnimal.photoUrl || 'https://picsum.photos/id/1015/400/400'} 
                alt={currentAnimal.nome} 
                className="w-full h-full object-cover" 
              />
            </div>

            <div className="flex-1 flex flex-col justify-between">
              <div className="grid grid-cols-3 gap-3 items-start">
                <div>
                  <span className="text-[11px] text-gray-500">Nome</span>
                  <p className="text-lg font-semibold text-gray-900 leading-tight">{currentAnimal.nome}</p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500">Nascimento</span>
                  <p className="text-xs text-gray-900">
                    {currentAnimal.dataNascimento ? new Date(currentAnimal.dataNascimento).toLocaleDateString('pt-BR') : '-'}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500">Raça</span>
                  <p className="text-xs text-gray-900">{currentAnimal.raca?.nome || 'Não informada'}</p>
                </div>
              </div>

              <div className="mt-2 pt-2 border-t">
                <span className="text-[11px] text-gray-500 block">Proprietário</span>
                <p className="text-xs font-medium text-gray-900">
                  {currentAnimal.user?.fullName || user?.fullName}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-900">Relatório Nutricional</h2>

          <button 
            onClick={gerarRelatorio}
            disabled={generating}
            className="bg-emerald-700 text-white px-4 py-2 rounded-xl flex items-center gap-2"
          >
            <RefreshCw size={16} className={generating ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full whitespace-nowrap text-xs text-gray-900">

            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 text-left text-gray-700">Nutriente</th>

                {colunasDinamicas.map(col => (
                  <th key={col} className="px-4 py-2 text-right text-gray-700">
                    {formatarNome(col)}
                  </th>
                ))}

                <th className="px-4 py-2 text-right text-gray-700">Total</th>
                <th className="px-4 py-2 text-right text-gray-700">Exigido</th>
                <th className="px-4 py-2 text-right text-gray-700">Saldo</th>
                <th className="px-4 py-2 text-right text-gray-700">%</th>
                <th className="px-4 py-2 text-center text-gray-700">Status</th>
              </tr>
            </thead>

            <tbody>
              {relatorio.map((item, idx) => (
                <tr key={idx} className="border-t hover:bg-gray-50">

                  <td className="px-4 py-2 font-medium text-gray-900">
                    {formatarNome(item.nutriente)}
                  </td>

                  {colunasDinamicas.map(col => (
                    <td key={col} className="px-4 py-2 text-right text-gray-900">
                      {item[col] ?? 0}
                    </td>
                  ))}

                  <td className="px-4 py-2 text-right font-semibold text-gray-900">
                    {item.Total_Dieta}
                  </td>

                  <td className="px-4 py-2 text-right text-gray-900">
                    {item.Exigido_NRC}
                  </td>

                  <td className="px-4 py-2 text-right font-semibold" 
                      style={{ color: item.Saldo < 0 ? 'red' : 'green' }}>
                    {item.Saldo}
                  </td>

                  <td className="px-4 py-2 text-right text-gray-900">
                    {item.Percentual_Atendido}%
                  </td>

                  <td className="px-4 py-2 text-center">
                    <span className={`px-2 py-1 rounded-xl text-xs ${getCorStatus(formatarStatus(item.status_nutricional))}`}>
                      {formatarStatus(item.status_nutricional)}
                    </span>
                  </td>

                </tr>
              ))}
            </tbody>

          </table>
        </div>

      </div>
    </div>
  );
};

export default RelatorioNutricional;
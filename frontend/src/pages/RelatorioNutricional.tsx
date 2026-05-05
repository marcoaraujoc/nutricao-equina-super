import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import { ArrowLeft, RefreshCw, Copy } from 'lucide-react';

interface RelatorioItem {
  nutriente: string;
  unidade: string;
  Total_Dieta: number;
  Valor_Exigido: number;
  Saldo: number;
  Percentual_Atendido: number;
  status_nutricional: string;
  [key: string]: any;
}

interface Animal {
  id: number;
  nome: string;
  photoUrl?: string;
  raca?: { nome: string };
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
      console.error('Erro ao carregar animal:', error);
    }
  };

  const gerarRelatorio = async () => {
    if (!effectiveAnimalId) return;
    setGenerating(true);
    try {
      const res = await api.get(`/relatorio/animal/${effectiveAnimalId}`);
      setRelatorio(res.data.dados || []);
    } catch (error) {
      console.error(error);
      alert('Erro ao gerar relatório nutricional');
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

  const copiarParaLLM = () => {
    if (relatorio.length === 0) return;
    navigator.clipboard.writeText(JSON.stringify(relatorio, null, 2));
    alert('✅ Relatório copiado para a LLM!');
  };

  const hasMultipleAnimals = animaisDoProprietario.length > 1;

  if (loading) return <div className="p-8 text-center">Carregando...</div>;
  if (!effectiveAnimalId) return <div className="p-6 text-center">Selecione um animal.</div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-6xl mx-auto px-4">
        <button 
          onClick={() => navigate('/')} 
          className="flex items-center gap-2 text-emerald-700 mb-6 hover:text-emerald-800"
        >
          <ArrowLeft size={20} /> Voltar
        </button>

        {hasMultipleAnimals && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-500 mb-1">Escolha o Animal</label>
            <select 
              value={effectiveAnimalId} 
              onChange={handleAnimalChange}
              className="w-full rounded-3xl border border-gray-300 p-3 focus:outline-none focus:border-emerald-600 bg-white"
            >
              {animaisDoProprietario.map(a => (
                <option key={a.id} value={a.id}>{a.nome}</option>
              ))}
            </select>
          </div>
        )}

        {currentAnimal && (
          <div className="bg-white rounded-2xl shadow p-5 flex gap-4 mb-6">
            <div className="w-20 h-20 bg-gray-200 rounded-xl overflow-hidden flex-shrink-0">
              <img 
                src={currentAnimal.photoUrl || 'https://picsum.photos/id/1015/400/400'} 
                alt={currentAnimal.nome} 
                className="w-full h-full object-cover" 
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{currentAnimal.nome}</h1>
              <p className="text-gray-600">{currentAnimal.raca?.nome || 'Raça não informada'}</p>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Relatório Nutricional</h2>
          <div className="flex gap-3">
            <button 
              onClick={gerarRelatorio}
              disabled={generating}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-3xl disabled:opacity-70"
            >
              <RefreshCw size={18} className={generating ? "animate-spin" : ""} />
              {generating ? "Gerando..." : "Atualizar Relatório"}
            </button>

            <button 
              onClick={copiarParaLLM}
              disabled={relatorio.length === 0}
              className="flex items-center gap-2 border border-emerald-700 text-emerald-700 hover:bg-emerald-50 px-6 py-3 rounded-3xl disabled:opacity-50"
            >
              <Copy size={18} /> Copiar para LLM
            </button>
          </div>
        </div>

        <div className="bg-white rounded-3xl shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Nutriente</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Unidade</th>
                <th className="text-right px-6 py-4 text-sm font-medium text-gray-500">Total Dieta</th>
                <th className="text-right px-6 py-4 text-sm font-medium text-gray-500">Exigido NRC</th>
                <th className="text-right px-6 py-4 text-sm font-medium text-gray-500">Saldo</th>
                <th className="text-right px-6 py-4 text-sm font-medium text-gray-500">% Atendido</th>
                <th className="text-center px-6 py-4 text-sm font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {relatorio.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center text-gray-400">
                    Nenhum dado encontrado. Clique em "Atualizar Relatório".
                  </td>
                </tr>
              ) : (
                relatorio.map((item, idx) => (
                  <tr key={idx} className="border-t hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{item.nutriente}</td>
                    <td className="px-6 py-4 text-gray-600">{item.unidade}</td>
                    <td className="px-6 py-4 text-right font-semibold">{item.Total_Dieta}</td>
                    <td className="px-6 py-4 text-right">{item.Valor_Exigido}</td>
                    <td className="px-6 py-4 text-right font-medium" style={{ color: (item.Saldo || 0) < 0 ? '#ef4444' : '#10b981' }}>
                      {item.Saldo}
                    </td>
                    <td className="px-6 py-4 text-right">{item.Percentual_Atendido}%</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-4 py-1 rounded-3xl text-xs font-medium ${
                        item.status_nutricional?.includes('CRÍTICA') ? 'bg-red-100 text-red-700' :
                        item.status_nutricional?.includes('DEFICIÊNCIA') ? 'bg-orange-100 text-orange-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {item.status_nutricional}
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
  );
};

export default RelatorioNutricional;
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
  idadeAnos?: number | null;
  raca?: { nome: string };
  user?: { fullName: string; email: string };
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

  // Adicionar após a função formatarNome
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
      !['nutriente', 'unidade', 'Total_Dieta', 'Exigido_NRC', 'Saldo', 'Percentual_Atendido', 'status_nutricional'].includes(key)
    )
  : [];

  const loadAnimais = async () => {
    if (!user?.id) return;
    try {
      const res = await api.get('/animais');
      const lista = res.data?.dados ?? res.data ?? [];
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
      // ✅ CHAMADA CORRETA (sem duplicar /api)
      const res = await api.get(`/relatorio/animal/${effectiveAnimalId}`);
      const dados = res.data?.dados;
      setRelatorio(dados?.linhas ?? []);
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
            <div className="bg-white rounded-xl shadow p-2 flex gap-2 mb-6">
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
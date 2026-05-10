// frontend/src/pages/Dashboard.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { Plus, PawPrint } from 'lucide-react';
import api from '../services/api';

const calcularIdade = (dataNascimento: string): string => {
  // Parseia direto da string para evitar problema de fuso horário
  const partes = dataNascimento.split('T')[0].split('-');
  const anoNasc = parseInt(partes[0]);
  const mesNasc = parseInt(partes[1]) - 1; // mês começa em 0
  const diaNasc = parseInt(partes[2]);

  const hoje = new Date();
  const anoHoje = hoje.getFullYear();
  const mesHoje = hoje.getMonth();
  const diaHoje = hoje.getDate();

  // Calcula diferença em dias
  const nascimento = new Date(anoNasc, mesNasc, diaNasc);
  const diffMs = hoje.getTime() - nascimento.getTime();
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Calcula meses completos
  let diffMeses = (anoHoje - anoNasc) * 12 + (mesHoje - mesNasc);
  if (diaHoje < diaNasc) diffMeses--;

  // Calcula anos completos
  let diffAnos = anoHoje - anoNasc;
  if (mesHoje < mesNasc || (mesHoje === mesNasc && diaHoje < diaNasc)) diffAnos--;

  if (diffDias < 30) {
    return `${diffDias} ${diffDias === 1 ? 'dia' : 'dias'}`;
  } else if (diffMeses < 12) {
    return `${diffMeses} ${diffMeses === 1 ? 'mês' : 'meses'}`;
  } else {
    return `${diffAnos} ${diffAnos === 1 ? 'ano' : 'anos'}`;
  }
};

const Dashboard = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal, hasAnimals } = useSelectedAnimal();
  const navigate = useNavigate();
  const [animais, setAnimais] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ==================== FUNÇÃO FORMATAR DATA (mesma dos outros arquivos) ====================
  const formatarDataBR = (data: string | Date | null | undefined): string => {
    if (!data) return '-';

    const dataObj = new Date(data instanceof Date ? data.toISOString() : data);

    if (isNaN(dataObj.getTime())) return '-';

    const dia = String(dataObj.getUTCDate()).padStart(2, '0');
    const mes = String(dataObj.getUTCMonth() + 1).padStart(2, '0');
    const ano = dataObj.getUTCFullYear();

    return `${dia}/${mes}/${ano}`;
  };

  // Carrega os animais
  useEffect(() => {
    if (!user?.id) return;

    const loadAnimais = async () => {
      try {
        const res = await api.get('/animais');
        console.log('✅ Animais carregados:', res.data);
        setAnimais(res.data);
      } catch (error) {
        console.error('❌ Erro ao carregar animais:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAnimais();
  }, [user?.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!hasAnimals || animais.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <PawPrint size={80} className="mx-auto text-gray-300 mb-6" />
        <h2 className="text-3xl font-bold text-gray-900 mb-3">Você ainda não completou o seu Cadastro ou não Cadastrou nenhum Animal</h2>
        <p className="text-gray-600 mb-8">Para começar a usar o sistema, cadastre seu primeiro animal e Complete o seu Cadastro Pessoal.</p>
        <button
          onClick={() => navigate('/animais')}
          className="inline-flex items-center gap-3 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-4 rounded-3xl font-semibold text-lg transition-colors"
        >
          <Plus size={24} />
          Cadastrar Primeiro Animal
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Meus Animais</h1>
      <div className="space-y-4">
        {animais.map((animal) => (
          <button
            key={animal.id}
            onClick={() => {
              setSelectedAnimal(animal);
              navigate(`/animal/${animal.id}`);
            }}
            className={`w-full flex items-center bg-white rounded-3xl shadow-sm border transition-all p-6 text-left ${
              selectedAnimal?.id === animal.id
                ? 'border-emerald-500 shadow-md'
                : 'border-gray-100 hover:shadow-md'
            }`}
          >
            {/* Foto */}
            <div className="w-20 h-20 bg-gray-200 rounded-3xl overflow-hidden flex-shrink-0 mr-6">
              <img
                src={animal.photoUrl || 'https://picsum.photos/id/1015/400/400'}
                alt={animal.nome}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Nome + Raça */}
            <div className="flex-1">
              <h3 className="text-3xl font-semibold text-gray-900">{animal.nome}</h3>
              <p className="text-xl font-medium text-emerald-600 mt-1">
                {animal.raca?.nome || animal.especie?.nome || 'Sem raça definida'}
              </p>
            </div>

            {/* Info */}
            <div className="grid grid-cols-4 gap-x-12 text-center">
              <div>
                <span className="block text-xs uppercase text-gray-900 tracking-widest">ESPÉCIE</span>
                <span className="text-lg font-medium text-emerald-600 mt-1">
                  {animal.especie?.nome || '-'}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-900 tracking-widest">SEXO</span>
                <span className="text-lg font-medium text-emerald-600 mt-1">
                  {animal.sexo || '-'}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-900 tracking-widest">NASCIMENTO</span>
                <span className="text-lg font-medium text-emerald-600 mt-1">
                  {formatarDataBR(animal.dataNascimento)}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-900 tracking-widest">IDADE</span>
                <span className="text-lg font-medium text-emerald-600 mt-1">
                  {animal.dataNascimento ? calcularIdade(animal.dataNascimento) : '-'}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import { ArrowLeft } from 'lucide-react';

interface AnimalData {
  id: number;
  nome: string;
  peso: number;
  sexo: string;
  photoUrl?: string | null;
  dataNascimento?: string | null;
  idadeAnos?: number | null;
  categoriaAnimal?: string | null;
  tipoExercicio?: string | null;
  veterinarioNome?: string | null;
  veterinarioClinica?: string | null;
  raca?: { nome: string } | null;
  especie?: { nome: string } | null;
  user?: { fullName: string; email: string } | null;
}

const calcularIdade = (dataNascimento: string): string => {
  const partes = dataNascimento.split('T')[0].split('-');
  const anoNasc = parseInt(partes[0]);
  const mesNasc = parseInt(partes[1]) - 1;
  const diaNasc = parseInt(partes[2]);

  const hoje = new Date();
  const anoHoje = hoje.getFullYear();
  const mesHoje = hoje.getMonth();
  const diaHoje = hoje.getDate();

  const nascimento = new Date(anoNasc, mesNasc, diaNasc);
  const diffMs = hoje.getTime() - nascimento.getTime();
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let diffMeses = (anoHoje - anoNasc) * 12 + (mesHoje - mesNasc);
  if (diaHoje < diaNasc) diffMeses--;

  let diffAnos = anoHoje - anoNasc;
  if (mesHoje < mesNasc || (mesHoje === mesNasc && diaHoje < diaNasc)) diffAnos--;

  if (diffDias < 30) return `${diffDias} ${diffDias === 1 ? 'dia' : 'dias'}`;
  if (diffMeses < 12) return `${diffMeses} ${diffMeses === 1 ? 'mês' : 'meses'}`;
  return `${diffAnos} ${diffAnos === 1 ? 'ano' : 'anos'}`;
};

const AnimalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [animal, setAnimal] = useState<AnimalData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const loadAnimal = async () => {
      try {
        const res = await api.get(`/animais/${id}`);
        const data = res.data?.dados ?? res.data;
        setAnimal(data);
      } catch (error) {
        console.error('Erro ao carregar animal:', error);
      } finally {
        setLoading(false);
      }
    };
    loadAnimal();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!animal) {
    return <div className="text-center py-20 text-red-500">Animal não encontrado</div>;
  }

  const idadeDisplay = animal.dataNascimento
    ? calcularIdade(animal.dataNascimento)
    : animal.idadeAnos
      ? `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'} `
      : '-';

  const nrcDisplay = animal.categoriaAnimal
    ? `${animal.categoriaAnimal} · ${animal.tipoExercicio}`
    : null;

  const temVeterinario = !!animal.veterinarioNome;

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-6">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium mb-6"
      >
        <ArrowLeft size={20} />
        <span className="text-sm sm:text-base">Voltar para lista de animais</span>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-8">

        {/* FOTO + INFORMAÇÕES */}
        <div className="lg:col-span-7 bg-white rounded-3xl shadow-md p-4 sm:p-8 border border-gray-100">
          <div className="flex flex-col sm:flex-row gap-5 sm:gap-8">
            <div className="w-full sm:w-64 h-56 sm:h-80 bg-gray-200 rounded-3xl overflow-hidden flex-shrink-0">
              <img
                src={animal.photoUrl || 'https://picsum.photos/id/1015/800/800'}
                alt={animal.nome}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="flex-1">
              <h1 className="text-3xl sm:text-5xl font-bold text-gray-900">{animal.nome}</h1>
              <p className="text-lg sm:text-2xl text-emerald-600 font-medium mt-1">
                {animal.raca?.nome || animal.especie?.nome || 'Sem raça definida'}
              </p>

              <div className="grid grid-cols-2 gap-4 sm:gap-6 mt-6 sm:mt-10">
                <div>
                  <span className="block text-xs uppercase text-gray-500 tracking-wide">Sexo</span>
                  <span className="text-xl sm:text-3xl font-semibold text-gray-900">
                    {animal.sexo || '-'}
                  </span>
                </div>

                <div>
                  <span className="block text-xs uppercase text-gray-500 tracking-wide">Idade</span>
                  <span className="text-xl sm:text-3xl font-semibold text-gray-900">
                    {idadeDisplay}
                  </span>
                </div>

                <div>
                  <span className="block text-xs uppercase text-gray-500 tracking-wide">Peso Atual</span>
                  <span className="text-xl sm:text-3xl font-semibold text-gray-900">
                    {animal.peso || '-'} kg
                  </span>
                </div>

                <div>
                  <span className="block text-xs uppercase text-gray-500 tracking-wide">Perfil NRC</span>
                  <span className="text-sm sm:text-base font-semibold text-emerald-600 leading-tight">
                    {nrcDisplay || 'Não informado'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* PROPRIETÁRIO + VETERINÁRIO */}
        <div className="lg:col-span-5 space-y-4 sm:space-y-6">

          {/* Proprietário */}
          <div className="bg-white rounded-3xl shadow-md p-4 sm:p-6 border border-gray-100">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 text-2xl sm:text-3xl">
                👤
              </div>
              <div>
                <h3 className="font-semibold text-base sm:text-lg text-gray-900">Proprietário</h3>
                <p className="text-gray-600 text-sm">
                  {animal.user?.fullName || user?.fullName || '-'}
                </p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-gray-500 flex-shrink-0">E-mail</span>
                <span className="text-gray-900 text-right truncate">
                  {animal.user?.email || user?.email || '-'}
                </span>
              </div>
            </div>
          </div>

          {/* Veterinário */}
          <div
            className={`rounded-3xl shadow-md p-4 sm:p-6 border ${
              temVeterinario
                ? 'bg-emerald-700 text-white border-emerald-700'
                : 'bg-white border-gray-100'
            }`}
          >
            <div className="flex items-center gap-4 mb-4">
              <div
                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center text-2xl sm:text-3xl ${
                  temVeterinario ? 'bg-white/20' : 'bg-emerald-50'
                }`}
              >
                🩺
              </div>
              <div>
                <h3
                  className={`font-semibold text-base sm:text-lg ${
                    temVeterinario ? 'text-white' : 'text-gray-900'
                  }`}
                >
                  Veterinário Responsável
                </h3>
                <p className={`text-sm ${temVeterinario ? 'text-emerald-200' : 'text-gray-400'}`}>
                  {temVeterinario ? `Dr(a). ${animal.veterinarioNome}` : 'Não informado'}
                </p>
              </div>
            </div>

            {temVeterinario && animal.veterinarioClinica && (
              <div className="text-sm">
                <div className="flex justify-between">
                  <span className="text-emerald-200">Clínica</span>
                  <span className="text-right">{animal.veterinarioClinica}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Dieta */}
        <div className="lg:col-span-12 bg-white rounded-3xl shadow-md p-4 sm:p-8 border border-gray-100">
          <h3 className="font-semibold flex items-center gap-2 mb-4 text-lg sm:text-xl text-gray-900">
            🥕 Dieta Atual
          </h3>
        </div>

      </div>
    </div>
  );
};

export default AnimalDetail;
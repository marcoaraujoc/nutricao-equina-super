import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import { ArrowLeft, PawPrint } from 'lucide-react';

const AnimalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedAnimal } = useSelectedAnimal();

  const [animal, setAnimal] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    const loadAnimal = async () => {
      try {
        const res = await api.get(`/animais/${id}`);
        setAnimal(res.data);
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
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!animal) {
    return (
      <div className="text-center py-20 text-red-500">
        Animal não encontrado
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium mb-8"
      >
        <ArrowLeft size={24} />
        Voltar para lista de animais
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* FOTO + INFORMAÇÕES DO ANIMAL */}
        <div className="lg:col-span-7 bg-white rounded-3xl shadow-md p-8 border border-gray-100">
          <div className="flex flex-col md:flex-row gap-8">
            <div className="md:w-80 h-80 bg-gray-200 rounded-3xl overflow-hidden flex-shrink-0">
              <img
                src={animal.photoUrl || 'https://picsum.photos/id/1015/800/800'}
                alt={animal.nome}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="flex-1">
              <h1 className="text-5xl font-bold text-gray-900">{animal.nome}</h1>
              <p className="text-2xl text-emerald-600 font-medium mt-2">
                {animal.raca?.nome || animal.especie?.nome || 'Sem raça definida'}
              </p>

              <div className="grid grid-cols-2 gap-8 mt-10">
                <div>
                  <span className="block text-xs uppercase text-gray-500">Sexo</span>
                  <span className="text-3xl font-semibold">{animal.sexo || '-'}</span>
                </div>
                <div>
                  <span className="block text-xs uppercase text-gray-500">Idade</span>
                  <span className="text-3xl font-semibold">
                    {animal.dataNascimento 
                      ? new Date().getFullYear() - new Date(animal.dataNascimento).getFullYear() 
                      : '-'} anos
                  </span>
                </div>
                <div>
                  <span className="block text-xs uppercase text-gray-500">Peso Atual</span>
                  <span className="text-3xl font-semibold">{animal.peso || '-'} kg</span>
                </div>
                <div>
                  <span className="block text-xs uppercase text-gray-500">Última Dieta</span>
                  <span className="text-3xl font-semibold text-emerald-600">Premium Light</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* PROPRIETÁRIO + VETERINÁRIO */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-3xl shadow-md p-6 border border-gray-100">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 text-3xl">👤</div>
              <div>
                <h3 className="font-semibold text-lg">Proprietário</h3>
                <p className="text-gray-600">{user?.fullName}</p>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">E-mail</span>
                <span>{user?.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Telefone</span>
                <span>(11) 98765-4321</span>
              </div>
            </div>
          </div>

          <div className="bg-emerald-700 text-white rounded-3xl shadow-md p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-3xl">🩺</div>
              <div>
                <h3 className="font-semibold text-lg">Veterinário Responsável</h3>
                <p className="text-emerald-200">Dr. Rafael Monteiro</p>
              </div>
            </div>
            <div className="text-sm space-y-3">
              <div className="flex justify-between">
                <span className="text-emerald-200">Clínica</span>
                <span>VetHouse Pinheiros</span>
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-200">CRMV</span>
                <span>SP-12345</span>
              </div>
            </div>
          </div>
        </div>

        {/* DIETA e demais seções mantidas iguais */}
        <div className="lg:col-span-12 bg-white rounded-3xl shadow-md p-8 border border-gray-100">
          <h3 className="font-semibold flex items-center gap-2 mb-6 text-xl">🥕 Dieta Atual</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <span className="font-medium">Ração Premium Light</span>
              <div className="text-emerald-600 mt-2">250 g manhã • 250 g noite</div>
              <div className="text-xs text-gray-500 mt-4">Última atualização: 07h atrás</div>
            </div>
            <div className="text-sm text-gray-600">
              • Petiscos naturais pós-exercício<br />
              • Ômega 3 • 1 cápsula/dia
            </div>
            <div className="bg-emerald-50 rounded-3xl p-6 text-xs text-emerald-700">
              Obs: fase de redução calórica, meta 26,0 kg
            </div>
          </div>
        </div>

        {/* Últimas Consultas + Próximos Eventos */}
        <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white rounded-3xl shadow-md p-8 border border-gray-100">
            <h3 className="font-semibold mb-6">Últimas Consultas</h3>
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium">Check-up anual</p>
                  <p className="text-sm text-gray-500">12 Abr 2026</p>
                </div>
                <span className="text-xs bg-emerald-100 text-emerald-700 px-4 py-1 rounded-3xl">Realizado</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-md p-8 border border-gray-100">
            <h3 className="font-semibold mb-6">Próximos Eventos</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-3xl p-4 text-center">
                <div className="text-emerald-600 text-3xl">💉</div>
                <p className="font-medium mt-2">Vacina V10</p>
                <p className="text-xs text-gray-500">03 Mai</p>
              </div>
              <div className="bg-gray-50 rounded-3xl p-4 text-center">
                <div className="text-emerald-600 text-3xl">🛁</div>
                <p className="font-medium mt-2">Banho</p>
                <p className="text-xs text-gray-500">05 Mai</p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default AnimalDetail;
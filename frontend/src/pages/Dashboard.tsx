import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import axios from 'axios';
import { Plus, PawPrint } from 'lucide-react';

const calculateAge = (dataNascimento: string) => {
  if (!dataNascimento) return '-';
  const birth = new Date(dataNascimento);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
};

const Dashboard = () => {
  const { user } = useAuth();
  const { setSelectedAnimal } = useSelectedAnimal();   // ← NOVO
  const navigate = useNavigate();
  const [animais, setAnimais] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAnimais = async () => {
    try {
      const res = await axios.get('/api/animais');
      console.log('✅ Animais carregados:', res.data);
      setAnimais(res.data);

      // Regra: se tiver EXATAMENTE 1 animal, auto-seleciona e abre
      if (res.data.length === 1) {
        setSelectedAnimal(res.data[0]);
        navigate(`/animal/${res.data[0].id}`);
      }
    } catch (error) {
      console.error('Erro ao carregar animais:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnimais();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (animais.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <PawPrint size={80} className="mx-auto text-gray-300 mb-6" />
        <h2 className="text-3xl font-bold text-gray-900 mb-3">Você ainda não tem animais cadastrados</h2>
        <p className="text-gray-600 mb-8">Para começar a usar o sistema, cadastre seu primeiro animal.</p>
        <button
          onClick={() => navigate('/cavalos')}
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
              setSelectedAnimal(animal);        // ← ARMAZENA NA MEMÓRIA GLOBAL
              navigate(`/animal/${animal.id}`);
            }}
            className="w-full flex items-center bg-white rounded-3xl shadow-sm border border-gray-100 hover:shadow-md transition-all p-6 text-left"
          >
            {/* Foto */}
            <div className="w-20 h-20 bg-gray-200 rounded-3xl overflow-hidden flex-shrink-0 mr-6">
              <img
                src={animal.photoUrl || 'https://picsum.photos/id/1015/400/400'}
                alt={animal.nome}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Nome + Raça/Espécie */}
            <div className="flex-1">
              <h3 className="text-3xl font-semibold text-gray-900">{animal.nome}</h3>
              <p className="text-xl font-medium text-emerald-600 mt-1">
                {animal.raca?.nome || animal.especie?.nome || 'Sem raça definida'}
              </p>
            </div>

            {/* Campos à direita */}
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
                  {animal.dataNascimento 
                    ? new Date(animal.dataNascimento).toLocaleDateString('pt-BR')
                    : '-'}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-900 tracking-widest">IDADE</span>
                <span className="text-lg font-medium text-emerald-600 mt-1">
                  {calculateAge(animal.dataNascimento)} anos
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
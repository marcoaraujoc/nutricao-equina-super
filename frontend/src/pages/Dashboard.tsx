// frontend/src/pages/Dashboard.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { Plus, PawPrint, ClipboardList, Utensils, FlaskConical, FileText, ArrowLeft } from 'lucide-react';
import api from '../services/api';

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
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

const idadeDisplay = (animal: { dataNascimento?: string | null; idadeAnos?: number | null }): string => {
  if (animal.dataNascimento) return calcularIdade(animal.dataNascimento);
  if (animal.idadeAnos) return `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'}`;
  return '-';
};

const formatarDataBR = (data: string | Date | null | undefined): string => {
  if (!data) return '-';
  const dataObj = new Date(data instanceof Date ? data.toISOString() : data);
  if (isNaN(dataObj.getTime())) return '-';
  const dia = String(dataObj.getUTCDate()).padStart(2, '0');
  const mes = String(dataObj.getUTCMonth() + 1).padStart(2, '0');
  const ano = dataObj.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
};

// -------------------------------------------------------------------
// Sub-componente: card de animal único (dashboard direto)
// -------------------------------------------------------------------
const AnimalDashboard = ({ animal, onNavigate, onBack }: { animal: any; onNavigate: (path: string) => void; onBack?: () => void }) => {
  const atalhos = [
    { label: 'Dieta',      icon: Utensils,      path: `/dieta/${animal.id}` },
    { label: 'Exames',     icon: FlaskConical,   path: `/exames/${animal.id}` },
    { label: 'Relatório',  icon: FileText,       path: `/relatorio-nutricional/${animal.id}` },
    { label: 'Prontuário', icon: ClipboardList,  path: `/animal/${animal.id}` },
  ];

  return (
      <div className="space-y-6">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
          >
            <ArrowLeft size={20} />
            <span className="text-sm">Todos os animais</span>
          </button>
        )}
        {/* Card principal */}
        <div className="bg-white rounded-3xl shadow-md border border-gray-100 overflow-hidden">
        <div className="flex flex-col sm:flex-row">
          {/* Foto */}
          <div className="w-full sm:w-56 h-48 sm:h-auto bg-gray-200 flex-shrink-0">
            <img
              src={animal.photoUrl || 'https://picsum.photos/id/1015/400/400'}
              alt={animal.nome}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Info */}
          <div className="flex-1 p-6 sm:p-8">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">{animal.nome}</h2>
            <p className="text-lg text-emerald-600 font-medium mt-1">
              {animal.raca?.nome || animal.especie?.nome || 'Sem raça definida'}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Espécie</span>
                <span className="text-base font-semibold text-gray-900">{animal.especie?.nome || '-'}</span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Sexo</span>
                <span className="text-base font-semibold text-gray-900">{animal.sexo || '-'}</span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Nascimento</span>
                <span className="text-base font-semibold text-gray-900">
                  {animal.dataNascimento ? formatarDataBR(animal.dataNascimento) : '-'}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Idade</span>
                <span className="text-base font-semibold text-gray-900">{idadeDisplay(animal)}</span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Peso</span>
                <span className="text-base font-semibold text-gray-900">{animal.peso ? `${animal.peso} kg` : '-'}</span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Perfil NRC</span>
                <span className="text-sm font-semibold text-emerald-600 leading-tight">
                  {animal.categoriaAnimal
                    ? `${animal.categoriaAnimal} · ${animal.tipoExercicio}`
                    : 'Não informado'}
                </span>
              </div>
              {animal.veterinarioNome && (
                <div className="col-span-2">
                  <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Veterinário</span>
                  <span className="text-base font-semibold text-gray-900">
                    Dr(a). {animal.veterinarioNome}
                    {animal.veterinarioClinica && (
                      <span className="text-sm font-normal text-gray-500 ml-1">
                        — {animal.veterinarioClinica}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Atalhos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {atalhos.map(({ label, icon: Icon, path }) => (
          <button
            key={label}
            onClick={() => onNavigate(path)}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md hover:border-emerald-200 transition-all p-5 flex flex-col items-center gap-3 text-center"
          >
            <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
              <Icon size={22} />
            </div>
            <span className="text-sm font-semibold text-gray-700">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// -------------------------------------------------------------------
// Dashboard principal
// -------------------------------------------------------------------
const Dashboard = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal, hasAnimals } = useSelectedAnimal();
  const navigate = useNavigate();
  const [animais, setAnimais] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [animalSelecionado, setAnimalSelecionado] = useState<any | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    const loadAnimais = async () => {
      try {
        const res = await api.get('/animais');
        const lista = res.data?.dados ?? res.data ?? [];
        setAnimais(lista);
      } catch (error) {
        console.error('Erro ao carregar animais:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAnimais();
  }, [user?.id]);

  // -------------------------------------------------------------------
  // Estados de carregamento e vazio
  // -------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!hasAnimals || animais.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <PawPrint size={80} className="mx-auto text-gray-300 mb-6" />
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
          Você ainda não cadastrou nenhum animal
        </h2>
        <p className="text-gray-600 mb-8">
          Para começar a usar o sistema, cadastre seu primeiro animal.
        </p>
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

  // -------------------------------------------------------------------
  // Animal único — dashboard direto
  // -------------------------------------------------------------------
  if (animais.length === 1) {
    return <AnimalDashboard animal={animais[0]} onNavigate={navigate} />;
  }

  // -------------------------------------------------------------------
  // Múltiplos animais — lista de seleção
  // -------------------------------------------------------------------
  if (animalSelecionado) 
    {
      return (
        <AnimalDashboard
          animal={animalSelecionado}
          onNavigate={navigate}
          onBack={() => setAnimalSelecionado(null)}
        />
      );
    }

    return (
      <div className="space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Meus Animais</h1>
        <div className="space-y-4">
          {animais.map((animal) => (
            <button
              key={animal.id}
              onClick={() => {
                setSelectedAnimal({ ...animal, photoUrl: animal.photoUrl ?? undefined });
                setAnimalSelecionado(animal);
              }}
            className={`w-full flex items-center bg-white rounded-3xl shadow-sm border transition-all p-4 sm:p-6 text-left ${
              selectedAnimal?.id === animal.id
                ? 'border-emerald-500 shadow-md'
                : 'border-gray-100 hover:shadow-md'
            }`}
          >
            {/* Foto */}
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gray-200 rounded-2xl overflow-hidden flex-shrink-0 mr-4 sm:mr-6">
              <img
                src={animal.photoUrl || 'https://picsum.photos/id/1015/400/400'}
                alt={animal.nome}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Nome + Raça */}
            <div className="flex-1 min-w-0">
              <h3 className="text-xl sm:text-2xl font-semibold text-gray-900 truncate">{animal.nome}</h3>
              <p className="text-sm sm:text-base font-medium text-emerald-600 mt-0.5 truncate">
                {animal.raca?.nome || animal.especie?.nome || 'Sem raça definida'}
              </p>
              {animal.categoriaAnimal && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {animal.categoriaAnimal} · {animal.tipoExercicio}
                </p>
              )}
            </div>

            {/* Info — desktop */}
            <div className="hidden sm:grid grid-cols-4 gap-8 text-center flex-shrink-0 ml-6">
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest">Espécie</span>
                <span className="text-sm font-semibold text-gray-900 mt-1 block">
                  {animal.especie?.nome || '-'}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest">Sexo</span>
                <span className="text-sm font-semibold text-gray-900 mt-1 block">
                  {animal.sexo || '-'}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest">Nascimento</span>
                <span className="text-sm font-semibold text-gray-900 mt-1 block">
                  {animal.dataNascimento ? formatarDataBR(animal.dataNascimento) : '-'}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest">Idade</span>
                <span className="text-sm font-semibold text-gray-900 mt-1 block">
                  {idadeDisplay(animal)}
                </span>
              </div>
            </div>

            {/* Idade + Sexo — mobile */}
            <div className="sm:hidden flex flex-col items-end gap-1 ml-3 flex-shrink-0">
              <span className="text-xs font-semibold text-gray-700">{idadeDisplay(animal)}</span>
              <span className="text-xs text-gray-500">{animal.sexo}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
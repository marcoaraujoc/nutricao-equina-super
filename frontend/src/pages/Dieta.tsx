import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import axios from 'axios';
import { ArrowLeft, Plus, Pencil, Trash2 } from 'lucide-react';

const Dieta = () => {
  const { user } = useAuth();
  const { selectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { animalId } = useParams<{ animalId: string }>();

  const [animal, setAnimal] = useState<any>(null);
  const [dietas, setDietas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemToDelete, setItemToDelete] = useState<any | null>(null);

  const effectiveAnimalId = animalId || selectedAnimal?.id?.toString();

  const loadDieta = async () => {
    if (!effectiveAnimalId) return;
    setLoading(true);
    try {
      const res = await axios.get(`/api/dietas/animal/${effectiveAnimalId}`);
      setDietas(res.data);
      if (res.data.length > 0) setAnimal(res.data[0].animal);
      else if (selectedAnimal) setAnimal(selectedAnimal);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (effectiveAnimalId) loadDieta();
  }, [effectiveAnimalId]);

  const handleAddAlimento = () => {
    navigate(`/dieta/${effectiveAnimalId}/novo`);
  };

  const handleEdit = (item: any) => {
    navigate(`/dieta/${effectiveAnimalId}/editar/${item.id}`);
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;
    try {
      await axios.delete(`/api/dietas/${itemToDelete.id}`);
      loadDieta();
      setItemToDelete(null);
    } catch (error) {
      alert('Erro ao excluir');
    }
  };

  const handleSalvarDieta = async () => {
    alert('✅ Dieta salva com sucesso!');
    navigate('/dashboard');
  };

  if (loading) return <div className="p-8 text-center text-gray-900">Carregando dieta...</div>;
  if (!effectiveAnimalId) return <div className="p-8 text-center text-gray-900">Selecione um animal para continuar.</div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* HEADER COM SETA */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-emerald-700">
            <ArrowLeft size={28} />
            <span className="font-semibold !text-gray-900">Voltar</span>
          </button>
          <h1 className="flex-1 text-xl font-bold text-center !text-gray-900">Dieta – {animal?.nome || 'Animal'}</h1>
        </div>
      </div>

      {/* BLOCO ANIMAL (READ-ONLY) */}
      <div className="max-w-4xl mx-auto px-4 pt-6">
        <div className="bg-white rounded-3xl shadow p-6 flex flex-col md:flex-row gap-6">
          {/* Foto */}
          <div className="w-40 h-40 bg-gray-200 rounded-3xl overflow-hidden flex-shrink-0">
            <img src={animal?.photoUrl || '/placeholder-horse.jpg'} alt={animal?.nome} className="w-full h-full object-cover" />
          </div>

          {/* Dados do Animal */}
          <div className="flex-1 space-y-3">
            <div>
              <span className="text-sm font-medium !text-gray-900">Nome:</span>
              <p className="font-bold text-2xl !text-gray-900">{animal?.nome}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-8">
              <div>
                <span className="text-sm font-medium !text-gray-900">Nascimento:</span>
                <p className="font-medium !text-gray-900">
                  {animal?.dataNascimento ? new Date(animal.dataNascimento).toLocaleDateString('pt-BR') : '-'}
                </p>
              </div>
              <div>
                <span className="text-sm font-medium !text-gray-900">Raça:</span>
                <p className="font-medium !text-gray-900">{animal?.raca?.nome || 'Não informada'}</p>
              </div>
            </div>
            <div className="pt-4 border-t">
              <span className="text-sm font-medium !text-gray-900 block">Proprietário:</span>
              <p className="font-semibold !text-gray-900">{animal?.user?.fullName}</p>
              <p className="text-sm !text-gray-900">{animal?.user?.email}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ALIMENTOS DA DIETA */}
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <h2 className="text-xl font-bold mb-4 px-2 !text-gray-900">Alimentos da Dieta</h2>

        <div className="bg-white rounded-3xl shadow p-6">
          <div className="hidden md:grid grid-cols-12 gap-4 text-sm font-semibold !text-gray-900 border-b pb-3">
            <div className="col-span-4">Alimento</div>
            <div className="col-span-3">Periodicidade</div>
            <div className="col-span-3">Quantidade</div>
            <div className="col-span-2 text-right">Ações</div>
          </div>

          {dietas.map((item) => (
            <div key={item.id} className="grid grid-cols-12 gap-4 py-4 border-b last:border-none items-center">
              <div className="col-span-4 font-medium !text-gray-900">{item.alimento.nome}</div>
              <div className="col-span-3 !text-gray-900">{item.periodicidade}</div>
              <div className="col-span-3 !text-gray-900">{item.quantidadePorVez}</div>
              <div className="col-span-2 flex justify-end gap-2">
                <button onClick={() => handleEdit(item)} className="text-emerald-600 hover:text-emerald-700">
                  <Pencil size={20} />
                </button>
                <button onClick={() => setItemToDelete(item)} className="text-red-600 hover:text-red-700">
                  <Trash2 size={20} />
                </button>
              </div>
            </div>
          ))}

          {dietas.length === 0 && <p className="text-center py-8 !text-gray-400">Nenhum alimento cadastrado ainda.</p>}
        </div>

        {/* BOTÕES */}
        <div className="mt-8 flex flex-col gap-4">
          <button
            onClick={handleAddAlimento}
            className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-5 rounded-3xl font-semibold flex items-center justify-center gap-3 text-lg"
          >
            <Plus size={24} /> + Adicionar Novo Alimento
          </button>

          <button
            onClick={handleSalvarDieta}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-5 rounded-3xl font-bold text-xl"
          >
            Salvar Dieta
          </button>
        </div>
      </div>

      {/* MODAL EXCLUIR */}
      {itemToDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6">
            <h3 className="font-bold text-xl !text-gray-900">Excluir alimento?</h3>
            <p className="mt-2 !text-gray-900">{itemToDelete.alimento.nome}</p>
            <div className="flex gap-4 mt-8">
              <button onClick={() => setItemToDelete(null)} className="flex-1 py-4 border rounded-3xl !text-gray-900">Cancelar</button>
              <button onClick={handleDelete} className="flex-1 py-4 bg-red-600 text-white rounded-3xl">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dieta;
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import { Pencil, Trash2, Plus } from 'lucide-react';

const Dieta = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { animalId } = useParams<{ animalId: string }>();

  const [animal, setAnimal] = useState<any>(null);
  const [dietas, setDietas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemToDelete, setItemToDelete] = useState<any | null>(null);
  const [animaisDoProprietario, setAnimaisDoProprietario] = useState<any[]>([]);

  const effectiveAnimalId = animalId || selectedAnimal?.id?.toString();

  const loadDieta = async () => {
    if (!effectiveAnimalId) return;
    setLoading(true);
    try {
      const res = await api.get(`/dietas/animal/${effectiveAnimalId}`);
      setDietas(res.data);
      if (res.data.length > 0) setAnimal(res.data[0].animal);
      else if (selectedAnimal) setAnimal(selectedAnimal);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const loadAnimais = async () => {
    try {
      const res = await api.get('/animais');
      setAnimaisDoProprietario(res.data);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (effectiveAnimalId) loadDieta();
    loadAnimais();
  }, [effectiveAnimalId]);

  const handleAnimalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = animaisDoProprietario.find(a => a.id === Number(e.target.value));
    if (selected) {
      setSelectedAnimal(selected);
      navigate(`/dieta/${selected.id}`);
    }
  };

  const handleAddAlimento = () => navigate(`/dieta/${effectiveAnimalId}/novo`);
  const handleEdit = (item: any) => navigate(`/dieta/${effectiveAnimalId}/editar/${item.id}`);
  const handleDeleteClick = (item: any) => setItemToDelete(item);

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      await api.delete(`/dietas/${itemToDelete.id}`);
      loadDieta();
      setItemToDelete(null);
    } catch (error) {
      alert('Erro ao excluir');
    }
  };

  const handleSalvarDieta = () => {
    alert('✅ Dieta salva com sucesso!');
    navigate('/dashboard');
  };

  const hasMultipleAnimals = animaisDoProprietario.length > 1;

  if (loading) return <div className="p-6 text-center text-gray-900">Carregando...</div>;
  if (!effectiveAnimalId || !animal) return <div className="p-6 text-center text-gray-900">Selecione um animal.</div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-3xl mx-auto px-4">

        {/* Seletor de Animal */}
        {hasMultipleAnimals && (
          <div className="mb-6 pt-2">
            <label className="block text-sm font-medium text-gray-500 mb-1">Escolha o Animal</label>
            <select
              value={effectiveAnimalId}
              onChange={handleAnimalChange}
              className="w-full rounded-3xl border border-gray-300 p-3 focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
            >
              {animaisDoProprietario.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Card do Animal */}
        <div className="bg-white rounded-2xl shadow p-2.5 flex gap-3 mb-4">
          <div className="w-24 self-stretch bg-gray-200 rounded-xl overflow-hidden flex-shrink-0">
            <img
              src={animal.photoUrl || 'https://picsum.photos/id/1015/400/400'}
              alt={animal.nome}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex-1 flex flex-col justify-between">
            <div className="grid grid-cols-3 gap-2 items-start">
              <div>
                <span className="text-[11px] text-gray-500">Nome</span>
                <p className="text-lg font-semibold text-gray-900 leading-tight">
                  {animal.nome}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-gray-500">Nascimento</span>
                <p className="text-xs text-gray-900">
                  {animal.dataNascimento
                    ? new Date(animal.dataNascimento).toLocaleDateString('pt-BR')
                    : '-'}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-gray-500">Raça</span>
                <p className="text-xs text-gray-900">
                  {animal.raca?.nome || 'Não informada'}
                </p>
              </div>
            </div>

            <div className="mt-2 pt-2 border-t">
              <span className="text-[11px] text-gray-500 block">Proprietário</span>
              <p className="text-xs font-medium text-gray-900 leading-tight">
                {animal.user?.fullName || user?.fullName}
              </p>
              <p className="text-[11px] text-gray-500 truncate">
                {animal.user?.email || user?.email}
              </p>
            </div>
          </div>
        </div>

        {/* Botões */}
        <div className="space-y-2 mb-6">
          <button
            onClick={handleAddAlimento}
            className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <Plus size={16} />
            Adicionar alimento
          </button>

          <button
            onClick={handleSalvarDieta}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-medium text-sm transition-colors"
          >
            Salvar dieta
          </button>
        </div>

        {/* Tabela */}
        <div className="bg-white rounded-2xl shadow overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h2 className="text-base font-semibold text-gray-900">Alimentos da Dieta</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Alimento</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Periodicidade</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Qtd</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Unidade</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 w-20">Ações</th>
                </tr>
              </thead>
              <tbody>
                {dietas.map((item) => (
                  <tr key={item.id} className="border-b last:border-none hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{item.alimento?.nome}</td>
                    <td className="px-4 py-3 text-gray-700">{item.periodicidade}</td>
                    <td className="px-4 py-3 text-gray-700">{item.qtdGramasDia}</td>
                    <td className="px-4 py-3 text-gray-700">{item.unidade}</td>
                    <td className="px-4 py-3 text-right flex justify-end gap-3">
                      <button onClick={() => handleEdit(item)} className="text-emerald-600 hover:text-emerald-700">
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => handleDeleteClick(item)} className="text-red-600 hover:text-red-700">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {dietas.length === 0 && (
            <p className="text-center py-8 text-gray-400 text-sm">
              Nenhum alimento cadastrado ainda.
            </p>
          )}
        </div>
      </div>

      {/* Modal */}
      {itemToDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5">
            <h3 className="font-semibold text-lg text-gray-900">Excluir alimento?</h3>
            <p className="mt-2 text-sm text-gray-600">{itemToDelete.alimento?.nome}</p>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setItemToDelete(null)} className="flex-1 py-2 border rounded-xl text-sm text-gray-700">Cancelar</button>
              <button onClick={confirmDelete} className="flex-1 py-2 bg-red-600 text-white rounded-xl text-sm">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dieta;
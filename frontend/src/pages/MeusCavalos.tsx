import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { Pencil, Trash2, Plus } from 'lucide-react';

const MeusCavalos = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [animais, setAnimais] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [animalToDelete, setAnimalToDelete] = useState<any | null>(null);

  const loadAnimais = async () => {
    try {
      const res = await axios.get('/api/animais', { params: { userId: user?.id } });
      setAnimais(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.id) loadAnimais();
  }, [user]);

  const filteredAnimais = animais.filter((a) =>
    a.nome.toLowerCase().includes(search.toLowerCase())
  );

  const calcularIdade = (dataNascimento: string | null) => {
    if (!dataNascimento) return 'Idade desconhecida';
    const birth = new Date(dataNascimento);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
    return `${age} ano${age !== 1 ? 's' : ''}`;
  };

  const handleEdit = (animal: any) => {
    navigate(`/cavalos/${animal.id}`);
  };

  const handleDeleteClick = (animal: any) => {
    setAnimalToDelete(animal);
  };

  const confirmDelete = async () => {
    if (!animalToDelete) return;
    try {
      await axios.delete(`/api/animais/${animalToDelete.id}`);
      alert('✅ Animal excluído com sucesso!');
      setAnimalToDelete(null);
      loadAnimais();
    } catch (error) {
      console.error(error);
      alert('❌ Erro ao excluir animal');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Meus Cavalos</h1>
          <button
            onClick={() => navigate('/cavalos')}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-3xl font-semibold transition-colors"
          >
            <Plus size={20} />
            Novo Cavalo
          </button>
        </div>

        {/* Search */}
        <div className="mb-8">
          <input
            type="text"
            placeholder="Buscar por nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md border border-gray-300 rounded-3xl px-6 py-4 text-gray-900 focus:outline-none focus:border-emerald-600"
          />
        </div>

        {loading ? (
          <p className="text-center text-gray-500 py-12">Carregando cavalos...</p>
        ) : (
          <div className="space-y-4"> {/* ← Lista vertical mais compacta */}
            {filteredAnimais.map((animal) => (
              <div
                key={animal.id}
                className="bg-white rounded-3xl shadow-md border border-gray-100 hover:shadow-xl transition-all flex overflow-hidden"
              >
                {/* Foto - ainda menor */}
                <div className="w-28 h-28 flex-shrink-0 bg-gray-200">
                  {animal.photoUrl ? (
                    <img
                      src={animal.photoUrl}
                      alt={animal.nome}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-5xl">🐴</div>
                  )}
                </div>

                {/* Informações */}
                <div className="flex-1 p-5">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900">{animal.nome}</h3>
                      <p className="text-emerald-700 font-medium text-sm">
                        {animal.raca?.nome || 'Raça não informada'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-4 text-sm text-gray-600">
                    <div>
                      <span className="block text-xs uppercase tracking-widest">Idade</span>
                      <span className="font-medium">{calcularIdade(animal.dataNascimento)}</span>
                    </div>
                    <div>
                      <span className="block text-xs uppercase tracking-widest">Sexo</span>
                      <span className="font-medium capitalize">{animal.sexo}</span>
                    </div>
                  </div>
                </div>

                {/* Botões à direita - empilhados */}
                <div className="flex flex-col border-l border-gray-100 p-2 gap-2 w-20">
                  <button
                    onClick={() => handleEdit(animal)}
                    className="flex-1 flex flex-col items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-medium transition-colors"
                  >
                    <Pencil size={16} />
                    Editar
                  </button>
                  <button
                    onClick={() => handleDeleteClick(animal)}
                    className="flex-1 flex flex-col items-center justify-center gap-1 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs font-medium transition-colors"
                  >
                    <Trash2 size={16} />
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal de exclusão (mantido igual) */}
        {animalToDelete && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl">
              <div className="bg-emerald-700 text-white p-6 text-center">
                <div className="mx-auto w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-4">
                  ⚠️
                </div>
                <h2 className="text-2xl font-bold">Excluir animal?</h2>
                <p className="text-emerald-100 mt-2">
                  Tem certeza que deseja excluir <strong>{animalToDelete.nome}</strong> permanentemente?
                  <br />Essa ação não pode ser desfeita.
                </p>
              </div>

              <div className="p-6">
                <div className="flex gap-4 items-center bg-gray-50 rounded-2xl p-4">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden bg-gray-200 flex-shrink-0">
                    {animalToDelete.photoUrl ? (
                      <img src={animalToDelete.photoUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl">🐴</div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-xl">{animalToDelete.nome}</h3>
                    <p className="text-gray-600">{animalToDelete.raca?.nome || ''}</p>
                  </div>
                </div>
              </div>

              <div className="border-t flex">
                <button
                  onClick={() => setAnimalToDelete(null)}
                  className="flex-1 py-6 text-lg font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 py-6 text-lg font-semibold text-red-600 hover:bg-red-50 transition-colors border-l"
                >
                  Sim, Excluir
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MeusCavalos;
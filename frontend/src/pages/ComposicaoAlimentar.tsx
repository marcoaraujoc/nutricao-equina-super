import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { Pencil, Trash2, Plus } from 'lucide-react';

const ComposicaoAlimentar = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [composicoes, setComposicoes] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [itemToDelete, setItemToDelete] = useState<any | null>(null);

  const loadComposicoes = async () => {
    try {
      const res = await axios.get('/api/composicoes-alimentares');
      setComposicoes(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadComposicoes();
  }, []);

  const filteredComposicoes = composicoes.filter((c) =>
    `${c.alimento?.nome || ''} ${c.nutriente?.nome || ''}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const handleEdit = (item: any) => {
    navigate(`/composicao-alimentar/${item.id}`);
  };

  const handleDeleteClick = (item: any) => {
    setItemToDelete(item);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      await axios.delete(`/api/composicoes-alimentares/${itemToDelete.id}`);
      alert('Composição excluída com sucesso!');
      setItemToDelete(null);
      loadComposicoes();
    } catch (error) {
      console.error(error);
      alert('Erro ao excluir composição');
    }
  };

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-3xl font-bold text-gray-900">Composição Alimentar</h1>
        <button
          onClick={() => navigate('/composicao-alimentar/novo')}
          className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-3xl font-semibold transition-colors w-full sm:w-auto"
        >
          <Plus size={20} />
          Nova Composição
        </button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Buscar por alimento ou nutriente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md border border-gray-300 rounded-3xl px-6 py-4 text-gray-900 focus:outline-none focus:border-emerald-600"
        />
      </div>

      {loading ? (
        <p className="text-center text-gray-500 py-12">Carregando composições...</p>
      ) : (
        <div className="space-y-4">
          {filteredComposicoes.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-3xl shadow-md border border-gray-100 hover:shadow-xl transition-all flex overflow-hidden w-full"
            >
              <div className="flex-1 p-6 flex items-center">
                <div className="w-full flex items-center justify-between">
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900">{item.alimento?.nome || 'Alimento'}</h3>
                    <p className="text-emerald-700 font-medium">{item.nutriente?.nome || 'Nutriente'}</p>
                  </div>
                  <div className="flex items-center gap-8 text-right">
                    {/* VALOR + UNIDADE SIMPLIFICADA (sem /g) */}
                    <div>
                      <span className="block text-xs uppercase text-gray-500 tracking-widest">VALOR</span>
                      <span className="font-semibold text-gray-800">
                        {item.valorPorKg} g
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs uppercase text-gray-500 tracking-widest">UNIDADE ORIGINAL</span>
                      <span className="font-semibold text-gray-800">
                        {item.nutriente?.unidadePadrao || '-'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs uppercase text-gray-500 tracking-widest">BASE</span>
                      <span className="font-semibold text-gray-800">{item.base}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* BOTÕES */}
              <div className="flex items-center p-6 gap-3 border-l border-gray-100">
                <button
                  onClick={(e) => { e.stopPropagation(); handleEdit(item); }}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-3xl text-sm font-medium transition-colors"
                >
                  <Pencil size={18} />
                  Editar
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteClick(item); }}
                  className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-3xl text-sm font-medium transition-colors"
                >
                  <Trash2 size={18} />
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de exclusão */}
      {itemToDelete && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="bg-emerald-700 text-white p-6 text-center">
              <h2 className="text-2xl font-bold">Excluir composição?</h2>
              <p className="text-emerald-100 mt-2">
                Tem certeza que deseja excluir <strong>{itemToDelete.alimento?.nome} × {itemToDelete.nutriente?.nome}</strong>?
              </p>
            </div>
            <div className="p-6 flex gap-4">
              <button
                onClick={() => setItemToDelete(null)}
                className="flex-1 py-4 text-gray-700 font-semibold border border-gray-300 rounded-3xl hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-4 bg-red-600 text-white font-semibold rounded-3xl hover:bg-red-700"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ComposicaoAlimentar;
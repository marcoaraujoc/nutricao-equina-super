import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { Pencil, Trash2, Plus } from 'lucide-react';

const Nutrientes = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [nutrientes, setNutrientes] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [nutrienteToDelete, setNutrienteToDelete] = useState<any | null>(null);

  const loadNutrientes = async () => {
    try {
      const res = await axios.get('/api/nutrientes');
      setNutrientes(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNutrientes();
  }, []);

  const filteredNutrientes = nutrientes.filter((n) =>
    n.nome.toLowerCase().includes(search.toLowerCase())
  );

  const handleEdit = (nutriente: any) => {
    navigate(`/nutrientes/${nutriente.id}`);
  };

  const handleDeleteClick = (nutriente: any) => {
    setNutrienteToDelete(nutriente);
  };

  const confirmDelete = async () => {
    if (!nutrienteToDelete) return;
    try {
      await axios.delete(`/api/nutrientes/${nutrienteToDelete.id}`);
      alert('Nutriente desativado com sucesso!');
      setNutrienteToDelete(null);
      loadNutrientes();
    } catch (error) {
      console.error(error);
      alert('Erro ao excluir nutriente');
    }
  };

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-3xl font-bold text-gray-900">Nutrientes</h1>
        <button
          onClick={() => navigate('/nutrientes/novo')}
          className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-3xl font-semibold transition-colors w-full sm:w-auto"
        >
          <Plus size={20} />
          Novo Nutriente
        </button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Buscar por nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md border border-gray-300 rounded-3xl px-6 py-4 text-gray-900 focus:outline-none focus:border-emerald-600"
        />
      </div>

      {loading ? (
        <p className="text-center text-gray-500 py-12">Carregando nutrientes...</p>
      ) : (
        <div className="space-y-4">
          {filteredNutrientes.map((nutriente) => (
            <div
              key={nutriente.id}
              className="bg-white rounded-3xl shadow-md border border-gray-100 hover:shadow-xl transition-all flex overflow-hidden w-full"
            >
              <div className="flex-1 p-6 flex items-center">
                <div className="w-full flex items-center justify-between">
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900">{nutriente.nome}</h3>
                    <p className="text-emerald-700 font-medium">{nutriente.categoria}</p>
                  </div>
                  <div className="flex items-center gap-8 text-right">
                    <div>
                      <span className="block text-xs uppercase text-gray-500 tracking-widest">UNIDADE</span>
                      <span className="font-semibold text-gray-800">{nutriente.unidadePadrao}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* BOTÕES */}
              <div className="flex items-center p-6 gap-3 border-l border-gray-100">
                <button
                  onClick={(e) => { e.stopPropagation(); handleEdit(nutriente); }}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-3xl text-sm font-medium transition-colors"
                >
                  <Pencil size={18} />
                  Editar
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteClick(nutriente); }}
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
      {nutrienteToDelete && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="bg-emerald-700 text-white p-6 text-center">
              <h2 className="text-2xl font-bold">Excluir nutriente?</h2>
              <p className="text-emerald-100 mt-2">
                Tem certeza que deseja excluir <strong>{nutrienteToDelete.nome}</strong>?
              </p>
            </div>
            <div className="p-6 flex gap-4">
              <button
                onClick={() => setNutrienteToDelete(null)}
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

export default Nutrientes;
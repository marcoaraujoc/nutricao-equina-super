import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Pencil, Trash2, Plus } from 'lucide-react';

const Alimentos = () => {
  const navigate = useNavigate();
  const [alimentos, setAlimentos] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [alimentoToDelete, setAlimentoToDelete] = useState<any | null>(null);

  const loadAlimentos = async () => {
    try {
      const res = await axios.get('/api/alimentos');
      setAlimentos(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlimentos();
  }, []);

  const filteredAlimentos = alimentos.filter((a) =>
    a.nome.toLowerCase().includes(search.toLowerCase())
  );

  const handleEdit = (alimento: any) => {
    navigate(`/alimentos/${alimento.id}`);
  };

  const handleDeleteClick = (alimento: any) => {
    setAlimentoToDelete(alimento);
  };

  const confirmDelete = async () => {
    if (!alimentoToDelete) return;
    try {
      await axios.delete(`/api/alimentos/${alimentoToDelete.id}`);
      alert('✅ Alimento excluído com sucesso!');
      setAlimentoToDelete(null);
      loadAlimentos();
    } catch (error) {
      console.error(error);
      alert('❌ Erro ao excluir alimento');
    }
  };

  const handleViewDetail = (alimento: any) => {
    navigate(`/alimentos/${alimento.id}`);
  };

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-3xl font-bold text-gray-900">Alimentos</h1>
        <button
          onClick={() => navigate('/alimentos/novo')}
          className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-3xl font-semibold transition-colors w-full sm:w-auto"
        >
          <Plus size={20} />
          Novo Alimento
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
        <p className="text-center text-gray-500 py-12">Carregando alimentos...</p>
      ) : (
        <div className="space-y-4">
          {filteredAlimentos.map((alimento) => (
            <div
              key={alimento.id}
              className="bg-white rounded-3xl shadow-md border border-gray-100 hover:shadow-xl transition-all flex overflow-hidden w-full"
            >
              {/* Área clicável */}
              <div
                onClick={() => handleViewDetail(alimento)}
                className="flex flex-1 cursor-pointer"
              >
                {/* Ícone / Placeholder (sem foto) */}
                <div className="w-28 h-28 flex-shrink-0 bg-emerald-100 flex items-center justify-center text-5xl">
                  🌾
                </div>

                {/* Informações */}
                <div className="flex-1 p-6 flex items-center">
                  <div className="w-full flex items-center">
                    {/* Nome + Categoria */}
                    <div className="flex-1 min-w-0 pr-8">
                      <h3 className="text-2xl font-bold text-gray-900 truncate">
                        {alimento.nome}
                      </h3>
                      <p className="text-emerald-700 font-medium text-lg truncate">
                        {alimento.categoria || '—'}
                      </p>
                    </div>

                    {/* Fabricante + Forma */}
                    <div className="flex items-center gap-10 flex-shrink-0">
                      <div className="text-right min-w-[100px]">
                        <span className="block text-xs uppercase text-gray-500 tracking-widest">FABRICANTE</span>
                        <span className="font-semibold text-gray-800 text-lg">
                          {alimento.fabricante || '—'}
                        </span>
                      </div>
                      <div className="text-right min-w-[100px]">
                        <span className="block text-xs uppercase text-gray-500 tracking-widest">FORMA</span>
                        <span className="font-semibold text-gray-800 text-lg">
                          {alimento.forma || '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Botões de ação */}
              <div className="flex items-center p-6 gap-3 border-l border-gray-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit(alimento);
                  }}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-3xl text-sm font-medium transition-colors"
                >
                  <Pencil size={18} />
                  Editar
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteClick(alimento);
                  }}
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
      {alimentoToDelete && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="bg-emerald-700 text-white p-6 text-center">
              <div className="mx-auto w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-4">
                ⚠️
              </div>
              <h2 className="text-2xl font-bold">Excluir alimento?</h2>
              <p className="text-emerald-100 mt-2">
                Tem certeza que deseja excluir <strong>{alimentoToDelete.nome}</strong> permanentemente?
                <br />Essa ação não pode ser desfeita.
              </p>
            </div>

            <div className="p-6">
              <div className="flex gap-4 items-center bg-gray-50 rounded-2xl p-4">
                <div>
                  <h3 className="font-semibold text-xl">{alimentoToDelete.nome}</h3>
                  <p className="text-gray-600">{alimentoToDelete.categoria}</p>
                </div>
              </div>
            </div>

            <div className="border-t flex">
              <button
                onClick={() => setAlimentoToDelete(null)}
                className="flex-1 py-6 text-lg font-semibold text-gray-700 hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-6 text-lg font-semibold text-red-600 hover:bg-red-50 border-l"
              >
                Sim, Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Alimentos;
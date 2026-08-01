import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Edit, Trash2 } from 'lucide-react';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';

const Nutrientes = () => {
  const navigate = useNavigate();
  const [nutrientes, setNutrientes] = useState<any[]>([]);
  // Erro de ação exibido inline (substitui o alert de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro de AÇÃO — renderizado no modal/painel que disparou, não no topo
  const [erroAcao, setErroAcao] = useState<ErroAcaoDados | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [nutrienteToDelete, setNutrienteToDelete] = useState<any | null>(null);

  const loadNutrientes = async () => {
    try {
      const res = await api.get('/nutrientes');
      setNutrientes(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadNutrientes(); }, []);

  const filteredNutrientes = nutrientes.filter((n) =>
    n.nome.toLowerCase().includes(search.toLowerCase())
  );

  const confirmDelete = async () => {
    if (!nutrienteToDelete) return;
    try {
      await api.delete(`/nutrientes/${nutrienteToDelete.id}`);
      toast.success('Nutriente desativado com sucesso!');
      setErroInline(null);
      setNutrienteToDelete(null);
      loadNutrientes();
    } catch (error) {
      console.error(error);
      setErroAcao({ mensagem: 'Erro ao excluir nutriente' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-6xl mx-auto px-3 sm:px-4">

        <BotaoVoltar className="mb-4" />

        <InlineError message={erroInline} className="mb-4" />

        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-5">Nutrientes</h1>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Buscar por nome..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border border-gray-300 rounded-3xl px-5 sm:px-6 py-3 sm:py-4 text-gray-900 focus:outline-none focus:border-emerald-600"
              />
            </div>
            <button
              onClick={() => navigate('/nutrientes/novo')}
              className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 sm:py-4 rounded-3xl font-semibold transition-colors whitespace-nowrap"
            >
              Novo Nutriente
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-center text-gray-500 py-12">Carregando nutrientes...</p>
        ) : (
          /* Tabela com scroll horizontal no mobile */
          <div className="bg-white rounded-3xl shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[400px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 sm:px-6 py-4 text-sm font-medium text-gray-500">Nome</th>
                    <th className="text-left px-4 sm:px-6 py-4 text-sm font-medium text-gray-500">Categoria</th>
                    <th className="text-left px-4 sm:px-6 py-4 text-sm font-medium text-gray-500">Unidade</th>
                    <th className="text-right px-4 sm:px-6 py-4 text-sm font-medium text-gray-500">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNutrientes.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-gray-400">
                        Nenhum nutriente encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredNutrientes.map((nutriente) => (
                      <tr key={nutriente.id} className="border-t hover:bg-gray-50">
                        <td className="px-4 sm:px-6 py-4 font-medium text-gray-900">{nutriente.nome}</td>
                        <td className="px-4 sm:px-6 py-4 font-medium text-gray-900">{nutriente.categoria}</td>
                        <td className="px-4 sm:px-6 py-4 font-semibold text-emerald-700">{nutriente.unidadePadrao}</td>
                        <td className="px-4 sm:px-6 py-4 text-right">
                          <div className="flex justify-end gap-3">
                            <button onClick={() => navigate(`/nutrientes/${nutriente.id}`)} className="text-emerald-600 hover:text-emerald-700">
                              <Edit size={18} />
                            </button>
                            <button onClick={() => setNutrienteToDelete(nutriente)} className="text-red-600 hover:text-red-700">
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {nutrienteToDelete && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl">
              <div className="bg-emerald-700 text-white p-6 text-center">
                <h2 className="text-xl sm:text-2xl font-bold">Excluir nutriente?</h2>
                <p className="text-emerald-100 mt-2 text-sm sm:text-base">
                  Tem certeza que deseja excluir <strong>{nutrienteToDelete.nome}</strong>?
                </p>
              </div>
              <div className="p-4 sm:p-6">
                <ErroAcao erro={erroAcao} className="mb-3" />
                <div className="flex gap-4">
                <button onClick={() => setNutrienteToDelete(null)}
                  className="flex-1 py-3 sm:py-4 text-gray-700 font-semibold border border-gray-300 rounded-3xl hover:bg-gray-50">
                  Cancelar
                </button>
                <button onClick={confirmDelete}
                  className="flex-1 py-3 sm:py-4 bg-red-600 text-white font-semibold rounded-3xl hover:bg-red-700">
                  Excluir
                </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Nutrientes;
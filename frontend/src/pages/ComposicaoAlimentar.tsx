import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Edit, Trash2 } from 'lucide-react';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';


// =====================================================================
// INTERFACES
// =====================================================================
interface Especie {
  id: number;
  nome: string;
}

interface Alimento {
  id: number;
  nome: string;
}

interface Nutriente {
  id: number;
  nome: string;
  unidadePadrao: string;
}

interface ComposicaoItem {
  id: number;
  alimentoId: number;
  nutrienteId: number;
  especieId?: number | null;
  valorPorKg: number;
  base: string;
  alimento?: Alimento | null;
  nutriente?: Nutriente | null;
  especie?: Especie | null;
}

interface EditValues {
  valorPorKg: string;
}

// =====================================================================
// COMPONENTE
// =====================================================================

const ComposicaoAlimentar = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [composicoes, setComposicoes] = useState<ComposicaoItem[]>([]);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [especies, setEspecies] = useState<Especie[]>([]);

  const [search, setSearch] = useState('');
  const [especieFiltro, setEspecieFiltro] = useState('');
  const [loading, setLoading] = useState(true);

  // ── Edição inline — apenas valor ────────────────────────────────────
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({ valorPorKg: '' });

  // ── Exclusão ────────────────────────────────────────────────────────
  const [itemToDelete, setItemToDelete] = useState<ComposicaoItem | null>(null);

  // =====================================================================
  // CARREGAMENTO
  // =====================================================================

  const loadComposicoes = useCallback(async () => {
    try {
      setLoading(true);
      const params = especieFiltro ? { especieId: especieFiltro } : {};
      const res = await api.get('/composicoes-alimentares', { params });
      setComposicoes(res.data?.dados ?? []);
    } catch (error) {
      console.error('Erro ao carregar composições:', error);
      setErroInline('Erro ao carregar composições');
    } finally {
      setLoading(false);
    }
  }, [especieFiltro]);

  useEffect(() => {
    const loadAuxData = async () => {
      try {
        const espRes = await api.get('/especies');
        setEspecies(espRes.data?.dados ?? espRes.data ?? []);
      } catch (e) {
        console.error('Erro ao carregar espécies:', e);
      }
    };
    loadAuxData();
  }, []);

  useEffect(() => {
    loadComposicoes();
  }, [loadComposicoes]);

  // =====================================================================
  // EDIÇÃO INLINE — apenas valorPorKg
  // =====================================================================

  const startEdit = (item: ComposicaoItem) => {
    setEditingId(item.id);
    setEditValues({ valorPorKg: String(item.valorPorKg) });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({ valorPorKg: '' });
  };

  const saveEdit = async (id: number) => {
    if (
      !editValues.valorPorKg ||
      isNaN(parseFloat(editValues.valorPorKg)) ||
      parseFloat(editValues.valorPorKg) < 0
    ) {
      setErroInline('Informe um valor numérico válido');
      return;
    }

    try {
      await api.put(`/composicoes-alimentares/${id}`, {
        valorPorKg: parseFloat(editValues.valorPorKg),
      });
      toast.success('Composição atualizada!');
      cancelEdit();
      loadComposicoes();
    } catch {
      setErroInline('Erro ao salvar edição');
    }
  };

  // =====================================================================
  // EXCLUSÃO
  // =====================================================================

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      await api.delete(`/composicoes-alimentares/${itemToDelete.id}`);
      toast.success('Composição excluída com sucesso!');
      setItemToDelete(null);
      loadComposicoes();
    } catch (error) {
      console.error(error);
      setErroInline('Erro ao excluir composição');
    }
  };

  // =====================================================================
  // FILTRO LOCAL (busca por texto)
  // =====================================================================

  const filteredComposicoes = composicoes.filter((c) =>
    `${c.alimento?.nome ?? ''} ${c.nutriente?.nome ?? ''} ${c.especie?.nome ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  void user;

  // =====================================================================
  // RENDER
  // =====================================================================

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-6xl mx-auto px-4">

        <InlineError message={erroInline} className="mt-6" />

        {/* Voltar */}
        <BotaoVoltar className="mb-4 mt-6" />

        {/* Título */}
        <h1 className="text-3xl font-bold text-gray-900 text-center mb-6">
          Composição Alimentar
        </h1>

        {/* Filtros + botões */}
        <div className="flex flex-col sm:flex-row gap-4 items-end mb-6">

          {/* Filtro de espécie */}
          <div className="w-full sm:w-56">
            <label className="block text-sm font-medium text-gray-500 mb-1">
              Espécie
            </label>
            <select
              value={especieFiltro}
              onChange={(e) => setEspecieFiltro(e.target.value)}
              className="w-full rounded-3xl border border-gray-300 px-4 py-4 bg-white text-gray-900 focus:outline-none focus:border-emerald-600"
            >
              <option value="">Todas as espécies</option>
              {especies.map((e) => (
                <option key={e.id} value={e.id}>{e.nome}</option>
              ))}
            </select>
          </div>

          {/* Busca por texto */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-500 mb-1">
              Buscar
            </label>
            <input
              type="text"
              placeholder="Buscar por alimento ou nutriente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-3xl px-6 py-4 text-gray-900 bg-white focus:outline-none focus:border-emerald-600"
            />
          </div>

          {/* Botões de ação */}
          <div className="flex gap-3 flex-shrink-0">
            <button
              onClick={() => navigate('/composicao-alimentar/nutriente/novo')}
              className="flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-emerald-700 border-2 border-emerald-700 px-6 py-4 rounded-3xl font-semibold transition-colors whitespace-nowrap"
            >
              Novo Nutriente
            </button>
            <button
              onClick={() => navigate('/composicao-alimentar/novo')}
              className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-4 rounded-3xl font-semibold transition-colors whitespace-nowrap"
            >
              Nova Composição
            </button>
          </div>

        </div>

        {/* Tabela */}
        {loading ? (
          <p className="text-center text-gray-500 py-12">Carregando composições...</p>
        ) : (
          <div className="bg-white rounded-3xl shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Alimento</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Espécie</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Nutriente</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Valor (/kg)</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Base</th>
                  <th className="text-right px-6 py-4 text-sm font-medium text-gray-500">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredComposicoes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                      Nenhuma composição encontrada.
                    </td>
                  </tr>
                ) : (
                  filteredComposicoes.map((item) => {
                    const isEditing = editingId === item.id;
                    return (
                      <tr key={item.id} className="border-t hover:bg-gray-50">

                        {/* Alimento — somente leitura */}
                        <td className="px-6 py-4 font-medium text-gray-900">
                          {item.alimento?.nome ?? '—'}
                        </td>

                        {/* Espécie — somente leitura */}
                        <td className="px-6 py-4 text-sm text-gray-700">
                          {item.especie?.nome ?? <span className="text-gray-300">—</span>}
                        </td>

                        {/* Nutriente — somente leitura */}
                        <td className="px-6 py-4 font-medium text-gray-900">
                          {item.nutriente?.nome ?? '—'}
                        </td>

                        {/* Valor — editável inline */}
                        <td className="px-6 py-4 font-semibold text-emerald-700">
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.0001"
                              min="0"
                              autoFocus
                              value={editValues.valorPorKg}
                              onChange={(e) =>
                                setEditValues({ valorPorKg: e.target.value })
                              }
                              className="border border-gray-300 rounded-xl p-2 text-sm text-gray-900 bg-white w-28 focus:outline-none focus:border-emerald-600"
                            />
                          ) : (
                            item.valorPorKg
                          )}
                        </td>

                        {/* Base — somente leitura */}
                        <td className="px-6 py-4 text-gray-900">
                          {item.base}
                        </td>

                        {/* Ações */}
                        <td className="px-6 py-4">
                          <div className="flex justify-end gap-3">
                            {isEditing ? (
                              <>
                                <button
                                  onClick={() => saveEdit(item.id)}
                                  className="text-emerald-600 hover:text-emerald-700 font-medium text-sm"
                                >
                                  Salvar
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="text-gray-500 hover:text-gray-700 text-sm"
                                >
                                  Cancelar
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => startEdit(item)}
                                  title="Editar valor"
                                  className="text-emerald-600 hover:text-emerald-700"
                                >
                                  <Edit size={18} />
                                </button>
                                <button
                                  onClick={() => setItemToDelete(item)}
                                  title="Excluir"
                                  className="text-red-500 hover:text-red-700"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>

                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Contagem */}
        {!loading && filteredComposicoes.length > 0 && (
          <p className="text-center text-sm text-gray-400 mt-4">
            {filteredComposicoes.length}{' '}
            {filteredComposicoes.length === 1 ? 'composição encontrada' : 'composições encontradas'}
          </p>
        )}

        {/* Modal de exclusão */}
        {itemToDelete && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl">
              <div className="bg-emerald-700 text-white p-6 text-center">
                <h2 className="text-2xl font-bold">Excluir composição?</h2>
                <p className="text-emerald-100 mt-2">
                  Tem certeza que deseja excluir{' '}
                  <strong>
                    {itemToDelete.alimento?.nome} × {itemToDelete.nutriente?.nome}
                  </strong>
                  ?
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
    </div>
  );
};

export default ComposicaoAlimentar;
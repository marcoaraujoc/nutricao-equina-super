import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import { Plus, Edit, Trash2, ArrowLeft } from 'lucide-react';

const ComposicaoAlimentar = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { animalId } = useParams<{ animalId: string }>();

  const [composicoes, setComposicoes] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [itemToDelete, setItemToDelete] = useState<any | null>(null);

  // === NOVO: inline edit + dados auxiliares ===
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<any>({});
  const [alimentos, setAlimentos] = useState<any[]>([]);
  const [nutrientes, setNutrientes] = useState<any[]>([]);

  const [animaisDoProprietario, setAnimaisDoProprietario] = useState<any[]>([]);

  const effectiveAnimalId = animalId || selectedAnimal?.id?.toString();

  const loadAnimais = async () => {
    if (!user?.id) return;
    try {
      const res = await api.get('/animais');
      const lista = res.data || [];
      setAnimaisDoProprietario(lista);

      if (lista.length === 1 && !selectedAnimal) {
        setSelectedAnimal(lista[0]);
      }
    } catch (error) {
      console.error('Erro ao carregar animais:', error);
    }
  };

  const loadComposicoes = async () => {
    try {
      const res = await api.get('/composicoes-alimentares');
      setComposicoes(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Carrega alimentos + nutrientes (igual Exames)
  useEffect(() => {
    const loadAuxData = async () => {
      try {
        const [alRes, nutRes] = await Promise.all([
          api.get('/alimentos'),
          api.get('/nutrientes')
        ]);
        setAlimentos(alRes.data);
        setNutrientes(nutRes.data);
      } catch (e) {
        console.error(e);
      }
    };
    loadAuxData();
  }, []);

  useEffect(() => {
    loadAnimais();
    loadComposicoes();
  }, []);

  const handleAnimalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = animaisDoProprietario.find((a: any) => a.id === Number(e.target.value));
    if (selected) {
      setSelectedAnimal(selected);
      // NÃO navega (composições são globais) - só troca o animal selecionado
    }
  };

  const filteredComposicoes = composicoes.filter((c) =>
    `${c.alimento?.nome || ''} ${c.nutriente?.nome || ''}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const startEdit = (item: any) => {
    setEditingId(item.id);
    setEditValues({ ...item });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const saveEdit = async (id: number) => {
    try {
      await api.put(`/composicoes-alimentares/${id}`, {
        alimentoId: editValues.alimentoId || editValues.alimento?.id,
        nutrienteId: editValues.nutrienteId || editValues.nutriente?.id,
        valorPorKg: parseFloat(editValues.valorPorKg),
        base: editValues.base
      });
      loadComposicoes();
      setEditingId(null);
      setEditValues({});
    } catch (error) {
      alert('Erro ao salvar edição');
    }
  };

  const handleDeleteClick = (item: any) => {
    setItemToDelete(item);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      await api.delete(`/composicoes-alimentares/${itemToDelete.id}`);
      alert('Composição excluída com sucesso!');
      setItemToDelete(null);
      loadComposicoes();
    } catch (error) {
      console.error(error);
      alert('Erro ao excluir composição');
    }
  };

  const hasMultipleAnimals = animaisDoProprietario.length > 1;

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-6xl mx-auto px-4">

        {/* === HEADER SUPERIOR IDÊNTICO AO EXAMES === */}
        <button 
          onClick={() => navigate('/')} 
          className="flex items-center gap-2 text-emerald-700 mb-4 hover:text-emerald-800"
        >
          <ArrowLeft size={20} /> Voltar
        </button>

        {hasMultipleAnimals && (
          <div className="mb-6 pt-2">
            <label className="block text-sm font-medium text-gray-500 mb-1">Escolha o Animal</label>
            <select 
              value={effectiveAnimalId || ''} 
              onChange={handleAnimalChange} 
              className="w-full rounded-3xl border border-gray-300 p-3 focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
            >
              {animaisDoProprietario.map((a: any) => (
                <option key={a.id} value={a.id}>{a.nome}</option>
              ))}
            </select>
          </div>
        )}

        {selectedAnimal && (
          <div className="bg-white rounded-2xl shadow p-2.5 flex gap-3 mb-6">
            <div className="w-24 self-stretch bg-gray-200 rounded-xl overflow-hidden flex-shrink-0">
              <img 
                src={selectedAnimal.photoUrl || 'https://picsum.photos/id/1015/400/400'} 
                alt={selectedAnimal.nome} 
                className="w-full h-full object-cover" 
              />
            </div>

            <div className="flex-1 flex flex-col justify-between">
              <div className="grid grid-cols-3 gap-3 items-start">
                <div>
                  <span className="text-[11px] text-gray-500">Nome</span>
                  <p className="text-lg font-semibold text-gray-900 leading-tight">{selectedAnimal.nome}</p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500">Nascimento</span>
                  <p className="text-xs text-gray-900">
                    {selectedAnimal.dataNascimento 
                      ? new Date(selectedAnimal.dataNascimento).toLocaleDateString('pt-BR') 
                      : '-'}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500">Raça</span>
                  <p className="text-xs text-gray-900">{selectedAnimal.raca?.nome || 'Não informada'}</p>
                </div>
              </div>

              <div className="mt-2 pt-2 border-t">
                <span className="text-[11px] text-gray-500 block">Proprietário</span>
                <p className="text-xs font-medium text-gray-900">
                  {selectedAnimal.user?.fullName || user?.fullName}
                </p>
              </div>
            </div>
          </div>
        )}

    {/* === TÍTULO CENTRALIZADO + BOTÃO AO LADO DO SEARCH === */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 text-center mb-6">Composição Alimentar</h1>
          
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Buscar por alimento ou nutriente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border border-gray-300 rounded-3xl px-6 py-4 text-gray-900 focus:outline-none focus:border-emerald-600"
              />
            </div>
            <button
              onClick={() => navigate('/composicao-alimentar/novo')}
              className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-4 rounded-3xl font-semibold transition-colors whitespace-nowrap"
            >
              <Plus size={20} />
              Nova Composição
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-center text-gray-500 py-12">Carregando composições...</p>
        ) : (
          <div className="bg-white rounded-3xl shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Alimento</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Nutriente</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Valor (g/kg)</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Base</th>
                  <th className="text-right px-6 py-4 text-sm font-medium text-gray-500">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredComposicoes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                      Nenhuma composição encontrada.
                    </td>
                  </tr>
                ) : (
                  filteredComposicoes.map((item) => {
                    const isEditing = editingId === item.id;
                    return (
                      <tr key={item.id} className="border-t hover:bg-gray-50">
                        <td className="px-6 py-4 font-medium text-gray-900">
                          {isEditing ? (
                            <input
                              list="alimentos-list"
                              value={editValues.alimento?.nome || item.alimento?.nome || ''}
                              onChange={(e) => {
                                const selected = alimentos.find((a: any) =>
                                  a.nome.toLowerCase() === e.target.value.toLowerCase()
                                );
                                setEditValues({ ...editValues, alimento: selected, alimentoId: selected?.id });
                              }}
                              className="border rounded p-1 text-sm w-full"
                            />
                          ) : (
                            item.alimento?.nome || '—'
                          )}
                        </td>
                        <td className="px-6 py-4 font-medium text-gray-900">
                          {isEditing ? (
                            <input
                              list="nutrientes-list"
                              value={editValues.nutriente?.nome || item.nutriente?.nome || ''}
                              onChange={(e) => {
                                const selected = nutrientes.find((n: any) =>
                                  n.nome.toLowerCase() === e.target.value.toLowerCase()
                                );
                                setEditValues({ ...editValues, nutriente: selected, nutrienteId: selected?.id });
                              }}
                              className="border rounded p-1 text-sm w-full"
                            />
                          ) : (
                            item.nutriente?.nome || '—'
                          )}
                        </td>
                        <td className="px-6 py-4 font-semibold text-emerald-700">
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.0001"
                              value={editValues.valorPorKg ?? item.valorPorKg}
                              onChange={(e) => setEditValues({ ...editValues, valorPorKg: e.target.value })}
                              className="border rounded p-1 text-sm w-28"
                            />
                          ) : (
                            item.valorPorKg
                          )}
                        </td>
                        <td className="px-6 py-4 text-gray-900">
                          {isEditing ? (
                            <select
                              value={editValues.base ?? item.base}
                              onChange={(e) => setEditValues({ ...editValues, base: e.target.value })}
                              className="border rounded p-1 text-sm"
                            >
                              <option value="Seca">Seca</option>
                              <option value="Úmida">Úmida</option>
                            </select>
                          ) : (
                            item.base
                          )}
                        </td>
                        <td className="px-6 py-4 text-right flex justify-end gap-3">
                          {isEditing ? (
                            <>
                              <button onClick={() => saveEdit(item.id)} className="text-emerald-600 hover:text-emerald-700 font-medium">Salvar</button>
                              <button onClick={cancelEdit} className="text-gray-500 hover:text-gray-700">Cancelar</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(item)} className="text-emerald-600 hover:text-emerald-700">
                                <Edit size={18} />
                              </button>
                              <button onClick={() => handleDeleteClick(item)} className="text-red-600 hover:text-red-700">
                                <Trash2 size={18} />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal de exclusão - mantido 100% igual ao original */}
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
    </div>
  );
};

export default ComposicaoAlimentar;
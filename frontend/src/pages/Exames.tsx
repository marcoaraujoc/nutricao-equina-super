import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import { Plus, Eye, Download, Calendar, Edit, Trash2, ArrowLeft } from 'lucide-react';

const Exames = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { animalId } = useParams<{ animalId: string }>();

  const [exames, setExames] = useState<any[]>([]);
  const [currentAnimal, setCurrentAnimal] = useState<any>(null);
  const [animaisDoProprietario, setAnimaisDoProprietario] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<any>({});
  const [nutrientes, setNutrientes] = useState<any[]>([]);

  const effectiveAnimalId = animalId || selectedAnimal?.id?.toString();

  // Carrega lista de nutrientes
  useEffect(() => {
    const loadNutrientes = async () => {
      try {
        const res = await api.get('/nutrientes');
        setNutrientes(res.data);
      } catch (err) {
        console.error('Erro ao carregar nutrientes:', err);
      }
    };
    loadNutrientes();
  }, []);

  const loadAnimais = async () => {
    if (!user?.id) return;
    try {
      const res = await api.get('/animais');
      const lista = res.data || [];
      setAnimaisDoProprietario(lista);

      if (lista.length === 1 && !selectedAnimal) {
        setSelectedAnimal(lista[0]);
        if (!animalId) navigate(`/exames/${lista[0].id}`, { replace: true });
      }
    } catch (error) {
      console.error('Erro ao carregar animais:', error);
    }
  };

  const loadExamesAndAnimal = async () => {
    if (!effectiveAnimalId) return;
    try {
      const resExames = await api.get(`/exames/animal/${effectiveAnimalId}`);
      setExames(resExames.data || []);

      const resAnimal = await api.get(`/animais/${effectiveAnimalId}`);
      setCurrentAnimal(resAnimal.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAnimais(), loadExamesAndAnimal()]).finally(() => setLoading(false));
  }, [effectiveAnimalId, user?.id]);

  const handleAnimalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = animaisDoProprietario.find((a: any) => a.id === Number(e.target.value));
    if (selected) {
      setSelectedAnimal(selected);
      navigate(`/exames/${selected.id}`);
    }
  };

  const handleNovoExame = () => {
    if (effectiveAnimalId) navigate(`/exames/${effectiveAnimalId}/novo`);
  };

  const startEdit = (ex: any) => {
    setEditingId(ex.id);
    setEditValues({ ...ex });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const saveEdit = async (id: number) => {
    try {
      await api.put(`/exames/${id}`, editValues);
      setExames(exames.map(ex => ex.id === id ? { ...ex, ...editValues } : ex));
      setEditingId(null);
      setEditValues({});
    } catch (error) {
      alert('Erro ao salvar edição');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Deseja realmente excluir este exame?')) return;
    try {
      await api.delete(`/exames/${id}`);
      setExames(exames.filter(ex => ex.id !== id));
    } catch (error) {
      alert('Erro ao excluir o exame');
      console.error(error);
    }
  };

  const getStatus = (ex: any) => {
    const valor = parseFloat(ex.valorEncontrado);
    const min = parseFloat(ex.valorMinRef);
    const max = parseFloat(ex.valorMaxRef);

    if ((min === 0 && max === 0) || (isNaN(min) && isNaN(max))) return 'naoCalculado';
    if (isNaN(valor) || isNaN(min) || isNaN(max)) return 'normal';
    if (valor < min) return 'baixo';
    if (valor > max) return 'alto';
    return 'normal';
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  };

  const hasMultipleAnimals = animaisDoProprietario.length > 1;

  if (loading) return <div className="p-8 text-center">Carregando...</div>;
  if (!effectiveAnimalId) return <div className="p-6 text-center text-gray-900">Selecione um animal.</div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-4xl mx-auto px-4">

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

        {currentAnimal && (
          <div className="bg-white rounded-2xl shadow p-2.5 flex gap-3 mb-6">
            <div className="w-24 self-stretch bg-gray-200 rounded-xl overflow-hidden flex-shrink-0">
              <img 
                src={currentAnimal.photoUrl || 'https://picsum.photos/id/1015/400/400'} 
                alt={currentAnimal.nome} 
                className="w-full h-full object-cover" 
              />
            </div>

            <div className="flex-1 flex flex-col justify-between">
              <div className="grid grid-cols-3 gap-3 items-start">
                <div>
                  <span className="text-[11px] text-gray-500">Nome</span>
                  <p className="text-lg font-semibold text-gray-900 leading-tight">{currentAnimal.nome}</p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500">Nascimento</span>
                  <p className="text-xs text-gray-900">
                    {currentAnimal.dataNascimento ? new Date(currentAnimal.dataNascimento).toLocaleDateString('pt-BR') : '-'}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500">Raça</span>
                  <p className="text-xs text-gray-900">{currentAnimal.raca?.nome || 'Não informada'}</p>
                </div>
              </div>

              <div className="mt-2 pt-2 border-t">
                <span className="text-[11px] text-gray-500 block">Proprietário</span>
                <p className="text-xs font-medium text-gray-900">
                  {currentAnimal.user?.fullName || user?.fullName}
                </p>
              </div>
            </div>
          </div>
        )}

        <button onClick={handleNovoExame} className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-3 rounded-3xl flex items-center justify-center gap-2 mb-6">
          <Plus size={20} /> Novo Exame Nutricional
        </button>

        <div className="bg-white rounded-3xl shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Data</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Nutriente</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Valor</th>
                <th className="text-center px-6 py-4 text-sm font-medium text-gray-500">Status</th>
                <th className="text-right px-6 py-4 text-sm font-medium text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody>
              {exames.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">Nenhum exame registrado ainda.</td>
                </tr>
              ) : (
                exames.map((ex: any) => {
                  const isEditing = editingId === ex.id;
                  const status = getStatus(ex);

                  return (
                    <tr key={ex.id} className="border-t hover:bg-gray-50">
                      <td className="px-6 py-4 flex items-center gap-2 text-gray-900">
                        <Calendar size={16} />
                        {isEditing ? (
                          <input 
                            type="date" 
                            value={editValues.dataExame ? editValues.dataExame.split('T')[0] : formatDate(ex.dataExame)} 
                            onChange={(e) => setEditValues({ ...editValues, dataExame: e.target.value })}
                            className="border rounded p-1 text-sm"
                          />
                        ) : (
                          formatDate(ex.dataExame)
                        )}
                      </td>
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {isEditing ? (
                          <>
                            <input 
                              list="nutrientes-list"
                              value={editValues.nutriente?.nome || ex.nutriente?.nome || ''} 
                              onChange={(e) => {
                                const selected = nutrientes.find(n => n.nome.toLowerCase() === e.target.value.toLowerCase());
                                setEditValues({ 
                                  ...editValues, 
                                  nutriente: { nome: e.target.value },
                                  nutrienteId: selected ? selected.id : null
                                });
                              }}
                              className="border rounded p-1 text-sm w-full"
                              placeholder="Digite o nutriente..."
                            />
                            <datalist id="nutrientes-list">
                              {nutrientes.map(n => (
                                <option key={n.id} value={n.nome} />
                              ))}
                            </datalist>
                          </>
                        ) : (
                          ex.nutriente?.nome || '—'
                        )}
                      </td>
                      <td className="px-6 py-4 font-semibold text-emerald-700">
                        {isEditing ? (
                          <input 
                            type="number" 
                            step="0.01"
                            value={editValues.valorEncontrado || ex.valorEncontrado} 
                            onChange={(e) => setEditValues({ ...editValues, valorEncontrado: e.target.value })}
                            className="border rounded p-1 text-sm w-20"
                          />
                        ) : (
                          `${ex.valorEncontrado} ${ex.unidade}`
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {status === 'naoCalculado' ? (
                          <span className="px-4 py-1 rounded-3xl text-xs font-medium bg-gray-100 text-gray-600">
                            Não calculado
                          </span>
                        ) : (
                          <span className={`px-4 py-1 rounded-3xl text-xs font-medium ${
                            status === 'normal' ? 'bg-green-100 text-green-700' : 
                            status === 'alto' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {status === 'normal' ? 'Normal' : status === 'alto' ? 'Alto' : 'Baixo'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right flex justify-end gap-3">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveEdit(ex.id)} className="text-emerald-600 hover:text-emerald-700 font-medium">Salvar</button>
                            <button onClick={cancelEdit} className="text-gray-500 hover:text-gray-700">Cancelar</button>
                          </>
                        ) : (
                          <>
                            {ex.arquivoUrl && (
                              <>
                                <button onClick={() => window.open(ex.arquivoUrl, '_blank')}><Eye size={18} /></button>
                                <button><Download size={18} /></button>
                              </>
                            )}
                            <button onClick={() => startEdit(ex)} className="text-emerald-600 hover:text-emerald-700">
                              <Edit size={18} />
                            </button>
                            <button onClick={() => handleDelete(ex.id)} className="text-red-500 hover:text-red-600">
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
      </div>
    </div>
  );
};

const formatDate = (isoString: string) => {
  const date = new Date(isoString);
  return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
};

export default Exames;
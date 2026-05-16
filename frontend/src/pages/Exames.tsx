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

  // ==================== FUNÇÃO FORMATAR DATA (mesma lógica do Dieta) ====================
  const formatarDataBR = (data: string | Date | null | undefined): string => {
    if (!data) return '-';

    const dataObj = new Date(data instanceof Date ? data.toISOString() : data);

    if (isNaN(dataObj.getTime())) return '-';

    const dia = String(dataObj.getUTCDate()).padStart(2, '0');
    const mes = String(dataObj.getUTCMonth() + 1).padStart(2, '0');
    const ano = dataObj.getUTCFullYear();

    return `${dia}/${mes}/${ano}`;
  };

  const calcularIdade = (dataNascimento: string): string => {
    const partes = dataNascimento.split('T')[0].split('-');
    const anoNasc = parseInt(partes[0]);
    const mesNasc = parseInt(partes[1]) - 1;
    const diaNasc = parseInt(partes[2]);
    const hoje = new Date();
    const diffMs = hoje.getTime() - new Date(anoNasc, mesNasc, diaNasc).getTime();
    const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    let diffMeses = (hoje.getFullYear() - anoNasc) * 12 + (hoje.getMonth() - mesNasc);
    if (hoje.getDate() < diaNasc) diffMeses--;
    let diffAnos = hoje.getFullYear() - anoNasc;
    if (hoje.getMonth() < mesNasc || (hoje.getMonth() === mesNasc && hoje.getDate() < diaNasc)) diffAnos--;
    if (diffDias < 30) return `${diffDias} ${diffDias === 1 ? 'dia' : 'dias'}`;
    if (diffMeses < 12) return `${diffMeses} ${diffMeses === 1 ? 'mês' : 'meses'}`;
    return `${diffAnos} ${diffAnos === 1 ? 'ano' : 'anos'}`;
  };

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
      const lista = res.data?.dados ?? res.data ?? [];
      setAnimaisDoProprietario(lista);

      if (lista.length === 1 && !selectedAnimal) {
        setSelectedAnimal({
          ...lista[0],
          photoUrl:       lista[0].photoUrl       ?? undefined,
          dataNascimento: lista[0].dataNascimento ?? undefined,
        });
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
      setExames(resExames.data?.dados ?? resExames.data ?? []);

      const resAnimal = await api.get(`/animais/${effectiveAnimalId}`);
      setCurrentAnimal(resAnimal.data?.dados ?? resAnimal.data);
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
      setSelectedAnimal({
        ...selected,
        photoUrl:       selected.photoUrl       ?? undefined,
        dataNascimento: selected.dataNascimento ?? undefined,
      });
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

  // Função para formatar datas dos exames (mantida)
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
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex gap-4 mb-4">
    <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 bg-gray-100 border border-gray-100">
      <img
        src={currentAnimal.photoUrl ?? 'https://picsum.photos/id/1015/80/80'}
        alt={currentAnimal.nome}
        className="w-full h-full object-cover"
      />
    </div>
    <div className="flex flex-col flex-1 min-w-0">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1">
        <div><span className="block text-xs text-gray-400">Nome</span><span className="text-sm font-semibold text-gray-900 truncate block">{currentAnimal.nome}</span></div>
        <div><span className="block text-xs text-gray-400">Nascimento</span><span className="text-sm font-semibold text-gray-900 block">{currentAnimal.dataNascimento ? formatarDataBR(currentAnimal.dataNascimento) : '-'}</span></div>
        <div><span className="block text-xs text-gray-400">Idade</span><span className="text-sm font-semibold text-gray-900 block">{currentAnimal.dataNascimento ? calcularIdade(currentAnimal.dataNascimento) : currentAnimal.idadeAnos ? `${currentAnimal.idadeAnos} ${currentAnimal.idadeAnos === 1 ? 'ano' : 'anos'}` : '-'}</span></div>
        <div><span className="block text-xs text-gray-400">Raça</span><span className="text-sm font-semibold text-gray-900 truncate block">{currentAnimal.raca?.nome ?? '-'}</span></div>
        <div><span className="block text-xs text-gray-400">Proprietário</span><span className="text-sm font-semibold text-gray-900 truncate block">{currentAnimal.user?.fullName ?? user?.fullName ?? '-'}</span></div>
        <div><span className="block text-xs text-gray-400">E-mail</span><span className="text-sm font-semibold text-gray-900 truncate block">{currentAnimal.user?.email ?? user?.email ?? '-'}</span></div>
        <div><span className="block text-xs text-gray-400">Veterinário Responsável</span><span className="text-sm font-semibold text-gray-900 truncate block">{user?.fullName ?? '-'}</span></div>
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

export default Exames;
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';
import toast from 'react-hot-toast';
import api from '../services/api';
import { Eye, Download, Calendar, Edit, Trash2 } from 'lucide-react';
import AnimalCard from '../components/AnimalCard';
import BotaoVoltar from '../components/BotaoVoltar';
import SeletorAnimal from '../components/SeletorAnimal';
import PageContainer from '../components/PageContainer';
import { formatDate } from '../utils/dateUtils';
import DateInputBR from '../components/DateInputBR';
import ModalJustificativa from '../components/ModalJustificativa';

const Exames = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { animalId } = useParams<{ animalId: string }>();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeEditar  = isGestor || podeExecutar('atendimento.exames.editar');
  const podeDeletar = isGestor || podeExecutar('atendimento.exames.deletar');
  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [exames, setExames] = useState<any[]>([]);
  const [currentAnimal, setCurrentAnimal] = useState<any>(null);
  const [animaisDoProprietario, setAnimaisDoProprietario] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [confirmId,  setConfirmId]  = useState<number | null>(null);
  const [editValues, setEditValues] = useState<any>({});
  const [nutrientes, setNutrientes] = useState<any[]>([]);
  const [filtroData,      setFiltroData]      = useState('');
  const [filtroNutriente, setFiltroNutriente] = useState('');
  const [filtroStatus,    setFiltroStatus]    = useState('');

  const effectiveAnimalId = animalId || selectedAnimal?.id?.toString();

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
    if (loadingPerms) return;
    setLoading(true);
    Promise.all([loadAnimais(), loadExamesAndAnimal()]).finally(() => setLoading(false));
  }, [effectiveAnimalId, user?.id, loadingPerms]);

  const handleNovoExame = () => {
    if (effectiveAnimalId) navigate(`/exames/${effectiveAnimalId}/novo`);
  };

  const startEdit = (ex: any) => { setEditingId(ex.id); setEditValues({ ...ex }); };
  const cancelEdit = () => { setEditingId(null); setEditValues({}); };

  const saveEdit = async (id: number) => {
    if (!podeEditar) { semPermissao('editar exame'); return; }
    try {
      await api.put(`/exames/${id}`, editValues);
      setExames(exames.map(ex => ex.id === id ? { ...ex, ...editValues } : ex));
      setEditingId(null);
      setEditValues({});
    } catch (error) {
      alert('Erro ao salvar edição');
    }
  };

  const handleDelete = (id: number) => {
    if (!podeDeletar) { semPermissao('excluir exame'); return; }
    setConfirmId(id);
  };

  const handleDeleteConfirmado = async (motivo: string) => {
    if (confirmId == null) return;
    const id = confirmId;
    setConfirmId(null);
    try {
      await api.delete(`/exames/${id}`, { data: { motivo } });
      setExames(exames.filter(ex => ex.id !== id));
    } catch (error) {
      toast.error('Erro ao excluir o exame');
      console.error(error);
    }
  };

  const getStatus = (ex: any) => {
    const valor = parseFloat(ex.valorEncontrado);
    const min   = parseFloat(ex.valorMinRef);
    const max   = parseFloat(ex.valorMaxRef);
    if ((min === 0 && max === 0) || (isNaN(min) && isNaN(max))) return 'naoCalculado';
    if (isNaN(valor) || isNaN(min) || isNaN(max)) return 'normal';
    if (valor < min) return 'baixo';
    if (valor > max) return 'alto';
    return 'normal';
  };

  const examesFiltrados = useMemo(() => exames.filter(ex => {
    if (filtroData && ex.dataExame?.split('T')[0] !== filtroData) return false;
    if (filtroNutriente && !(ex.nutriente?.nome ?? '').toLowerCase().includes(filtroNutriente.toLowerCase())) return false;
    if (filtroStatus && getStatus(ex) !== filtroStatus) return false;
    return true;
  }), [exames, filtroData, filtroNutriente, filtroStatus]);

  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.exames.ler')) return (
    <PageContainer>
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500">Você não tem permissão para visualizar exames.</p>
      </div>
    </PageContainer>
  );

  if (loading || loadingPerms) return (
    <PageContainer>
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    </PageContainer>
  );

  if (!effectiveAnimalId) return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />
      <div className="text-center py-20">
        <p className="text-gray-500 text-sm">Você ainda não possui animais sob sua responsabilidade.</p>
        <p className="text-gray-400 text-xs mt-1">Solicite o vínculo com um animal para começar.</p>
      </div>
    </PageContainer>
  );

  return (
    <PageContainer>
      <div className="space-y-5">

        <BotaoVoltar />

        <SeletorAnimal
          animais={animaisDoProprietario}
          animalIdAtual={effectiveAnimalId}
          rotaBase="/exames"
        />

        {currentAnimal && <AnimalCard animal={currentAnimal} />}

        <button
          onClick={handleNovoExame}
          className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-3 rounded-3xl flex items-center justify-center gap-2 transition-colors"
        >
          Novo Exame Nutricional
        </button>

        {/* Filtros */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Data</label>
              <DateInputBR
                value={filtroData}
                onChange={setFiltroData}
                className="border border-gray-200 rounded-xl px-3 py-2 focus-within:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Nutriente</label>
              <input
                type="text"
                value={filtroNutriente}
                onChange={e => setFiltroNutriente(e.target.value)}
                placeholder="Buscar nutriente..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Status</label>
              <select
                value={filtroStatus}
                onChange={e => setFiltroStatus(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
              >
                <option value="">Todos</option>
                <option value="normal">Normal</option>
                <option value="alto">Alto</option>
                <option value="baixo">Baixo</option>
                <option value="naoCalculado">Não calculado</option>
              </select>
            </div>
          </div>
          {(filtroData || filtroNutriente || filtroStatus) && (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-gray-400">{examesFiltrados.length} de {exames.length} exames</span>
              <button
                onClick={() => { setFiltroData(''); setFiltroNutriente(''); setFiltroStatus(''); }}
                className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
              >
                Limpar filtros
              </button>
            </div>
          )}
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Resultados do Exame</p>
            <span className="text-xs text-gray-400">{examesFiltrados.length} registro{examesFiltrados.length !== 1 ? 's' : ''}</span>
          </div>

          <datalist id="nutrientes-list">
            {nutrientes.map(n => <option key={n.id} value={n.nome} />)}
          </datalist>

          {examesFiltrados.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-400 text-sm">
              {exames.length === 0 ? 'Nenhum exame registrado ainda.' : 'Nenhum exame corresponde aos filtros.'}
            </div>
          ) : (
          <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <span className="flex items-center gap-1"><Calendar size={11} /> Data</span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Nutriente</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Valor</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {examesFiltrados.map((ex: any) => {
                  const isEditing = editingId === ex.id;
                  const status    = getStatus(ex);
                  return (
                    <tr key={ex.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-800 whitespace-nowrap">
                        {isEditing ? (
                          <DateInputBR
                            value={editValues.dataExame ? editValues.dataExame.split('T')[0] : ex.dataExame?.split('T')[0] ?? ''}
                            onChange={v => setEditValues({ ...editValues, dataExame: v })}
                            className="border rounded p-1 text-sm"
                          />
                        ) : formatDate(ex.dataExame)}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {isEditing ? (
                          <input
                            list="nutrientes-list"
                            value={editValues.nutriente?.nome || ex.nutriente?.nome || ''}
                            onChange={e => {
                              const selected = nutrientes.find(n => n.nome.toLowerCase() === e.target.value.toLowerCase());
                              setEditValues({ ...editValues, nutriente: { nome: e.target.value }, nutrienteId: selected ? selected.id : null });
                            }}
                            className="border rounded p-1 text-sm w-full"
                            placeholder="Digite o nutriente..."
                          />
                        ) : ex.nutriente?.nome || '—'}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-emerald-700 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="number" step="0.01"
                            value={editValues.valorEncontrado || ex.valorEncontrado}
                            onChange={e => setEditValues({ ...editValues, valorEncontrado: e.target.value })}
                            className="border rounded p-1 text-sm w-20 text-center"
                          />
                        ) : `${ex.valorEncontrado} ${ex.unidade}`}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {status === 'naoCalculado' ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">Não calculado</span>
                        ) : (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            status === 'normal' ? 'bg-green-100 text-green-700' : status === 'alto' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {status === 'normal' ? 'Normal' : status === 'alto' ? 'Alto' : 'Baixo'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {isEditing ? (
                            <>
                              <button onClick={() => saveEdit(ex.id)} className="px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50">Salvar</button>
                              <button onClick={cancelEdit} className="px-2.5 py-1 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
                            </>
                          ) : (
                            <>
                              {ex.arquivoUrl && (
                                <button onClick={() => window.open(ex.arquivoUrl, '_blank')} title="Ver laudo"
                                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                                  <Eye size={15} />
                                </button>
                              )}
                              <button onClick={() => startEdit(ex)} title="Editar"
                                className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                                <Edit size={15} />
                              </button>
                              <button onClick={() => handleDelete(ex.id)} title="Excluir"
                                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-gray-50">
            {examesFiltrados.map((ex: any) => {
              const isEditing = editingId === ex.id;
              const status    = getStatus(ex);
              return (
                <div key={ex.id} className="px-4 py-3">
                  {isEditing ? (
                    <div className="space-y-2">
                      <DateInputBR
                        value={editValues.dataExame ? editValues.dataExame.split('T')[0] : ex.dataExame?.split('T')[0] ?? ''}
                        onChange={v => setEditValues({ ...editValues, dataExame: v })}
                        className="border rounded-lg p-1.5 text-sm w-full"
                      />
                      <input
                        list="nutrientes-list"
                        value={editValues.nutriente?.nome || ex.nutriente?.nome || ''}
                        onChange={e => {
                          const selected = nutrientes.find(n => n.nome.toLowerCase() === e.target.value.toLowerCase());
                          setEditValues({ ...editValues, nutriente: { nome: e.target.value }, nutrienteId: selected ? selected.id : null });
                        }}
                        className="border rounded-lg p-1.5 text-sm w-full"
                        placeholder="Digite o nutriente..."
                      />
                      <input
                        type="number" step="0.01"
                        value={editValues.valorEncontrado || ex.valorEncontrado}
                        onChange={e => setEditValues({ ...editValues, valorEncontrado: e.target.value })}
                        className="border rounded-lg p-1.5 text-sm w-full"
                        placeholder="Valor"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => saveEdit(ex.id)} className="flex-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">Salvar</button>
                        <button onClick={cancelEdit} className="flex-1 px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-semibold text-gray-900 text-sm truncate">{ex.nutriente?.nome || '—'}</span>
                        {status === 'naoCalculado' ? (
                          <span className="inline-flex flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">Não calculado</span>
                        ) : (
                          <span className={`inline-flex flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            status === 'normal' ? 'bg-green-100 text-green-700' : status === 'alto' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {status === 'normal' ? 'Normal' : status === 'alto' ? 'Alto' : 'Baixo'}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 flex items-center gap-1">
                        <Calendar size={11} /> {formatDate(ex.dataExame)}
                        {' · '}<span className="font-semibold text-emerald-700">{ex.valorEncontrado} {ex.unidade}</span>
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {ex.arquivoUrl && (
                          <button onClick={() => window.open(ex.arquivoUrl, '_blank')}
                            className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50 transition-colors">
                            <Eye size={11} /> Laudo
                          </button>
                        )}
                        <button onClick={() => startEdit(ex)}
                          className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-emerald-600 rounded-lg text-xs hover:bg-emerald-50 transition-colors">
                          <Edit size={11} /> Editar
                        </button>
                        <button onClick={() => handleDelete(ex.id)}
                          className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors">
                          <Trash2 size={11} /> Excluir
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          </>
          )}
        </div>
      </div>
      <ModalJustificativa
        aberto={confirmId != null}
        titulo="Excluir exame"
        descricao="Deseja realmente excluir este exame? Esta ação não pode ser desfeita."
        acaoLabel="Excluir"
        onConfirmar={handleDeleteConfirmado}
        onFechar={() => setConfirmId(null)}
      />
    </PageContainer>
  );
};

export default Exames;
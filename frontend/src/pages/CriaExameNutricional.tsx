import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import { Upload, Edit, Trash2, AlertCircle, X, FileText } from 'lucide-react';
import BotaoVoltar from '../components/BotaoVoltar';

const CriaExameNutricional = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { animalId } = useParams<{ animalId: string }>();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();

  const [resultadoIA, setResultadoIA] = useState<any>(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const cancelar = () => {
    setResultadoIA(null);
    setFileName('');
    setProgress(0);
    setShowModal(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const [nutrientes, setNutrientes] = useState<any[]>([]);

  const [manualExames, setManualExames] = useState<any[]>([
    { nutrienteId: '', nomeOficial: '', valorEncontrado: '', unidade: '', valorMinRef: '', valorMaxRef: '', observacao: '' }
  ]);

  // Carrega nutrientes para dropdown
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

  // Auto seleção de animal
  useEffect(() => {
    const autoSelecionarAnimal = async () => {
      if (selectedAnimal) return;
      if (!user?.id) return;

      try {
        if (animalId) {
          const res = await api.get(`/animais/${animalId}`);
          const animal = res.data?.dados ?? res.data;
          if (animal?.id) setSelectedAnimal(animal);
          return;
        }

        const res = await api.get('/animais');
        const animais = res.data;
        if (animais.length === 0) return;

        let animalParaSelecionar = animais[0];
        const ultimoAnimalId = localStorage.getItem('lastSelectedAnimalId');
        if (ultimoAnimalId) {
          const ultimo = animais.find((a: any) => a.id?.toString() === ultimoAnimalId);
          if (ultimo) animalParaSelecionar = ultimo;
        }
        setSelectedAnimal(animalParaSelecionar);
      } catch (error) {
        console.error(error);
      }
    };

    autoSelecionarAnimal();
  }, [selectedAnimal, animalId, user, setSelectedAnimal]);

  useEffect(() => {
    if (selectedAnimal?.id) {
      localStorage.setItem('lastSelectedAnimalId', selectedAnimal.id.toString());
    }
  }, [selectedAnimal]);

  const handleFileChange = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setLoading(true);
    setProgress(0);

    const formData = new FormData();
    formData.append('arquivo', file);

    const idParaEnviar = animalId || selectedAnimal?.id?.toString();
    if (idParaEnviar) formData.append('animalId', idParaEnviar);

    try {
      const interval = setInterval(() => setProgress(p => (p >= 95 ? 95 : p + 12)), 70);
      const res = await api.post('/exames/analisar-llm', formData);
      setResultadoIA(res.data);
      setProgress(100);
      clearInterval(interval);
    } catch (err) {
      alert('Erro ao analisar o laudo');
    } finally {
      setLoading(false);
    }
  };

  // Manual
  const addManualRow = () => {
    setManualExames([...manualExames, { nutrienteId: '', nomeOficial: '', valorEncontrado: '', unidade: '', valorMinRef: '', valorMaxRef: '', observacao: '' }]);
  };

  const updateManualRow = (index: number, field: string, value: string) => {
    const updated = [...manualExames];
    updated[index] = { ...updated[index], [field]: value };
    setManualExames(updated);
  };

  const handleNutrienteSelect = (index: number, nutrienteId: string) => {
    const selected = nutrientes.find(n => n.id === Number(nutrienteId));
    const updated = [...manualExames];
    updated[index] = {
      ...updated[index],
      nutrienteId,
      nomeOficial: selected ? selected.nome : '',
      unidade: selected ? selected.unidadePadrao : ''
    };
    setManualExames(updated);
  };

  const saveManual = async () => {
    if (!isGestor && !podeExecutar('atendimento.exames.criar')) {
      alert('Sem permissão para criar exames. Verifique com o responsável da equipe.');
      return;
    }
    const validos = manualExames.filter(e => e.nutrienteId && e.valorEncontrado);
    if (validos.length === 0) return alert('Preencha Nutriente e Valor.');

    try {
      await Promise.all(validos.map(e =>
        api.post('/exames', {
          animalId: animalId || selectedAnimal?.id?.toString(),
          nutrienteId: Number(e.nutrienteId),
          dataExame: new Date().toISOString().split('T')[0],
          valorEncontrado: e.valorEncontrado,
          unidade: e.unidade,
          valorMinRef: e.valorMinRef,
          valorMaxRef: e.valorMaxRef,
          observacao: e.observacao
        })
      ));
      alert(`${validos.length} exames salvos!`);
      setShowManualForm(false);
      setManualExames([{ nutrienteId: '', nomeOficial: '', valorEncontrado: '', unidade: '', valorMinRef: '', valorMaxRef: '', observacao: '' }]);
      navigate(`/exames/${animalId || selectedAnimal?.id}`);
    } catch (err) {
      alert('Erro ao salvar');
      console.error(err);
    }
  };

  const salvarTodos = async () => {
    if (!isGestor && !podeExecutar('atendimento.exames.criar')) {
      alert('Sem permissão para criar exames. Verifique com o responsável da equipe.');
      return;
    }
    if (!resultadoIA || submitting) return;
    const validos = resultadoIA.exames.filter((e: any) => e.encontrado);
    if (validos.length === 0) { alert('Nenhum exame válido.'); return; }

    setSubmitting(true);
    try {
      await Promise.all(
        validos.map((e: any) =>
          api.post('/exames', {
            animalId: animalId || selectedAnimal?.id?.toString(),
            nutrienteId: e.nutrienteId,
            dataExame: resultadoIA.dataExame,
            valorEncontrado: e.valorEncontrado,
            unidade: e.unidade,
            valorMinRef: e.valorMinRef,
            valorMaxRef: e.valorMaxRef,
            observacao: e.observacao
          })
        )
      );
      alert(`${validos.length} exames salvos com sucesso!`);
      navigate(`/exames/${animalId || selectedAnimal?.id}`);
    } catch (err) {
      alert('Erro ao salvar os exames');
    } finally {
      setSubmitting(false);
    }
  };

  const adicionarTodosFaltantes = () => {
    const faltantes = resultadoIA.exames.filter((e: any) => !e.encontrado);
    alert(`Adicionando ${faltantes.length} nutrientes ao catálogo:\n\n` + faltantes.map((e: any) => `- ${e.nomeOficial}`).join('\n'));
    setShowModal(false);
  };

  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.exames.criar')) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Você não tem permissão para criar exames nutricionais.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-4xl mx-auto px-4">

        <BotaoVoltar className="mb-4" />

        {selectedAnimal ? (
          <div className="bg-white rounded-3xl shadow p-4 flex gap-4 mb-6">
            <div className="w-20 h-20 bg-gray-200 rounded-2xl overflow-hidden flex-shrink-0">
              <img src={selectedAnimal.photoUrl || 'https://picsum.photos/id/1015/400/400'} alt={selectedAnimal.nome} className="w-full h-full object-cover" />
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-2xl font-bold text-gray-900">{selectedAnimal.nome}</p>
                  <p className="text-gray-600 text-sm">{selectedAnimal.raca?.nome || 'Raça não informada'}</p>
                </div>
                <div className="text-right text-sm">
                  <div className="text-gray-900"><span className="text-gray-500">Nascimento</span> <span className="font-medium">07/08/2019</span></div>
                  <div className="text-gray-900"><span className="text-gray-500">Idade</span> <span className="font-medium">6 anos</span></div>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t flex justify-between text-sm">
                <div>
                  <span className="text-gray-500">Proprietário</span><br />
                  <span className="font-medium text-gray-900">{selectedAnimal.user?.fullName || user?.fullName}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6 text-center mb-6">
            <p className="text-amber-700">Carregando animal do proprietário...</p>
          </div>
        )}

        {fileName && (
          <div className="mb-4 text-sm text-emerald-700 flex items-center gap-2">
            <Upload size={16} />
            <span className="font-medium">Arquivo:</span> {fileName}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-3xl shadow p-6 text-center hover:shadow-md transition flex flex-col items-center">
            <Upload className="mb-3 text-emerald-600" size={32} />
            <p className="font-medium text-gray-900">Enviar Laudo</p>
            <p className="text-xs text-gray-500 mt-1">PDF ou imagem</p>
            <input ref={fileInputRef} type="file" accept=".pdf,image/*" onChange={handleFileChange} className="hidden" id="laudo" />
            <label htmlFor="laudo" className="mt-6 block bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-3 px-8 rounded-3xl cursor-pointer w-full">
              Escolher Arquivo
            </label>
          </div>

          <div className="bg-white rounded-3xl shadow p-6 text-center hover:shadow-md transition flex flex-col items-center">
            <FileText className="mb-3 text-emerald-600" size={32} />
            <p className="font-medium text-gray-900">Preencher Manualmente</p>
            <p className="text-xs text-gray-500 mt-1">Digite os dados</p>
            <button 
              onClick={() => setShowManualForm(true)}
              className="mt-6 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-3 px-8 rounded-3xl w-full"
            >
              Iniciar Preenchimento
            </button>
          </div>
        </div>

        {loading && (
          <div className="mb-6">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-600 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-center text-xs text-gray-500 mt-1">{progress}%</p>
          </div>
        )}

        {resultadoIA && (
          <div className="bg-white rounded-3xl shadow overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50">
              <h2 className="font-semibold text-gray-900">Exames</h2>
            </div>
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-900">Bioquímica</th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-900">Resultado</th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-900">Valor Mínimo</th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-900">Valor Máximo</th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-900">Observação</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {resultadoIA.exames.map((e: any, i: number) => (
                  <tr key={i} className={`border-t hover:bg-gray-50 ${!e.encontrado ? 'bg-red-50' : ''}`}>
                    <td className="px-6 py-4 font-medium text-gray-900">{e.nomeOficial}</td>
                    <td className="px-6 py-4 text-emerald-700 font-semibold whitespace-nowrap">{e.valorEncontrado} {e.unidade}</td>
                    <td className="px-6 py-4 text-gray-600">{e.valorMinRef || '-'}</td>
                    <td className="px-6 py-4 text-gray-600">{e.valorMaxRef || '-'}</td>
                    <td className="px-6 py-4 text-xs text-gray-500">{e.observacao || '-'}</td>
                    <td className="px-6 py-4">
                      <div className="flex gap-3">
                        <button className="text-emerald-600 hover:text-emerald-700"><Edit size={18} /></button>
                        <button className="text-red-500 hover:text-red-600"><Trash2 size={18} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-6 py-4 border-t bg-gray-50 flex gap-3">
              <button
                onClick={cancelar}
                disabled={submitting}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white py-3 rounded-3xl font-medium text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={salvarTodos}
                disabled={submitting}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-3 rounded-3xl font-medium text-sm transition-colors"
              >
                {submitting ? 'Salvando...' : 'Salvar exames'}
              </button>
            </div>
          </div>
        )}

        {showModal && resultadoIA && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full mx-4">
              <div className="px-6 pt-6 pb-4 border-b flex items-center justify-between">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertCircle size={22} />
                  <h3 className="font-semibold text-lg">Nutrientes não encontrados</h3>
                </div>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X size={24} />
                </button>
              </div>

              <div className="p-6 max-h-80 overflow-y-auto">
                <p className="text-gray-600 mb-4">Os seguintes nutrientes não existem no catálogo. Deseja adicionar todos de uma vez?</p>
                <ul className="space-y-2">
                  {resultadoIA.exames.filter((e: any) => !e.encontrado).map((e: any, i: number) => (
                    <li key={i} className="flex items-center gap-2 text-gray-800 bg-gray-100 px-4 py-2 rounded-2xl">
                      <span className="flex-1">{e.nomeOficial}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="px-6 py-5 border-t flex gap-3">
                <button onClick={() => setShowModal(false)} className="flex-1 py-3 text-gray-700 font-medium border border-gray-200 rounded-3xl hover:bg-gray-100">Cancelar</button>
                <button onClick={adicionarTodosFaltantes} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-3xl">Adicionar todos ao catálogo</button>
              </div>
            </div>
          </div>
        )}

        {showManualForm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-auto">
              <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white z-10">
                <h2 className="text-xl font-semibold text-gray-900">Preencher Exames Manualmente</h2>
                <button onClick={() => setShowManualForm(false)}><X size={24} /></button>
              </div>

              <div className="p-6 space-y-6">
                {manualExames.map((exame, index) => (
                  <div key={index} className="border rounded-2xl p-5 bg-gray-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nutriente</label>
                        <select 
                          value={exame.nutrienteId} 
                          onChange={e => handleNutrienteSelect(index, e.target.value)} 
                          className="w-full border border-gray-300 rounded-xl p-3 text-gray-900 focus:outline-none focus:border-emerald-600"
                        >
                          <option value="">Selecione o nutriente</option>
                          {nutrientes.map(n => (
                            <option key={n.id} value={n.id}>
                              {n.nome}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Valor encontrado</label>
                        <input 
                          placeholder="Ex: 4.2" 
                          type="number" 
                          step="0.01"
                          value={exame.valorEncontrado} 
                          onChange={e => updateManualRow(index, 'valorEncontrado', e.target.value)} 
                          className="w-full border border-gray-300 rounded-xl p-3 text-gray-900 focus:outline-none focus:border-emerald-600" 
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Unidade</label>
                        <input 
                          value={exame.unidade} 
                          readOnly 
                          className="w-full border border-gray-300 rounded-xl p-3 text-gray-900 bg-gray-100" 
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Valor Mín</label>
                          <input 
                            placeholder="Ex: 3.5" 
                            value={exame.valorMinRef} 
                            onChange={e => updateManualRow(index, 'valorMinRef', e.target.value)} 
                            className="w-full border border-gray-300 rounded-xl p-3 text-gray-900 focus:outline-none focus:border-emerald-600" 
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Valor Máx</label>
                          <input 
                            placeholder="Ex: 5.0" 
                            value={exame.valorMaxRef} 
                            onChange={e => updateManualRow(index, 'valorMaxRef', e.target.value)} 
                            className="w-full border border-gray-300 rounded-xl p-3 text-gray-900 focus:outline-none focus:border-emerald-600" 
                          />
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Observação</label>
                        <input 
                          placeholder="Observações adicionais" 
                          value={exame.observacao} 
                          onChange={e => updateManualRow(index, 'observacao', e.target.value)} 
                          className="w-full border border-gray-300 rounded-xl p-3 text-gray-900 focus:outline-none focus:border-emerald-600" 
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <button 
                  onClick={addManualRow} 
                  className="w-full py-4 border-2 border-dashed border-emerald-300 rounded-2xl text-emerald-600 hover:bg-emerald-50 flex items-center justify-center gap-2 font-medium"
                >
                  Adicionar outro exame
                </button>
              </div>

              <div className="p-6 border-t flex gap-3">
                <button onClick={() => setShowManualForm(false)} className="flex-1 py-3.5 border border-gray-300 rounded-3xl text-gray-700 font-medium hover:bg-gray-50">Cancelar</button>
                <button onClick={saveManual} className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-3xl">Salvar todos os exames</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CriaExameNutricional;
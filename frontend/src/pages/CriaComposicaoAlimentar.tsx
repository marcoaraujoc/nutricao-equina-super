import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import { ArrowLeft, Upload, FileText, Plus, X, AlertCircle } from 'lucide-react';

const CriaComposicaoAlimentar = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { animalId } = useParams<{ animalId: string }>();

  const [resultadoIA, setResultadoIA] = useState<any>(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);

  const [alimentos, setAlimentos] = useState<any[]>([]);
  const [nutrientes, setNutrientes] = useState<any[]>([]);

  const [manualComposicoes, setManualComposicoes] = useState<any[]>([
    { alimentoId: '', nutrienteId: '', valorPorKg: '', base: 'Seca' }
  ]);

  // Carrega alimentos e nutrientes
  useEffect(() => {
    const loadData = async () => {
      try {
        const [alRes, nutRes] = await Promise.all([
          api.get('/alimentos'),
          api.get('/nutrientes')
        ]);
        setAlimentos(alRes.data);
        setNutrientes(nutRes.data);
      } catch (err) {
        console.error(err);
      }
    };
    loadData();
  }, []);

  // Auto seleção de animal
  useEffect(() => {
    const autoSelecionarAnimal = async () => {
      if (selectedAnimal) return;
      if (!user?.id) return;

      try {
        if (animalId) {
          const res = await api.get(`/animais/${animalId}`);
          setSelectedAnimal(res.data);
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

    try {
      const interval = setInterval(() => setProgress(p => (p >= 95 ? 95 : p + 12)), 70);
      const res = await api.post('/composicoes-alimentares/analisar-llm', formData);
      setResultadoIA(res.data);
      setProgress(100);
      clearInterval(interval);
    } catch (err) {
      alert('Erro ao analisar o rótulo/composição');
    } finally {
      setLoading(false);
    }
  };

  // === MANUAL ===
  const addManualRow = () => {
    setManualComposicoes([...manualComposicoes, { alimentoId: '', nutrienteId: '', valorPorKg: '', base: 'Seca' }]);
  };

  const updateManualRow = (index: number, field: string, value: string) => {
    const updated = [...manualComposicoes];
    updated[index] = { ...updated[index], [field]: value };
    setManualComposicoes(updated);
  };

  const handleAlimentoSelect = (index: number, alimentoId: string) => {
    const updated = [...manualComposicoes];
    updated[index].alimentoId = alimentoId;
    setManualComposicoes(updated);
  };

  const handleNutrienteSelect = (index: number, nutrienteId: string) => {
    const updated = [...manualComposicoes];
    updated[index].nutrienteId = nutrienteId;
    setManualComposicoes(updated);
  };

  const saveManual = async () => {
    const validos = manualComposicoes.filter(c => c.alimentoId && c.nutrienteId && c.valorPorKg);
    if (validos.length === 0) return alert('Preencha ao menos um registro completo.');

    try {
      await Promise.all(validos.map(c =>
        api.post('/composicoes-alimentares', {
          alimentoId: Number(c.alimentoId),
          nutrienteId: Number(c.nutrienteId),
          valorPorKg: parseFloat(c.valorPorKg),
          base: c.base
        })
      ));
      alert(`${validos.length} composições salvas com sucesso!`);
      setShowManualForm(false);
      setManualComposicoes([{ alimentoId: '', nutrienteId: '', valorPorKg: '', base: 'Seca' }]);
      navigate('/composicao-alimentar');
    } catch (err) {
      alert('Erro ao salvar composições');
    }
  };

  const salvarTodos = async () => {
    if (!resultadoIA) return;
    const validos = resultadoIA.composicoes?.filter((c: any) => c.alimentoId && c.nutrienteId) || [];
    if (validos.length === 0) return alert('Nenhuma composição válida.');

    try {
      await Promise.all(validos.map((c: any) =>
        api.post('/composicoes-alimentares', {
          alimentoId: c.alimentoId,
          nutrienteId: c.nutrienteId,
          valorPorKg: c.valorPorKg,
          base: c.base || 'Seca'
        })
      ));
      alert(`${validos.length} composições salvas com sucesso!`);
      navigate('/composicao-alimentar');
    } catch (err) {
      alert('Erro ao salvar composições');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-4xl mx-auto px-4">

        <button 
          onClick={() => navigate('/composicao-alimentar')} 
          className="flex items-center gap-2 text-emerald-700 mb-4 hover:text-emerald-800"
        >
          <ArrowLeft size={20} /> Voltar
        </button>

        {selectedAnimal && (
          <div className="bg-white rounded-3xl shadow p-4 flex gap-4 mb-6">
            <div className="w-20 h-20 bg-gray-200 rounded-2xl overflow-hidden flex-shrink-0">
              <img 
                src={selectedAnimal.photoUrl || 'https://picsum.photos/id/1015/400/400'} 
                alt={selectedAnimal.nome} 
                className="w-full h-full object-cover" 
              />
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-2xl font-bold text-gray-900">{selectedAnimal.nome}</p>
                  <p className="text-gray-600 text-sm">{selectedAnimal.raca?.nome || 'Raça não informada'}</p>
                </div>
                <div className="text-right text-sm">
                  <div className="text-gray-900">
                    <span className="text-gray-500">Nascimento</span>{' '}
                    <span className="font-medium">
                      {selectedAnimal.dataNascimento 
                        ? new Date(selectedAnimal.dataNascimento).toLocaleDateString('pt-BR') 
                        : '-'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t">
                <span className="text-gray-500">Proprietário</span><br />
                <span className="font-medium text-gray-900">
                  {selectedAnimal.user?.fullName || user?.fullName}
                </span>
              </div>
            </div>
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
            <p className="font-medium text-gray-900">Enviar Rótulo / Composição</p>
            <p className="text-xs text-gray-500 mt-1">PDF ou imagem</p>
            <input type="file" accept=".pdf,image/*" onChange={handleFileChange} className="hidden" id="composicao" />
            <label htmlFor="composicao" className="mt-6 block bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-3 px-8 rounded-3xl cursor-pointer w-full">
              Escolher Arquivo
            </label>
          </div>

          <div className="bg-white rounded-3xl shadow p-6 text-center hover:shadow-md transition flex flex-col items-center">
            <FileText className="mb-3 text-emerald-600" size={32} />
            <p className="font-medium text-gray-900">Preencher Manualmente</p>
            <p className="text-xs text-gray-500 mt-1">Digite os dados da composição</p>
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

        <button 
          onClick={salvarTodos} 
          disabled={!resultadoIA}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white py-3 rounded-3xl font-medium text-sm mb-8"
        >
          Salvar Composições (do upload)
        </button>

        {resultadoIA && (
          <div className="bg-white rounded-3xl shadow overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50">
              <h2 className="font-semibold text-gray-900">Composições detectadas pela IA</h2>
            </div>
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-900">Alimento</th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-900">Nutriente</th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-900">Valor (g/kg)</th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-900">Base</th>
                </tr>
              </thead>
              <tbody>
                {(resultadoIA.composicoes || []).map((c: any, i: number) => (
                  <tr key={i} className="border-t hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{c.alimentoNome}</td>
                    <td className="px-6 py-4 font-medium text-gray-900">{c.nutrienteNome}</td>
                    <td className="px-6 py-4 text-emerald-700 font-semibold">{c.valorPorKg}</td>
                    <td className="px-6 py-4">{c.base}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showManualForm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-auto">
              <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white z-10">
                <h2 className="text-xl font-semibold text-gray-900">Preencher Composições Manualmente</h2>
                <button onClick={() => setShowManualForm(false)}><X size={24} /></button>
              </div>

              <div className="p-6 space-y-6">
                {manualComposicoes.map((comp, index) => (
                  <div key={index} className="border rounded-2xl p-5 bg-gray-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Alimento</label>
                        <select 
                          value={comp.alimentoId} 
                          onChange={e => handleAlimentoSelect(index, e.target.value)}
                          className="w-full border border-gray-300 rounded-xl p-3 text-gray-900 focus:outline-none focus:border-emerald-600"
                        >
                          <option value="">Selecione o alimento</option>
                          {alimentos.map(a => (
                            <option key={a.id} value={a.id}>{a.nome}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nutriente</label>
                        <select 
                          value={comp.nutrienteId} 
                          onChange={e => handleNutrienteSelect(index, e.target.value)}
                          className="w-full border border-gray-300 rounded-xl p-3 text-gray-900 focus:outline-none focus:border-emerald-600"
                        >
                          <option value="">Selecione o nutriente</option>
                          {nutrientes.map(n => (
                            <option key={n.id} value={n.id}>{n.nome} ({n.unidadePadrao})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Valor (g/kg)</label>
                        <input 
                          type="number" 
                          step="0.0001"
                          value={comp.valorPorKg} 
                          onChange={e => updateManualRow(index, 'valorPorKg', e.target.value)}
                          className="w-full border border-gray-300 rounded-xl p-3 text-gray-900 focus:outline-none focus:border-emerald-600" 
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Base</label>
                        <select 
                          value={comp.base} 
                          onChange={e => updateManualRow(index, 'base', e.target.value)}
                          className="w-full border border-gray-300 rounded-xl p-3 text-gray-900 focus:outline-none focus:border-emerald-600"
                        >
                          <option value="Seca">Seca</option>
                          <option value="Úmida">Úmida</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}

                <button 
                  onClick={addManualRow} 
                  className="w-full py-4 border-2 border-dashed border-emerald-300 rounded-2xl text-emerald-600 hover:bg-emerald-50 flex items-center justify-center gap-2 font-medium"
                >
                  <Plus size={20} /> Adicionar outra composição
                </button>
              </div>

              <div className="p-6 border-t flex gap-3">
                <button onClick={() => setShowManualForm(false)} className="flex-1 py-3.5 border border-gray-300 rounded-3xl text-gray-700 font-medium hover:bg-gray-50">Cancelar</button>
                <button onClick={saveManual} className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-3xl">Salvar todas as composições</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CriaComposicaoAlimentar;
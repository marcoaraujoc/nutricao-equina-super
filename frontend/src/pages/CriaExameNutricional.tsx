import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import axios from 'axios';
import { ArrowLeft, Upload, Save, Edit, Trash2, AlertCircle, X } from 'lucide-react';

const CriaExameNutricional = () => {
  const { user } = useAuth();
  const { selectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { animalId } = useParams<{ animalId: string }>();
  

  const [resultadoIA, setResultadoIA] = useState<any>(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showModal, setShowModal] = useState(false);

  const handleFileChange = async (e: any) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setFileName(file.name);
  setLoading(true);
  setProgress(0);

  const formData = new FormData();
  formData.append('arquivo', file);
  formData.append('animalId', animalId);   // ← LINHA ADICIONADA (obrigatória agora)

  try {
    const interval = setInterval(() => {
      setProgress(prev => (prev >= 95 ? 95 : prev + 12));
    }, 70);

    const res = await axios.post('/api/exames/analisar-llm', formData);
    setResultadoIA(res.data);
    setProgress(100);
    clearInterval(interval);
  } catch (err) {
    alert('Erro ao analisar o laudo');
    console.error(err);
  } finally {
    setLoading(false);
  }
};

  const salvarTodos = async () => {
    if (!resultadoIA) return;
    const validos = resultadoIA.exames.filter((e: any) => e.encontrado);
    if (validos.length === 0) return alert('Nenhum exame válido.');

    try {
      await Promise.all(
        validos.map((e: any) =>
          axios.post('/api/exames', {
            animalId,
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
      navigate(`/exames/${animalId}`);
    } catch (err) {
      alert('Erro ao salvar os exames');
    }
  };

  // Função para adicionar todos os nutrientes faltantes de uma vez
  const adicionarTodosFaltantes = () => {
    const faltantes = resultadoIA.exames.filter((e: any) => !e.encontrado);
    alert(`Adicionando ${faltantes.length} nutrientes ao catálogo:\n\n` +
          faltantes.map((e: any) => `- ${e.nomeOficial}`).join('\n'));
    // Aqui no futuro você pode chamar um endpoint para inserir todos de uma vez
    setShowModal(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-4xl mx-auto px-4">

        {/* Botão Voltar */}
        <button onClick={() => navigate(`/exames/${animalId}`)} className="flex items-center gap-2 text-emerald-700 mb-4">
          <ArrowLeft size={20} /> Voltar
        </button>

        {/* Card do Animal */}
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
                    <span className="text-gray-500">Nascimento</span> <span className="font-medium">07/08/2019</span>
                  </div>
                  <div className="text-gray-900">
                    <span className="text-gray-500">Idade</span> <span className="font-medium">6 anos</span>
                  </div>
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
        )}

        {/* Dois cards lado a lado */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-3xl shadow p-6 text-center hover:shadow-md transition">
            <Upload className="mx-auto mb-3 text-emerald-600" size={32} />
            <p className="font-medium text-gray-900">Enviar Laudo</p>
            <p className="text-xs text-gray-500 mt-1">PDF ou imagem do exame</p>
            <input type="file" accept=".pdf,image/*" onChange={handleFileChange} className="hidden" id="laudo" />
            <label htmlFor="laudo" className="mt-4 block bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-3 px-8 rounded-3xl cursor-pointer">
              Escolher Arquivo
            </label>
          </div>

          <div className="bg-white rounded-3xl shadow p-6 text-center hover:shadow-md transition flex flex-col justify-center">
            <button className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-3 px-8 rounded-3xl">
              Preencher Manualmente
            </button>
          </div>
        </div>

        {/* Barra de carregamento */}
        {loading && (
          <div className="mb-6">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-600 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-center text-xs text-gray-500 mt-1">{progress}%</p>
          </div>
        )}

        {/* Botão Salvar - mais suave */}
        <button
          onClick={salvarTodos}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-3xl font-medium text-sm mb-8"
        >
          Salvar
        </button>

        {/* Tabela de Exames */}
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
                    <td className="px-6 py-4 text-emerald-700 font-semibold whitespace-nowrap">
                      {e.valorEncontrado} {e.unidade}
                    </td>
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
          </div>
        )}

        {/* Modal de Nutrientes Faltantes */}
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
                  {resultadoIA.exames
                    .filter((e: any) => !e.encontrado)
                    .map((e: any, i: number) => (
                      <li key={i} className="flex items-center gap-2 text-gray-800 bg-gray-100 px-4 py-2 rounded-2xl">
                        <span className="flex-1">{e.nomeOficial}</span>
                      </li>
                    ))}
                </ul>
              </div>

              <div className="px-6 py-5 border-t flex gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-3 text-gray-700 font-medium border border-gray-200 rounded-3xl hover:bg-gray-100"
                >
                  Cancelar
                </button>
                <button
                  onClick={adicionarTodosFaltantes}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-3xl"
                >
                  Adicionar todos ao catálogo
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CriaExameNutricional;
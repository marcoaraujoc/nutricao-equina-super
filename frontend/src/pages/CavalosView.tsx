import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft } from 'lucide-react';

const CavalosView = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);           // ← Novo estado de loading
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [especies, setEspecies] = useState<any[]>([]);
  const [racasFiltradas, setRacasFiltradas] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    nome: '',
    especieId: 1,
    racaId: null as number | null,
    peso: '',
    dataNascimento: '',
    sexo: 'Macho',
    exercises: [] as { tipo: string; periodicidade: string }[],
  });

  // Carrega dados do animal
  useEffect(() => {
    const loadData = async () => {
      try {
        const [espRes, racRes] = await Promise.all([
          axios.get('/api/especies'),
          axios.get('/api/racas')
        ]);

        setEspecies(espRes.data);

        if (id) {
          const animalRes = await axios.get(`/api/animais/${id}`);
          const animal = animalRes.data;

          const filtradas = racRes.data.filter((r: any) => r.especieId === animal.especieId);
          setRacasFiltradas(filtradas);

          setFormData({
            nome: animal.nome,
            especieId: animal.especieId,
            racaId: animal.racaId,
            peso: animal.peso.toString(),
            dataNascimento: animal.dataNascimento ? animal.dataNascimento.split('T')[0] : '',
            sexo: animal.sexo,
            exercises: animal.exercises || [],
          });

          if (animal.photoUrl) setPhotoPreview(animal.photoUrl);
        }
      } catch (error) {
        console.error('Erro ao carregar dados', error);
      } finally {
        setLoading(false);          // ← Finaliza o loading
      }
    };

    loadData();
  }, [id]);

  const handleBack = () => {
    navigate('/meus-cavalos');
  };

  // Tela de loading (evita flash de tela vazia)
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Carregando animal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white shadow-2xl rounded-3xl p-6 md:p-8 border border-gray-100">
          {/* Header com botão Voltar */}
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={handleBack}
              className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
            >
              <ArrowLeft size={24} />
              <span className="text-lg">Voltar</span>
            </button>
          </div>

          {/* Foto quadrada + Nome em destaque */}
          <div className="flex gap-6 mb-10">
            <div className="w-40 h-40 flex-shrink-0 bg-gray-200 rounded-3xl overflow-hidden shadow-inner">
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="Foto do animal"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-6xl">🐴</div>
              )}
            </div>

            <div className="flex-1 pt-4">
              <h2 className="text-4xl font-bold text-gray-900 leading-tight">
                {formData.nome}
              </h2>
              <p className="text-emerald-700 font-medium text-2xl mt-1">
                {racasFiltradas.find(r => r.id === formData.racaId)?.nome || 'Raça não informada'}
              </p>
            </div>
          </div>

          {/* Demais informações */}
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Espécie</label>
                <select value={formData.especieId} disabled className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 bg-gray-50 cursor-not-allowed">
                  {especies.map((esp: any) => (
                    <option key={esp.id} value={esp.id}>{esp.nome}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
                <select value={formData.sexo} disabled className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 bg-gray-50 cursor-not-allowed">
                  <option value="Macho">Macho</option>
                  <option value="Fêmea">Fêmea</option>
                  <option value="Castrado">Castrado</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Raça</label>
              <select value={formData.racaId || ''} disabled className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 bg-gray-50 cursor-not-allowed">
                {racasFiltradas.map((raca: any) => (
                  <option key={raca.id} value={raca.id}>{raca.nome}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Peso (kg)</label>
                <input type="text" value={formData.peso} disabled className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 bg-gray-50 cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data de Nascimento</label>
                <input type="date" value={formData.dataNascimento} disabled className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 bg-gray-50 cursor-not-allowed" />
              </div>
            </div>

            {formData.especieId === 1 && formData.exercises.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">Exercícios</label>
                <div className="grid grid-cols-2 gap-3">
                  {formData.exercises.map((ex, index) => (
                    <div key={index} className="border border-gray-200 rounded-2xl p-4 bg-gray-50">
                      <div className="font-medium text-gray-800">{ex.tipo}</div>
                      <div className="text-sm text-gray-600 mt-1">{ex.periodicidade}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CavalosView;
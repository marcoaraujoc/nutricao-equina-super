import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

const Cavalos = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const [especies, setEspecies] = useState<any[]>([]);
  const [todasRacas, setTodasRacas] = useState<any[]>([]);
  const [racasFiltradas, setRacasFiltradas] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    nome: '',
    especieId: 1,
    racaId: null as number | null,
    peso: '',
    dataNascimento: '',
    sexo: 'Macho',
    exercises: [] as { tipo: string; periodicidade: string }[],
  });

  // Carrega espécies, raças e dados do animal (edição)
  useEffect(() => {
    const loadData = async () => {
      try {
        const [espRes, racRes] = await Promise.all([
          axios.get('/api/especies'),
          axios.get('/api/racas')
        ]);
        setEspecies(espRes.data);
        setTodasRacas(racRes.data);

        const filtradas = racRes.data.filter((r: any) => r.especieId === 1);
        setRacasFiltradas(filtradas);

        if (isEditMode && id) {
          const animalRes = await axios.get(`/api/animais/${id}`);
          const animal = animalRes.data;
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
      }
    };
    loadData();
  }, [id, isEditMode]);

  // Filtra raças + define default apenas no cadastro
  useEffect(() => {
    if (formData.especieId && todasRacas.length > 0) {
      const filtradas = todasRacas.filter((r: any) => r.especieId === formData.especieId);
      setRacasFiltradas(filtradas);

      if (!isEditMode && filtradas.length > 0 && !formData.racaId) {
        setFormData(prev => ({ ...prev, racaId: filtradas[0].id }));
      }
    }
  }, [formData.especieId, todasRacas, isEditMode]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const toggleExercise = (tipo: string) => {
    const exists = formData.exercises.find(ex => ex.tipo === tipo);
    if (exists) {
      setFormData(prev => ({
        ...prev,
        exercises: prev.exercises.filter(ex => ex.tipo !== tipo)
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        exercises: [...prev.exercises, { tipo, periodicidade: '1x na semana' }]
      }));
    }
  };

  const updatePeriodicidade = (index: number, value: string) => {
    const newExercises = [...formData.exercises];
    newExercises[index].periodicidade = value;
    setFormData({ ...formData, exercises: newExercises });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    // Debug: mostra o que está sendo enviado
    console.log('=== DADOS ANTES DE ENVIAR ===');
    console.log('formData.racaId:', formData.racaId);
    console.log('formData completo:', formData);

    if (!formData.racaId) {
      alert('❌ Raça é obrigatória');
      setSubmitting(false);
      return;
    }

    try {
      const payload = {
        nome: formData.nome,
        especieId: formData.especieId,
        racaId: formData.racaId,
        peso: parseFloat(formData.peso) || 0,
        dataNascimento: formData.dataNascimento || null,
        sexo: formData.sexo,
        exercises: formData.exercises,
        userId: user?.id,
      };

      if (photoFile) {
        const formDataUpload = new FormData();
        formDataUpload.append('nome', payload.nome);
        formDataUpload.append('especieId', String(payload.especieId));
        formDataUpload.append('racaId', String(payload.racaId));        // ← corrigido
        formDataUpload.append('peso', String(payload.peso));
        formDataUpload.append('dataNascimento', payload.dataNascimento || '');
        formDataUpload.append('sexo', payload.sexo);
        formDataUpload.append('userId', String(payload.userId || ''));
        formDataUpload.append('exercises', JSON.stringify(payload.exercises));
        formDataUpload.append('foto', photoFile);

        console.log('Enviando FormData com foto...');
        const config = { headers: { 'Content-Type': 'multipart/form-data' } };

        if (isEditMode) {
          await axios.put(`/api/animais/${id}`, formDataUpload, config);
          alert('✅ Animal atualizado com sucesso!');
        } else {
          await axios.post('/api/animais', formDataUpload, config);
          alert('✅ Animal cadastrado com sucesso!');
        }
      } else {
        console.log('Enviando JSON sem foto...');
        if (isEditMode) {
          await axios.put(`/api/animais/${id}`, payload);
          alert('✅ Animal atualizado com sucesso!');
        } else {
          await axios.post('/api/animais', payload);
          alert('✅ Animal cadastrado com sucesso!');
        }
      }

      navigate('/meus-cavalos');
    } catch (error: any) {
      console.error('Erro completo:', error.response?.data || error);
      alert(error.response?.data?.error || '❌ Erro ao salvar animal');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-screen bg-white flex items-center justify-center overflow-hidden">
      <div className="max-w-2xl w-full mx-auto px-4">
        <div className="bg-white shadow-2xl rounded-3xl p-5 border border-gray-100 max-h-[94vh] overflow-y-auto">
          {/* Foto */}
          <div className="flex justify-center mb-5">
            <label className="cursor-pointer group">
              <div className="w-44 h-44 rounded-full border-4 border-emerald-600 overflow-hidden bg-gray-100 flex items-center justify-center shadow-inner transition-all group-hover:scale-105">
                {photoPreview ? (
                  <img src={photoPreview} alt="Foto do animal" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center text-emerald-600">
                    <span className="block text-sm font-medium">Adicionar foto</span>
                    <span className="text-xs">Clique aqui</span>
                  </div>
                )}
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
            </label>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Animal</label>
              <input
                type="text"
                required
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Espécie</label>
                <select
                  value={formData.especieId}
                  onChange={(e) => setFormData({ ...formData, especieId: parseInt(e.target.value), racaId: null })}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-gray-900"
                >
                  {especies.map((esp: any) => (
                    <option key={esp.id} value={esp.id}>{esp.nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
                <select
                  value={formData.sexo}
                  onChange={(e) => setFormData({ ...formData, sexo: e.target.value })}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-gray-900"
                >
                  <option value="Macho">Macho</option>
                  <option value="Fêmea">Fêmea</option>
                  <option value="Castrado">Castrado</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Raça <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.racaId || ''}
                onChange={(e) => setFormData({ ...formData, racaId: parseInt(e.target.value) })}
                required
                className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-gray-900"
              >
                {racasFiltradas.map((raca: any) => (
                  <option key={raca.id} value={raca.id}>
                    {raca.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Peso (kg)</label>
                <input
                  type="number"
                  step="0.1"
                  required
                  value={formData.peso}
                  onChange={(e) => setFormData({ ...formData, peso: e.target.value })}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data de Nascimento</label>
                <input
                  type="date"
                  required
                  value={formData.dataNascimento}
                  onChange={(e) => setFormData({ ...formData, dataNascimento: e.target.value })}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-gray-900"
                />
              </div>
            </div>

            {formData.especieId === 1 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tipos de Exercício e Quantidade de Vezes</label>
                <div className="grid grid-cols-2 gap-3">
                  {['Adestramento', 'Salto', 'Barril', 'Cross'].map((tipo) => {
                    const selected = formData.exercises.find((ex) => ex.tipo === tipo);
                    return (
                      <div key={tipo} className="border border-gray-200 rounded-2xl p-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={!!selected} onChange={() => toggleExercise(tipo)} />
                          <span className="text-gray-700">{tipo}</span>
                        </label>
                        {selected && (
                          <div className="mt-2">
                            <label className="text-xs text-gray-500 block mb-1">Quantidade de vezes</label>
                            <select
                              value={selected.periodicidade}
                              onChange={(e) => updatePeriodicidade(formData.exercises.indexOf(selected), e.target.value)}
                              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                            >
                              <option value="1x na semana">1x na semana</option>
                              <option value="2x na semana">2x na semana</option>
                              <option value="3x na semana">3x na semana</option>
                              <option value="4x na semana">4x na semana</option>
                              <option value="5x na semana">5x na semana</option>
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white py-3.5 rounded-2xl font-semibold text-lg transition-colors"
            >
              {submitting 
                ? (isEditMode ? 'Atualizando Animal...' : 'Cadastrando Animal...') 
                : (isEditMode ? 'Atualizar Animal' : 'Cadastrar Animal')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Cavalos;
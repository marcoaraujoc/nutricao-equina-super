import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

const Cavalos = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [especies, setEspecies] = useState<any[]>([]);
  const [todasRacas, setTodasRacas] = useState<any[]>([]); // todas as raças do banco
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

  // Carrega espécies e todas as raças
  useEffect(() => {
    const loadData = async () => {
      try {
        const [espRes, racRes] = await Promise.all([
          axios.get('/api/especies'),
          axios.get('/api/racas')
        ]);
        setEspecies(espRes.data);
        setTodasRacas(racRes.data);
        // Filtra inicialmente para Equino
        const filtradas = racRes.data.filter((r: any) => r.especieId === 1);
        setRacasFiltradas(filtradas);
      } catch (error) {
        console.error('Erro ao carregar dados', error);
      }
    };
    loadData();
  }, []);

  // Filtra raças quando a espécie muda
  useEffect(() => {
    if (formData.especieId) {
      const filtradas = todasRacas.filter((r: any) => r.especieId === formData.especieId);
      setRacasFiltradas(filtradas);
      // Limpa raça selecionada quando muda a espécie
      setFormData(prev => ({ ...prev, racaId: null }));
    }
  }, [formData.especieId, todasRacas]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const toggleExercise = (tipo: string) => {
    const exists = formData.exercises.find((ex) => ex.tipo === tipo);
    if (exists) {
      setFormData((prev) => ({
        ...prev,
        exercises: prev.exercises.filter((ex) => ex.tipo !== tipo),
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        exercises: [...prev.exercises, { tipo, periodicidade: '1x na semana' }],
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
    try {
      await axios.post('/api/animais', {
        ...formData,
        peso: parseFloat(formData.peso),
        dataNascimento: formData.dataNascimento || null,
        userId: user?.id,
      });
      alert('✅ Animal cadastrado com sucesso!');
      setFormData({ nome: '', especieId: 1, racaId: null, peso: '', dataNascimento: '', sexo: 'Macho', exercises: [] });
      setPhotoPreview(null);
    } catch (error) {
      console.error(error);
      alert('❌ Erro ao cadastrar animal');
    }
  };

  const isEquino = formData.especieId === 1;

  return (
    <div className="h-screen bg-white flex items-center justify-center overflow-hidden">
      <div className="max-w-2xl w-full mx-auto px-4">
        <div className="bg-white shadow-2xl rounded-3xl p-5 border border-gray-100 max-h-[94vh] overflow-y-auto">
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
            {/* NOME GRANDE */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Animal</label>
              <input type="text" required value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900" />
            </div>

            {/* Espécie + Sexo lado a lado */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Espécie</label>
                <select value={formData.especieId} onChange={(e) => setFormData({ ...formData, especieId: parseInt(e.target.value), racaId: null })} className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-gray-900">
                  {especies.map((esp: any) => (
                    <option key={esp.id} value={esp.id}>{esp.nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
                <select value={formData.sexo} onChange={(e) => setFormData({ ...formData, sexo: e.target.value })} className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-gray-900">
                  <option value="Macho">Macho</option>
                  <option value="Fêmea">Fêmea</option>
                  <option value="Castrado">Castrado</option>
                </select>
              </div>
            </div>

            {/* RAÇA - dropdown filtrado */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Raça</label>
              <select value={formData.racaId || ''} onChange={(e) => setFormData({ ...formData, racaId: e.target.value ? parseInt(e.target.value) : null })} className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-gray-900">
                <option value="">Selecione uma raça...</option>
                {racasFiltradas.map((raca: any) => (
                  <option key={raca.id} value={raca.id}>
                    {raca.nome}
                  </option>
                ))}
              </select>
            </div>

            {/* PESO + DATA */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Peso (kg)</label>
                <input type="number" step="0.1" required value={formData.peso} onChange={(e) => setFormData({ ...formData, peso: e.target.value })} className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-gray-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data de Nascimento</label>
                <input type="date" value={formData.dataNascimento} onChange={(e) => setFormData({ ...formData, dataNascimento: e.target.value })} className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-gray-900" />
              </div>
            </div>

            {/* EXERCÍCIOS (só Equino) */}
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
                            <select value={selected.periodicidade} onChange={(e) => updatePeriodicidade(formData.exercises.indexOf(selected), e.target.value)} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900">
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

            <button type="submit" className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-3.5 rounded-2xl font-semibold text-lg transition-colors">
              Cadastrar Animal
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Cavalos;
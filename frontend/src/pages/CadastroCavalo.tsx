import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

const CadastroCavalo = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [especies, setEspecies] = useState<any[]>([]);
  const [racasFiltradas, setRacasFiltradas] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    nome: '',
    especieId: 1, // Default: Equino
    racaId: null as number | null,
    peso: '',
    dataNascimento: '',
    sexo: 'Macho',
    exercises: [] as { tipo: string; periodicidade: string }[],
  });

  // Mock inicial de espécies e raças (será substituído pelo backend)
  useEffect(() => {
    setEspecies([
      { id: 1, nome: 'Equino' },
      { id: 2, nome: 'Canino' },
      { id: 3, nome: 'Felino' },
    ]);

    // Raças iniciais para Equino
    setRacasFiltradas([
      { id: 1, nome: 'Quarto de Milha' },
      { id: 2, nome: 'Mangalarga Marchador' },
      { id: 3, nome: 'Árabe' },
      { id: 4, nome: 'Puro Sangue Inglês' },
      { id: 5, nome: 'Crioulo' },
      { id: 6, nome: 'Appaloosa' },
      { id: 7, nome: 'Paint Horse' },
    ]);
  }, []);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
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
        exercises: prev.exercises.filter(ex => ex.tipo !== tipo),
      }));
    } else {
      setFormData(prev => ({
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
      navigate('/cavalos');
    } catch (error) {
      console.error(error);
      alert('❌ Erro ao cadastrar animal');
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white min-h-screen">
      <h1 className="text-3xl font-bold text-gray-800 mb-8 text-center">Cadastro de Animal</h1>

      {/* FOTO OVAL CENTRAL */}
      <div className="flex justify-center mb-10">
        <label className="cursor-pointer group">
          <div className="w-48 h-48 rounded-[50%] border-4 border-emerald-600 overflow-hidden bg-gray-100 flex items-center justify-center shadow-2xl transition-all group-hover:scale-105">
            {photoPreview ? (
              <img src={photoPreview} alt="Foto do animal" className="w-full h-full object-cover" />
            ) : (
              <div className="text-center">
                <span className="text-emerald-700 text-sm font-medium block">Adicionar foto</span>
                <span className="text-xs text-gray-400">Clique aqui</span>
              </div>
            )}
          </div>
          <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
        </label>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* NOME */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Animal</label>
          <input
            type="text"
            required
            value={formData.nome}
            onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
            className="w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600"
          />
        </div>

        {/* ESPÉCIE */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Espécie</label>
          <select
            value={formData.especieId}
            onChange={(e) => setFormData({ ...formData, especieId: parseInt(e.target.value), racaId: null })}
            className="w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600"
          >
            {especies.map((esp: any) => (
              <option key={esp.id} value={esp.id}>
                {esp.nome}
              </option>
            ))}
          </select>
        </div>

        {/* RAÇA COM AUTOCOMPLETE */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Raça</label>
          <input
            list="lista-racas"
            placeholder="Digite ou selecione a raça..."
            className="w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600"
            onChange={(e) => {
              const racaSelecionada = racasFiltradas.find((r) => r.nome === e.target.value);
              setFormData({ ...formData, racaId: racaSelecionada ? racaSelecionada.id : null });
            }}
          />
          <datalist id="lista-racas">
            {racasFiltradas.map((raca: any) => (
              <option key={raca.id} value={raca.nome} />
            ))}
          </datalist>
        </div>

        {/* PESO E DATA DE NASCIMENTO */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Peso (kg)</label>
            <input
              type="number"
              step="0.1"
              required
              value={formData.peso}
              onChange={(e) => setFormData({ ...formData, peso: e.target.value })}
              className="w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data de Nascimento</label>
            <input
              type="date"
              value={formData.dataNascimento}
              onChange={(e) => setFormData({ ...formData, dataNascimento: e.target.value })}
              className="w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600"
            />
          </div>
        </div>

        {/* SEXO */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
          <select
            value={formData.sexo}
            onChange={(e) => setFormData({ ...formData, sexo: e.target.value })}
            className="w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600"
          >
            <option value="Macho">Macho</option>
            <option value="Fêmea">Fêmea</option>
            <option value="Castrado">Castrado</option>
          </select>
        </div>

        {/* TIPOS DE EXERCÍCIO + PERIODICIDADE */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">Tipos de Exercício (pode selecionar mais de um)</label>
          <div className="grid grid-cols-2 gap-4">
            {['Adestramento', 'Salto', 'Barril', 'Cross'].map((tipo) => {
              const selected = formData.exercises.find((ex) => ex.tipo === tipo);
              return (
                <div key={tipo} className="border border-gray-200 rounded-2xl p-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!selected}
                      onChange={() => toggleExercise(tipo)}
                    />
                    <span className="text-gray-700">{tipo}</span>
                  </label>
                  {selected && (
                    <input
                      type="text"
                      placeholder="Ex: 2x na semana"
                      value={selected.periodicidade}
                      onChange={(e) => updatePeriodicidade(formData.exercises.indexOf(selected), e.target.value)}
                      className="mt-3 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* BOTÃO CADASTRAR */}
        <button
          type="submit"
          className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-2xl font-semibold text-lg transition-colors"
        >
          Cadastrar Animal
        </button>
      </form>
    </div>
  );
};

export default CadastroCavalo;
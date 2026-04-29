import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import axios from 'axios';
import { ArrowLeft } from 'lucide-react';

const CriaDieta = () => {
  const { animalId } = useParams<{ animalId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedAnimal } = useSelectedAnimal();

  const [alimentos, setAlimentos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    alimentoId: '',
    periodicidade: '2x ao dia',
    quantidadePorVez: '',
  });

  // Carrega alimentos da tabela tb_alimentos
  useEffect(() => {
    axios.get('/api/alimentos')
      .then((res) => {
        const ativos = res.data.filter((a: any) => a.ativo !== false);
        ativos.sort((a: any, b: any) => a.nome.localeCompare(b.nome));
        setAlimentos(ativos);
      })
      .catch((err) => console.error('Erro ao carregar alimentos', err));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.alimentoId || !form.quantidadePorVez) {
      alert('Preencha o alimento e a quantidade');
      return;
    }

    const effectiveAnimalId = animalId || selectedAnimal?.id?.toString();
    if (!effectiveAnimalId) {
      alert('Animal não identificado');
      return;
    }

    setLoading(true);

    const payload = {
      animalId: Number(effectiveAnimalId),
      alimentoId: Number(form.alimentoId),
      periodicidade: form.periodicidade,
      quantidadePorVez: form.quantidadePorVez,
      userId: user?.id
    };

    try {
      await axios.post('/api/dietas/item', payload);
      alert('✅ Alimento adicionado com sucesso!');
      navigate(`/dieta/${effectiveAnimalId}`);
    } catch (err: any) {
      console.error(err);
      alert('Erro ao adicionar alimento: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-20">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 mb-6 text-emerald-700 hover:text-emerald-800"
        >
          <ArrowLeft size={24} />
          <span className="font-semibold !text-gray-900">Voltar</span>
        </button>

        <h1 className="text-3xl font-bold mb-8 text-center !text-gray-900">Adicionar Novo Alimento</h1>

        <form onSubmit={handleSubmit} className="bg-white p-8 rounded-3xl shadow space-y-8">
          {/* ALIMENTO */}
          <div>
            <label className="block text-sm font-medium !text-gray-900 mb-2">Alimento</label>
            <select
              value={form.alimentoId}
              onChange={(e) => setForm({ ...form, alimentoId: e.target.value })}
              className="w-full rounded-3xl border border-gray-300 p-4 focus:outline-none focus:border-emerald-600 !text-gray-900 text-base bg-white"
              required
            >
              <option value="" className="!text-gray-900 bg-white">Selecione um alimento...</option>
              {alimentos.map((alimento: any) => (
                <option key={alimento.id} value={alimento.id} className="!text-gray-900 bg-white">
                  {alimento.nome}
                </option>
              ))}
            </select>
          </div>

          {/* PERIODICIDADE */}
          <div>
            <label className="block text-sm font-medium !text-gray-900 mb-2">Periodicidade</label>
            <select
              value={form.periodicidade}
              onChange={(e) => setForm({ ...form, periodicidade: e.target.value })}
              className="w-full rounded-3xl border border-gray-300 p-4 focus:outline-none focus:border-emerald-600 !text-gray-900 text-base bg-white"
            >
              <option value="1x ao dia" className="!text-gray-900 bg-white">1x ao dia</option>
              <option value="2x ao dia" className="!text-gray-900 bg-white">2x ao dia</option>
              <option value="3x ao dia" className="!text-gray-900 bg-white">3x ao dia</option>
              <option value="4x ao dia" className="!text-gray-900 bg-white">4x ao dia</option>
            </select>
          </div>

          {/* QUANTIDADE */}
          <div>
            <label className="block text-sm font-medium !text-gray-900 mb-2">
              Quantidade (ex: 2 pães, 2 Kg, 500 g, 300 ml)
            </label>
            <input
              type="text"
              value={form.quantidadePorVez}
              onChange={(e) => setForm({ ...form, quantidadePorVez: e.target.value })}
              className="w-full rounded-3xl border border-gray-300 p-4 focus:outline-none focus:border-emerald-600 !text-gray-900 text-base bg-white"
              placeholder="2 pães"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white py-5 rounded-3xl font-bold text-xl transition-colors"
          >
            {loading ? 'Adicionando...' : 'Adicionar à Dieta'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CriaDieta;
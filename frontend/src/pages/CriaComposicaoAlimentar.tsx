import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { ArrowLeft } from 'lucide-react';

const CriaComposicaoAlimentar = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [alimentos, setAlimentos] = useState<any[]>([]);
  const [nutrientes, setNutrientes] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    alimentoId: '',
    nutrienteId: '',
    valorPorKg: '',
    base: 'Seca',
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        const [alRes, nutRes] = await Promise.all([
          axios.get('/api/alimentos'),
          axios.get('/api/nutrientes')
        ]);
        setAlimentos(alRes.data);
        setNutrientes(nutRes.data);

        if (isEditMode && id) {
          const res = await axios.get(`/api/composicoes-alimentares/${id}`);
          const item = res.data;
          setFormData({
            alimentoId: item.alimentoId.toString(),
            nutrienteId: item.nutrienteId.toString(),
            valorPorKg: item.valorPorKg.toString(),
            base: item.base,
          });
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id, isEditMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload = {
        alimentoId: parseInt(formData.alimentoId),
        nutrienteId: parseInt(formData.nutrienteId),
        valorPorKg: parseFloat(formData.valorPorKg),
        base: formData.base,
      };

      if (isEditMode) {
        await axios.put(`/api/composicoes-alimentares/${id}`, payload);
        alert('Composição atualizada com sucesso!');
      } else {
        await axios.post('/api/composicoes-alimentares', payload);
        alert('Composição cadastrada com sucesso!');
      }
      navigate('/composicao-alimentar');
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.error || 'Erro ao salvar composição');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white shadow-2xl rounded-3xl p-6 md:p-8 border border-gray-100">
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={() => navigate('/composicao-alimentar')}
              className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
            >
              <ArrowLeft size={24} />
              <span className="text-lg">Voltar</span>
            </button>
          </div>

          <h1 className="text-3xl font-bold text-gray-900 mb-8 text-center">
            {isEditMode ? 'Editar Composição' : 'Nova Composição Alimentar'}
          </h1>

          <form onSubmit={handleSubmit} className="space-y-8">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Alimento</label>
              <select
                required
                value={formData.alimentoId}
                onChange={(e) => setFormData({ ...formData, alimentoId: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-6 py-4 focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
              >
                <option value="">Selecione o alimento...</option>
                {alimentos.map((a) => (
                  <option key={a.id} value={a.id}>{a.nome}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Nutriente</label>
              <select
                required
                value={formData.nutrienteId}
                onChange={(e) => setFormData({ ...formData, nutrienteId: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-6 py-4 focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
              >
                <option value="">Selecione o nutriente...</option>
                {nutrientes.map((n) => (
                  <option key={n.id} value={n.id}>{n.nome} ({n.unidadePadrao})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Valor</label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.valorPorKg}
                onChange={(e) => setFormData({ ...formData, valorPorKg: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-6 py-4 focus:outline-none focus:border-emerald-600 text-gray-900"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Base</label>
              <select
                value={formData.base}
                onChange={(e) => setFormData({ ...formData, base: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-6 py-4 focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
              >
                <option value="Seca">Seca</option>
                <option value="Úmida">Úmida</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-5 rounded-3xl font-semibold text-xl transition-colors disabled:opacity-50"
            >
              {submitting ? 'Salvando...' : isEditMode ? 'Atualizar Composição' : 'Cadastrar Composição'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// ✅ EXPORT DEFAULT (obrigatório para Vite)
export default CriaComposicaoAlimentar;
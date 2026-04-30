import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { ArrowLeft } from 'lucide-react';

const CriaDieta = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { animalId, id } = useParams<{ animalId: string; id?: string }>();
  const isEditMode = !!id;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [alimentos, setAlimentos] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    alimentoId: '',
    qtdGramasDia: '',
    unidade: '',
    periodicidade: '',
    horario: '',
    observacao: '',
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        // Carregar lista de alimentos para o select
        const alRes = await axios.get('/api/alimentos');
        setAlimentos(alRes.data);

        // Se estiver editando, carregar os dados existentes da dieta
        if (isEditMode && id) {
          const res = await axios.get(`/api/dietas/${id}`);
          const item = res.data;

          setFormData({
            alimentoId: item.alimentoId?.toString() || '',
            qtdGramasDia: item.qtdGramasDia?.toString() || '',
            unidade: item.unidade || '',
            periodicidade: item.periodicidade || '',
            horario: item.horario || '',
            observacao: item.observacao || '',
          });
        }
      } catch (error) {
        console.error('Erro ao carregar dados de edição:', error);
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
        animalId: parseInt(animalId!),
        alimentoId: parseInt(formData.alimentoId),
        qtdGramasDia: parseFloat(formData.qtdGramasDia) || 0,
        unidade: formData.unidade,
        periodicidade: formData.periodicidade,
        horario: formData.horario || null,
        observacao: formData.observacao || null,
        criadopor: user?.id || 1,
        modificadopor: user?.id || 1,
      };

      if (isEditMode) {
        await axios.put(`/api/dietas/${id}`, payload);
        alert('✅ Alimento atualizado na dieta com sucesso!');
      } else {
        await axios.post('/api/dietas', payload);
        alert('✅ Alimento adicionado à dieta com sucesso!');
      }

      navigate(`/dieta/${animalId}`);
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.error || 'Erro ao salvar alimento na dieta');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-900">Carregando dados...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white shadow-2xl rounded-3xl p-6 border border-gray-100">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => navigate(`/dieta/${animalId}`)}
              className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
            >
              <ArrowLeft size={22} />
              <span className="text-base">Voltar</span>
            </button>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            {isEditMode ? 'Editar Alimento na Dieta' : 'Adicionar Alimento na Dieta'}
          </h1>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Alimento</label>
              <select
                required
                value={formData.alimentoId}
                onChange={(e) => setFormData({ ...formData, alimentoId: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-5 py-3.5 focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
              >
                <option value="">Selecione o alimento...</option>
                {alimentos.map((a) => (
                  <option key={a.id} value={a.id}>{a.nome}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Quantidade (qtdGramasDia)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={formData.qtdGramasDia}
                onChange={(e) => setFormData({ ...formData, qtdGramasDia: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-5 py-3.5 focus:outline-none focus:border-emerald-600 text-gray-900"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Unidade</label>
              <select
                required
                value={formData.unidade}
                onChange={(e) => setFormData({ ...formData, unidade: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-5 py-3.5 focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
              >
                <option value="">Selecione a unidade...</option>
                <option value="Pães">Pães</option>
                <option value="Kg">Kg</option>
                <option value="Gramas">Gramas</option>
                <option value="Mililitros">Mililitros</option>
                <option value="Litro">Litro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Periodicidade</label>
              <select
                required
                value={formData.periodicidade}
                onChange={(e) => setFormData({ ...formData, periodicidade: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-5 py-3.5 focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
              >
                <option value="">Selecione a periodicidade...</option>
                <option value="3x ao dia">3x ao dia</option>
                <option value="2x ao dia">2x ao dia</option>
                <option value="1x ao dia">1x ao dia</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Horário (24h)</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={5}
                placeholder="00:00"
                value={formData.horario}
                onChange={(e) => setFormData({ ...formData, horario: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-5 py-3.5 focus:outline-none focus:border-emerald-600 text-gray-900"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Observação</label>
              <textarea
                value={formData.observacao}
                onChange={(e) => setFormData({ ...formData, observacao: e.target.value })}
                rows={3}
                className="w-full border border-gray-300 rounded-3xl px-5 py-3.5 focus:outline-none focus:border-emerald-600 text-gray-900"
                placeholder="Observações adicionais..."
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-3xl font-semibold text-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Salvando...' : isEditMode ? 'Atualizar Alimento' : 'Adicionar Alimento'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CriaDieta;
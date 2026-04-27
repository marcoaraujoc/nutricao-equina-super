import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { ArrowLeft } from 'lucide-react';

const CriaDieta = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [animais, setAnimais] = useState<any[]>([]);
  const [alimentos, setAlimentos] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    animalId: '',
    alimentoId: '',
    qtdGramasDia: '',
    dataInicio: '',
    dataFim: '',
    horario: '',
    observacao: '',
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        const [aniRes, aliRes] = await Promise.all([
          axios.get('/api/cavalos'),      // endpoint de animais (padrão do projeto)
          axios.get('/api/alimentos')
        ]);
        setAnimais(aniRes.data);
        setAlimentos(aliRes.data);

        if (isEditMode && id) {
          const res = await axios.get(`/api/dietas/${id}`);
          const d = res.data;
          setFormData({
            animalId: d.animalId.toString(),
            alimentoId: d.alimentoId.toString(),
            qtdGramasDia: d.qtdGramasDia.toString(),
            dataInicio: d.dataInicio ? d.dataInicio.split('T')[0] : '',
            dataFim: d.dataFim ? d.dataFim.split('T')[0] : '',
            horario: d.horario || '',
            observacao: d.observacao || '',
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
        animalId: parseInt(formData.animalId),
        alimentoId: parseInt(formData.alimentoId),
        qtdGramasDia: parseFloat(formData.qtdGramasDia),
        dataInicio: formData.dataInicio || undefined,
        dataFim: formData.dataFim || undefined,
        horario: formData.horario || undefined,
        observacao: formData.observacao || undefined,
      };

      if (isEditMode) {
        await axios.put(`/api/dietas/${id}`, payload);
        alert('Dieta atualizada com sucesso!');
      } else {
        await axios.post('/api/dietas', payload);
        alert('Dieta cadastrada com sucesso!');
      }
      navigate('/dieta');
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.error || 'Erro ao salvar dieta');
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
              onClick={() => navigate('/dieta')}
              className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
            >
              <ArrowLeft size={24} />
              <span className="text-lg">Voltar</span>
            </button>
          </div>

          <h1 className="text-3xl font-bold text-gray-900 mb-8 text-center">
            {isEditMode ? 'Editar Dieta' : 'Nova Dieta'}
          </h1>

          <form onSubmit={handleSubmit} className="space-y-8">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Animal / Cavalo</label>
              <select
                required
                value={formData.animalId}
                onChange={(e) => setFormData({ ...formData, animalId: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-6 py-4 focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
              >
                <option value="">Selecione o animal...</option>
                {animais.map((a) => (
                  <option key={a.id} value={a.id}>{a.nome}</option>
                ))}
              </select>
            </div>

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
              <label className="block text-sm font-medium text-gray-700 mb-2">Quantidade por dia (g)</label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.qtdGramasDia}
                onChange={(e) => setFormData({ ...formData, qtdGramasDia: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-6 py-4 focus:outline-none focus:border-emerald-600 text-gray-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Data de Início</label>
                <input
                  type="date"
                  value={formData.dataInicio}
                  onChange={(e) => setFormData({ ...formData, dataInicio: e.target.value })}
                  className="w-full border border-gray-300 rounded-3xl px-6 py-4 focus:outline-none focus:border-emerald-600 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Data de Fim (opcional)</label>
                <input
                  type="date"
                  value={formData.dataFim}
                  onChange={(e) => setFormData({ ...formData, dataFim: e.target.value })}
                  className="w-full border border-gray-300 rounded-3xl px-6 py-4 focus:outline-none focus:border-emerald-600 text-gray-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Horário (opcional)</label>
              <input
                type="text"
                placeholder="ex: 08:00"
                value={formData.horario}
                onChange={(e) => setFormData({ ...formData, horario: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-6 py-4 focus:outline-none focus:border-emerald-600 text-gray-900"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Observação</label>
              <textarea
                value={formData.observacao}
                onChange={(e) => setFormData({ ...formData, observacao: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-6 py-4 focus:outline-none focus:border-emerald-600 text-gray-900 h-24"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-5 rounded-3xl font-semibold text-xl transition-colors disabled:opacity-50"
            >
              {submitting ? 'Salvando...' : isEditMode ? 'Atualizar Dieta' : 'Cadastrar Dieta'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CriaDieta;
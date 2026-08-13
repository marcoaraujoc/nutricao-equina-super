import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';

const CriaNutrientes = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Erro de ação exibido inline (substitui o alert de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    nome: '',
    categoria: '',
    unidadePadrao: '',
  });

  useEffect(() => {
    const loadData = async () => {
      if (isEditMode && id) {
        try {
          const res = await api.get(`/nutrientes/${id}`);
          const n = res.data;
          setFormData({ nome: n.nome, categoria: n.categoria, unidadePadrao: n.unidadePadrao });
        } catch (error) {
          console.error(error);
        }
      }
      setLoading(false);
    };
    loadData();
  }, [id, isEditMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErroInline(null);
    try {
      if (isEditMode) {
        await api.put(`/nutrientes/${id}`, formData);
        toast.success('Nutriente atualizado com sucesso!');
      } else {
        await api.post('/nutrientes', formData);
        toast.success('Nutriente cadastrado com sucesso!');
      }
      navigate('/nutrientes');
    } catch (error: any) {
      console.error(error);
      setErroInline(error.response?.data?.error || 'Erro ao salvar nutriente');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-2xl mx-auto px-3 sm:px-4">

        <BotaoVoltar className="mb-4" />

        <InlineError message={erroInline} className="mb-4" />

        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-5">
            {isEditMode ? 'Editar Nutriente' : 'Novo Nutriente'}
          </h1>
        </div>

        <div className="bg-white rounded-3xl shadow overflow-hidden">
          <form onSubmit={handleSubmit} className="p-5 sm:p-8 space-y-6">
            <div>
              <label className="block text-xs uppercase text-gray-500 tracking-widest mb-2">Nome do Nutriente</label>
              <input
                type="text"
                required
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-5 sm:px-6 py-3 sm:py-4 focus:outline-none focus:border-emerald-600 text-gray-900"
              />
            </div>

            <div>
              <label className="block text-xs uppercase text-gray-500 tracking-widest mb-2">Categoria</label>
              <select
                required
                value={formData.categoria}
                onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-5 sm:px-6 py-3 sm:py-4 focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
              >
                <option value="">Selecione a categoria...</option>
                <option value="Vitamina">Vitamina</option>
                <option value="Ácido Graxo">Ácido Graxo</option>
                <option value="Macronutriente">Macronutriente</option>
                <option value="Energia">Energia</option>
                <option value="Mineral">Mineral</option>
                <option value="Aminoácido">Aminoácido</option>
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase text-gray-500 tracking-widest mb-2">Unidade Padrão</label>
              <select
                required
                value={formData.unidadePadrao}
                onChange={(e) => setFormData({ ...formData, unidadePadrao: e.target.value })}
                className="w-full border border-gray-300 rounded-3xl px-5 sm:px-6 py-3 sm:py-4 focus:outline-none focus:border-emerald-600 bg-white text-gray-900"
              >
                <option value="">Selecione a unidade...</option>
                <option value="g">g</option>
                <option value="mg">mg</option>
                <option value="UI">UI</option>
                <option value="mcg">mcg</option>
                <option value="Mcal">Mcal</option>
              </select>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-3 rounded-3xl font-semibold transition-colors disabled:opacity-50"
              >
                {submitting ? 'Salvando...' : isEditMode ? 'Atualizar Nutriente' : 'Cadastrar Nutriente'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CriaNutrientes;
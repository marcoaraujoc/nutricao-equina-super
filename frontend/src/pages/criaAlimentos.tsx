import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';

const CriaAlimentos = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    nome: '',
    categoria: '',
    fabricante: '',
    forma: '',
    ativo: true,
  });

  // Carrega dados para edição
  useEffect(() => {
    const loadData = async () => {
      if (!isEditMode || !id) return;
      try {
        const res = await axios.get(`/api/alimentos/${id}`);
        const alimento = res.data;
        setFormData({
          nome: alimento.nome,
          categoria: alimento.categoria || '',
          fabricante: alimento.fabricante || '',
          forma: alimento.forma || '',
          ativo: alimento.ativo !== false,
        });
      } catch (error) {
        console.error('Erro ao carregar alimento', error);
      }
    };
    loadData();
  }, [id, isEditMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (isEditMode) {
        await axios.put(`/api/alimentos/${id}`, formData);
        alert('✅ Alimento atualizado com sucesso!');
      } else {
        await axios.post('/api/alimentos', formData);
        alert('✅ Alimento cadastrado com sucesso!');
      }
      navigate('/alimentos');
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.error || '❌ Erro ao salvar alimento');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-screen bg-white flex items-center justify-center overflow-hidden">
      <div className="max-w-2xl w-full mx-auto px-4">
        <div className="bg-white shadow-2xl rounded-3xl p-5 border border-gray-100 max-h-[94vh] overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Alimento</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                <select
                  value={formData.categoria}
                  onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
                  required
                >
                  <option value="">Selecione a categoria...</option>
                  <option value="Concentrado">Concentrado</option>
                  <option value="Óleo / Gordura">Óleo / Gordura</option>
                  <option value="Suplemento">Suplemento</option>
                  <option value="Volumoso">Volumoso</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fabricante</label>
                <input
                  type="text"
                  value={formData.fabricante}
                  onChange={(e) => setFormData({ ...formData, fabricante: e.target.value })}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Forma</label>
              <select
                value={formData.forma}
                onChange={(e) => setFormData({ ...formData, forma: e.target.value })}
                className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
              >
                <option value="">Selecione a forma...</option>
                <option value="Bloco">Bloco</option>
                <option value="Cubo">Cubo</option>
                <option value="Extrusada">Extrusada</option>
                <option value="Farelo">Farelo</option>
                <option value="Floculada">Floculada</option>
                <option value="Granulado">Granulado</option>
                <option value="Grão">Grão</option>
                <option value="Líquido">Líquido</option>
                <option value="Mash">Mash</option>
                <option value="Peletizada">Peletizada</option>
                <option value="Pó">Pó</option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={formData.ativo}
                onChange={(e) => setFormData({ ...formData, ativo: e.target.checked })}
                className="w-5 h-5 accent-emerald-600"
              />
              <label className="text-sm font-medium text-gray-700">Ativo</label>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white py-3.5 rounded-2xl font-semibold text-lg transition-colors"
            >
              {submitting 
                ? (isEditMode ? 'Atualizando Alimento...' : 'Cadastrando Alimento...') 
                : (isEditMode ? 'Atualizar Alimento' : 'Cadastrar Alimento')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CriaAlimentos;
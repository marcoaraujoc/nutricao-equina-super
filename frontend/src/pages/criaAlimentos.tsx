// src/pages/CriaAlimentos.tsx

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import axios from 'axios';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';


// ─── Constantes ───────────────────────────────────────────────────────────────

const CATEGORIAS = ['Concentrado', 'Óleo / Gordura', 'Suplemento', 'Volumoso'];

const FORMAS = [
  'Bloco', 'Cubo', 'Extrusada', 'Farelo', 'Floculada',
  'Granulado', 'Grão', 'Líquido', 'Mash', 'Peletizada', 'Pó',
];

const UNIDADES = ['kg', 'g', 'L', 'mL', 'unidade', 'porção'];

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface FormData {
  nome: string;
  categoria: string;
  fabricante: string;
  forma: string;
  unidade: string;
  ativo: boolean;
}

const FORM_INICIAL: FormData = {
  nome:       '',
  categoria:  '',
  fabricante: '',
  forma:      '',
  unidade:    'kg',
  ativo:      true,
};

// ─── Componente ───────────────────────────────────────────────────────────────

const CriaAlimentos = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id && id !== 'novo';

  const [formData,    setFormData]    = useState<FormData>(FORM_INICIAL);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [submitting,  setSubmitting]  = useState(false);
  const [loading,     setLoading]     = useState(isEditMode);

  // ── Carrega dados para edição ─────────────────────────────────────────────

  useEffect(() => {
    if (!isEditMode) return;
    const load = async () => {
      try {
        const res = await api.get(`/alimentos/${id}`);
        const a   = res.data?.dados ?? res.data;
        setFormData({
          nome:       a.nome        ?? '',
          categoria:  a.categoria   ?? '',
          fabricante: a.fabricante  ?? '',
          forma:      a.forma       ?? '',
          unidade:    a.unidade     ?? 'kg',
          ativo:      a.ativo       !== false,
        });
      } catch (error) {
        console.error('Erro ao carregar alimento:', error);
        setErroInline('Erro ao carregar alimento');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isEditMode]);

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.nome.trim()) { setErroInline('Informe o nome do alimento'); return; }
    if (!formData.categoria)   { setErroInline('Selecione a categoria');       return; }

    setSubmitting(true);
    try {
      if (isEditMode) {
        await api.put(`/alimentos/${id}`, formData);
        toast.success('Alimento atualizado com sucesso!');
      } else {
        await api.post('/alimentos', formData);
        toast.success('Alimento cadastrado com sucesso!');
      }
      navigate('/alimentos');
    } catch (error: unknown) {
      const mensagem = axios.isAxiosError(error)
        ? error.response?.data?.mensagem ?? 'Erro ao salvar alimento'
        : 'Erro inesperado';
      setErroInline(mensagem);
    } finally {
      setSubmitting(false);
    }
  };

  const set = (field: keyof FormData, value: string | boolean) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const inputClass  = 'w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 focus:outline-none focus:border-emerald-600 text-sm bg-white';
  const selectClass = 'w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 focus:outline-none focus:border-emerald-600 text-sm bg-white';

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Carregando...</div>;

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center py-10 px-4">
      <div className="w-full max-w-lg">

        {/* Voltar */}
        <BotaoVoltar className="mb-6" />

        <div className="bg-white shadow-xl rounded-3xl p-6 border border-gray-100">

          <InlineError message={erroInline} className="mb-4" />

          <h1 className="text-xl font-bold text-gray-900 text-center mb-6">
            {isEditMode ? 'Editar Alimento' : 'Novo Alimento'}
          </h1>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Nome */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Nome do Alimento <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.nome}
                onChange={e => set('nome', e.target.value)}
                placeholder="Ex: Ração Royal Horse S-280"
                className={inputClass} />
            </div>

            {/* Categoria + Fabricante */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Categoria <span className="text-red-400">*</span>
                </label>
                <select value={formData.categoria} onChange={e => set('categoria', e.target.value)} className={selectClass}>
                  <option value="">Selecione...</option>
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Fabricante</label>
                <input
                  type="text"
                  value={formData.fabricante}
                  onChange={e => set('fabricante', e.target.value)}
                  placeholder="Ex: Guabi"
                  className={inputClass} />
              </div>
            </div>

            {/* Forma + Unidade */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Forma</label>
                <select value={formData.forma} onChange={e => set('forma', e.target.value)} className={selectClass}>
                  <option value="">Selecione...</option>
                  {FORMAS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Unidade padrão</label>
                <select value={formData.unidade} onChange={e => set('unidade', e.target.value)} className={selectClass}>
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            {/* Ativo (somente em modo edição) */}
            {isEditMode && (
              <div className="flex items-center gap-3 pt-1">
                <input
                  type="checkbox"
                  id="ativo"
                  checked={formData.ativo}
                  onChange={e => set('ativo', e.target.checked)}
                  className="w-4 h-4 accent-emerald-600" />
                <label htmlFor="ativo" className="text-sm font-medium text-gray-700">Ativo</label>
              </div>
            )}

            {/* Botão */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white py-3.5 rounded-2xl font-semibold transition-colors mt-2">
              {submitting
                ? (isEditMode ? 'Atualizando...' : 'Cadastrando...')
                : (isEditMode ? 'Atualizar Alimento' : 'Cadastrar Alimento')}
            </button>

          </form>
        </div>
      </div>
    </div>
  );
};

export default CriaAlimentos;
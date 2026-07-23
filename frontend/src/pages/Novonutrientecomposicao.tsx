import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import axios from 'axios';
import toast from 'react-hot-toast';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import InlineError from '../components/InlineError';

// =====================================================================
// INTERFACES
// =====================================================================

interface Alimento {
  id: number;
  nome: string;
}

interface Nutriente {
  id: number;
  nome: string;
  unidadePadrao: string;
}

interface ComposicaoItem {
  alimentoId: number;
  nutrienteId: number;
  alimento?: Alimento | null;
  nutriente?: Nutriente | null;
}

type FeedbackState = { tipo: 'erro'; mensagem: string } | null;

// =====================================================================
// CONSTANTES
// =====================================================================

const UNIDADES_DISPONIVEIS = ['g/kg', 'mg/kg', 'mcg/kg', 'UI/kg', 'kcal/kg', '%'];

const FORM_INICIAL = {
  alimentoId: '',
  nutrienteId: '',
  valorPorKg: '',
  unidade: 'g/kg',
  base: 'Seca',
};

// =====================================================================
// COMPONENTE
// =====================================================================

const NovoNutrienteComposicao = () => {
  const navigate = useNavigate();

  // ── Dados carregados ─────────────────────────────────────────────────
  const [composicoes, setComposicoes] = useState<ComposicaoItem[]>([]);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [nutrientes, setNutrientes] = useState<Nutriente[]>([]);
  const [loadingDados, setLoadingDados] = useState(true);

  // ── Formulário ────────────────────────────────────────────────────────
  const [form, setForm] = useState(FORM_INICIAL);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [salvando, setSalvando] = useState(false);

  // =====================================================================
  // CARREGAMENTO
  // =====================================================================

  useEffect(() => {
    const loadDados = async () => {
      try {
        setLoadingDados(true);
        const [compRes, nutRes] = await Promise.all([
          api.get('/composicoes-alimentares'),
          api.get('/nutrientes'),
        ]);
        setComposicoes(compRes.data?.dados ?? []);
        setNutrientes(nutRes.data?.dados ?? nutRes.data ?? []);
      } catch (err) {
        console.error('Erro ao carregar dados:', err);
        setErroInline('Erro ao carregar dados');
      } finally {
        setLoadingDados(false);
      }
    };
    loadDados();
  }, []);

  // =====================================================================
  // DERIVAÇÕES
  // =====================================================================

  // Alimentos únicos que já possuem composição cadastrada
  const alimentosComComposicao = useMemo<Alimento[]>(() => {
    const mapa = new Map<number, Alimento>();
    composicoes.forEach((c) => {
      if (c.alimento && !mapa.has(c.alimentoId)) {
        mapa.set(c.alimentoId, c.alimento);
      }
    });
    return Array.from(mapa.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [composicoes]);

  // Nutrientes que o alimento selecionado JÁ possui — excluídos do select
  const nutrientesJaCadastrados = useMemo(() => {
    if (!form.alimentoId) return new Set<number>();
    return new Set(
      composicoes
        .filter((c) => c.alimentoId === Number(form.alimentoId))
        .map((c) => c.nutrienteId)
    );
  }, [composicoes, form.alimentoId]);

  // Nutrientes disponíveis para o alimento selecionado
  const nutrientesDisponiveis = useMemo(() => {
    return nutrientes.filter((n) => !nutrientesJaCadastrados.has(n.id));
  }, [nutrientes, nutrientesJaCadastrados]);

  // Alimento selecionado (objeto completo para exibição)
  const alimentoSelecionado = useMemo(() => {
    if (!form.alimentoId) return null;
    return alimentosComComposicao.find((a) => a.id === Number(form.alimentoId)) ?? null;
  }, [form.alimentoId, alimentosComComposicao]);

  // =====================================================================
  // HANDLERS
  // =====================================================================

  const handleAlimentoChange = (alimentoId: string) => {
    // Ao trocar o alimento, reseta nutriente para evitar seleção inválida
    setForm((prev) => ({ ...prev, alimentoId, nutrienteId: '' }));
    setFeedback(null);
  };

  const validar = (): boolean => {
    if (!form.alimentoId) {
      setFeedback({ tipo: 'erro', mensagem: 'Selecione o alimento' });
      return false;
    }
    if (!form.nutrienteId) {
      setFeedback({ tipo: 'erro', mensagem: 'Selecione o nutriente' });
      return false;
    }
    if (!form.valorPorKg || isNaN(parseFloat(form.valorPorKg)) || parseFloat(form.valorPorKg) < 0) {
      setFeedback({ tipo: 'erro', mensagem: 'Informe um valor numérico válido' });
      return false;
    }
    return true;
  };

  const handleSalvar = async () => {
    setFeedback(null);
    if (!validar()) return;

    setSalvando(true);
    try {
      await api.post('/composicoes-alimentares', {
        alimentoId: Number(form.alimentoId),
        nutrienteId: Number(form.nutrienteId),
        valorPorKg: parseFloat(form.valorPorKg),
        unidade: form.unidade,
        base: form.base,
      });
      toast.success('Nutriente adicionado com sucesso!');
      navigate('/composicao-alimentar');
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setFeedback({
          tipo: 'erro',
          mensagem: err.response?.data?.mensagem ?? 'Erro ao salvar',
        });
      } else {
        setFeedback({ tipo: 'erro', mensagem: 'Erro inesperado' });
      }
    } finally {
      setSalvando(false);
    }
  };

  // =====================================================================
  // CLASSES REUTILIZÁVEIS (padrão do projeto)
  // =====================================================================

  const selectClass =
    'w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600 bg-white text-gray-900 text-sm';
  const inputClass =
    'w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600 text-gray-900 text-sm';

  // =====================================================================
  // RENDER
  // =====================================================================

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-xl mx-auto">
        <div className="bg-white shadow-2xl rounded-3xl p-6 border border-gray-100">

          <InlineError message={erroInline} className="mb-4" />

          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => navigate('/composicao-alimentar')}
              className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
            >
              <ArrowLeft size={22} />
              <span className="text-base">Voltar</span>
            </button>
          </div>

          <h1 className="text-xl font-bold text-gray-900 mb-1 text-center">
            Novo Nutriente
          </h1>
          <p className="text-sm text-gray-500 text-center mb-6">
            Adicione um nutriente a um alimento já cadastrado
          </p>

          {/* Feedback */}
          {feedback && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-red-700 text-sm mb-5">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{feedback.mensagem}</span>
            </div>
          )}

          {loadingDados ? (
            <p className="text-center text-gray-400 py-8">Carregando...</p>
          ) : (
            <div className="space-y-5">

              {/* Alimento */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Alimento <span className="text-red-400">*</span>
                </label>
                <select
                  value={form.alimentoId}
                  onChange={(e) => handleAlimentoChange(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selecione o alimento...</option>
                  {alimentosComComposicao.map((a) => (
                    <option key={a.id} value={a.id}>{a.nome}</option>
                  ))}
                </select>
                {alimentosComComposicao.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">
                    Nenhum alimento com composição cadastrada encontrado.
                  </p>
                )}
              </div>

              {/* Info: quantos nutrientes o alimento já tem */}
              {alimentoSelecionado && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3">
                  <p className="text-sm text-emerald-800">
                    <span className="font-semibold">{alimentoSelecionado.nome}</span>
                    {' '}já possui{' '}
                    <span className="font-semibold">{nutrientesJaCadastrados.size}</span>
                    {' '}{nutrientesJaCadastrados.size === 1 ? 'nutriente cadastrado' : 'nutrientes cadastrados'}.
                    {nutrientesDisponiveis.length === 0 && (
                      <span className="block mt-1 text-amber-700 font-medium">
                        Todos os nutrientes disponíveis já estão cadastrados para este alimento.
                      </span>
                    )}
                  </p>
                </div>
              )}

              {/* Nutriente */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Nutriente <span className="text-red-400">*</span>
                </label>
                <select
                  value={form.nutrienteId}
                  onChange={(e) => {
                    setForm((p) => ({ ...p, nutrienteId: e.target.value }));
                    setFeedback(null);
                  }}
                  disabled={!form.alimentoId || nutrientesDisponiveis.length === 0}
                  className={`${selectClass} disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed`}
                >
                  <option value="">
                    {!form.alimentoId
                      ? 'Selecione o alimento primeiro...'
                      : nutrientesDisponiveis.length === 0
                      ? 'Nenhum nutriente disponível'
                      : 'Selecione o nutriente...'}
                  </option>
                  {nutrientesDisponiveis.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.nome} ({n.unidadePadrao})
                    </option>
                  ))}
                </select>
                {form.alimentoId && nutrientesJaCadastrados.size > 0 && (
                  <p className="text-xs text-gray-400 mt-1">
                    Nutrientes já cadastrados para este alimento não aparecem na lista.
                  </p>
                )}
              </div>

              {/* Valor + Unidade */}
              <div className="flex gap-3">
                <div className="w-2/5">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    Valor <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={form.valorPorKg}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, valorPorKg: e.target.value }));
                      setFeedback(null);
                    }}
                    placeholder="0"
                    className={inputClass}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    Unidade
                  </label>
                  <select
                    value={form.unidade}
                    onChange={(e) => setForm((p) => ({ ...p, unidade: e.target.value }))}
                    className={selectClass}
                  >
                    {UNIDADES_DISPONIVEIS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Base */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Base
                </label>
                <select
                  value={form.base}
                  onChange={(e) => setForm((p) => ({ ...p, base: e.target.value }))}
                  className={selectClass}
                >
                  <option value="Seca">Seca</option>
                  <option value="Úmida">Úmida</option>
                </select>
              </div>

              {/* Botões */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/composicao-alimentar')}
                  className="flex-1 border border-gray-300 text-gray-700 hover:bg-gray-50 py-4 rounded-3xl font-semibold text-sm transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSalvar}
                  disabled={salvando || nutrientesDisponiveis.length === 0 && !!form.alimentoId}
                  className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-3xl font-semibold text-sm transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default NovoNutrienteComposicao;
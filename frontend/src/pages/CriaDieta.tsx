import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import { ArrowLeft, Trash2, Pencil, Check, X } from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Alimento {
  id: number;
  nome: string;
}

interface FormData {
  alimentoId: string;
  qtdGramasDia: string;
  unidade: string;
  periodicidade: string;
  horario: string;
  observacao: string;
}

interface PendingItem extends FormData {
  _tempId: number;
  alimentoNome: string;
}

type FeedbackState = { tipo: 'sucesso' | 'info' | 'erro'; mensagem: string } | null;

// ─── Constantes ───────────────────────────────────────────────────────────────

const FORM_INICIAL: FormData = {
  alimentoId: '',
  qtdGramasDia: '',
  unidade: '',
  periodicidade: '',
  horario: '',
  observacao: '',
};

const OPCOES_UNIDADE     = ['Kg', 'Gramas', 'Pão', 'Feixe', 'Mililitros', 'Litro'];
const OPCOES_HORARIO     = ['Manhã', 'Meio-dia', 'Tarde', 'Janta', 'Noite'];
const OPCOES_PERIODICIDADE = [
  '1x ao dia', '2x ao dia', '3x ao dia',
  '1x por semana', '2x por semana', '3x por semana',
  '1x por mês', '2x por mês',
];

// ─── Componente ───────────────────────────────────────────────────────────────

const CriaDieta = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { animalId, planoDietaId, id } = useParams<{
    animalId: string;
    planoDietaId: string;
    id?: string;
  }>();
  const isEditMode = !!id;

  const [loading, setLoading]       = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [alimentos, setAlimentos]   = useState<Alimento[]>([]);
  const [formData, setFormData]     = useState<FormData>(FORM_INICIAL);
  const [pendingItems, setPendingItems]   = useState<PendingItem[]>([]);
  const [editingTempId, setEditingTempId] = useState<number | null>(null);
  const [editingData, setEditingData]     = useState<FormData>(FORM_INICIAL);
  const [feedback, setFeedback]     = useState<FeedbackState>(null);
  const [tempIdCounter, setTempIdCounter] = useState(0);

  // ── Destino de navegação ──────────────────────────────────────────────────
  const rotaVoltar = `/dieta/${animalId}/plano/${planoDietaId}`;

  // ── Feedback ──────────────────────────────────────────────────────────────
  const exibirFeedback = (tipo: 'sucesso' | 'info' | 'erro', mensagem: string) => {
    setFeedback({ tipo, mensagem });
    setTimeout(() => setFeedback(null), 5000);
  };

  // ── Carregamento ──────────────────────────────────────────────────────────
  useEffect(() => {
    const loadData = async () => {
      try {
        const alRes = await api.get('/alimentos');
        setAlimentos(alRes.data);

        if (isEditMode && id) {
          const res = await api.get(`/dietas/${id}`);
          const item = res.data;
          setFormData({
            alimentoId:   item.alimentoId?.toString()   ?? '',
            qtdGramasDia: item.qtdGramasDia?.toString() ?? '',
            unidade:      item.unidade      ?? '',
            periodicidade: item.periodicidade ?? '',
            horario:      item.horario      ?? '',
            observacao:   item.observacao   ?? '',
          });
        }
      } catch (error) {
        console.error('Erro ao carregar dados:', error);
        exibirFeedback('erro', 'Erro ao carregar dados. Tente novamente.');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id, isEditMode]);

  // ── Validação ─────────────────────────────────────────────────────────────
  const validar = (dados: FormData): string | null => {
    if (!dados.alimentoId)                              return 'Selecione um alimento';
    if (!dados.horario)                                 return 'Selecione o horário';
    if (!dados.qtdGramasDia || Number(dados.qtdGramasDia) <= 0) return 'Informe uma quantidade válida';
    if (!dados.unidade)                                 return 'Selecione a unidade';
    if (!dados.periodicidade)                           return 'Selecione a periodicidade';
    return null;
  };

  const chaveUnica = (alimentoId: string, horario: string) => `${alimentoId}__${horario}`;

  const isDuplicado = (dados: FormData, ignorarTempId?: number): boolean =>
    pendingItems.some(
      (item) => item._tempId !== ignorarTempId &&
        chaveUnica(item.alimentoId, item.horario) === chaveUnica(dados.alimentoId, dados.horario)
    );

  const formEstaPreenchido = (): boolean =>
    !!(formData.alimentoId && formData.qtdGramasDia && formData.unidade && formData.periodicidade && formData.horario);

  // ── Adicionar à lista pendente ────────────────────────────────────────────
  const handleAdicionarItem = () => {
    const erro = validar(formData);
    if (erro) { exibirFeedback('erro', erro); return; }

    if (isDuplicado(formData)) {
      exibirFeedback('erro', `Este alimento já foi adicionado para o horário "${formData.horario}".`);
      return;
    }

    const alimento = alimentos.find((a) => a.id === Number(formData.alimentoId));
    setPendingItems((prev) => [...prev, { ...formData, _tempId: tempIdCounter, alimentoNome: alimento?.nome ?? '' }]);
    setTempIdCounter((c) => c + 1);
    setFormData(FORM_INICIAL);
    exibirFeedback('info', 'Alimento adicionado. Preencha o próximo ou clique em Salvar.');
  };

  // ── Edição inline ─────────────────────────────────────────────────────────
  const handleIniciarEdicao = (item: PendingItem) => {
    setEditingTempId(item._tempId);
    setEditingData({ alimentoId: item.alimentoId, qtdGramasDia: item.qtdGramasDia, unidade: item.unidade, periodicidade: item.periodicidade, horario: item.horario, observacao: item.observacao });
  };

  const handleConfirmarEdicao = (tempId: number) => {
    const erro = validar(editingData);
    if (erro) { exibirFeedback('erro', erro); return; }
    if (isDuplicado(editingData, tempId)) {
      exibirFeedback('erro', `Este alimento já está na lista para o horário "${editingData.horario}".`);
      return;
    }
    const alimento = alimentos.find((a) => a.id === Number(editingData.alimentoId));
    setPendingItems((prev) =>
      prev.map((item) => item._tempId === tempId
        ? { ...editingData, _tempId: tempId, alimentoNome: alimento?.nome ?? '' }
        : item
      )
    );
    setEditingTempId(null);
    exibirFeedback('sucesso', 'Item atualizado.');
  };

  const handleRemoverPendente = (tempId: number) =>
    setPendingItems((prev) => prev.filter((i) => i._tempId !== tempId));

  // ── Persistir ─────────────────────────────────────────────────────────────
  const salvarItem = async (dados: FormData): Promise<void> => {
    const payload = {
      animalId:     parseInt(animalId!),
      alimentoId:   parseInt(dados.alimentoId),
      planoDietaId: planoDietaId ? parseInt(planoDietaId) : null,
      qtdGramasDia: parseFloat(dados.qtdGramasDia) || 0,
      unidade:      dados.unidade,
      periodicidade: dados.periodicidade,
      horario:      dados.horario   || null,
      observacao:   dados.observacao || null,
      criadopor:    user?.id ?? 1,
      modificadopor: user?.id ?? 1,
    };
    if (isEditMode) {
      await api.put(`/dietas/${id}`, payload);
    } else {
      await api.post('/dietas', payload);
    }
  };

  // ── Salvar e navegar ──────────────────────────────────────────────────────
  const handleSalvar = async () => {
    if (isEditMode) {
      const erro = validar(formData);
      if (erro) { exibirFeedback('erro', erro); return; }
      setSubmitting(true);
      try {
        await salvarItem(formData);
        navigate(rotaVoltar, { state: { mensagem: 'Alimento atualizado na dieta com sucesso!' } });
      } catch (error) {
        console.error(error);
        exibirFeedback('erro', 'Erro ao atualizar alimento. Tente novamente.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const itensFinal: FormData[] = [...pendingItems];
    if (formEstaPreenchido()) {
      const erro = validar(formData);
      if (erro) { exibirFeedback('erro', erro); return; }
      if (isDuplicado(formData)) {
        exibirFeedback('erro', `Este alimento já está na lista para o horário "${formData.horario}".`);
        return;
      }
      itensFinal.push(formData);
    }

    if (itensFinal.length === 0) {
      exibirFeedback('erro', 'Preencha ao menos um alimento antes de salvar');
      return;
    }

    setSubmitting(true);
    try {
      await Promise.all(itensFinal.map(salvarItem));
      const n = itensFinal.length;
      navigate(rotaVoltar, {
        state: { mensagem: `${n} alimento${n > 1 ? 's' : ''} adicionado${n > 1 ? 's' : ''} à dieta com sucesso!` }
      });
    } catch (error) {
      console.error(error);
      exibirFeedback('erro', 'Erro ao salvar alimentos. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Classes reutilizáveis ─────────────────────────────────────────────────
  const selectClass = 'w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600 bg-white text-gray-900 text-sm';
  const inputClass  = 'w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600 text-gray-900 text-sm';
  const totalItens  = pendingItems.length + (formEstaPreenchido() ? 1 : 0);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Carregando dados...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto space-y-4">

        {/* Card do formulário */}
        <div className="bg-white shadow-2xl rounded-3xl p-6 border border-gray-100">

          {/* Voltar */}
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => navigate(rotaVoltar)}
              className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
            >
              <ArrowLeft size={22} />
              <span className="text-base">Voltar</span>
            </button>
          </div>

          <h1 className="text-xl font-bold text-gray-900 mb-5 text-center">
            {isEditMode ? 'Editar Alimento na Dieta' : 'Adicionar Alimento na Dieta'}
          </h1>

          {/* Feedback */}
          {feedback && (
            <div className={`mb-5 px-4 py-3 rounded-xl text-sm font-medium flex items-center justify-between gap-3 border ${
              feedback.tipo === 'sucesso' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : feedback.tipo === 'erro'  ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-blue-50 text-blue-700 border-blue-200'
            }`}>
              <span>
                {feedback.tipo === 'sucesso' ? '✅' : feedback.tipo === 'erro' ? '❌' : 'ℹ️'}{' '}
                {feedback.mensagem}
              </span>
              <button onClick={() => setFeedback(null)} className="opacity-50 hover:opacity-100 leading-none">✕</button>
            </div>
          )}

          {/* Formulário */}
          <div className="space-y-4">

            {/* Alimento + Quantidade */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Alimento</label>
                <select value={formData.alimentoId} onChange={(e) => setFormData({ ...formData, alimentoId: e.target.value })} className={selectClass}>
                  <option value="">Selecione...</option>
                  {alimentos.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
                </select>
              </div>
              <div className="w-36">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Quantidade</label>
                <input
                  type="number" min="0" step="0.01"
                  value={formData.qtdGramasDia}
                  onChange={(e) => setFormData({ ...formData, qtdGramasDia: e.target.value })}
                  className={inputClass} placeholder="0"
                />
              </div>
            </div>

            {/* Unidade + Frequência */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Unidade</label>
                <select value={formData.unidade} onChange={(e) => setFormData({ ...formData, unidade: e.target.value })} className={selectClass}>
                  <option value="">Selecione...</option>
                  {OPCOES_UNIDADE.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Frequência</label>
                <select value={formData.periodicidade} onChange={(e) => setFormData({ ...formData, periodicidade: e.target.value })} className={selectClass}>
                  <option value="">Selecione...</option>
                  {OPCOES_PERIODICIDADE.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            {/* Horário */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Horário de fornecimento</label>
              <select value={formData.horario} onChange={(e) => setFormData({ ...formData, horario: e.target.value })} className={selectClass}>
                <option value="">Selecione o horário...</option>
                {OPCOES_HORARIO.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>

            {/* Observação */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Observação</label>
              <textarea
                value={formData.observacao}
                onChange={(e) => setFormData({ ...formData, observacao: e.target.value })}
                rows={2}
                className={`${inputClass} resize-none`}
                placeholder="Observações adicionais..."
              />
            </div>

            {/* Botões */}
            <div className={`flex gap-3 pt-1 ${isEditMode ? 'justify-end' : ''}`}>
              {!isEditMode && (
                <button
                  type="button" onClick={handleAdicionarItem} disabled={submitting}
                  className="flex-1 border-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50 py-3 rounded-2xl font-semibold text-sm transition-colors disabled:opacity-50"
                >
                  + Adicionar outro alimento
                </button>
              )}
              <button
                type="button" onClick={handleSalvar} disabled={submitting}
                className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white py-3 rounded-2xl font-semibold text-sm transition-colors disabled:opacity-50"
              >
                {submitting ? 'Salvando...' : isEditMode ? 'Salvar Alimento' : `Salvar Alimento${totalItens > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>

        {/* Lista de itens pendentes */}
        {!isEditMode && pendingItems.length > 0 && (
          <div className="bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Aguardando salvamento</h2>
              <span className="text-xs font-medium bg-emerald-100 text-emerald-700 px-2.5 py-0.5 rounded-full">
                {pendingItems.length} {pendingItems.length === 1 ? 'item' : 'itens'}
              </span>
            </div>

            <div className="divide-y divide-gray-100">
              {pendingItems.map((item) => {
                const isEditing = editingTempId === item._tempId;

                if (isEditing) {
                  return (
                    <div key={item._tempId} className="p-4 bg-emerald-50 space-y-3">
                      <div className="flex gap-2">
                        <select value={editingData.alimentoId} onChange={(e) => setEditingData({ ...editingData, alimentoId: e.target.value })}
                          className="flex-1 border border-emerald-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-600">
                          <option value="">Alimento...</option>
                          {alimentos.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
                        </select>
                        <input type="number" min="0" step="0.01" value={editingData.qtdGramasDia}
                          onChange={(e) => setEditingData({ ...editingData, qtdGramasDia: e.target.value })}
                          className="w-28 border border-emerald-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-600" placeholder="Qtd" />
                      </div>
                      <div className="flex gap-2">
                        <select value={editingData.unidade} onChange={(e) => setEditingData({ ...editingData, unidade: e.target.value })}
                          className="flex-1 border border-emerald-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-600">
                          <option value="">Unidade...</option>
                          {OPCOES_UNIDADE.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                        <select value={editingData.periodicidade} onChange={(e) => setEditingData({ ...editingData, periodicidade: e.target.value })}
                          className="flex-1 border border-emerald-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-600">
                          <option value="">Frequência...</option>
                          {OPCOES_PERIODICIDADE.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <select value={editingData.horario} onChange={(e) => setEditingData({ ...editingData, horario: e.target.value })}
                          className="flex-1 border border-emerald-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-600">
                          <option value="">Horário...</option>
                          {OPCOES_HORARIO.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button onClick={() => { setEditingTempId(null); setEditingData(FORM_INICIAL); }}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                          <X size={13} /> Cancelar
                        </button>
                        <button onClick={() => handleConfirmarEdicao(item._tempId)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">
                          <Check size={13} /> Confirmar
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={item._tempId} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.alimentoNome}</p>
                      <p className="text-xs text-gray-500">
                        {item.qtdGramasDia} {item.unidade} · {item.periodicidade} · {item.horario}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => handleIniciarEdicao(item)} className="text-emerald-600 hover:text-emerald-700 p-1" aria-label="Editar">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleRemoverPendente(item._tempId)} className="text-red-500 hover:text-red-700 p-1" aria-label="Remover">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CriaDieta;
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

const getSlotsFromPeriodicidade = (p: string): number => {
  const match = p.match(/^(\d+)x/);
  return match ? parseInt(match[1], 10) : 1;
};

const getPeriodicidadeByCount = (grupo: string, count: number): string => {
  if (grupo === 'diario')  {
    if (count === 1) return '1x ao dia';
    if (count === 2) return '2x ao dia';
    if (count === 3) return '3x ao dia';
  }
  if (grupo === 'semanal') {
    if (count === 1) return '1x por semana';
    if (count === 2) return '2x por semana';
    if (count === 3) return '3x por semana';
  }
  if (grupo === 'mensal')  {
    if (count === 1) return '1x por mês';
    if (count === 2) return '2x por mês';
  }
  return `${count}x`;
};

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
  const [tempIdCounter, setTempIdCounter]   = useState(0);
  const [itensDoBanco, setItensDoBanco]     = useState<{ id: number; alimentoId: number; qtdGramasDia: number; unidade: string; periodicidade: string; horario: string | null }[]>([]);
  const [formHorarios, setFormHorarios]   = useState<string[]>(['']);

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

        if (planoDietaId && !isEditMode) {
          const itensRes = await api.get(`/dietas/plano/${planoDietaId}/itens`);
          setItensDoBanco(itensRes.data.dados ?? []);
        }

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
  const validar = (dados: FormData, horarios?: string[]): string | null => {
    if (!dados.alimentoId)                              return 'Selecione um alimento';
    if (!dados.periodicidade)                           return 'Selecione a periodicidade';
    if (!dados.qtdGramasDia || Number(dados.qtdGramasDia) <= 0) return 'Informe uma quantidade válida';
    if (!dados.unidade)                                 return 'Selecione a unidade';
    const slots = horarios ?? [dados.horario];
    if (slots.some(h => !h)) return 'Selecione todos os horários de fornecimento';
    return null;
  };

  const chaveUnica = (alimentoId: string, horario: string) => `${alimentoId}__${horario}`;

  const isDuplicado = (dados: FormData, ignorarTempId?: number): boolean =>
    pendingItems.some(
      (item) => item._tempId !== ignorarTempId &&
        chaveUnica(item.alimentoId, item.horario) === chaveUnica(dados.alimentoId, dados.horario)
    );

  const formEstaPreenchido = (): boolean =>
    !!(formData.alimentoId && formData.qtdGramasDia && formData.unidade && formData.periodicidade && formHorarios.some(h => h));

  // ── Adicionar à lista pendente ────────────────────────────────────────────
  const handleAdicionarItem = () => 
  {
    const erro = validar(formData, formHorarios);
    if (erro) { exibirFeedback('erro', erro); return; }

    const alimento = alimentos.find((a) => a.id === Number(formData.alimentoId));
    const novos: PendingItem[] = [];
    let counter = tempIdCounter;

    for (const horario of formHorarios) {
      const itemComHorario = { ...formData, horario };
      if (isDuplicado(itemComHorario)) {
        exibirFeedback('erro', `Este alimento já foi adicionado para o horário "${horario}".`);
        return;
      }
      novos.push({ ...itemComHorario, _tempId: counter, alimentoNome: alimento?.nome ?? '' });
      counter++;
    }

    setPendingItems((prev) => [...prev, ...novos]);
    setTempIdCounter(counter);
    setFormData(FORM_INICIAL);
    setFormHorarios(['']);
    exibirFeedback('info', `${novos.length} horário${novos.length > 1 ? 's' : ''} adicionado${novos.length > 1 ? 's' : ''}. Preencha o próximo ou clique em Salvar.`);
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

  const handleRemoverPendente = (tempId: number) => {
    const removido = pendingItems.find(i => i._tempId === tempId);

    setPendingItems(prev => {
      const semItem = prev.filter(i => i._tempId !== tempId);
      if (!removido) return semItem;

      const grupo   = getGrupo(removido.periodicidade);
      const irmaos  = semItem.filter(i =>
        Number(i.alimentoId) === Number(removido.alimentoId) &&
        getGrupo(i.periodicidade) === grupo
      );
      if (irmaos.length === 0) return semItem;

      const novaPeriodicidade = getPeriodicidadeByCount(grupo, irmaos.length);
      return semItem.map(i =>
        Number(i.alimentoId) === Number(removido.alimentoId) && getGrupo(i.periodicidade) === grupo
          ? { ...i, periodicidade: novaPeriodicidade }
          : i
      );
    });
  };

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
      if (formEstaPreenchido()) 
      {
        const erro = validar(formData, formHorarios);
        if (erro) { exibirFeedback('erro', erro); return; }
        for (const horario of formHorarios) {
          const itemComHorario = { ...formData, horario };
          if (isDuplicado(itemComHorario)) {
            exibirFeedback('erro', `Este alimento já está na lista para o horário "${horario}".`);
            return;
          }
          itensFinal.push(itemComHorario);
        }
      }

    if (itensFinal.length === 0) {
      exibirFeedback('erro', 'Preencha ao menos um alimento antes de salvar');
      return;
    }

    setSubmitting(true);
    try {
      await Promise.all(itensFinal.map(salvarItem));

      // Recalcula periodicidade dos irmãos já no banco para refletir o novo total
      const alimentosInseridos = [...new Set(itensFinal.map(i => i.alimentoId))];
      const recalculos: Promise<unknown>[] = [];

      for (const alimentoId of alimentosInseridos) {
        const grupo           = getGrupo(itensFinal.find(i => i.alimentoId === alimentoId)!.periodicidade);
        const irmaosNoBanco   = itensDoBanco.filter(i => Number(i.alimentoId) === Number(alimentoId) && getGrupo(i.periodicidade) === grupo);
        const novosNesteGrupo = itensFinal.filter(i => i.alimentoId === alimentoId && getGrupo(i.periodicidade) === grupo);
        const totalFinal      = irmaosNoBanco.length + novosNesteGrupo.length;
        const novaPeriodicidade = getPeriodicidadeByCount(grupo, totalFinal);

        irmaosNoBanco.forEach(irmao => {
          recalculos.push(
            api.put(`/dietas/${irmao.id}`, {
              alimentoId:    irmao.alimentoId,
              qtdGramasDia:  irmao.qtdGramasDia,
              unidade:       irmao.unidade,
              horario:       irmao.horario,
              periodicidade: novaPeriodicidade,
            })
          );
        });
      }

      if (recalculos.length > 0) await Promise.all(recalculos);

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
  const GRUPOS_FREQUENCIA: Record<string, string> = {
    '1x ao dia': 'diario', '2x ao dia': 'diario', '3x ao dia': 'diario',
    '1x por semana': 'semanal', '2x por semana': 'semanal', '3x por semana': 'semanal',
    '1x por mês': 'mensal', '2x por mês': 'mensal',
  };
  const getGrupo = (p: string) => GRUPOS_FREQUENCIA[p] ?? p;

  const validarContraPlano = (alimentoId: string, periodicidade: string, horario: string): string | null => {
    const idNum      = Number(alimentoId);
    const novoGrupo  = getGrupo(periodicidade);
    const nomeAlim   = alimentos.find(a => a.id === idNum)?.nome ?? 'Este alimento';

    // Verifica também os pendentes ainda não salvos
    const todosItens = [
      ...itensDoBanco,
      ...pendingItems.map(p => ({ alimentoId: Number(p.alimentoId), periodicidade: p.periodicidade, horario: p.horario })),
    ];

    for (const item of todosItens) {
      if (item.alimentoId !== idNum) continue;

      if (item.horario === horario) {
        return `"${nomeAlim}" já está cadastrado no horário "${horario}".`;
      }
      if (getGrupo(item.periodicidade) !== novoGrupo) {
        return `"${nomeAlim}" já existe com frequência "${item.periodicidade}". Um alimento só pode pertencer a um grupo de frequência por plano.`;
      }
    }
    return null;
  };

  const totalItens = pendingItems.length + (formEstaPreenchido() ? 1 : 0);

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

          {/* Linha 1 — Alimento */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Alimento</label>
              <select value={formData.alimentoId} onChange={(e) => setFormData({ ...formData, alimentoId: e.target.value })} className={selectClass}>
                <option value="">Selecione...</option>
                {alimentos.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>
            </div>

            {/* Linha 2 — Quantidade + Unidade */}
            <div className="flex gap-3">
              <div className="w-1/3">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Quantidade por refeição</label>
                <input
                  type="number" min="0" step="0.01"
                  value={formData.qtdGramasDia}
                  onChange={(e) => setFormData({ ...formData, qtdGramasDia: e.target.value })}
                  className={inputClass} placeholder="0"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Unidade</label>
                <select value={formData.unidade} onChange={(e) => setFormData({ ...formData, unidade: e.target.value })} className={selectClass}>
                  <option value="">Selecione...</option>
                  {OPCOES_UNIDADE.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            {/* Linha 3 — Frequência + Horário */}
            <div className="flex gap-3 items-start">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Frequência</label>
                
                <select value={formData.periodicidade} onChange={(e) => {
                  const p = e.target.value;

                  if (p && formData.alimentoId) {
                    const novoGrupo    = getGrupo(p);
                    const idNum        = Number(formData.alimentoId);
                    const nomeAlim     = alimentos.find(a => a.id === idNum)?.nome ?? 'Este alimento';
                    const todosItens   = [
                      ...itensDoBanco,
                      ...pendingItems.map(i => ({ alimentoId: Number(i.alimentoId), periodicidade: i.periodicidade, horario: i.horario })),
                    ];
                    const itemExistente = todosItens.find(i =>
                      Number(i.alimentoId) === idNum && getGrupo(i.periodicidade) !== novoGrupo
                    );
                    if (itemExistente) {
                      exibirFeedback('erro', `"${nomeAlim}" já está cadastrado com frequência "${itemExistente.periodicidade}". Um alimento só pode pertencer a um grupo de frequência por plano.`);
                      return;
                    }
                  }

                  const slots = getSlotsFromPeriodicidade(p);
                  setFormHorarios(prev => Array.from({ length: slots }, (_, i) => prev[i] ?? ''));
                  setFormData({ ...formData, periodicidade: p });
                }} className={selectClass}>
                  <option value="">Selecione...</option>
                  {OPCOES_PERIODICIDADE.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Horário de fornecimento
                  {formHorarios.length > 1 && (
                    <span className="ml-2 text-[10px] font-normal text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      {formHorarios.length} horários
                    </span>
                  )}
                </label>
                <div className="flex flex-col gap-2">
                  {formHorarios.map((h, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      {formHorarios.length > 1 && (
                        <span className="text-xs text-gray-400 w-5 shrink-0 text-right">{idx + 1}ª</span>
                      )}
                      <select
                        value={h}
                        onChange={(e) => {
                          const horario = e.target.value;
                          const next = [...formHorarios];
                          next[idx] = horario;
                          setFormHorarios(next);
                          if (horario && formData.alimentoId && formData.periodicidade) {
                            const erro = validarContraPlano(formData.alimentoId, formData.periodicidade, horario);
                            if (erro) exibirFeedback('erro', erro);
                          }
                        }}
                        className={selectClass}
                      >
                        <option value="">Selecione...</option>
                        {OPCOES_HORARIO.map((op) => <option key={op} value={op}>{op}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
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
                    <div key={item._tempId} className="px-4 py-3 bg-emerald-50 flex items-center gap-2">
                      <select value={editingData.alimentoId} onChange={(e) => setEditingData({ ...editingData, alimentoId: e.target.value })}
                        className="flex-1 min-w-0 border border-emerald-300 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600">
                        <option value="">Alimento...</option>
                        {alimentos.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
                      </select>
                      <input type="number" min="0" step="0.01" value={editingData.qtdGramasDia}
                        onChange={(e) => setEditingData({ ...editingData, qtdGramasDia: e.target.value })}
                        className="w-20 border border-emerald-300 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600" placeholder="Qtd" />
                      <select value={editingData.unidade} onChange={(e) => setEditingData({ ...editingData, unidade: e.target.value })}
                        className="w-24 border border-emerald-300 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600">
                        <option value="">Unid...</option>
                        {OPCOES_UNIDADE.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <select value={editingData.horario} onChange={(e) => setEditingData({ ...editingData, horario: e.target.value })}
                        className="w-28 border border-emerald-300 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600">
                        <option value="">Horário...</option>
                        {OPCOES_HORARIO.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <button onClick={() => handleConfirmarEdicao(item._tempId)}
                        className="text-emerald-600 hover:text-emerald-700 font-medium text-xs whitespace-nowrap">
                        <Check size={15} />
                      </button>
                      <button onClick={() => { setEditingTempId(null); setEditingData(FORM_INICIAL); }}
                        className="text-gray-400 hover:text-gray-600 text-xs">
                        <X size={15} />
                      </button>
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
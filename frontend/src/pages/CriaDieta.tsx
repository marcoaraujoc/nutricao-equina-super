import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import { Trash2 } from 'lucide-react';
import BotaoVoltar from '../components/BotaoVoltar';
import PageContainer from '../components/PageContainer';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Alimento { id: number; nome: string; }

interface OcorrenciaForm {
  horario: string;
  qtdGramasDia: string;
  unidade: string;
}

interface FormData {
  alimentoId: string;
  periodicidade: string;
  observacao: string;
}

interface PendingGroup {
  _groupId: number;
  alimentoId: string;
  alimentoNome: string;
  periodicidade: string;
  observacao: string;
  ocorrencias: OcorrenciaForm[];
}

interface ItemBanco {
  id: number;
  alimentoId: number;
  qtdGramasDia: number;
  unidade: string;
  periodicidade: string;
  horario: string | null;
}

type FeedbackState = { tipo: 'sucesso' | 'info' | 'erro'; mensagem: string } | null;

// ─── Constantes ───────────────────────────────────────────────────────────────

const FORM_INICIAL: FormData      = { alimentoId: '', periodicidade: '', observacao: '' };
const OCC_INICIAL: OcorrenciaForm = { horario: '', qtdGramasDia: '', unidade: '' };

const OPCOES_UNIDADE       = ['Kg', 'Gramas', 'Pão', 'Feixe', 'Mililitros', 'Litro'];
const OPCOES_HORARIO       = ['Manhã', 'Meio-dia', 'Tarde', 'Janta', 'Noite'];
const OPCOES_PERIODICIDADE = [
  '1x ao dia', '2x ao dia', '3x ao dia',
  '1x por semana', '2x por semana', '3x por semana',
  '1x por mês', '2x por mês',
];

const GRUPOS_FREQUENCIA: Record<string, string> = {
  '1x ao dia': 'diario',      '2x ao dia': 'diario',      '3x ao dia': 'diario',
  '1x por semana': 'semanal', '2x por semana': 'semanal',  '3x por semana': 'semanal',
  '1x por mês': 'mensal',     '2x por mês': 'mensal',
};

const getGrupo = (p: string): string => GRUPOS_FREQUENCIA[p] ?? p;

const getSlotsFromPeriodicidade = (p: string): number => {
  const match = p.match(/^(\d+)x/);
  return match ? parseInt(match[1], 10) : 1;
};

const getPeriodicidadeByCount = (grupo: string, count: number): string => {
  if (grupo === 'diario')  { if (count === 1) return '1x ao dia';     if (count === 2) return '2x ao dia';     if (count === 3) return '3x ao dia'; }
  if (grupo === 'semanal') { if (count === 1) return '1x por semana'; if (count === 2) return '2x por semana'; if (count === 3) return '3x por semana'; }
  if (grupo === 'mensal')  { if (count === 1) return '1x por mês';    if (count === 2) return '2x por mês'; }
  return `${count}x`;
};

// ─── Componente ───────────────────────────────────────────────────────────────

const CriaDieta = () => {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  const { animalId, planoDietaId, id } = useParams<{
    animalId: string; planoDietaId: string; id?: string;
  }>();
  const isEditMode = !!id;

  const [loading, setLoading]         = useState(true);
  const [submitting, setSubmitting]   = useState(false);
  const [alimentos, setAlimentos]     = useState<Alimento[]>([]);
  const [planNome, setPlanNome]       = useState('');
  const [formData, setFormData]       = useState<FormData>(FORM_INICIAL);
  const [ocorrencias, setOcorrencias] = useState<OcorrenciaForm[]>([{ ...OCC_INICIAL }]);
  const [pendingGroups, setPendingGroups]   = useState<PendingGroup[]>([]);
  const [feedback, setFeedback]             = useState<FeedbackState>(null);
  const [groupIdCounter, setGroupIdCounter] = useState(0);
  const [itensDoBanco, setItensDoBanco]     = useState<ItemBanco[]>([]);
  const [formKey, setFormKey]               = useState(0);

  const rotaVoltar = `/dieta/${animalId}`;

  // ── Feedback ──────────────────────────────────────────────────────────────
  const exibirFeedback = (tipo: 'sucesso' | 'info' | 'erro', mensagem: string) => {
    setFeedback({ tipo, mensagem });
    setTimeout(() => setFeedback(null), 5000);
  };

  // ── Carregamento ──────────────────────────────────────────────────────────
  useEffect(() => {
    const loadData = async () => {
      try {
        const [alRes, planoRes] = await Promise.all([
          api.get('/alimentos'),
          planoDietaId ? api.get(`/dietas/planos/${planoDietaId}`) : Promise.resolve(null),
        ]);
        setAlimentos(alRes.data?.dados ?? alRes.data ?? []);

        if (planoRes) {
          const plano = planoRes.data.dados;
          setPlanNome(plano?.nome ?? '');
          if (!isEditMode) setItensDoBanco(plano?.itens ?? []);
        }

        if (isEditMode && id) {
          const res  = await api.get(`/dietas/${id}`);
          const item = res.data;
          setFormData({
            alimentoId:    item.alimentoId?.toString() ?? '',
            periodicidade: item.periodicidade ?? '',
            observacao:    item.observacao ?? '',
          });
          setOcorrencias([{
            horario:      item.horario ?? '',
            qtdGramasDia: String(item.qtdGramasDia ?? ''),
            unidade:      item.unidade ?? '',
          }]);
        }
      } catch (err) {
        console.error(err);
        exibirFeedback('erro', 'Erro ao carregar dados. Tente novamente.');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id, isEditMode, planoDietaId]);

  // ── Validação contra o plano ──────────────────────────────────────────────
  const validarContraPlano = (
    alimentoId: string,
    periodicidade: string,
    horario: string,
    excludeHorarios: string[] = [],
  ): string | null => {
    const idNum     = Number(alimentoId);
    const novoGrupo = getGrupo(periodicidade);
    const nomeAlim  = alimentos.find(a => a.id === idNum)?.nome ?? 'Este alimento';

    const pendentesFlat = pendingGroups.flatMap(g =>
      g.ocorrencias.map(o => ({ alimentoId: Number(g.alimentoId), periodicidade: g.periodicidade, horario: o.horario }))
    );
    const todosItens = [
      ...itensDoBanco.map(i => ({ alimentoId: i.alimentoId, periodicidade: i.periodicidade, horario: i.horario })),
      ...pendentesFlat,
    ];

    for (const item of todosItens) {
      if (item.alimentoId !== idNum) continue;
      if (excludeHorarios.includes(item.horario ?? '')) continue;
      if (item.horario === horario)
        return `"${nomeAlim}" já está cadastrado no horário "${horario}".`;
      if (getGrupo(item.periodicidade) !== novoGrupo)
        return `"${nomeAlim}" já existe com frequência "${item.periodicidade}". Um alimento só pode pertencer a um grupo de frequência por plano.`;
    }
    return null;
  };

  // ── Mudar periodicidade ───────────────────────────────────────────────────
  const handlePeriodicidadeChange = (p: string) => {
    if (p && formData.alimentoId) {
      const novoGrupo     = getGrupo(p);
      const idNum         = Number(formData.alimentoId);
      const nomeAlim      = alimentos.find(a => a.id === idNum)?.nome ?? 'Este alimento';
      const pendentesFlat = pendingGroups.flatMap(g =>
        g.ocorrencias.map(o => ({ alimentoId: Number(g.alimentoId), periodicidade: g.periodicidade, horario: o.horario }))
      );
      const todosItens = [
        ...itensDoBanco.map(i => ({ alimentoId: i.alimentoId, periodicidade: i.periodicidade, horario: i.horario })),
        ...pendentesFlat,
      ];
      const conflito = todosItens.find(i => Number(i.alimentoId) === idNum && getGrupo(i.periodicidade) !== novoGrupo);
      if (conflito) {
        exibirFeedback('erro', `"${nomeAlim}" já está cadastrado com frequência "${conflito.periodicidade}". Um alimento só pode pertencer a um grupo de frequência por plano.`);
        return;
      }
    }
    const slots = getSlotsFromPeriodicidade(p);
    setOcorrencias(Array.from({ length: slots }, (_, i) => ocorrencias[i] ?? { ...OCC_INICIAL }));
    setFormData({ ...formData, periodicidade: p });
  };

  // ── Atualizar campo de ocorrência ─────────────────────────────────────────
  const updateOcorrencia = (idx: number, field: keyof OcorrenciaForm, value: string) => {
    const next  = [...ocorrencias];
    next[idx]   = { ...next[idx], [field]: value };
    setOcorrencias(next);

    if (field === 'horario' && value && formData.alimentoId && formData.periodicidade) {
      const outrosHorarios = next.map((o, i) => i !== idx ? o.horario : '').filter(Boolean);
      const erro = validarContraPlano(formData.alimentoId, formData.periodicidade, value, outrosHorarios);
      if (erro) exibirFeedback('erro', erro);
    }
  };

  // ── Validação do formulário ───────────────────────────────────────────────
  const validar = (): string | null => {
    if (!formData.alimentoId)    return 'Selecione um alimento';
    if (!formData.periodicidade) return 'Selecione a frequência';
    for (let i = 0; i < ocorrencias.length; i++) {
      const o     = ocorrencias[i];
      const label = ocorrencias.length > 1 ? ` da ${i + 1}ª vez` : '';
      if (!o.horario)                                      return `Selecione o horário${label}`;
      if (!o.qtdGramasDia || Number(o.qtdGramasDia) <= 0) return `Informe a quantidade${label}`;
      if (!o.unidade)                                      return `Selecione a unidade${label}`;
    }
    return null;
  };

  // ── Adicionar grupo pendente ──────────────────────────────────────────────
  const handleAdicionarItem = () => {
    const erro = validar();
    if (erro) { exibirFeedback('erro', erro); return; }

    const alimento = alimentos.find(a => a.id === Number(formData.alimentoId));
    setPendingGroups(prev => [...prev, {
      _groupId:      groupIdCounter,
      alimentoId:    formData.alimentoId,
      alimentoNome:  alimento?.nome ?? '',
      periodicidade: formData.periodicidade,
      observacao:    formData.observacao,
      ocorrencias:   [...ocorrencias],
    }]);
    setGroupIdCounter(c => c + 1);
    setFormData(FORM_INICIAL);
    setOcorrencias([{ ...OCC_INICIAL }]);
    setFormKey(k => k + 1);
    exibirFeedback('info', 'Alimento adicionado. Preencha o próximo ou clique em Salvar.');
  };

  // ── Remover grupo pendente ────────────────────────────────────────────────
  const handleRemoverGrupo = (groupId: number) => {
    const removido = pendingGroups.find(g => g._groupId === groupId);
    setPendingGroups(prev => {
      const sem    = prev.filter(g => g._groupId !== groupId);
      if (!removido) return sem;
      const grupo  = getGrupo(removido.periodicidade);
      const irmaos = sem.filter(g => g.alimentoId === removido.alimentoId && getGrupo(g.periodicidade) === grupo);
      if (irmaos.length === 0) return sem;
      const total  = irmaos.reduce((acc, g) => acc + g.ocorrencias.length, 0);
      const novaP  = getPeriodicidadeByCount(grupo, total);
      return sem.map(g =>
        g.alimentoId === removido.alimentoId && getGrupo(g.periodicidade) === grupo
          ? { ...g, periodicidade: novaP } : g
      );
    });
  };

  // ── Persistir grupo ───────────────────────────────────────────────────────
  const salvarGrupo = async (grupo: PendingGroup): Promise<void> => {
    const novaPeriodicidade = getPeriodicidadeByCount(getGrupo(grupo.periodicidade), grupo.ocorrencias.length);
    await Promise.all(grupo.ocorrencias.map(occ =>
      api.post('/dietas', {
        animalId:      parseInt(animalId!),
        alimentoId:    parseInt(grupo.alimentoId),
        planoDietaId:  planoDietaId ? parseInt(planoDietaId) : null,
        qtdGramasDia:  parseFloat(occ.qtdGramasDia) || 0,
        unidade:       occ.unidade,
        periodicidade: novaPeriodicidade,
        horario:       occ.horario || null,
        observacao:    grupo.observacao || null,
        criadopor:     user?.id ?? 1,
        modificadopor: user?.id ?? 1,
      })
    ));
  };

  // ── Salvar e navegar ──────────────────────────────────────────────────────
  const handleSalvar = async () => {
    if (isEditMode) {
      const erro = validar();
      if (erro) { exibirFeedback('erro', erro); return; }
      setSubmitting(true);
      try {
        const occ = ocorrencias[0];
        await api.put(`/dietas/${id}`, {
          alimentoId:    parseInt(formData.alimentoId),
          qtdGramasDia:  parseFloat(occ.qtdGramasDia) || 0,
          unidade:       occ.unidade,
          periodicidade: formData.periodicidade,
          horario:       occ.horario || null,
          observacao:    formData.observacao || null,
        });
        navigate(rotaVoltar, { state: { mensagem: 'Alimento atualizado com sucesso!', planoAberto: Number(planoDietaId) } });
      } catch (err) {
        console.error(err);
        exibirFeedback('erro', 'Erro ao atualizar. Tente novamente.');
      } finally { setSubmitting(false); }
      return;
    }

    // Modo criação — inclui form atual se preenchido
    const gruposFinal: PendingGroup[] = [...pendingGroups];
    if (!validar()) {
      const alimento = alimentos.find(a => a.id === Number(formData.alimentoId));
      gruposFinal.push({
        _groupId: -1, alimentoId: formData.alimentoId,
        alimentoNome: alimento?.nome ?? '', periodicidade: formData.periodicidade,
        observacao: formData.observacao, ocorrencias: [...ocorrencias],
      });
    } else if (pendingGroups.length === 0) {
      exibirFeedback('erro', 'Preencha ao menos um alimento antes de salvar');
      return;
    }

    setSubmitting(true);
    try {
      await Promise.all(gruposFinal.map(salvarGrupo));

      // Recalcula periodicidade dos irmãos já no banco
      const alimentosInseridos = [...new Set(gruposFinal.map(g => g.alimentoId))];
      const recalculos: Promise<unknown>[] = [];
      for (const alimentoId of alimentosInseridos) {
        const grupo         = getGrupo(gruposFinal.find(g => g.alimentoId === alimentoId)!.periodicidade);
        const irmaosNoBanco = itensDoBanco.filter(i => Number(i.alimentoId) === Number(alimentoId) && getGrupo(i.periodicidade) === grupo);
        const novosCount    = gruposFinal.filter(g => g.alimentoId === alimentoId && getGrupo(g.periodicidade) === grupo).reduce((acc, g) => acc + g.ocorrencias.length, 0);
        const novaP         = getPeriodicidadeByCount(grupo, irmaosNoBanco.length + novosCount);
        irmaosNoBanco.forEach(irmao => {
          recalculos.push(api.put(`/dietas/${irmao.id}`, {
            alimentoId:    irmao.alimentoId,
            qtdGramasDia:  irmao.qtdGramasDia,
            unidade:       irmao.unidade,
            horario:       irmao.horario,
            periodicidade: novaP,
          }));
        });
      }
      if (recalculos.length > 0) await Promise.all(recalculos);

      const n = gruposFinal.reduce((acc, g) => acc + g.ocorrencias.length, 0);
      navigate(rotaVoltar, {
        state: {
          mensagem:    `${n} alimento${n > 1 ? 's' : ''} adicionado${n > 1 ? 's' : ''} à dieta com sucesso!`,
          planoAberto: Number(planoDietaId),
        },
      });
    } catch (err) {
      console.error(err);
      exibirFeedback('erro', 'Erro ao salvar alimentos. Tente novamente.');
    } finally { setSubmitting(false); }
  };

  // ── Classes ───────────────────────────────────────────────────────────────
  const selectClass = 'w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600 bg-white text-gray-900 text-sm';
  const inputClass  = 'w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600 text-gray-900 text-sm';
  const slots       = getSlotsFromPeriodicidade(formData.periodicidade || '1x ao dia');

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-20">
          <p className="text-gray-500 text-sm">Carregando dados...</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="3xl">
      <div className="space-y-4">

        {/* Card do formulário */}
        <div className="bg-white shadow-2xl rounded-3xl p-6 border border-gray-100">

          {/* Voltar */}
          <BotaoVoltar para={rotaVoltar} className="mb-5" />

          <h1 className="text-xl font-bold text-gray-900 mb-5 text-center">
            {isEditMode
              ? 'Editar Alimento na Dieta'
              : `Adicionar Alimento na Dieta${planNome ? ` — ${planNome}` : ''}`}
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

          <div className="space-y-4">

            {/* Linha 1 — Alimento + Frequência */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Alimento</label>
                <select
                  value={formData.alimentoId}
                  onChange={e => {
                    setFormData({ ...formData, alimentoId: e.target.value });
                    setOcorrencias([{ ...OCC_INICIAL }]);
                  }}
                  className={selectClass}
                >
                  <option value="">Selecione...</option>
                  {alimentos.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Frequência</label>
                <select
                  value={formData.periodicidade}
                  onChange={e => handlePeriodicidadeChange(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selecione...</option>
                  {OPCOES_PERIODICIDADE.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            {/* Linhas de ocorrências + observação — aparecem após selecionar periodicidade */}
            {formData.periodicidade && (
              <div key={formKey} className={slots > 1 ? 'rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3' : 'space-y-3'}>
                {ocorrencias.map((occ, idx) => (
                  <div key={idx} className={slots > 1 && idx > 0 ? 'pt-3 border-t border-gray-200' : ''}>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Horário de fornecimento</label>
                        <select
                          value={occ.horario}
                          onChange={e => updateOcorrencia(idx, 'horario', e.target.value)}
                          className={selectClass}
                        >
                          <option value="">Selecione...</option>
                          {OPCOES_HORARIO.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div className="w-1/4">
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Quantidade</label>
                        <input
                          type="number" min="0" step="0.01"
                          value={occ.qtdGramasDia}
                          onChange={e => updateOcorrencia(idx, 'qtdGramasDia', e.target.value)}
                          className={inputClass}
                          placeholder="0"
                        />
                      </div>
                      <div className="w-32">
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Unidade</label>
                        <select
                          value={occ.unidade}
                          onChange={e => updateOcorrencia(idx, 'unidade', e.target.value)}
                          className={selectClass}
                        >
                          <option value="">Sel...</option>
                          {OPCOES_UNIDADE.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Observação — aparece junto com os campos de fornecimento */}
                <div className={slots > 1 ? 'pt-3 border-t border-gray-200' : ''}>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Observação</label>
                  <textarea
                    value={formData.observacao}
                    onChange={e => setFormData({ ...formData, observacao: e.target.value })}
                    rows={2}
                    className={`${inputClass} resize-none`}
                    placeholder="Ex: fornecer picado, misturado ao feno, antes do exercício..."
                  />
                </div>
              </div>
            )}

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
                {submitting ? 'Salvando...' : isEditMode ? 'Salvar Alimento' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>

        {/* Lista de grupos pendentes */}
        {!isEditMode && pendingGroups.length > 0 && (
          <div className="bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Aguardando salvamento</h2>
              <span className="text-xs font-medium bg-emerald-100 text-emerald-700 px-2.5 py-0.5 rounded-full">
                {pendingGroups.length} {pendingGroups.length === 1 ? 'alimento' : 'alimentos'}
              </span>
            </div>
            <div className="divide-y divide-gray-100">
              {pendingGroups.map(grupo => (
                <div key={grupo._groupId} className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{grupo.alimentoNome}</p>
                    <p className="text-xs text-gray-400 mb-0.5">{grupo.periodicidade}</p>
                    {grupo.ocorrencias.map((occ, i) => (
                      <p key={i} className="text-xs text-gray-500">
                        {grupo.ocorrencias.length > 1 ? `${i + 1}ª vez: ` : ''}
                        {occ.horario} · {occ.qtdGramasDia} {occ.unidade}
                      </p>
                    ))}
                  </div>
                  <button
                    onClick={() => handleRemoverGrupo(grupo._groupId)}
                    className="text-red-500 hover:text-red-700 p-1 flex-shrink-0"
                    aria-label="Remover"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
};

export default CriaDieta;
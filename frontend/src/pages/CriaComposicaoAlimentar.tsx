import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import axios from 'axios';
import { ArrowLeft, Upload, FileText, AlertCircle, Edit, Trash2, Check, X, Pencil } from 'lucide-react';
import BotaoVoltar from '../components/BotaoVoltar';

// =====================================================================
// CONSTANTES
// =====================================================================

const UNIDADES_PADRAO = ['g', 'mg', 'mcg', 'ui', 'kcal', 'UFC', '%'];

const CATEGORIAS_ALIMENTO = [
  'Concentrado',
  'Volumoso',
  'Suplemento',
  'Minerais',
  'Vitaminas',
  'Importado',
];

const FORM_MANUAL_INICIAL = {
  nutrienteNome: '',
  valorPorKg: '',
  unidade: 'g/kg',
  base: 'Seca',
};

// =====================================================================
// INTERFACES
// =====================================================================

interface Especie {
  id: number;
  nome: string;
}

interface Nutriente {
  id: number;
  nome: string;
  unidadePadrao: string;
}

interface PendingNutriente {
  _key: number;
  nutrienteNome: string;
  valorPorKg: string;
  unidade: string;
  base: string;
}

interface ManualForm {
  nutrienteNome: string;
  valorPorKg: string;
  unidade: string;
  base: string;
}

interface ComposicaoEditavel {
  _key: number;
  nutrienteNome: string;
  valorPorKg: string;
  unidadeDetectada: string;
  base: string;
}

interface ResultadoIA {
  composicoes: {
    nutrienteNome: string;
    valorPorKg: number;
    unidadeDetectada: string;
    base: string;
  }[];
  nomeAlimento: string | null;
  baseCalculo?: string;
}

type FeedbackState = { tipo: 'sucesso' | 'info' | 'erro'; mensagem: string } | null;

// =====================================================================
// COMPONENTE
// =====================================================================

const CriaComposicaoAlimentar = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [especies, setEspecies] = useState<Especie[]>([]);
  const [nutrientes, setNutrientes] = useState<Nutriente[]>([]);

  // ── Campos globais ──────────────────────────────────────────────────
  const [nomeAlimento, setNomeAlimento] = useState('');
  const [categoriaAlimento, setCategoriaAlimento] = useState('Importado');
  const [especieId, setEspecieId] = useState('');
  const [erroAlimento, setErroAlimento] = useState('');
  const [erroCategoria, setErroCategoria] = useState('');
  const [erroEspecie, setErroEspecie] = useState('');

  // ── Feedback do banner global ───────────────────────────────────────
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  // ── Feedback local (dentro do card de nutriente) ────────────────────
  const [feedbackLocal, setFeedbackLocal] = useState<FeedbackState>(null);

  const exibirFeedback = (tipo: 'sucesso' | 'info' | 'erro', mensagem: string) => {
    setFeedback({ tipo, mensagem });
    setTimeout(() => setFeedback(null), 5000);
  };

  const exibirFeedbackLocal = (tipo: 'sucesso' | 'info' | 'erro', mensagem: string) => {
    setFeedbackLocal({ tipo, mensagem });
    setTimeout(() => setFeedbackLocal(null), 5000);
  };

  // ── Upload / IA ─────────────────────────────────────────────────────
  const [resultadoIA, setResultadoIA] = useState<ResultadoIA | null>(null);
  const [fileName, setFileName] = useState('');
  const [loadingIA, setLoadingIA] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // ── Preview IA editável ─────────────────────────────────────────────
  const [composicoesEditaveis, setComposicoesEditaveis] = useState<ComposicaoEditavel[]>([]);
  const [editandoKey, setEditandoKey] = useState<number | null>(null);
  const [editBuffer, setEditBuffer] = useState<Partial<ComposicaoEditavel>>({});

  // ── Fluxo manual ───────────────────────────────────────────────────
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState<ManualForm>(FORM_MANUAL_INICIAL);
  const [pendingNutrientes, setPendingNutrientes] = useState<PendingNutriente[]>([]);
  const [keyCounter, setKeyCounter] = useState(0);
  const [editingKey, setEditingKey] = useState<number | null>(null);
  const [editingData, setEditingData] = useState<ManualForm>(FORM_MANUAL_INICIAL);

  const [salvando, setSalvando] = useState(false);

  // =====================================================================
  // CARREGAMENTO
  // =====================================================================

  useEffect(() => {
    const loadData = async () => {
      try {
        const [nutRes, espRes] = await Promise.all([
          api.get('/nutrientes'),
          api.get('/especies'),
        ]);
        setNutrientes(nutRes.data?.dados ?? nutRes.data ?? []);
        setEspecies(espRes.data?.dados ?? espRes.data ?? []);
      } catch (err) {
        console.error('Erro ao carregar dados auxiliares:', err);
      }
    };
    loadData();
  }, []);

  // =====================================================================
  // UNIDADES DISPONÍVEIS BASEADAS NO NUTRIENTE DIGITADO
  // =====================================================================

  const unidadesDisponiveis = useMemo(() => {
    const nome = manualForm.nutrienteNome.trim().toLowerCase();
    if (!nome) return UNIDADES_PADRAO;

    const matches = nutrientes.filter(n => n.nome.toLowerCase() === nome);
    if (matches.length === 0) return UNIDADES_PADRAO;

    // Coleta unidades únicas dos nutrientes que batem com o nome
    const unidades = [...new Set(matches.map(m => m.unidadePadrao))];
    return unidades;
  }, [manualForm.nutrienteNome, nutrientes]);

  // =====================================================================
  // VALIDAÇÃO DOS CAMPOS GLOBAIS
  // =====================================================================

  const validarCamposGlobais = (): boolean => {
    let valido = true;
    if (!nomeAlimento.trim()) {
      setErroAlimento('Informe o nome do alimento');
      valido = false;
    }
    if (!categoriaAlimento) {
      setErroCategoria('Selecione a categoria do alimento');
      valido = false;
    }
    if (!especieId) {
      setErroEspecie('Selecione a espécie do alimento');
      valido = false;
    }
    return valido;
  };

  // =====================================================================
  // PAYLOAD COMPARTILHADO
  // =====================================================================

  const montarPayload = (
    composicoes: { nutrienteNome: string; unidade: string; valorPorKg: number; base: string }[]
  ) => ({
    nomeAlimento: nomeAlimento.trim(),
    categoriaAlimento,
    especieId: especieId ? Number(especieId) : null,
    composicoes,
  });

  const tratarErroSalvar = (err: unknown) => {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const mensagem = err.response?.data?.mensagem ?? 'Erro ao salvar';
      if (status === 409) {
        setErroAlimento(mensagem);
        setShowManualForm(false);
      } else {
        exibirFeedback('erro', mensagem);
      }
    } else if (err instanceof Error && (err as Error & { isPermissionError?: boolean }).isPermissionError) {
      exibirFeedback('erro', 'Sem permissão. Apenas administradores podem salvar composições alimentares.');
    } else {
      exibirFeedback('erro', 'Erro inesperado ao salvar');
    }
  };

  // =====================================================================
  // FLUXO IA
  // =====================================================================

  const inicializarEditaveis = (resultado: ResultadoIA) => {
    setComposicoesEditaveis(
      resultado.composicoes.map((c, i) => ({
        _key: i,
        nutrienteNome: c.nutrienteNome,
        valorPorKg: String(c.valorPorKg),
        unidadeDetectada: c.unidadeDetectada,
        base: c.base || 'Seca',
      }))
    );
  };

  // Botão de upload valida ANTES de abrir o seletor de arquivo
  const handleUploadClick = () => {
    if (!validarCamposGlobais()) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setResultadoIA(null);
    setComposicoesEditaveis([]);
    setLoadingIA(true);
    setProgress(0);

    const formData = new FormData();
    formData.append('arquivo', file);

    const interval = setInterval(
      () => setProgress((p) => (p >= 90 ? 90 : p + 10)),
      100
    );

    try {
      const res = await api.post('/composicoes-alimentares/analisar-llm', formData);
      const dados: ResultadoIA = res.data?.dados ?? null;
      setResultadoIA(dados);
      inicializarEditaveis(dados);
      setProgress(100);
      setShowConfirmModal(true);
    } catch (err: unknown) {
      const mensagem = axios.isAxiosError(err)
        ? err.response?.data?.mensagem ?? 'Erro ao analisar o rótulo'
        : 'Erro ao analisar o rótulo';
      exibirFeedback('erro', mensagem);
    } finally {
      clearInterval(interval);
      setLoadingIA(false);
      // Reseta o input para permitir reenvio do mesmo arquivo
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const salvarResultadoIA = async () => {
    if (!resultadoIA) return;
    if (!nomeAlimento.trim()) { setErroAlimento('Informe o nome do alimento'); return; }

    const composicoes = composicoesEditaveis
      .filter((c) => c.nutrienteNome.trim() && parseFloat(c.valorPorKg) > 0)
      .map((c) => ({
        nutrienteNome: c.nutrienteNome.trim(),
        unidade: c.unidadeDetectada,
        valorPorKg: parseFloat(c.valorPorKg),
        base: c.base,
      }));

    if (composicoes.length === 0) {
      exibirFeedback('erro', 'Nenhuma composição válida para salvar.');
      return;
    }

    setSalvando(true);
    try {
      const res = await api.post(
        '/composicoes-alimentares/importar-completo',
        montarPayload(composicoes)
      );
      toast.success(res.data.mensagem ?? 'Composições salvas com sucesso!');
      navigate('/composicao-alimentar');
    } catch (err) {
      tratarErroSalvar(err);
    } finally {
      setSalvando(false);
    }
  };

  // Preview IA — edição inline
  const startEditPreview = (row: ComposicaoEditavel) => {
    setEditandoKey(row._key);
    setEditBuffer({ ...row });
  };
  const cancelEditPreview = () => { setEditandoKey(null); setEditBuffer({}); };
  const saveEditPreview = (key: number) => {
    setComposicoesEditaveis((prev) =>
      prev.map((r) => (r._key === key ? { ...r, ...editBuffer } : r))
    );
    cancelEditPreview();
  };
  const deletePreviewRow = (key: number) => {
    setComposicoesEditaveis((prev) => prev.filter((r) => r._key !== key));
  };
  const limparIA = () => {
    setResultadoIA(null);
    setComposicoesEditaveis([]);
    setFileName('');
    setEditandoKey(null);
    setEditBuffer({});
  };

  // =====================================================================
  // FLUXO MANUAL
  // =====================================================================

  // Ao mudar o nome do nutriente, auto-preenche a unidade se houver match
  const handleNutrienteNomeChange = (value: string) => {
    const match = nutrientes.find(
      (n) => n.nome.toLowerCase() === value.toLowerCase()
    );
    setManualForm((prev) => ({
      ...prev,
      nutrienteNome: value,
      // Auto-fill unidade se encontrou nutriente; mantém a atual se não
      ...(match ? { unidade: match.unidadePadrao } : {}),
    }));
  };

  const validarManualForm = (dados: ManualForm): string | null => {
    if (!dados.nutrienteNome.trim()) return 'Informe o nome do nutriente';
    if (!dados.valorPorKg || parseFloat(dados.valorPorKg) <= 0) return 'Informe um valor válido';
    if (!dados.unidade) return 'Selecione a unidade';
    if (!dados.base) return 'Selecione a base';
    return null;
  };

  const handleAdicionarNutriente = () => {
    const erro = validarManualForm(manualForm);
    if (erro) { exibirFeedbackLocal('erro', erro); return; }

    const duplicado = pendingNutrientes.some(
      (p) => p.nutrienteNome.toLowerCase().trim() === manualForm.nutrienteNome.toLowerCase().trim()
    );
    if (duplicado) {
      exibirFeedbackLocal('erro', `"${manualForm.nutrienteNome}" já foi adicionado à lista.`);
      return;
    }

    setPendingNutrientes((prev) => [
      ...prev,
      { ...manualForm, _key: keyCounter },
    ]);
    setKeyCounter((k) => k + 1);
    setManualForm(FORM_MANUAL_INICIAL);
    exibirFeedbackLocal('info', 'Nutriente adicionado. Preencha o próximo ou clique em Salvar.');
  };

  const handleIniciarEdicaoPending = (item: PendingNutriente) => {
    setEditingKey(item._key);
    setEditingData({
      nutrienteNome: item.nutrienteNome,
      valorPorKg: item.valorPorKg,
      unidade: item.unidade,
      base: item.base,
    });
  };

  const handleConfirmarEdicaoPending = (key: number) => {
    const erro = validarManualForm(editingData);
    if (erro) { exibirFeedback('erro', erro); return; }

    const duplicado = pendingNutrientes.some(
      (p) =>
        p._key !== key &&
        p.nutrienteNome.toLowerCase().trim() === editingData.nutrienteNome.toLowerCase().trim()
    );
    if (duplicado) {
      exibirFeedback('erro', `"${editingData.nutrienteNome}" já está na lista.`);
      return;
    }

    setPendingNutrientes((prev) =>
      prev.map((p) => (p._key === key ? { ...editingData, _key: key } : p))
    );
    setEditingKey(null);
    exibirFeedbackLocal('sucesso', 'Nutriente atualizado.');
  };

  const handleRemoverPending = (key: number) => {
    setPendingNutrientes((prev) => prev.filter((p) => p._key !== key));
  };

  const formManualPreenchido = () =>
    !!(manualForm.nutrienteNome.trim() && manualForm.valorPorKg && manualForm.unidade);

  const salvarManual = async () => {
    const itensFinal = [...pendingNutrientes];

    if (formManualPreenchido()) {
      const erro = validarManualForm(manualForm);
      if (erro) { exibirFeedbackLocal('erro', erro); return; }
      const duplicado = itensFinal.some(
        (p) => p.nutrienteNome.toLowerCase().trim() === manualForm.nutrienteNome.toLowerCase().trim()
      );
      if (duplicado) {
        exibirFeedbackLocal('erro', `"${manualForm.nutrienteNome}" já está na lista.`);
        return;
      }
      itensFinal.push({ ...manualForm, _key: keyCounter });
    }

    if (itensFinal.length === 0) {
      exibirFeedbackLocal('erro', 'Preencha ao menos um nutriente antes de salvar.');
      return;
    }

    setSalvando(true);
    try {
      const res = await api.post(
        '/composicoes-alimentares/importar-completo',
        montarPayload(
          itensFinal.map((r) => ({
            nutrienteNome: r.nutrienteNome.trim(),
            unidade: r.unidade,
            valorPorKg: parseFloat(r.valorPorKg),
            base: r.base,
          }))
        )
      );
      toast.success(res.data.mensagem ?? 'Composições salvas com sucesso!');
      navigate('/composicao-alimentar');
    } catch (err) {
      tratarErroSalvar(err);
    } finally {
      setSalvando(false);
    }
  };

  const cancelarManual = () => {
    setShowManualForm(false);
    setPendingNutrientes([]);
    setManualForm(FORM_MANUAL_INICIAL);
    setFeedback(null);
    setFeedbackLocal(null);
    setEditingKey(null);
  };

  // =====================================================================
  // CLASSES REUTILIZÁVEIS (padrão CriaDieta)
  // =====================================================================

  const selectClass =
    'w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600 bg-white text-gray-900 text-sm';
  const inputClass =
    'w-full border border-gray-300 rounded-2xl px-4 py-3 focus:outline-none focus:border-emerald-600 text-gray-900 text-sm';

  const showPreview = resultadoIA && !showConfirmModal;
  const showActionCards = !showPreview && !showManualForm;
  const totalPending = pendingNutrientes.length + (formManualPreenchido() ? 1 : 0);

  // =====================================================================
  // BLOCO DE FEEDBACK (reutilizável)
  // =====================================================================

  const BlocoFeedback = ({ state, onClose }: { state: FeedbackState; onClose: () => void }) => {
    if (!state) return null;
    return (
      <div
        className={`px-4 py-3 rounded-xl text-sm font-medium flex items-center justify-between gap-3 border ${
          state.tipo === 'sucesso'
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : state.tipo === 'erro'
            ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-blue-50 text-blue-700 border-blue-200'
        }`}
      >
        <span>
          {state.tipo === 'sucesso' ? '✅' : state.tipo === 'erro' ? '❌' : 'ℹ️'}{' '}
          {state.mensagem}
        </span>
        <button onClick={onClose} className="opacity-50 hover:opacity-100 leading-none">
          ✕
        </button>
      </div>
    );
  };

  // =====================================================================
  // RENDER
  // =====================================================================

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto space-y-4">

        {/* ── Card de dados globais — oculto no fluxo manual ── */}
        {!showManualForm && (
          <div className="bg-white shadow-2xl rounded-3xl p-6 border border-gray-100">

            <div className="flex items-center gap-3 mb-5">
              <BotaoVoltar />
            </div>

            <h1 className="text-xl font-bold text-gray-900 mb-5 text-center">
              Nova Composição Alimentar
            </h1>

            {/* Feedback global */}
            {feedback && (
              <div className="mb-5">
                <BlocoFeedback state={feedback} onClose={() => setFeedback(null)} />
              </div>
            )}

            <div className="space-y-4">

              {/* Nome */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Nome do alimento <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={nomeAlimento}
                  onChange={(e) => { setNomeAlimento(e.target.value); setErroAlimento(''); }}
                  placeholder="Ex: Equilíbrio Lazer, Potence S-280..."
                  className={`${inputClass} ${erroAlimento ? 'border-red-400 bg-red-50' : ''}`}
                />
                {erroAlimento && (
                  <div className="flex items-start gap-2 mt-1.5 text-red-600 text-xs">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{erroAlimento}</span>
                  </div>
                )}
              </div>

              {/* Categoria + Espécie */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    Categoria <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={categoriaAlimento}
                    onChange={(e) => { setCategoriaAlimento(e.target.value); setErroCategoria(''); }}
                    className={`${selectClass} ${erroCategoria ? 'border-red-400 bg-red-50' : ''}`}
                  >
                    {CATEGORIAS_ALIMENTO.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {erroCategoria && (
                    <div className="flex items-start gap-2 mt-1.5 text-red-600 text-xs">
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                      <span>{erroCategoria}</span>
                    </div>
                  )}
                </div>

                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    Espécie <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={especieId}
                    onChange={(e) => { setEspecieId(e.target.value); setErroEspecie(''); }}
                    className={`${selectClass} ${erroEspecie ? 'border-red-400 bg-red-50' : ''}`}
                  >
                    <option value="">Selecione...</option>
                    {especies.map((e) => (
                      <option key={e.id} value={e.id}>{e.nome}</option>
                    ))}
                  </select>
                  {erroEspecie && (
                    <div className="flex items-start gap-2 mt-1.5 text-red-600 text-xs">
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                      <span>{erroEspecie}</span>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* Nome do arquivo */}
        {fileName && !showManualForm && (
          <div className="text-sm text-emerald-700 flex items-center gap-2 px-2">
            <Upload size={16} />
            <span className="font-medium">Arquivo:</span> {fileName}
          </div>
        )}

        {/* Barra de progresso */}
        {loadingIA && (
          <div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-600 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-center text-xs text-gray-500 mt-1">
              Analisando rótulo ... {progress}%
            </p>
          </div>
        )}

        {/* ── Cards de ação ── */}
        {showActionCards && (
          <div className="grid grid-cols-2 gap-4">

            {/* Upload */}
            <div className="bg-white rounded-3xl shadow p-6 text-center hover:shadow-md transition flex flex-col items-center border border-gray-100">
              <Upload className="mb-3 text-emerald-600" size={32} />
              <p className="font-medium text-gray-900">Enviar Rótulo</p>
              <p className="text-xs text-gray-500 mt-1">PDF ou foto do rótulo</p>
              {/* Input oculto — aberto via ref somente após validação */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={handleUploadClick}
                className="mt-6 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-3 px-8 rounded-3xl w-full transition-colors"
              >
                Escolher Arquivo
              </button>
            </div>

            {/* Manual */}
            <div className="bg-white rounded-3xl shadow p-6 text-center hover:shadow-md transition flex flex-col items-center border border-gray-100">
              <FileText className="mb-3 text-emerald-600" size={32} />
              <p className="font-medium text-gray-900">Preencher Manualmente</p>
              <p className="text-xs text-gray-500 mt-1">Digite os nutrientes um a um</p>
              <button
                onClick={() => {
                  if (!validarCamposGlobais()) return;
                  setShowManualForm(true);
                }}
                className="mt-6 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-3 px-8 rounded-3xl w-full transition-colors"
              >
                Iniciar Preenchimento
              </button>
            </div>

          </div>
        )}

        {/* ============================================================
            FLUXO MANUAL — padrão CriaDieta, substitui o card global
        ============================================================ */}
        {showManualForm && (
          <>
            <div className="bg-white shadow-2xl rounded-3xl p-6 border border-gray-100">

              {/* Header com voltar e info do alimento */}
              <div className="flex items-center gap-3 mb-2">
                <button
                  onClick={cancelarManual}
                  className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
                >
                  <ArrowLeft size={22} />
                  <span className="text-base">Voltar</span>
                </button>
              </div>

              <h2 className="text-lg font-bold text-gray-900 mb-1 text-center">
                Adicionar Nutriente
              </h2>

              {/* Info resumida do alimento */}
              <div className="flex items-center justify-center gap-2 mb-5 flex-wrap">
                <span className="text-sm font-semibold text-emerald-700">{nomeAlimento}</span>
                <span className="text-gray-300">·</span>
                <span className="text-sm text-gray-500">{categoriaAlimento}</span>
                <span className="text-gray-300">·</span>
                <span className="text-sm text-gray-500">
                  {especies.find((e) => String(e.id) === especieId)?.nome ?? ''}
                </span>
              </div>

              {/* Feedback local — dentro do box */}
              {feedbackLocal && (
                <div className="mb-4">
                  <BlocoFeedback
                    state={feedbackLocal}
                    onClose={() => setFeedbackLocal(null)}
                  />
                </div>
              )}

              <div className="space-y-4">

                {/* Nutriente */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    Nutriente <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    list="nutrientes-manual-list"
                    value={manualForm.nutrienteNome}
                    onChange={(e) => handleNutrienteNomeChange(e.target.value)}
                    placeholder="Ex: Proteína Bruta"
                    className={inputClass}
                  />
                  <datalist id="nutrientes-manual-list">
                    {nutrientes.map((n) => (
                      <option key={n.id} value={n.nome} />
                    ))}
                  </datalist>
                  <p className="text-xs text-gray-400 mt-1">
                    Será criado automaticamente se não existir.
                  </p>
                </div>

                {/* Valor + Unidade */}
                <div className="flex gap-3">
                  <div className="w-1/3">
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">
                      Valor <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={manualForm.valorPorKg}
                      onChange={(e) =>
                        setManualForm({ ...manualForm, valorPorKg: e.target.value })
                      }
                      placeholder="0"
                      className={inputClass}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">
                      Unidade
                      {unidadesDisponiveis.length < UNIDADES_PADRAO.length && (
                        <span className="ml-2 text-[10px] font-normal text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                          sugerida pelo nutriente
                        </span>
                      )}
                    </label>
                    <select
                      value={manualForm.unidade}
                      onChange={(e) =>
                        setManualForm({ ...manualForm, unidade: e.target.value })
                      }
                      className={selectClass}
                    >
                      {unidadesDisponiveis.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                      {/* Se unidades filtradas, mostra as demais como opções secundárias */}
                      {unidadesDisponiveis.length < UNIDADES_PADRAO.length && (
                        <>
                          <option disabled>── outras ──</option>
                          {UNIDADES_PADRAO.filter(
                            (u) => !unidadesDisponiveis.includes(u)
                          ).map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </>
                      )}
                    </select>
                  </div>
                </div>

                {/* Base */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Base</label>
                  <select
                    value={manualForm.base}
                    onChange={(e) => setManualForm({ ...manualForm, base: e.target.value })}
                    className={selectClass}
                  >
                    <option value="Seca">Seca</option>
                    <option value="Úmida">Úmida</option>
                  </select>
                </div>

                {/* Botões */}
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleAdicionarNutriente}
                    disabled={salvando}
                    className="flex-1 border-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50 py-3 rounded-2xl font-semibold text-sm transition-colors disabled:opacity-50"
                  >
                    + Adicionar outro nutriente
                  </button>
                  <button
                    type="button"
                    onClick={salvarManual}
                    disabled={salvando}
                    className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white py-3 rounded-2xl font-semibold text-sm transition-colors disabled:opacity-50"
                  >
                    {salvando
                      ? 'Salvando...'
                      : `Salvar nutriente${totalPending > 1 ? 's' : ''}`}
                  </button>
                </div>

              </div>
            </div>

            {/* Lista de nutrientes pendentes */}
            {pendingNutrientes.length > 0 && (
              <div className="bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-700">Aguardando salvamento</h2>
                  <span className="text-xs font-medium bg-emerald-100 text-emerald-700 px-2.5 py-0.5 rounded-full">
                    {pendingNutrientes.length}{' '}
                    {pendingNutrientes.length === 1 ? 'nutriente' : 'nutrientes'}
                  </span>
                </div>

                <div className="divide-y divide-gray-100">
                  {pendingNutrientes.map((item) => {
                    const isEditing = editingKey === item._key;

                    if (isEditing) {
                      return (
                        <div
                          key={item._key}
                          className="px-4 py-3 bg-emerald-50 flex items-center gap-2 flex-wrap"
                        >
                          <input
                            type="text"
                            list="nutrientes-pending-list"
                            value={editingData.nutrienteNome}
                            onChange={(e) =>
                              setEditingData({ ...editingData, nutrienteNome: e.target.value })
                            }
                            className="flex-1 min-w-0 border border-emerald-300 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600"
                            placeholder="Nutriente..."
                          />
                          <datalist id="nutrientes-pending-list">
                            {nutrientes.map((n) => (
                              <option key={n.id} value={n.nome} />
                            ))}
                          </datalist>
                          <input
                            type="number"
                            step="0.0001"
                            min="0"
                            value={editingData.valorPorKg}
                            onChange={(e) =>
                              setEditingData({ ...editingData, valorPorKg: e.target.value })
                            }
                            className="w-20 border border-emerald-300 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600"
                            placeholder="Valor"
                          />
                          <select
                            value={editingData.unidade}
                            onChange={(e) =>
                              setEditingData({ ...editingData, unidade: e.target.value })
                            }
                            className="w-24 border border-emerald-300 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600"
                          >
                            {UNIDADES_PADRAO.map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                          <select
                            value={editingData.base}
                            onChange={(e) =>
                              setEditingData({ ...editingData, base: e.target.value })
                            }
                            className="w-24 border border-emerald-300 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600"
                          >
                            <option value="Seca">Seca</option>
                            <option value="Úmida">Úmida</option>
                          </select>
                          <button
                            onClick={() => handleConfirmarEdicaoPending(item._key)}
                            className="text-emerald-600 hover:text-emerald-700"
                          >
                            <Check size={15} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingKey(null);
                              setEditingData(FORM_MANUAL_INICIAL);
                            }}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={item._key}
                        className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {item.nutrienteNome}
                          </p>
                          <p className="text-xs text-gray-500">
                            {item.valorPorKg} {item.unidade} · {item.base}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleIniciarEdicaoPending(item)}
                            className="text-emerald-600 hover:text-emerald-700 p-1"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => handleRemoverPending(item._key)}
                            className="text-red-500 hover:text-red-700 p-1"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ============================================================
            PREVIEW IA EDITÁVEL
        ============================================================ */}
        {showPreview && (
          <div className="bg-white rounded-3xl shadow overflow-hidden border border-gray-100">

            <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center">
              <div>
                <h2 className="font-semibold text-gray-900">Preview — edite antes de salvar</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  <span className="font-medium text-gray-700">{nomeAlimento}</span>
                  <span className="mx-1">·</span>
                  <span className="text-emerald-700">{categoriaAlimento}</span>
                  {especieId && (
                    <>
                      <span className="mx-1">·</span>
                      {especies.find((e) => String(e.id) === especieId)?.nome}
                    </>
                  )}
                </p>
              </div>
              <span className="text-sm text-emerald-700 font-medium">
                {composicoesEditaveis.length} nutrientes
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Nutriente</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Valor</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Unidade</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Base</th>
                    <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {composicoesEditaveis.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">
                        Todos os nutrientes foram removidos.
                      </td>
                    </tr>
                  )}
                  {composicoesEditaveis.map((row) => {
                    const isEditing = editandoKey === row._key;
                    return (
                      <tr key={row._key} className="border-t hover:bg-gray-50">

                        <td className="px-4 py-3 text-gray-900 text-sm">
                          {isEditing ? (
                            <>
                              <input
                                type="text"
                                list="nutrientes-preview-list"
                                value={editBuffer.nutrienteNome ?? ''}
                                onChange={(e) =>
                                  setEditBuffer((prev) => ({
                                    ...prev,
                                    nutrienteNome: e.target.value,
                                  }))
                                }
                                className="border border-gray-300 rounded-xl p-2 text-sm text-gray-900 bg-white w-44 focus:outline-none focus:border-emerald-600"
                              />
                              <datalist id="nutrientes-preview-list">
                                {nutrientes.map((n) => (
                                  <option key={n.id} value={n.nome} />
                                ))}
                              </datalist>
                            </>
                          ) : (
                            row.nutrienteNome
                          )}
                        </td>

                        <td className="px-4 py-3 text-emerald-700 font-semibold text-sm">
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.0001"
                              value={editBuffer.valorPorKg ?? ''}
                              onChange={(e) =>
                                setEditBuffer((prev) => ({ ...prev, valorPorKg: e.target.value }))
                              }
                              className="border border-gray-300 rounded-xl p-2 text-sm text-gray-900 bg-white w-24 focus:outline-none focus:border-emerald-600"
                            />
                          ) : (
                            row.valorPorKg
                          )}
                        </td>

                        <td className="px-4 py-3 text-gray-500 text-sm">
                          {isEditing ? (
                            <select
                              value={editBuffer.unidadeDetectada ?? ''}
                              onChange={(e) =>
                                setEditBuffer((prev) => ({
                                  ...prev,
                                  unidadeDetectada: e.target.value,
                                }))
                              }
                              className="border border-gray-300 rounded-xl p-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600"
                            >
                              {UNIDADES_PADRAO.map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          ) : (
                            row.unidadeDetectada
                          )}
                        </td>

                        <td className="px-4 py-3 text-gray-500 text-sm">
                          {isEditing ? (
                            <select
                              value={editBuffer.base ?? ''}
                              onChange={(e) =>
                                setEditBuffer((prev) => ({ ...prev, base: e.target.value }))
                              }
                              className="border border-gray-300 rounded-xl p-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600"
                            >
                              <option value="Seca">Seca</option>
                              <option value="Úmida">Úmida</option>
                            </select>
                          ) : (
                            row.base
                          )}
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-3">
                            {isEditing ? (
                              <>
                                <button
                                  onClick={() => saveEditPreview(row._key)}
                                  className="text-emerald-600 hover:text-emerald-700 font-medium text-sm"
                                >
                                  Salvar
                                </button>
                                <button
                                  onClick={cancelEditPreview}
                                  className="text-gray-500 hover:text-gray-700 text-sm"
                                >
                                  Cancelar
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => startEditPreview(row)}
                                  className="text-emerald-600 hover:text-emerald-700"
                                >
                                  <Edit size={16} />
                                </button>
                                <button
                                  onClick={() => deletePreviewRow(row._key)}
                                  className="text-red-500 hover:text-red-700"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {erroAlimento && (
              <div className="mx-6 my-3 flex items-start gap-2 bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-red-700 text-sm">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{erroAlimento}</span>
              </div>
            )}

            <div className="p-6 border-t flex gap-3">
              <button
                onClick={() => setShowConfirmModal(true)}
                className="py-4 px-6 border border-gray-300 rounded-3xl text-gray-700 font-medium hover:bg-gray-50"
              >
                Editar nome
              </button>
              <button
                onClick={limparIA}
                className="py-4 px-6 border border-gray-300 rounded-3xl text-gray-700 font-medium hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={salvarResultadoIA}
                disabled={salvando || composicoesEditaveis.length === 0}
                className="flex-1 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white py-4 rounded-3xl font-semibold transition-colors"
              >
                {salvando
                  ? 'Salvando...'
                  : `Salvar ${composicoesEditaveis.length} composições`}
              </button>
            </div>

          </div>
        )}

        {/* ============================================================
            MODAL — Confirmação do nome após IA
        ============================================================ */}
        {showConfirmModal && resultadoIA && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl">

              <div className="bg-emerald-700 text-white p-6 text-center">
                <h2 className="text-2xl font-bold">Confirmar Alimento</h2>
                <p className="text-emerald-100 mt-1 text-sm">
                  {resultadoIA.composicoes.length} nutrientes detectados
                  {resultadoIA.baseCalculo === '100g' && (
                    <span className="ml-1">· valores convertidos de 100g → kg</span>
                  )}
                </p>
              </div>

              <div className="p-6 space-y-4">

                {resultadoIA.nomeAlimento && resultadoIA.nomeAlimento !== nomeAlimento && (
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 text-sm text-blue-800">
                    Foi identificado no rótulo o nome: <strong>{resultadoIA.nomeAlimento}</strong>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    Nome do alimento <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={nomeAlimento}
                    onChange={(e) => { setNomeAlimento(e.target.value); setErroAlimento(''); }}
                    placeholder="Ex: Equilíbrio Lazer"
                    className={`${inputClass} ${erroAlimento ? 'border-red-400 bg-red-50' : ''}`}
                  />
                  {erroAlimento && (
                    <div className="flex items-start gap-2 mt-1.5 text-red-600 text-xs">
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                      <span>{erroAlimento}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Categoria</label>
                    <select
                      value={categoriaAlimento}
                      onChange={(e) => setCategoriaAlimento(e.target.value)}
                      className={selectClass}
                    >
                      {CATEGORIAS_ALIMENTO.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Espécie</label>
                    <select
                      value={especieId}
                      onChange={(e) => setEspecieId(e.target.value)}
                      className={selectClass}
                    >
                      <option value="">Selecione...</option>
                      {especies.map((e) => (
                        <option key={e.id} value={e.id}>{e.nome}</option>
                      ))}
                    </select>
                  </div>
                </div>

              </div>

              <div className="p-6 border-t flex gap-3">
                <button
                  onClick={() => { setShowConfirmModal(false); limparIA(); }}
                  className="flex-1 py-4 border border-gray-300 rounded-3xl text-gray-700 font-medium hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    if (!nomeAlimento.trim()) {
                      setErroAlimento('Informe o nome do alimento');
                      return;
                    }
                    setErroAlimento('');
                    setShowConfirmModal(false);
                  }}
                  className="flex-1 py-4 bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded-3xl"
                >
                  Ver preview e salvar
                </button>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default CriaComposicaoAlimentar;
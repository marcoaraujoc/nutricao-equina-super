// src/pages/Animal.tsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Calendar, Camera, AlertCircle, RefreshCw, MapPin, CheckCircle2, X, Plus, User2, Loader2, ChevronDown } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';


// ─── NRC ─────────────────────────────────────────────────────────────────────
const NRC_CATEGORIAS: Record<string, string[]> = {
  'Adulto - Manutenção': ['Temperamento Calmo','Temperamento Médio','Temperamento Nervoso'],
  'Trabalhando':         ['Exercício Leve','Exercício Moderado','Exercício Pesado','Exercício Muito pesado'],
  'Garanhões':           ['Em serviço','Fora de serviço'],
  'Éguas Prenhas':       ['Menos de 5 Meses','5 Meses','6 Meses','7 Meses','8 Meses','9 Meses','10 Meses','11 Meses'],
  'Éguas em Lactação':   ['1 mês','2 Meses','3 Meses','4 Meses','5 Meses','6 Meses'],
  'Potros em Crescimento': [
    '4 Meses','6 Meses','12 Meses','18 Meses',
    '18 Meses Exercício Leve','18 Meses Exercício Moderado',
    '24 Meses','24 Meses Exercício Leve','24 Meses Exercício Moderado',
    '24 Meses Exercício Pesado','24 Meses Exercício Muito Pesado',
  ],
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface FormData {
  nome:               string;
  especieId:          number;
  racaId:             number | null;
  peso:               string;
  dataNascimento:     string;
  idadeAnos:          string;
  sexo:               string;
  categoriaAnimal:    string;
  tipoExercicio:      string;
  localizacaoId:      number | null;
  tratadorId:         number | null;
  baia:               string;
  pelagem:            string;
  altura:             string;
  registroPassaporte: string;
  finalidades:        string[];
  seguradora:         string;
}

interface Tratador {
  id:       number;
  nome:     string;
  telefone: string | null;
}

interface Localizacao {
  id:              number;
  nome:            string;
  tipoLocalizacao: string;
  tipoEntrada:     string;
}

interface FormProprietario {
  nomeCompleto: string;
  email:        string;
  telefone:     string;
  telefone2:    string;
}



interface AnimalEncontrado {
  id:               number;
  nome:             string;
  photoUrl?:        string | null;
  dataNascimento?:  string | null;
  idadeAnos?:       number | null;
  peso?:            number | null;
  sexo?:            string | null;
  categoriaAnimal?: string | null;
  tipoExercicio?:   string | null;
  especieId?:       number | null;
  racaId?:          number | null;
  especie?:         { id: number; nome: string } | null;
  raca?:            { id: number; nome: string } | null;
  baia?:               string | null;
  local?:              string | null;
  localizacaoId?:      number | null;
  localizacao?:        { id: number; nome: string } | null;
  tratadorId?:         number | null;
  tratador?:           { id: number; nome: string } | null;
  pelagem?:            string | null;
  altura?:             string | null;
  registroPassaporte?: string | null;
  finalidade?:         string | null;
  seguradora?:         string | null;
  // Fase 3 do multi-tenancy: uma pergunta só — este animal já é DESTA empresa?
  // Substituiu `temVet` + `vetDaMinhaEquipe`, que perguntavam pela PESSOA responsável.
  jaCadastradoAqui: boolean;
  proprietario?:    { id: number; fullName: string; email: string; phone?: string | null } | null;
}

// ⚠️ Eram cinco estados, hoje são quatro — e a diferença é o fim do vínculo.
// `sem_vet` ("existe, mas ninguém responde por ele") e `com_vet` ("existe, e o
// responsável é de outra equipe") perguntavam quem era o veterinário do animal.
// Quem responde por um paciente é a CLÍNICA: ou ele já é desta empresa (e então não
// se duplica), ou não é (e o cadastro segue normalmente).
type StatusBusca = 'idle' | 'ja_cadastrado' | 'outra_empresa' | 'nao_encontrado';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const calcularIdadeEmMeses = (dn: string, ia: string): number | null => {
  if (dn) {
    const nasc = new Date(dn);
    if (isNaN(nasc.getTime())) return null;
    const h = new Date();
    return (h.getFullYear() - nasc.getFullYear()) * 12 + (h.getMonth() - nasc.getMonth());
  }
  return ia && Number(ia) > 0 ? Number(ia) * 12 : null;
};

// Idade em anos completos a partir da data de nascimento (YYYY-MM-DD). '' se inválida.
const calcularIdadeAnos = (dn: string): string => {
  if (!dn) return '';
  const nasc = new Date(dn + 'T00:00');
  if (isNaN(nasc.getTime())) return '';
  const h = new Date(); h.setHours(0, 0, 0, 0);
  let anos = h.getFullYear() - nasc.getFullYear();
  const antesDoAniversario =
    h.getMonth() < nasc.getMonth() ||
    (h.getMonth() === nasc.getMonth() && h.getDate() < nasc.getDate());
  if (antesDoAniversario) anos--;
  return anos >= 0 ? String(anos) : '0';
};

// ─── Utilitário de compressão ─────────────────────────────────────────────────
const comprimirImagem = (file: File, maxWidth = 1200, qualidade = 0.82): Promise<File> =>
  new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width  = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type:         'image/jpeg',
            lastModified: Date.now(),
          }));
        },
        'image/jpeg',
        qualidade,
      );
    };

    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });

const getCategoriasDisponiveis = (sexo: string, dn: string, ia: string) => {
  const m = calcularIdadeEmMeses(dn, ia);
  if (m !== null && m <= 24) return ['Potros em Crescimento'];
  if (sexo === 'Fêmea') return ['Adulto - Manutenção','Trabalhando','Éguas Prenhas','Éguas em Lactação'];
  if (sexo === 'Macho') return ['Adulto - Manutenção','Trabalhando','Garanhões'];
  return Object.keys(NRC_CATEGORIAS);
};

const getTiposDisponiveis = (cat: string, dn: string, ia: string) => {
  if (cat !== 'Potros em Crescimento') return NRC_CATEGORIAS[cat] ?? [];
  const m = calcularIdadeEmMeses(dn, ia);
  if (m === null) return NRC_CATEGORIAS['Potros em Crescimento'];
  if (m < 18) return ['4 Meses','6 Meses','12 Meses'];
  if (m < 24) return ['18 Meses','18 Meses Exercício Leve','18 Meses Exercício Moderado'];
  return ['24 Meses','24 Meses Exercício Leve','24 Meses Exercício Moderado','24 Meses Exercício Pesado','24 Meses Exercício Muito Pesado'];
};

// ─── Componente principal ─────────────────────────────────────────────────────
function mascaraTelefone(v: string): string {
  const n = v.replace(/\D/g, '').slice(0, 11);
  if (n.length <= 10) return n.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  return n.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
}

function mascaraAltura(v: string): string {
  const n = v.replace(/\D/g, '').slice(0, 3);
  if (n.length === 0) return '';
  if (n.length === 1) return n;
  if (n.length === 2) return `${n[0]}.${n[1]}`;
  return `${n[0]}.${n.slice(1)} m`;
}

const FINALIDADES = [
  'Adestramento', 'Barril', 'CCE', 'Enduro', 'Laço',
  'Manga Larga', 'Polo', 'Salto', 'Vaquejada', 'Reprodução', 'Trabalho/Tração', 'Outro',
];

const Animal = () => {
  const { refreshSelectedAnimal } = useSelectedAnimal();
  const { user }                  = useAuth();
  const navigate                  = useNavigate();
  const location                  = useLocation();
  const { id }                    = useParams<{ id: string }>();
  const isEditMode                = !!id;
  const nomeFromState             = !id ? (location.state as { nome?: string } | null)?.nome ?? '' : '';

  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeCriar  = isGestor || podeExecutar('animais.criar');
  const podeEditar = isGestor || podeExecutar('animais.editar');
  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const role          = (user?.role     ?? user?.userType ?? '').toUpperCase();
  const userTypeUpper = (user?.userType ?? '').toUpperCase();
  const isVet         = role === 'VETERINARIO' || userTypeUpper === 'VETERINARIO';
  // Página de "Pacientes": só o PROPRIETÁRIO usa /meus-animais; todos os demais
  // perfis (vet, estagiário, gestor, fornecedor, admin) usam /animais-vet.
  const paginaPacientes = userTypeUpper === 'PROPRIETARIO' ? '/meus-animais' : '/animais-vet';

  // ── Estado base ────────────────────────────────────────────────────────────
  const [loading,        setLoading]        = useState(true);
  const [submitting,     setSubmitting]     = useState(false);
  const [photoPreview,   setPhotoPreview]   = useState<string | null>(null);
  const [photoFile,      setPhotoFile]      = useState<File | null>(null);
  // Marca que a foto JÁ SALVA deve ser removida no próximo salvar — "Remover foto"
  // só troca o preview local; sem isso o backend nunca soube que devia apagar.
  const [photoRemovida,  setPhotoRemovida]  = useState(false);
  const [especies,       setEspecies]       = useState<{ id: number; nome: string }[]>([]);
  const [todasRacas,     setTodasRacas]     = useState<{ id: number; nome: string; especieId: number }[]>([]);
  const [racasFiltradas, setRacasFiltradas] = useState<{ id: number; nome: string }[]>([]);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro de AÇÃO — renderizado no modal/painel que disparou, não no topo
  const [erroAcao, setErroAcao] = useState<ErroAcaoDados | null>(null);
  // Erros por campo — preenchidos durante a digitação (onBlur) e no submit
  const [erros, setErros] = useState<Record<string, string>>({});
  // ⚠️ FASE 3 DO MULTI-TENANCY — saíram daqui `vets`, `vetsFiltrados`, `vetOriginalId`
  // e `vetStatusAtual`. Eram o estado do seletor "Veterinário Responsável", que o
  // PROPRIETÁRIO usava para escolher um vet — e a escolha criava um vínculo e MOVIA o
  // animal para a empresa dele. Quem responde pelo paciente é a clínica que o cadastrou.

  // ── Localização do animal ──────────────────────────────────────────────────
  const [localizacoes,   setLocalizacoes]   = useState<Localizacao[]>([]);
  const [locBusca,       setLocBusca]       = useState('');
  const [locDropdownOpen, setLocDropdownOpen] = useState(false);

  // ── Tratador do animal ─────────────────────────────────────────────────────
  const [tratadores,       setTratadores]       = useState<Tratador[]>([]);
  const [tratBusca,        setTratBusca]        = useState('');
  const [tratDropdownOpen, setTratDropdownOpen] = useState(false);
  const [criandoTratador,  setCriandoTratador]  = useState(false);
  const [modalNovoTrat,    setModalNovoTrat]    = useState(false);
  const [novoTratNome,     setNovoTratNome]     = useState('');
  const [novoTratTelefone, setNovoTratTelefone] = useState('');
  const [novoTratLocId,    setNovoTratLocId]    = useState<number | null>(null);

  // ── Busca por nome (vet, novo cadastro) ────────────────────────────────────
  const [buscandoAnimal,    setBuscandoAnimal]    = useState(false);
  const [animalEncontrado,  setAnimalEncontrado]  = useState<AnimalEncontrado | null>(null);
  const [statusBuscaAnimal, setStatusBuscaAnimal] = useState<StatusBusca>('idle');

  // ── Busca proprietário por email ───────────────────────────────────────────
  const [buscandoProprietario,   setBuscandoProprietario]   = useState(false);
  const [proprietarioExistente,  setProprietarioExistente]  = useState<boolean | null>(null);

  // ── Estado de bloqueio do animal ────────────────────────────────────────────
  const [animalBloqueado,   setAnimalBloqueado]   = useState(false);
  const [bloqueioTipo,      setBloqueioTipo]      = useState<string | null>(null);
  const [bloqueioExpira,    setBloqueioExpira]    = useState<string | null>(null);

  // ── Formulário ─────────────────────────────────────────────────────────────
  const [formData, setFormData] = useState<FormData>({
    nome: nomeFromState, especieId: 0, racaId: null, peso: '',
    dataNascimento: '', idadeAnos: '', sexo: '',
    categoriaAnimal: '', tipoExercicio: '',
    localizacaoId: null, tratadorId: null, baia: '',
    pelagem: '', altura: '', registroPassaporte: '', finalidades: [],
    seguradora: '',
  });

  // Checagem da baia enquanto o usuário digita (regra: única por local + empresa).
  // A validação definitiva continua no backend ao salvar — esta só antecipa o erro.
  const [baiaStatus, setBaiaStatus] = useState<
    { estado: 'idle' | 'checando' | 'livre' } | { estado: 'ocupada'; por: string }
  >({ estado: 'idle' });

  const [formProp, setFormProp] = useState<FormProprietario>({
    nomeCompleto: '', email: '', telefone: '', telefone2: '',
  });

  // ── Rascunho do cadastro NÃO SALVO ───────────────────────────────────────────
  // Guarda o que está na tela se o usuário sair sem salvar nem cancelar (só CRIAÇÃO —
  // na edição o dado real já está no banco). Restaura ao voltar; limpa ao salvar ou
  // cancelar. Mesmo padrão do autosave de evolução (CLAUDE.md).
  const RASCUNHO_KEY = 's2vet_animal_draft';
  const rascunhoPronto = useRef(false);
  const limparRascunho = () => { try { localStorage.removeItem(RASCUNHO_KEY); } catch { /* ok */ } };

  useEffect(() => {
    if (isEditMode) { rascunhoPronto.current = true; return; }
    try {
      const raw = localStorage.getItem(RASCUNHO_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.formData) setFormData(d.formData);
        if (d.formProp) setFormProp(d.formProp);
      }
    } catch { /* rascunho corrompido: ignora */ }
    rascunhoPronto.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Só grava DEPOIS de tentar restaurar — senão o estado vazio inicial apagaria o rascunho.
    if (isEditMode || !rascunhoPronto.current) return;
    try { localStorage.setItem(RASCUNHO_KEY, JSON.stringify({ formData, formProp })); } catch { /* quota */ }
  }, [formData, formProp, isEditMode]);

  // ── Computados ─────────────────────────────────────────────────────────────
  const especieAtual = especies.find(e => e.id === formData.especieId);
  const isEquino     = !!especieAtual && (
    especieAtual.nome.toLowerCase().includes('equino') ||
    especieAtual.nome.toLowerCase().includes('cavalo')
  );
  const isCanino = !!especieAtual && (
    especieAtual.nome.toLowerCase().includes('canino') ||
    especieAtual.nome.toLowerCase().includes('cachorro') ||
    especieAtual.nome.toLowerCase().includes('cão') ||
    especieAtual.nome.toLowerCase().includes('cao')
  );
  const isFelino = !!especieAtual && (
    especieAtual.nome.toLowerCase().includes('felino') ||
    especieAtual.nome.toLowerCase().includes('gato')
  );
  const labelBaia = isEquino ? 'Baia' : (isCanino || isFelino) ? 'Leito' : null;

  // Verifica a disponibilidade da baia enquanto o usuário preenche (debounce 500ms).
  // Depende do local porque a regra é única por LOCAL (espaço físico): trocar o local
  // revalida a mesma baia. `animalId` ignora o próprio registro na edição.
  useEffect(() => {
    const baia  = formData.baia.trim();
    const local = locBusca.trim();
    if (!baia) { setBaiaStatus({ estado: 'idle' }); return; }

    setBaiaStatus({ estado: 'checando' });
    let cancelado = false;
    const t = setTimeout(async () => {
      try {
        const res = await api.get('/animais/verificar-baia', {
          params: {
            baia,
            localizacaoId: formData.localizacaoId ?? undefined,
            local:         local || undefined,
            animalId:      isEditMode ? id : undefined,
          },
        });
        if (cancelado) return;
        const d = res.data?.dados;
        if (!d) { setBaiaStatus({ estado: 'idle' }); return; }   // GET 403 → interceptor devolve null
        setBaiaStatus(d.disponivel ? { estado: 'livre' } : { estado: 'ocupada', por: d.ocupadaPor });
      } catch {
        if (!cancelado) setBaiaStatus({ estado: 'idle' });        // falha na checagem não bloqueia o form
      }
    }, 500);

    return () => { cancelado = true; clearTimeout(t); };
  }, [formData.baia, formData.localizacaoId, locBusca, isEditMode, id]);

  const categoriasDisponiveis = useMemo(
    () => getCategoriasDisponiveis(formData.sexo, formData.dataNascimento, formData.idadeAnos),
    [formData.sexo, formData.dataNascimento, formData.idadeAnos],
  );
  const tiposDisponiveis = useMemo(
    () => formData.categoriaAnimal
      ? getTiposDisponiveis(formData.categoriaAnimal, formData.dataNascimento, formData.idadeAnos)
      : [],
    [formData.categoriaAnimal, formData.dataNascimento, formData.idadeAnos],
  );
  const temIdadeOuData = !!formData.dataNascimento || !!formData.idadeAnos;

  // Busca de localização é server-side (autocomplete) — o backend já devolve os
  // primeiros resultados filtrados; usa direto o que veio.
  const filteredLocs = localizacoes;

  const filteredTrats = useMemo(() => {
    if (!tratBusca.trim()) return tratadores;
    return tratadores.filter(t =>
      t.nome.toLowerCase().includes(tratBusca.trim().toLowerCase()),
    );
  }, [tratadores, tratBusca]);

  // ── Buscar localizações (autocomplete server-side) ────────────────────────
  // Catálogo grande: traz só os primeiros 10 e refaz a busca conforme digita
  // (debounce). Busca apenas com o dropdown aberto — evita refetch ao selecionar.
  useEffect(() => {
    if (!formData.especieId || !especies.length) return;
    if (!locDropdownOpen) return;
    const especieNome = especieAtual?.nome ?? '';
    const t = setTimeout(() => {
      const params = new URLSearchParams({ ativo: 'true', limit: '10' });
      if (especieNome)     params.set('especie', especieNome);
      if (locBusca.trim()) params.set('busca', locBusca.trim());
      api.get(`/cadastro/localizacoes?${params.toString()}`)
        .then(res => { if (res.data) setLocalizacoes(res.data?.dados ?? []); })
        .catch(() => setLocalizacoes([]));
    }, 250);
    return () => clearTimeout(t);
  }, [formData.especieId, especies.length, locBusca, locDropdownOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Buscar tratadores (filtrado pelo local do animal, se definido) ─────────
  useEffect(() => {
    const params = formData.localizacaoId
      ? `ativo=true&localizacaoId=${formData.localizacaoId}`
      : 'ativo=true';
    api.get(`/cadastro/tratadores?${params}`)
      .then(res => { if (res.data) setTratadores(res.data?.dados ?? []); })
      .catch(() => setTratadores([]));
  }, [formData.localizacaoId]);

  // ── Efeitos de limpeza ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isEquino && (formData.categoriaAnimal || formData.tipoExercicio))
      setFormData(p => ({ ...p, categoriaAnimal: '', tipoExercicio: '' }));
  }, [isEquino]);

  useEffect(() => {
    if (formData.categoriaAnimal && !categoriasDisponiveis.includes(formData.categoriaAnimal))
      setFormData(p => ({ ...p, categoriaAnimal: '', tipoExercicio: '' }));
    else if (formData.tipoExercicio && !tiposDisponiveis.includes(formData.tipoExercicio))
      setFormData(p => ({ ...p, tipoExercicio: '' }));
  }, [categoriasDisponiveis, tiposDisponiveis]);

  useEffect(() => {
    if (formData.especieId && todasRacas.length > 0) {
      // SRD ("Sem Raça Definida") vem PRIMEIRO e o resto em ordem alfabética: é a
      // opção mais escolhida e, no meio de uma lista de raças, ficava escondida.
      const filtradas = todasRacas
        .filter(r => r.especieId === formData.especieId)
        .sort((a, b) => {
          if (a.nome === 'SRD') return -1;
          if (b.nome === 'SRD') return 1;
          return a.nome.localeCompare(b.nome, 'pt-BR');
        });
      setRacasFiltradas(filtradas);
      setFormData(p => p.racaId && !filtradas.some(r => r.id === p.racaId) ? { ...p, racaId: null } : p);
    }
  }, [formData.especieId, todasRacas]);

  // ── Carregamento inicial ───────────────────────────────────────────────────
  useEffect(() => {
    if (loadingPerms) return;
    const load = async () => {
      try {
        const [espRes, racRes] = await Promise.all([
          api.get('/especies'),
          api.get('/racas'),
        ]);
        const todasEspecies: { id: number; nome: string }[] = espRes.data?.dados ?? espRes.data ?? [];
        const racasData    = racRes.data?.dados ?? racRes.data ?? [];

        setTodasRacas(racasData);

        // Espécie é HERDADA da configuração da empresa (Configurações > Espécies
        // atendidas), não das espécies de interesse do vet — duas empresas com o
        // mesmo vet podem atender espécies diferentes. Só 1 espécie configurada →
        // campo trava nela (readonly); mais de 1 → dropdown com as configuradas.
        let especiesVisiveis = todasEspecies;
        try {
          const espEmpresaRes = await api.get('/equipes/especies-atendidas');
          const idsEmpresa: number[] = espEmpresaRes.data?.dados?.especiesAtendidas ?? [];
          if (idsEmpresa.length > 0) {
            const filtradas = todasEspecies.filter(e => idsEmpresa.includes(e.id));
            if (filtradas.length > 0) especiesVisiveis = filtradas;
          }
        } catch { /* mantém todas */ }
        setEspecies(especiesVisiveis);

        // Empresa atende uma única espécie → herda e trava o campo
        if (!isEditMode && especiesVisiveis.length === 1) {
          const unicaId = especiesVisiveis[0].id;
          setFormData(p => (p.especieId ? p : { ...p, especieId: unicaId }));
        }

        if (isEditMode && id) {
          const animalRes = await api.get(`/animais/${id}`);
          const a = animalRes.data?.dados ?? animalRes.data;

          // Paciente INATIVO é somente leitura — nem o backend aceita o PUT.
          // Manda direto para a tela de visualização em vez de deixar preencher
          // um formulário que vai recusar ao salvar.
          if (a.inativo) {
            toast.error('Paciente inativo — reative com o gestor antes de editar o cadastro.');
            navigate(`/animal/${id}`, { replace: true });
            return;
          }

          // Animal com espécie fora da configuração atual da empresa (config
          // mudou depois do cadastro) — mantém visível para não quebrar a tela
          // nem apagar silenciosamente o dado já salvo.
          if (a.especieId && !especiesVisiveis.some(sp => sp.id === a.especieId)) {
            const extra = todasEspecies.find(sp => sp.id === a.especieId);
            if (extra) setEspecies(prev => prev.some(sp => sp.id === extra.id) ? prev : [...prev, extra]);
          }

          setFormData({
            nome:              a.nome            ?? '',
            especieId:         a.especieId       ?? 0,
            racaId:            a.racaId          ?? null,
            peso:              a.peso?.toString() ?? '',
            dataNascimento:    a.dataNascimento   ? a.dataNascimento.split('T')[0] : '',
            // Com data de nascimento, a idade é sempre derivada dela (mantém consistência)
            idadeAnos:         a.dataNascimento   ? calcularIdadeAnos(a.dataNascimento.split('T')[0])
                                                  : (a.idadeAnos ? String(a.idadeAnos) : ''),
            sexo:              a.sexo             ?? '',
            categoriaAnimal:   a.categoriaAnimal  ?? '',
            tipoExercicio:     a.tipoExercicio    ?? '',
            localizacaoId:     a.localizacaoId      ?? null,
            tratadorId:        a.tratadorId         ?? null,
            baia:              a.baia               ?? '',
            pelagem:           a.pelagem            ?? '',
            altura:            a.altura             ?? '',
            registroPassaporte: a.registroPassaporte ?? '',
            finalidades:       a.finalidade ? a.finalidade.split('|') : [],
            seguradora:        a.seguradora ?? '',
          });
          // Pré-preenche o texto da busca de localização
          if (a.localizacao?.nome) {
            setLocBusca(a.localizacao.nome);
          } else if (a.local) {
            setLocBusca(a.local);
          }
          // Pré-preenche o texto da busca de tratador
          if (a.tratador?.nome) {
            setTratBusca(a.tratador.nome);
          }
          if (a.photoUrl) setPhotoPreview(a.photoUrl);
          if (a.user) {
            setFormProp({
              nomeCompleto: a.user.fullName ?? '',
              email:        a.user.email   ?? '',
              telefone:     a.user.phone  ? mascaraTelefone(a.user.phone.replace(/\D/g, ''))  : '',
              telefone2:    a.user.phone2 ? mascaraTelefone(a.user.phone2.replace(/\D/g, '')) : '',
            });
          }
          setAnimalBloqueado(a.bloqueado ?? false);
          setBloqueioTipo(a.bloqueioTipo ?? null);
          setBloqueioExpira(a.bloqueioExpira ?? null);
        }
      } catch (err) {
        console.error(err);
        setErroInline('Erro ao carregar dados');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isEditMode, isVet, loadingPerms]);

  // ── Busca por nome ─────────────────────────────────────────────────────────
  const buscarAnimalExistente = async (nome: string) => {
    if (!nome.trim() || !isVet || isEditMode) return;
    setBuscandoAnimal(true);
    setAnimalEncontrado(null);
    setStatusBuscaAnimal('idle');
    try {
      const res = await api.get(`/animais/buscar-por-nome?nome=${encodeURIComponent(nome.trim())}`);
      const animal: AnimalEncontrado | null = res.data?.dados;
      if (animal) {
        setAnimalEncontrado(animal);

        // Animal existente em OUTRA empresa vira um NOVO registro nesta clínica —
        // tratado como cadastro em branco. NÃO pré-preenche NADA vindo do registro
        // de origem: nem os dados do animal (peso, raça, local, tratador, foto —
        // referenciam localização/tratador de outro escopo) nem os do PROPRIETÁRIO.
        // O proprietário é isolado por empresa igual ao animal: cada empresa
        // preenche e mantém os próprios dados de contato do cliente.

        setStatusBuscaAnimal(animal.jaCadastradoAqui ? 'ja_cadastrado' : 'outra_empresa');
      } else {
        setStatusBuscaAnimal('nao_encontrado');
      }
    } catch {
      setStatusBuscaAnimal('nao_encontrado');
    } finally {
      setBuscandoAnimal(false);
    }
  };

  // Auto-busca quando nome vem de location state (ex: AnimaisVet → "Cadastrar Animal").
  // Garante que animais já existentes não tomem o caminho nao_encontrado e criem duplicatas.
  useEffect(() => {
    if (!nomeFromState || !isVet || isEditMode) return;
    buscarAnimalExistente(nomeFromState);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Busca proprietário por email ───────────────────────────────────────────
  // O backend só devolve o proprietário quando ele pertence à EMPRESA ATIVA
  // (mesmo escopo da listagem de proprietários). Cliente de outra empresa não é
  // encontrado aqui — os dados são preenchidos do zero e ficam isolados.
  const buscarProprietarioPorEmail = async (email: string) => {
    if (!isVet || isEditMode) return;
    const e = email.trim();
    if (!e) return;
    setBuscandoProprietario(true);
    try {
      const res = await api.get(`/users/buscar-proprietario?email=${encodeURIComponent(e)}`);
      if (res.data?.encontrado) {
        setFormProp(p => ({
          ...p,
          nomeCompleto: res.data.fullName ?? '',
          telefone:     res.data.phone  ? mascaraTelefone(res.data.phone.replace(/\D/g, ''))  : '',
          telefone2:    res.data.phone2 ? mascaraTelefone(res.data.phone2.replace(/\D/g, '')) : '',
        }));
        setProprietarioExistente(true);
      } else {
        setProprietarioExistente(false);
      }
    } catch {
      setProprietarioExistente(false);
    } finally {
      setBuscandoProprietario(false);
    }
  };

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview imediato antes de comprimir
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);

    // Comprime em background
    const comprimido = await comprimirImagem(file);
    setPhotoFile(comprimido);
    setPhotoRemovida(false);

    // Atualiza preview com versão comprimida
    const reader2 = new FileReader();
    reader2.onloadend = () => setPhotoPreview(reader2.result as string);
    reader2.readAsDataURL(comprimido);
  };

  const handleDateTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 2) val = val.slice(0, 2) + '/' + val.slice(2);
    if (val.length > 5) val = val.slice(0, 5) + '/' + val.slice(5);
    val = val.slice(0, 10);
    const parts = val.split('/');
    if (parts.length === 3 && parts[2].length === 4) {
      const [d, m, y] = parts.map(Number);
      const obj = new Date(y, m - 1, d);
      if (obj.getFullYear() !== y || obj.getMonth() !== m - 1 || obj.getDate() !== d) {
        setErroInline('Data inválida.'); setFormData(p => ({ ...p, dataNascimento: '' })); return;
      }
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      if (obj > hoje) {
        setErroInline('A data de nascimento não pode ser futura.'); setFormData(p => ({ ...p, dataNascimento: '' })); return;
      }
      const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
      setFormData(p => ({ ...p, dataNascimento: iso, idadeAnos: calcularIdadeAnos(iso) }));
    } else {
      setFormData(p => ({ ...p, dataNascimento: val }));
    }
  };

  // ── Criar tratador inline ──────────────────────────────────────────────────
  const abrirModalNovoTratador = (nome: string) => {
    setNovoTratNome(nome);
    setNovoTratTelefone('');
    // Local de trabalho replicado automaticamente do local do animal
    setNovoTratLocId(formData.localizacaoId);
    setTratDropdownOpen(false);
    setModalNovoTrat(true);
  };

  const handleCriarTratador = async () => {
    if (!novoTratNome.trim()) { setErroAcao({ mensagem: 'Nome é obrigatório', campos: ['novoTratNome'] }); return; }
    if (!novoTratLocId)       { setErroAcao({ mensagem: 'Local de trabalho é obrigatório', campos: ['novoTratLocId'] }); return; }
    setCriandoTratador(true);
    try {
      const res = await api.post('/cadastro/tratadores', {
        nome:          novoTratNome.trim(),
        telefone:      novoTratTelefone || undefined,
        localizacaoId: novoTratLocId,
      });
      if (res.data?.dados) {
        const novo: Tratador = res.data.dados;
        setTratadores(prev => [...prev, novo].sort((a, b) => a.nome.localeCompare(b.nome)));
        setFormData(p => ({ ...p, tratadorId: novo.id }));
        setTratBusca(novo.nome);
        setModalNovoTrat(false);
        toast.success('Tratador criado com sucesso!');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao criar tratador';
      setErroAcao({ mensagem: msg });
    } finally {
      setCriandoTratador(false);
    }
  };

  // ── Validação por campo ────────────────────────────────────────────────────
  // Roda DURANTE o preenchimento (onBlur/onChange de cada campo) e de novo no submit.
  // A mensagem aparece embaixo do próprio campo — o erro fica onde o usuário está.
  const CAMPOS_ANIMAL = [
    'nome', 'sexo', 'especieId', 'racaId', 'localizacaoId',
    'peso', 'idade', 'categoriaAnimal', 'tipoExercicio',
  ] as const;
  const CAMPOS_PROPRIETARIO = ['propNome', 'propEmail', 'propTelefone'] as const;

  const erroDoCampo = (campo: string): string | null => {
    const digitosTel = formProp.telefone.replace(/\D/g, '');
    switch (campo) {
      case 'nome':            return formData.nome?.trim() ? null : 'Informe o nome do animal';
      case 'sexo':            return formData.sexo ? null : 'Selecione o sexo';
      case 'especieId':       return formData.especieId ? null : 'Selecione a espécie';
      case 'racaId':          return formData.racaId ? null : 'Selecione a raça';
      case 'localizacaoId':   return formData.localizacaoId ? null : 'Selecione ou crie o local do animal';
      // O rótulo exibe "Peso (kg) *", então o vazio TEM de acusar. Antes só reclamava
      // de valor <= 0: o campo aparecia com asterisco, passava em branco no submit e o
      // animal era gravado com peso 0 — que a Nutrição depois lê como dado válido.
      case 'peso':
        if (!formData.peso.trim())    return 'Informe o peso do animal';
        if (Number(formData.peso) <= 0) return 'O peso deve ser positivo';
        return null;
      case 'idade':
        if (!formData.dataNascimento && !formData.idadeAnos) return 'Informe a data de nascimento ou a idade';
        if (formData.idadeAnos && Number(formData.idadeAnos) <= 0) return 'A idade deve ser positiva';
        return null;
      case 'categoriaAnimal': return isEquino && !formData.categoriaAnimal ? 'Obrigatória para equinos' : null;
      case 'tipoExercicio':   return isEquino && !formData.tipoExercicio   ? 'Obrigatório para equinos' : null;
      case 'propNome':        return formProp.nomeCompleto.trim() ? null : 'Informe o nome do proprietário';
      case 'propEmail':
        if (!formProp.email.trim()) return 'Informe o e-mail do proprietário';
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(formProp.email.trim()) ? null : 'E-mail inválido';
      case 'propTelefone':
        return digitosTel && (digitosTel.length < 10 || digitosTel.length > 11)
          ? 'Telefone inválido — use (00) 00000-0000' : null;
      default: return null;
    }
  };

  // Marca/limpa o erro de um campo (usado no onBlur de cada campo)
  const validarCampo = (campo: string) =>
    setErros(prev => {
      const msg = erroDoCampo(campo);
      if (!msg) {
        if (!(campo in prev)) return prev;
        const { [campo]: _removido, ...resto } = prev;
        return resto;
      }
      return prev[campo] === msg ? prev : { ...prev, [campo]: msg };
    });

  // Erro exibido embaixo do campo
  const ErroCampo = ({ campo }: { campo: string }) =>
    erros[campo] ? <p className="mt-1 text-xs text-red-600">{erros[campo]}</p> : null;

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isEditMode && !podeEditar) { semPermissao('alterar animal'); return; }
    if (!isEditMode && !podeCriar) { semPermissao('criar animal'); return; }

    if (statusBuscaAnimal === 'ja_cadastrado') {
      setErroInline(`${formData.nome} já está cadastrado nesta clínica`);
      return;
    }

    // Animal existente em OUTRA empresa vira um NOVO registro nesta clínica —
    // mesmo fluxo do não encontrado.
    const criandoNovoRegistro = isVet && !isEditMode
      && (statusBuscaAnimal === 'nao_encontrado' || statusBuscaAnimal === 'outra_empresa');

    // Valida TODOS os campos de uma vez: cada um recebe a própria mensagem, em vez
    // de parar no primeiro erro com um aviso solto no topo da página.
    // Na EDIÇÃO o bloco do proprietário é só leitura, com uma exceção: o telefone,
    // que a tela grava. Por isso ele entra na validação também aqui — sem isso, um
    // número pela metade seguiria para o cadastro do cliente sem ninguém avisar.
    const campos = [
      ...CAMPOS_ANIMAL,
      ...(criandoNovoRegistro ? CAMPOS_PROPRIETARIO : isEditMode ? (['propTelefone'] as const) : []),
    ];
    const novosErros: Record<string, string> = {};
    for (const campo of campos) {
      const msg = erroDoCampo(campo);
      if (msg) novosErros[campo] = msg;
    }
    // ⚠️ Trocar a localidade NÃO exige baia nem tratador (2026-08-04). Havia aqui uma
    // regra que barrava o salvamento pedindo os dois "para o local escolhido" — mas os
    // dois são OPCIONAIS no cadastro, e a troca de local não deveria transformá-los em
    // obrigatórios: quem move o animal muitas vezes ainda não sabe em que baia ele vai
    // ficar nem quem vai tratá-lo. O que a troca faz continua sendo LIMPAR os dois (ver
    // o onMouseDown do combobox de local), porque pertencem ao lugar anterior; deixá-los
    // em branco é resultado válido, e a baia pode ser preenchida depois.
    // O conflito de baia OCUPADA segue barrando logo abaixo — isso é colisão, não
    // obrigatoriedade.
    setErros(novosErros);

    const pendentes = Object.keys(novosErros);
    if (pendentes.length > 0) {
      setErroInline(pendentes.length === 1
        ? novosErros[pendentes[0]]
        : `Há ${pendentes.length} campos a corrigir — veja as mensagens em vermelho.`);
      // Leva o usuário até o primeiro campo com problema
      document.querySelector(`[data-campo="${pendentes[0]}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (baiaStatus.estado === 'ocupada') {
      setErroInline(`${labelBaia ?? 'Baia'} já ocupada por ${baiaStatus.por}. Escolha outra.`);
      return;
    }
    setErroInline(null);
    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        nome:               formData.nome.trim(),
        especieId:          formData.especieId,
        racaId:             formData.racaId,
        peso:               parseFloat(formData.peso) || 0,
        dataNascimento:     formData.dataNascimento || null,
        idadeAnos:          formData.dataNascimento ? null : (Number(formData.idadeAnos) || null),
        sexo:               formData.sexo,
        categoriaAnimal:    isEquino ? formData.categoriaAnimal : null,
        tipoExercicio:      isEquino ? formData.tipoExercicio   : null,
        localizacaoId:      formData.localizacaoId ?? null,
        tratadorId:         formData.tratadorId    ?? null,
        local:              locBusca.trim() || null,
        baia:               formData.baia.trim() || null,
        pelagem:            formData.pelagem.trim()            || null,
        altura:             formData.altura.trim()             || null,
        registroPassaporte: formData.registroPassaporte.trim() || null,
        finalidade:         formData.finalidades.length > 0 ? formData.finalidades.join('|') : null,
        seguradora:         formData.seguradora.trim() || null,
        // Animal já existente (sem vet ou com vet de outra equipe) → NOVO registro
        // duplicado para este veterinário; a origem é enviada apenas para o backend
        // reaproveitar a foto do animal original
        ...(criandoNovoRegistro && animalEncontrado && {
          animalOrigemId: animalEncontrado.id,
        }),
        // Vet criando animal novo (inclusive duplicado) → envia dados do proprietário
        ...(criandoNovoRegistro && {
          proprietario: {
            fullName: (formProp.nomeCompleto ?? '').trim(),
            email:    (formProp.email        ?? '').trim(),
            phone:    (formProp.telefone     ?? '').trim() || null,
            phone2:   (formProp.telefone2    ?? '').trim() || null,
          },
        }),
        // Edição: o ÚNICO dado do proprietário que esta tela grava é o CONTATO — não
        // se troca o dono do animal por aqui, então nome e e-mail não vão no payload.
        ...(isEditMode && {
          proprietario: {
            phone:  (formProp.telefone  ?? '').trim() || null,
            phone2: (formProp.telefone2 ?? '').trim() || null,
          },
        }),
        // "Remover foto" some com o preview na hora, mas sem avisar o backend a foto
        // já salva ficava intocada — o campo só é enviado quando não há arquivo novo
        // (photoFile vence: trocar a foto já implica remover a antiga, no backend).
        ...(isEditMode && photoRemovida && !photoFile && { removerFoto: true }),
      };

      let createdAnimalId: number | null = null;

      if (photoFile) {
        const fd = new FormData();
        // Campos primitivos: string, number, boolean (objetos são tratados abaixo)
        Object.entries(payload).forEach(([k, v]) => {
          if (v != null && typeof v !== 'object') fd.append(k, String(v));
        });
        // proprietario é um objeto → precisa ser serializado manualmente
        if (criandoNovoRegistro) {
          fd.append('proprietario', JSON.stringify({
            fullName: (formProp.nomeCompleto ?? '').trim(),
            email:    (formProp.email        ?? '').trim(),
            phone:    (formProp.telefone     ?? '').trim() || null,
            phone2:   (formProp.telefone2    ?? '').trim() || null,
          }));
        } else if (isEditMode) {
          fd.append('proprietario', JSON.stringify({
            phone:  (formProp.telefone  ?? '').trim() || null,
            phone2: (formProp.telefone2 ?? '').trim() || null,
          }));
        }
        fd.append('foto', photoFile);
        const cfg = { headers: { 'Content-Type': 'multipart/form-data' } };

        if (isEditMode) {
          await api.put(`/animais/${id}`, fd, cfg);
        } else {
          const res = await api.post('/animais', fd, cfg);
          createdAnimalId = res.data?.dados?.id ?? null;
        }
      } else {
        if (isEditMode) {
          await api.put(`/animais/${id}`, payload);
        } else {
          const res = await api.post('/animais', payload);
          createdAnimalId = res.data?.dados?.id ?? null;
        }
      }

      // Mensagem de sucesso contextual
      const msgSucesso = isEditMode
        ? 'Animal atualizado com sucesso!'
        : 'Animal cadastrado com sucesso!';

      toast.success(msgSucesso);
      if (!isEditMode) limparRascunho();  // salvou: o rascunho cumpriu o papel
      await refreshSelectedAnimal();

      const returnTo = (location.state as { nome?: string; returnTo?: string } | null)?.returnTo;
      if (!isEditMode && localStorage.getItem('s2vet_ob') === 'a') {
        localStorage.setItem('s2vet_ob', 'd');
        navigate('/');
      } else if (returnTo && !isEditMode) {
        navigate(createdAnimalId ? `${returnTo}/${createdAnimalId}` : returnTo);
      } else {
        navigate(paginaPacientes);
      }
    } catch (err: unknown) {
      // Log completo para diagnóstico — o toast abaixo mostra só a mensagem curta.
      console.error('[Animal.tsx] Erro ao salvar animal:', err);
      const isPermErr = (err as { isPermissionError?: boolean } | null)?.isPermissionError === true;
      const resp = (err as {
        response?: { data?: { mensagem?: string; error?: string; erros?: { campo: string; mensagem: string }[] } };
      }).response;
      // Fallback em cascata: mensagem do controller → erro de permissão (checkPermission
      // usa a chave `error`, não `mensagem` — e o interceptor 403 zera o response de
      // mutations) → 1º erro de validação (422) → texto genérico.
      const msg = isPermErr
        ? 'Sem permissão para realizar esta ação. Verifique com o responsável da equipe.'
        : resp?.data?.mensagem
          ?? resp?.data?.error
          ?? resp?.data?.erros?.[0]?.mensagem
          ?? 'Erro ao salvar animal';
      setErroInline(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading || loadingPerms) return (
    <PageContainer maxWidth="2xl">
      <div className="flex items-center justify-center py-20 text-gray-500">
        Carregando...
      </div>
    </PageContainer>
  );

  if (!loadingPerms && (isEditMode ? !podeEditar : !podeCriar)) {
    return (
      <PageContainer maxWidth="2xl">
        <BotaoVoltar para={paginaPacientes} className="mb-4" />
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Você não tem permissão para {isEditMode ? 'alterar' : 'criar'} animais.</p>
        </div>
      </PageContainer>
    );
  }

  const inputClass = 'w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition-colors';
  // Mesma caixa, em vermelho — usada enquanto o campo estiver inválido
  const inputClassErro = 'w-full border border-red-400 bg-red-50/40 rounded-2xl px-4 py-3 text-gray-900 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 transition-colors';

  return (
    <>
    <PageContainer maxWidth="2xl">
      <BotaoVoltar para={paginaPacientes} className="mb-4" />

      {isEditMode && animalBloqueado && (
        <div className={`mb-4 flex items-start gap-3 rounded-2xl px-4 py-3 border ${
          bloqueioTipo === 'AGUARDANDO_APROVACAO'
            ? 'bg-amber-50 border-amber-300 text-amber-800'
            : 'bg-orange-50 border-orange-300 text-orange-800'
        }`}>
          <span className="text-lg mt-0.5">🔒</span>
          <div className="flex-1">
            <p className="font-semibold text-sm">
              {bloqueioTipo === 'AGUARDANDO_APROVACAO'
                ? 'Animal aguardando autorização do proprietário'
                : 'Animal em período provisional'}
            </p>
            <p className="text-xs mt-0.5">
              {bloqueioTipo === 'AGUARDANDO_APROVACAO'
                ? 'Uma notificação foi enviada ao proprietário. O animal será liberado após a aprovação.'
                : bloqueioExpira
                  ? `O proprietário tem até ${new Date(bloqueioExpira).toLocaleString('pt-BR')} para confirmar o vínculo. Após esse prazo, o pedido será cancelado automaticamente.`
                  : 'O proprietário tem 24h para confirmar o vínculo. Após esse prazo, o pedido será cancelado automaticamente.'}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white shadow rounded-3xl p-5 sm:p-8">

          {/* Foto */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <label className="cursor-pointer group">
              <div className="w-32 h-32 rounded-3xl border-4 border-emerald-600 overflow-hidden bg-gray-50 shadow-inner transition-all group-hover:scale-105 flex items-center justify-center">
                {photoPreview
                  ? <img src={photoPreview} alt="Foto do animal" className="w-full h-full object-cover" />
                  : <div className="flex flex-col items-center gap-1 text-emerald-500 p-3">
                      <Camera size={28} />
                      <span className="text-xs font-medium text-gray-400 text-center leading-tight">Adicionar foto</span>
                    </div>
                }
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
            </label>
            {photoPreview && (
              <button type="button" onClick={() => { setPhotoPreview(null); setPhotoFile(null); setPhotoRemovida(true); }}
                className="text-xs text-gray-400 hover:text-red-500 underline transition-colors">
                Remover foto
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">

            {/* ── 1. Nome do animal + Sexo ──────────────────────────────────── */}
            <div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Nome do animal <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={formData.nome}
                      onChange={e => {
                        setFormData({ ...formData, nome: e.target.value });
                        if (statusBuscaAnimal !== 'idle') {
                          setStatusBuscaAnimal('idle');
                          setAnimalEncontrado(null);
                          setFormProp({ nomeCompleto: '', email: '', telefone: '', telefone2: '' });
                          setProprietarioExistente(null);
                        }
                      }}
                      onBlur={e => { validarCampo('nome'); if (isVet && !isEditMode) buscarAnimalExistente(e.target.value); }}
                      placeholder="Ex: Trovão, Mel, Rex..."
                      data-campo="nome"
                      className={erros.nome ? inputClassErro : inputClass}
                    />
                    {buscandoAnimal && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  <ErroCampo campo="nome" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Sexo <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select
                      value={formData.sexo}
                      onChange={e => { setFormData({ ...formData, sexo: e.target.value }); setErros(p => { const { sexo: _s, ...r } = p; return r; }); }}
                      onBlur={() => validarCampo('sexo')}
                      data-campo="sexo"
                      className={`${erros.sexo ? inputClassErro : inputClass} appearance-none pr-9`}
                    >
                      <option value="" disabled>Selecione o sexo</option>
                      <option value="Macho">Macho</option>
                      <option value="Fêmea">Fêmea</option>
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  <ErroCampo campo="sexo" />
                </div>
              </div>

              {/* Já é desta clínica — bloqueia (o Salvar também recusa) */}
              {statusBuscaAnimal === 'ja_cadastrado' && (
                <div className="mt-2 flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs text-emerald-700">
                  <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>{formData.nome}</strong> já está cadastrado nesta clínica.
                    Nenhuma ação necessária.
                  </span>
                </div>
              )}

              {/* Existe em OUTRA clínica — cadastro próprio, independente */}
              {statusBuscaAnimal === 'outra_empresa' && animalEncontrado && (
                <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>
                    Já existe um animal com o nome <strong>{formData.nome}</strong> em outra
                    clínica. Será criado um <strong>cadastro próprio desta clínica</strong>,
                    independente do outro — preencha os dados do animal e do proprietário.
                  </span>
                </div>
              )}

              {/* Animal não cadastrado na empresa é o caso normal de um cadastro novo —
                  não precisa de aviso. Só avisamos quando há algo a decidir. */}
            </div>

            {/* ── 2. Local do Animal + Baia ────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
              <div className="relative">
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  <span className="flex items-center gap-1">
                    <MapPin size={14} className="text-emerald-600" />
                    Local do Animal <span className="text-red-500">*</span>
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={locBusca}
                    onChange={e => {
                      setLocBusca(e.target.value);
                      setLocDropdownOpen(true);
                      if (formData.localizacaoId !== null) setFormData(p => ({ ...p, localizacaoId: null }));
                    }}
                    onFocus={() => setLocDropdownOpen(true)}
                    onBlur={() => { setTimeout(() => { setLocDropdownOpen(false); validarCampo('localizacaoId'); }, 200); }}
                    placeholder={formData.especieId ? 'Buscar local...' : 'Selecione a espécie primeiro'}
                    disabled={!formData.especieId}
                    data-campo="localizacaoId"
                    className={`${erros.localizacaoId ? inputClassErro : inputClass} pr-8 ${!formData.especieId ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}
                    autoComplete="off"
                  />
                  {formData.localizacaoId
                    ? <CheckCircle2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
                    : locBusca && (
                      <button type="button"
                        onMouseDown={() => { setLocBusca(''); setFormData(p => ({ ...p, localizacaoId: null })); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-400">
                        <X size={14} />
                      </button>
                    )
                  }
                </div>
                {locDropdownOpen && formData.especieId > 0 && (
                  <div className="absolute z-20 w-full bg-white border border-gray-200 shadow-xl rounded-xl mt-1 max-h-52 overflow-y-auto">
                    {filteredLocs.length === 0 && !locBusca.trim() && (
                      <p className="px-4 py-3 text-xs text-gray-400">Nenhum local cadastrado para esta espécie</p>
                    )}
                    {filteredLocs.map(loc => (
                      <button key={loc.id} type="button"
                        onMouseDown={() => {
                          // Trocar a localidade zera baia e tratador: os dois pertencem
                          // ao local anterior. Reinformar é OPCIONAL — podem ficar em branco.
                          setFormData(p => p.localizacaoId === loc.id
                            ? { ...p, localizacaoId: loc.id }
                            : { ...p, localizacaoId: loc.id, baia: '', tratadorId: null });
                          if (formData.localizacaoId !== loc.id) setTratBusca('');
                          setErros(prev => ({ ...prev, baia: '', tratador: '' }));
                          setLocBusca(loc.nome);
                          setLocDropdownOpen(false);
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 text-sm border-b border-gray-50 last:border-0">
                        <span className="font-medium text-gray-800">{loc.nome}</span>
                      </button>
                    ))}
                    {filteredLocs.length === 0 && locBusca.trim() && (
                      <p className="px-4 py-2 text-xs text-gray-400 italic">Nenhum resultado para "{locBusca}"</p>
                    )}
                  </div>
                )}
              </div>
              {labelBaia && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    {labelBaia}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={formData.baia}
                      onChange={e => { setFormData({ ...formData, baia: e.target.value }); if (erros.baia) setErros(prev => ({ ...prev, baia: '' })); }}
                      placeholder={isEquino ? 'Ex: B-12' : 'Ex: L-03'}
                      data-campo="baia"
                      className={`${erros.baia ? inputClassErro : inputClass} pr-9 ${
                        baiaStatus.estado === 'ocupada' ? 'border-red-300 focus:border-red-500' : ''
                      }`}
                    />
                    {/* Só sinaliza problema: baia livre é o caso esperado, não precisa de aviso */}
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      {baiaStatus.estado === 'checando' && <Loader2 size={14} className="animate-spin text-gray-400" />}
                      {baiaStatus.estado === 'ocupada'  && <AlertCircle size={14} className="text-red-500" />}
                    </span>
                  </div>
                  {baiaStatus.estado === 'ocupada' && (
                    <p className="mt-1 text-xs text-red-600">
                      {labelBaia} ocupada por <strong>{baiaStatus.por}</strong>
                      {locBusca.trim() ? ` (${locBusca.trim()})` : ''}.
                    </p>
                  )}
                  {erros.baia && <p className="mt-1 text-xs text-red-600">{erros.baia}</p>}
                </div>
              )}
            </div>

            {/* ── 3. Espécie + Raça ─────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Espécie <span className="text-red-500">*</span></label>
                <div className="relative">
                  <select
                    value={formData.especieId}
                    onChange={e => { setFormData({ ...formData, especieId: parseInt(e.target.value), racaId: null }); setErros(p => { const { especieId: _e, ...r } = p; return r; }); }}
                    onBlur={() => validarCampo('especieId')}
                    data-campo="especieId"
                    disabled={especies.length <= 1}
                    className={`${erros.especieId ? inputClassErro : inputClass} appearance-none pr-9 ${especies.length <= 1 ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                  >
                    <option value={0} disabled>Selecione a espécie</option>
                    {especies.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
                <ErroCampo campo="especieId" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Raça <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={formData.racaId || ''}
                    onChange={e => { setFormData({ ...formData, racaId: parseInt(e.target.value) }); setErros(p => { const { racaId: _r, ...rest } = p; return rest; }); }}
                    onBlur={() => validarCampo('racaId')}
                    data-campo="racaId"
                    className={`${erros.racaId ? inputClassErro : inputClass} appearance-none pr-9`}
                  >
                    <option value="">Selecione</option>
                    {racasFiltradas.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
                <ErroCampo campo="racaId" />
              </div>
            </div>


            {/* ── 4. Peso + Idade + Data de nascimento ─────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Peso (kg) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number" step="0.1" min="0.1" placeholder="Ex: 450"
                  value={formData.peso}
                  onChange={e => setFormData({ ...formData, peso: e.target.value })}
                  onBlur={() => validarCampo('peso')}
                  data-campo="peso"
                  className={erros.peso ? inputClassErro : inputClass}
                />
                <ErroCampo campo="peso" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Idade (anos){!temIdadeOuData && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input
                  type="number" min="1" step="1" placeholder="Ex: 5"
                  value={formData.idadeAnos}
                  disabled={!!formData.dataNascimento}
                  onChange={e => setFormData({ ...formData, idadeAnos: e.target.value })}
                  onBlur={() => validarCampo('idade')}
                  data-campo="idade"
                  className={`${erros.idade ? inputClassErro : inputClass} ${formData.dataNascimento ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}
                />
                <ErroCampo campo="idade" />
                {formData.dataNascimento && <p className="text-xs text-gray-400 mt-1">Calculada pela data</p>}
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Data de nascimento{!temIdadeOuData && <span className="text-red-500 ml-1">*</span>}
                </label>
                <div className="relative">
                  <input
                    type="text" placeholder="dd/mm/aaaa" autoComplete="off"
                    value={formData.dataNascimento ? formData.dataNascimento.split('-').reverse().join('/') : ''}
                    onChange={handleDateTextChange}
                    className={`${inputClass} pr-10`}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center">
                    <Calendar size={18} className="text-emerald-600 pointer-events-none" />
                    <input
                      type="date" lang="pt-BR" max={new Date().toISOString().split('T')[0]}
                      value={formData.dataNascimento?.includes('-') ? formData.dataNascimento : ''}
                      onChange={e => {
                        if (!e.target.value) return;
                        const d = new Date(e.target.value + 'T00:00');
                        const h = new Date(); h.setHours(0, 0, 0, 0);
                        if (d > h) { setErroInline('Data futura não permitida.'); return; }
                        setFormData({ ...formData, dataNascimento: e.target.value, idadeAnos: calcularIdadeAnos(e.target.value) });
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                  </div>
                </div>
                {formData.dataNascimento && (
                  <button type="button" onClick={() => setFormData({ ...formData, dataNascimento: '' })}
                    className="mt-1 text-xs text-gray-400 hover:text-red-500 underline transition-colors">
                    Limpar data
                  </button>
                )}
              </div>
            </div>

            {/* ── 5. Identificação / Resenha ───────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Pelagem</label>
                <div className="relative">
                  <select
                    value={formData.pelagem}
                    onChange={e => setFormData(p => ({ ...p, pelagem: e.target.value }))}
                    className={`${inputClass} appearance-none pr-9`}
                  >
                    <option value="">— selecione —</option>
                    <option>Alazão</option>
                    <option>Apaloosa</option>
                    <option>Baio</option>
                    <option>Castanho</option>
                    <option>Gateado/Dun</option>
                    <option>Isabel (Champagne/Cremello)</option>
                    <option>Murzelo</option>
                    <option>Overo</option>
                    <option>Palomino</option>
                    <option>Pampa/Pampeano (Pinto/Paint)</option>
                    <option>Preto (Tordilho preto/Zaino)</option>
                    <option>Ruão (Roano/Roan)</option>
                    <option>Tobiano</option>
                    <option>Tordilho</option>
                    <option>Zebrado</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Altura (cernelha)</label>
                <input
                  type="text"
                  placeholder="Ex.: 1.70 m"
                  value={formData.altura}
                  onChange={e => setFormData(p => ({ ...p, altura: mascaraAltura(e.target.value) }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Registro / Passaporte N°</label>
                <input
                  type="text"
                  placeholder="Número do registro ou passaporte"
                  value={formData.registroPassaporte}
                  onChange={e => setFormData(p => ({ ...p, registroPassaporte: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Nome da Seguradora</label>
                <input
                  type="text"
                  placeholder="Ex.: Allianz, Porto Seguro, HDI..."
                  value={formData.seguradora}
                  onChange={e => setFormData(p => ({ ...p, seguradora: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>

            {/* ── Finalidade (multi-seleção: select + pills removíveis) ────── */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Finalidade</label>
              <div className="relative">
                <select
                  value=""
                  onChange={e => {
                    const val = e.target.value;
                    if (val && !formData.finalidades.includes(val))
                      setFormData(p => ({ ...p, finalidades: [...p.finalidades, val] }));
                  }}
                  className={`${inputClass} appearance-none pr-9`}
                >
                  <option value="">Adicionar finalidade...</option>
                  {FINALIDADES.filter(f => !formData.finalidades.includes(f)).map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              {formData.finalidades.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {formData.finalidades.map(f => (
                    <span key={f} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                      {f}
                      <button
                        type="button"
                        onClick={() => setFormData(p => ({ ...p, finalidades: p.finalidades.filter(x => x !== f) }))}
                        className="ml-0.5 hover:text-emerald-900 transition-colors"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ── 6. Perfil NRC — equinos ───────────────────────────────────── */}
            {isEquino && (
              <>
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-sm font-semibold text-gray-700 mb-1">Perfil NRC</p>
                  {!temIdadeOuData && <p className="text-xs text-amber-600">Informe a idade ou data para ver as categorias.</p>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Categoria <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <select
                        value={formData.categoriaAnimal}
                        onChange={e => { setFormData({ ...formData, categoriaAnimal: e.target.value, tipoExercicio: '' }); setErros(p => { const { categoriaAnimal: _c, ...r } = p; return r; }); }}
                        onBlur={() => validarCampo('categoriaAnimal')}
                        disabled={!temIdadeOuData}
                        data-campo="categoriaAnimal"
                        className={`${erros.categoriaAnimal ? inputClassErro : inputClass} appearance-none pr-9 ${!temIdadeOuData ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}
                      >
                        <option value="">Selecione a categoria</option>
                        {categoriasDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                    <ErroCampo campo="categoriaAnimal" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Tipo / Estágio <span className="text-red-500">*</span>
                    </label>
                    {/* ⚠️ Este campo era o único OBRIGATÓRIO sem `data-campo`, sem a
                        classe de erro, sem `ErroCampo` e sem `validarCampo` no blur.
                        Efeito: o submit acusava "Obrigatório para equinos", mas o
                        `scrollIntoView` do `[data-campo=...]` não achava nada, o campo
                        não ficava vermelho e a mensagem não aparecia embaixo dele — o
                        usuário preenchia tudo o que estava marcado e o erro continuava,
                        sem dizer onde. Campo obrigatório novo precisa dos QUATRO. */}
                    <div className="relative">
                      <select
                        value={formData.tipoExercicio}
                        onChange={e => { setFormData({ ...formData, tipoExercicio: e.target.value }); setErros(p => { const { tipoExercicio: _t, ...r } = p; return r; }); }}
                        onBlur={() => validarCampo('tipoExercicio')}
                        disabled={!formData.categoriaAnimal || tiposDisponiveis.length === 0}
                        data-campo="tipoExercicio"
                        className={`${erros.tipoExercicio ? inputClassErro : inputClass} appearance-none pr-9 ${(!formData.categoriaAnimal || tiposDisponiveis.length === 0) ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}
                      >
                        <option value="">Selecione o tipo</option>
                        {tiposDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                    <ErroCampo campo="tipoExercicio" />
                  </div>
                </div>
              </>
            )}


            {/* ── 7. Tratador ───────────────────────────────────────────────── */}
            <div className="relative">
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                <span className="flex items-center gap-1">
                  <User2 size={14} className="text-emerald-600" />
                  Tratador Responsável
                </span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={tratBusca}
                  onChange={e => {
                    setTratBusca(e.target.value);
                    setTratDropdownOpen(true);
                    if (formData.tratadorId !== null) setFormData(p => ({ ...p, tratadorId: null }));
                  }}
                  onFocus={() => setTratDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setTratDropdownOpen(false), 200)}
                  placeholder={formData.localizacaoId ? 'Buscar ou incluir tratador…' : 'Selecione o local primeiro'}
                  disabled={!formData.localizacaoId}
                  data-campo="tratador"
                  className={`${erros.tratador ? inputClassErro : inputClass} pr-8 ${!formData.localizacaoId ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}
                  autoComplete="off"
                />
                {formData.tratadorId
                  ? <CheckCircle2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
                  : tratBusca && (
                    <button type="button"
                      onMouseDown={() => { setTratBusca(''); setFormData(p => ({ ...p, tratadorId: null })); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-400">
                      <X size={14} />
                    </button>
                  )
                }
              </div>
              {tratDropdownOpen && (
                <div className="absolute z-20 w-full bg-white border border-gray-200 shadow-xl rounded-xl mt-1 max-h-52 overflow-y-auto">
                  {filteredTrats.length === 0 && !tratBusca.trim() && (
                    <p className="px-4 py-3 text-xs text-gray-400">
                      Nenhum tratador{formData.localizacaoId ? ' para este local' : ''} cadastrado
                    </p>
                  )}
                  {filteredTrats.map(t => (
                    <button key={t.id} type="button"
                      onMouseDown={() => {
                        setFormData(p => ({ ...p, tratadorId: t.id }));
                        setTratBusca(t.nome);
                        setTratDropdownOpen(false);
                        if (erros.tratador) setErros(prev => ({ ...prev, tratador: '' }));
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 flex items-center justify-between text-sm border-b border-gray-50 last:border-0">
                      <span className="font-medium text-gray-800">{t.nome}</span>
                      {t.telefone && <span className="text-xs text-gray-400 ml-2 shrink-0">{t.telefone}</span>}
                    </button>
                  ))}
                  {filteredTrats.length === 0 && tratBusca.trim() && (
                    <p className="px-4 py-2 text-xs text-gray-400 italic">Nenhum resultado para "{tratBusca}"</p>
                  )}
                  <button type="button"
                    onMouseDown={() => abrirModalNovoTratador(tratBusca.trim())}
                    className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-blue-600 text-sm flex items-center gap-2 border-t border-gray-100">
                    <Plus size={13} />
                    Incluir novo Tratador{tratBusca.trim() ? ` "${tratBusca.trim()}"` : ''}
                  </button>
                </div>
              )}
              {erros.tratador && <p className="mt-1 text-xs text-red-600">{erros.tratador}</p>}
            </div>

            {/* ── 8. Proprietário (apenas vets) ────────────────────────────── */}
            {isVet && (
              <div className="pt-4 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-700 mb-3">Proprietário</p>
                <div className="space-y-3">
                  {/* E-mail e Nome lado a lado */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        E-mail {!isEditMode && <span className="text-red-500">*</span>}
                      </label>
                      <div className="relative">
                        <input
                          type="email"
                          value={formProp.email}
                          onChange={e => {
                            const v = e.target.value;
                            setFormProp(p => ({ ...p, email: v }));
                            if (proprietarioExistente === true) {
                              setFormProp(p => ({ ...p, email: v, nomeCompleto: '', telefone: '', telefone2: '' }));
                              setProprietarioExistente(null);
                            }
                          }}
                          onBlur={e => { validarCampo('propEmail'); buscarProprietarioPorEmail(e.target.value); }}
                          placeholder="email@exemplo.com"
                          disabled={isEditMode}
                          data-campo="propEmail"
                          className={`${erros.propEmail ? inputClassErro : inputClass} ${isEditMode ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                        />
                        {buscandoProprietario && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2">
                            <RefreshCw size={14} className="animate-spin text-gray-400" />
                          </span>
                        )}
                        {!buscandoProprietario && proprietarioExistente === true && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2">
                            <CheckCircle2 size={14} className="text-emerald-500" />
                          </span>
                        )}
                      </div>
                      <ErroCampo campo="propEmail" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Nome Completo {!isEditMode && <span className="text-red-500">*</span>}
                      </label>
                      <input
                        type="text"
                        value={formProp.nomeCompleto}
                        onChange={e => setFormProp(p => ({ ...p, nomeCompleto: e.target.value }))}
                        onBlur={() => validarCampo('propNome')}
                        placeholder="Nome do proprietário"
                        disabled={isEditMode || proprietarioExistente === true}
                        data-campo="propNome"
                        className={`${erros.propNome ? inputClassErro : inputClass} ${(isEditMode || proprietarioExistente === true) ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                      />
                      <ErroCampo campo="propNome" />
                    </div>
                  </div>
                  {/* Telefones — SEMPRE editáveis, inclusive com proprietário já
                      cadastrado e na edição do animal. Nome e e-mail continuam
                      travados (identidade do cliente é assunto do Cadastro de
                      Cliente); o contato muda o tempo todo e é o que a clínica precisa
                      corrigir na hora, sem sair da tela. O backend grava o telefone no
                      cadastro DESTA empresa e ignora campo vazio — formulário em branco
                      não apaga o número que a clínica já tem. */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Telefone 1</label>
                      <input
                        type="tel"
                        value={formProp.telefone}
                        onChange={e => setFormProp(p => ({ ...p, telefone: mascaraTelefone(e.target.value) }))}
                        onBlur={() => validarCampo('propTelefone')}
                        placeholder="(00) 00000-0000"
                        data-campo="propTelefone"
                        className={erros.propTelefone ? inputClassErro : inputClass}
                      />
                      <ErroCampo campo="propTelefone" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Telefone 2</label>
                      <input
                        type="tel"
                        value={formProp.telefone2}
                        onChange={e => setFormProp(p => ({ ...p, telefone2: mascaraTelefone(e.target.value) }))}
                        placeholder="(00) 00000-0000"
                        className={inputClass}
                      />
                    </div>
                  </div>
                  {!isEditMode && proprietarioExistente === false && statusBuscaAnimal === 'nao_encontrado' && (
                    <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-xs text-blue-700">
                      <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                      <span>
                        Proprietário não encontrado. Preencha os dados para enviar o convite.
                        Senha inicial: <strong>Inicial#001</strong>.
                      </span>
                    </div>
                  )}
                  {!isEditMode && proprietarioExistente === null && statusBuscaAnimal === 'nao_encontrado' && (
                    <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-xs text-blue-700">
                      <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                      <span>
                        Senha inicial: <strong>Inicial#001</strong>. Se o e-mail já estiver cadastrado,
                        o animal será vinculado ao usuário existente.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ⚠️ FASE 3 DO MULTI-TENANCY — a seção "Veterinário Responsável" (que só
                aparecia para o PROPRIETÁRIO) foi REMOVIDA. Escolher um vet ali criava um
                vínculo e movia o animal para a EMPRESA dele: uma parte colocando o
                registro dentro do tenant da outra. Junto saíram os avisos de "será
                vinculado", "o vínculo do veterinário anterior é mantido" e "este
                veterinário ainda não aceitou a solicitação". */}

            {/* Legenda campos obrigatórios */}
            <p className="text-xs text-gray-400">
              <span className="text-red-500">*</span> Campos obrigatórios
            </p>

            {/* Erro da ação — fica GRUDADO na base da janela enquanto o formulário
                está visível, junto do botão que o usuário acabou de clicar. Antes
                ficava no topo da página (acima do "Voltar"), fora da vista. */}
            {erroInline && (
              <div className="sticky bottom-2 z-20">
                <InlineError message={erroInline} className="shadow-lg" />
              </div>
            )}

            {/* Rodapé no padrão da aplicação: ações à direita, tamanho padrão, Cancelar
                ao lado do Salvar. O rótulo é só "Salvar" — cadastro e edição são a
                mesma ação, e "Salvar e Continuar"/"Atualizar Animal" só diziam de novo
                o que o cabeçalho da tela já diz. Sai da forma antiga (botão de largura
                total, py-3.5 e texto grande), que destoava das demais telas.
                O texto do estado BLOQUEADO permanece: ali o botão está desabilitado e a
                frase é a única explicação do porquê. */}
            <div className="flex items-center justify-end gap-3 pb-2">
              <button
                type="button"
                onClick={() => { if (!isEditMode) limparRascunho(); navigate(paginaPacientes); }}
                disabled={submitting}
                className="px-4 py-2.5 border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting || statusBuscaAnimal === 'ja_cadastrado'}
                className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors"
              >
                {submitting
                  ? 'Salvando...'
                  : statusBuscaAnimal === 'ja_cadastrado'
                    // Estado BLOQUEADO: o texto é a única explicação de por que o
                    // botão está desabilitado (CLAUDE.md §12, rodapé do Animal).
                    ? 'Animal já cadastrado aqui'
                    : 'Salvar'}
              </button>
            </div>

          </form>
        </div>
    </PageContainer>

    {/* ── Mini-modal: Novo Tratador ──────────────────────────────────────── */}
    {modalNovoTrat && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <User2 size={16} className="text-emerald-600" />
            Novo Tratador
          </h3>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Nome <span className="text-red-500">*</span>
            </label>
            <input
              value={novoTratNome}
              onChange={e => setNovoTratNome(e.target.value)}
              className={inputClass}
              placeholder="Ex.: João da Silva"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Telefone</label>
            <input
              value={novoTratTelefone}
              onChange={e => setNovoTratTelefone(mascaraTelefone(e.target.value))}
              placeholder="(00) 00000-0000"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Local de Trabalho
            </label>
            <div className={`${inputClass} bg-gray-50 text-gray-600 cursor-not-allowed flex items-center gap-2`}>
              <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
              {locBusca || '—'}
            </div>
            <p className="text-xs text-gray-400 mt-1">Replicado automaticamente do local do animal.</p>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setModalNovoTrat(false)}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <ErroAcao erro={erroAcao} className="mb-3" />
            <button
              type="button"
              onClick={handleCriarTratador}
              disabled={criandoTratador || !novoTratNome.trim() || !novoTratLocId}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {criandoTratador ? 'Salvando...' : 'Criar tratador'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default Animal;
// src/pages/Animal.tsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Calendar, Camera, UserCheck, AlertCircle, RefreshCw, MapPin, CheckCircle2, X, Plus, User2 } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';

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
  veterinarioUserId:  number | null;
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

interface Vet {
  vetUserId: number;
  nome:      string;
  crmv:      string | null;
  email:     string;
  especies:  { id: number; nome: string }[];
}

interface Solicitacao {
  tipo:        string;
  status:      string;
  vetUserId:   number;
  veterinario?: { id: number; fullName: string; email: string } | null;
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
  temVet:           boolean;
  vetDaMinhaEquipe?: boolean;
  proprietario?:    { id: number; fullName: string; email: string; phone?: string | null } | null;
}

// ← 'minha_equipe' adicionado
type StatusBusca = 'idle' | 'com_vet' | 'sem_vet' | 'nao_encontrado' | 'minha_equipe';

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

// ─── Dados estáticos de localização ──────────────────────────────────────────
const TIPO_ESPECIES_MAP: Record<string, string[] | null> = {
  HARAS:              ['Equino'],
  CANIL:              ['Canino'],
  GATIL:              ['Felino'],
  FAZENDA:            null,
  CLINICA:            null,
  HOSPITAL:           null,
  CENTRO_REPRODUCAO:  ['Equino', 'Canino', 'Felino', 'Bovino'],
  CENTRO_TREINAMENTO: ['Equino', 'Canino', 'Felino', 'Bovino'],
  PETSHOP:            ['Canino', 'Felino', 'Réptil'],
  HOTEL_ANIMAL:       ['Canino', 'Felino', 'Réptil'],
  ONG:                null,
  CRIADOR:            null,
  PROPRIETARIO:       null,
  OUTRO:              null,
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
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const role          = (user?.role     ?? user?.userType ?? '').toUpperCase();
  const userTypeUpper = (user?.userType ?? '').toUpperCase();
  const isVet         = role === 'VETERINARIO' || userTypeUpper === 'VETERINARIO';

  // ── Estado base ────────────────────────────────────────────────────────────
  const [loading,        setLoading]        = useState(true);
  const [submitting,     setSubmitting]     = useState(false);
  const [photoPreview,   setPhotoPreview]   = useState<string | null>(null);
  const [photoFile,      setPhotoFile]      = useState<File | null>(null);
  const [especies,       setEspecies]       = useState<{ id: number; nome: string }[]>([]);
  const [todasRacas,     setTodasRacas]     = useState<{ id: number; nome: string; especieId: number }[]>([]);
  const [racasFiltradas, setRacasFiltradas] = useState<{ id: number; nome: string }[]>([]);
  const [vets,           setVets]           = useState<Vet[]>([]);
  const [vetsFiltrados,  setVetsFiltrados]  = useState<Vet[]>([]);
  const [vetOriginalId,  setVetOriginalId]  = useState<number | null>(null);
  const [vetStatusAtual, setVetStatusAtual] = useState<string | null>(null);

  // ── Localização do animal ──────────────────────────────────────────────────
  const [localizacoes,   setLocalizacoes]   = useState<Localizacao[]>([]);
  const [locBusca,       setLocBusca]       = useState('');
  const [locDropdownOpen, setLocDropdownOpen] = useState(false);
  const [criandoLocal,   setCriandoLocal]   = useState(false);
  const [novoLocalNome,  setNovoLocalNome]  = useState('');
  const [novoLocalTipo,  setNovoLocalTipo]  = useState('');
  const [salvandoLocal,  setSalvandoLocal]  = useState(false);

  // ── Tratador do animal ─────────────────────────────────────────────────────
  const [tratadores,       setTratadores]       = useState<Tratador[]>([]);
  const [tratBusca,        setTratBusca]        = useState('');
  const [tratDropdownOpen, setTratDropdownOpen] = useState(false);
  const [criandoTratador,  setCriandoTratador]  = useState(false);
  const [modalNovoTrat,    setModalNovoTrat]    = useState(false);
  const [novoTratNome,     setNovoTratNome]     = useState('');
  const [novoTratTelefone, setNovoTratTelefone] = useState('');
  const [novoTratLocId,    setNovoTratLocId]    = useState<number | null>(null);
  const [novoTratLocBusca, setNovoTratLocBusca] = useState('');
  const [novoTratLocOpen,  setNovoTratLocOpen]  = useState(false);

  // ── Busca por nome (vet, novo cadastro) ────────────────────────────────────
  const [buscandoAnimal,    setBuscandoAnimal]    = useState(false);
  const [animalEncontrado,  setAnimalEncontrado]  = useState<AnimalEncontrado | null>(null);
  const [statusBuscaAnimal, setStatusBuscaAnimal] = useState<StatusBusca>('idle');

  // ── Busca proprietário por email ───────────────────────────────────────────
  const [buscandoProprietario,   setBuscandoProprietario]   = useState(false);
  const [proprietarioExistente,  setProprietarioExistente]  = useState<boolean | null>(null);
  const [pedirAutorizacao,       setPedirAutorizacao]       = useState(false);

  // ── Estado de bloqueio do animal ────────────────────────────────────────────
  const [animalBloqueado,   setAnimalBloqueado]   = useState(false);
  const [bloqueioTipo,      setBloqueioTipo]      = useState<string | null>(null);
  const [bloqueioExpira,    setBloqueioExpira]    = useState<string | null>(null);

  // ── Formulário ─────────────────────────────────────────────────────────────
  const [formData, setFormData] = useState<FormData>({
    nome: nomeFromState, especieId: 0, racaId: null, peso: '',
    dataNascimento: '', idadeAnos: '', sexo: '',
    categoriaAnimal: '', tipoExercicio: '',
    veterinarioUserId: null,
    localizacaoId: null, tratadorId: null, baia: '',
    pelagem: '', altura: '', registroPassaporte: '', finalidades: [],
    seguradora: '',
  });

  const [formProp, setFormProp] = useState<FormProprietario>({
    nomeCompleto: '', email: '', telefone: '', telefone2: '',
  });

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

  const filteredLocs = useMemo(() => {
    if (!locBusca.trim()) return localizacoes;
    return localizacoes.filter(l =>
      l.nome.toLowerCase().includes(locBusca.trim().toLowerCase()),
    );
  }, [localizacoes, locBusca]);

  const filteredTrats = useMemo(() => {
    if (!tratBusca.trim()) return tratadores;
    return tratadores.filter(t =>
      t.nome.toLowerCase().includes(tratBusca.trim().toLowerCase()),
    );
  }, [tratadores, tratBusca]);

  const tiposCompativeis = useMemo(() => {
    const especieNome = especieAtual?.nome ?? '';
    return Object.keys(TIPO_ESPECIES_MAP).filter(tipo => {
      const specs = TIPO_ESPECIES_MAP[tipo];
      if (specs === null) return true;
      return especieNome && specs.some(s => especieNome.toLowerCase().includes(s.toLowerCase()));
    });
  }, [especieAtual]);

  const vetFoiAlterado = isEditMode
    && formData.veterinarioUserId !== null
    && formData.veterinarioUserId !== vetOriginalId;

  // ── Buscar localizações ao trocar espécie ─────────────────────────────────
  useEffect(() => {
    if (!formData.especieId || !especies.length) return;
    const especieNome = especieAtual?.nome ?? '';
    const params = `ativo=true${especieNome ? `&especie=${encodeURIComponent(especieNome)}` : ''}`;
    api.get(`/cadastro/localizacoes?${params}`)
      .then(res => { if (res.data) setLocalizacoes(res.data?.dados ?? []); })
      .catch(() => setLocalizacoes([]));
  }, [formData.especieId, especies.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const filtradas = todasRacas.filter(r => r.especieId === formData.especieId);
      setRacasFiltradas(filtradas);
      setFormData(p => p.racaId && !filtradas.some(r => r.id === p.racaId) ? { ...p, racaId: null } : p);
    }
  }, [formData.especieId, todasRacas]);

  useEffect(() => {
    if (formData.especieId && vets.length > 0) {
      const filtrados = vets.filter(v =>
        v.especies.length === 0 || v.especies.some(e => e.id === formData.especieId)
      );
      setVetsFiltrados(filtrados);
      if (formData.veterinarioUserId && !filtrados.some(v => v.vetUserId === formData.veterinarioUserId))
        setFormData(p => ({ ...p, veterinarioUserId: null }));
    } else {
      setVetsFiltrados(vets);
    }
  }, [formData.especieId, vets]);

  // ── Carregamento inicial ───────────────────────────────────────────────────
  useEffect(() => {
    if (loadingPerms) return;
    const load = async () => {
      try {
        const [espRes, racRes] = await Promise.all([
          api.get('/especies'),
          api.get('/racas'),
        ]);
        const vetRes       = await api.get('/veterinarios').catch(() => ({ data: { dados: [] } }));
        const todasEspecies: { id: number; nome: string }[] = espRes.data?.dados ?? espRes.data ?? [];
        const racasData    = racRes.data?.dados ?? racRes.data ?? [];
        const vetsData     = vetRes.data?.dados ?? [];

        setTodasRacas(racasData);
        setVets(vetsData);
        setVetsFiltrados(vetsData);

        // Filtrar espécies pelas atendidas na empresa/equipe
        // (vet: suas espécies; gestor: união das espécies dos vets da equipe)
        let especiesVisiveis = todasEspecies;
        if (isVet || isGestor) {
          try {
            const espEquipeRes = await api.get('/equipes/minhas-especies');
            const nomes: string[] = espEquipeRes.data?.dados ?? [];
            if (nomes.length > 0) {
              const filtradas = todasEspecies.filter(e => nomes.includes(e.nome));
              if (filtradas.length > 0) especiesVisiveis = filtradas;
            }
          } catch { /* mantém todas */ }
        }
        setEspecies(especiesVisiveis);

        // Empresa atende uma única espécie → mostra e seleciona somente ela
        if (!isEditMode && especiesVisiveis.length === 1) {
          const unicaId = especiesVisiveis[0].id;
          setFormData(p => (p.especieId ? p : { ...p, especieId: unicaId }));
        }

        if (isEditMode && id) {
          const animalRes = await api.get(`/animais/${id}`);
          const a = animalRes.data?.dados ?? animalRes.data;

          const solicitacoes: Solicitacao[] = a.solicitacoes ?? [];
          // Apenas VINCULO ACEITO representa vet ativo; DESVINCULO ACEITO significa vet removido
          const solAceita   = solicitacoes.find(s => s.status === 'ACEITO' && s.tipo === 'VINCULO');
          const solPendente = solicitacoes.find(s => s.status === 'PENDENTE');
          const solAtual    = solAceita ?? solPendente ?? null;
          let vetCarregadoId: number | null = solAtual?.vetUserId ?? null;

          // Fallback: sem solicitação mas veterinarioNome gravado → tenta encontrar pelo nome
          if (!vetCarregadoId && a.veterinarioNome) {
            const match = vetsData.find(
              (v: { vetUserId: number; nome: string }) =>
                v.nome.toLowerCase() === (a.veterinarioNome as string).toLowerCase()
            );
            if (match) vetCarregadoId = match.vetUserId;
          }

          setVetOriginalId(vetCarregadoId);
          setVetStatusAtual(solAtual?.status ?? null);

          setFormData({
            nome:              a.nome            ?? '',
            especieId:         a.especieId       ?? 0,
            racaId:            a.racaId          ?? null,
            peso:              a.peso?.toString() ?? '',
            dataNascimento:    a.dataNascimento   ? a.dataNascimento.split('T')[0] : '',
            idadeAnos:         a.idadeAnos        ? String(a.idadeAnos) : '',
            sexo:              a.sexo             ?? '',
            categoriaAnimal:   a.categoriaAnimal  ?? '',
            tipoExercicio:     a.tipoExercicio    ?? '',
            veterinarioUserId: vetCarregadoId,
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
              telefone:     a.user.phone ? mascaraTelefone(a.user.phone.replace(/\D/g, '')) : '',
            });
          }
          setAnimalBloqueado(a.bloqueado ?? false);
          setBloqueioTipo(a.bloqueioTipo ?? null);
          setBloqueioExpira(a.bloqueioExpira ?? null);
        }
      } catch (err) {
        console.error(err);
        toast.error('Erro ao carregar dados');
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

        // Pré-preenche campos do animal com os dados encontrados
        setFormData(prev => ({
          ...prev,
          especieId:       animal.especieId       ?? prev.especieId,
          racaId:          animal.racaId          ?? prev.racaId,
          peso:            animal.peso != null     ? String(animal.peso) : prev.peso,
          dataNascimento:  animal.dataNascimento   ? animal.dataNascimento.split('T')[0] : prev.dataNascimento,
          idadeAnos:       animal.idadeAnos != null ? String(animal.idadeAnos) : prev.idadeAnos,
          sexo:            animal.sexo             ?? prev.sexo,
          categoriaAnimal: animal.categoriaAnimal  ?? prev.categoriaAnimal,
          tipoExercicio:   animal.tipoExercicio    ?? prev.tipoExercicio,
        }));
        if (animal.photoUrl) setPhotoPreview(animal.photoUrl);

        if (!animal.temVet) {
          // Sem vet → pode vincular
          setStatusBuscaAnimal('sem_vet');
          if (animal.proprietario) {
            setFormProp({
              nomeCompleto: animal.proprietario.fullName ?? '',
              email:        animal.proprietario.email    ?? '',
              telefone:     animal.proprietario.phone ? mascaraTelefone(animal.proprietario.phone.replace(/\D/g, '')) : '',
            });
          }
        } else if (animal.vetDaMinhaEquipe) {
          // Tem vet mas é da mesma equipe → informa, bloqueia
          setStatusBuscaAnimal('minha_equipe');
        } else {
          // Tem vet de outra equipe → bloqueia com mensagem original
          setStatusBuscaAnimal('com_vet');
        }
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
  const buscarProprietarioPorEmail = async (email: string) => {
    if (!isVet || isEditMode || statusBuscaAnimal === 'sem_vet') return;
    const e = email.trim();
    if (!e) return;
    setBuscandoProprietario(true);
    try {
      const res = await api.get(`/users/buscar-proprietario?email=${encodeURIComponent(e)}`);
      if (res.data?.encontrado) {
        setFormProp(p => ({
          ...p,
          nomeCompleto: res.data.fullName ?? '',
          telefone:     res.data.phone ? mascaraTelefone(res.data.phone.replace(/\D/g, '')) : '',
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
        toast.error('Data inválida.'); setFormData(p => ({ ...p, dataNascimento: '' })); return;
      }
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      if (obj > hoje) {
        toast.error('A data de nascimento não pode ser futura.'); setFormData(p => ({ ...p, dataNascimento: '' })); return;
      }
      setFormData(p => ({ ...p, dataNascimento: `${parts[2]}-${parts[1]}-${parts[0]}`, idadeAnos: '' }));
    } else {
      setFormData(p => ({ ...p, dataNascimento: val }));
    }
  };

  // ── Criar localização inline ───────────────────────────────────────────────
  const handleCriarLocal = async () => {
    if (!novoLocalNome.trim() || !novoLocalTipo) return;
    setSalvandoLocal(true);
    try {
      const res = await api.post('/cadastro/localizacoes', {
        nome:            novoLocalNome.trim(),
        tipoLocalizacao: novoLocalTipo,
      });
      if (res.data?.dados) {
        const novaLoc: Localizacao = res.data.dados;
        setLocalizacoes(prev => [...prev, novaLoc].sort((a, b) => a.nome.localeCompare(b.nome)));
        setFormData(p => ({ ...p, localizacaoId: novaLoc.id }));
        setLocBusca(novaLoc.nome);
        setCriandoLocal(false);
        setNovoLocalNome('');
        setNovoLocalTipo('');
        toast.success('Local criado com sucesso!');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao criar local';
      toast.error(msg);
    } finally {
      setSalvandoLocal(false);
    }
  };

  // ── Criar tratador inline ──────────────────────────────────────────────────
  const abrirModalNovoTratador = (nome: string) => {
    setNovoTratNome(nome);
    setNovoTratTelefone('');
    setNovoTratLocId(formData.localizacaoId);
    const locAtual = localizacoes.find(l => l.id === formData.localizacaoId);
    setNovoTratLocBusca(locAtual?.nome ?? '');
    setNovoTratLocOpen(false);
    setTratDropdownOpen(false);
    setModalNovoTrat(true);
  };

  const handleCriarTratador = async () => {
    if (!novoTratNome.trim()) { toast.error('Nome é obrigatório'); return; }
    if (!novoTratLocId)       { toast.error('Local de trabalho é obrigatório'); return; }
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
      toast.error(msg);
    } finally {
      setCriandoTratador(false);
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isEditMode && !podeEditar) { semPermissao('alterar animal'); return; }
    if (!isEditMode && !podeCriar) { semPermissao('criar animal'); return; }

    if (statusBuscaAnimal === 'com_vet' || statusBuscaAnimal === 'minha_equipe') {
      toast.error(`${formData.nome} já está sob cuidados de um veterinário`);
      return;
    }

    setSubmitting(true);

    if (!formData.nome?.trim())      { toast.error('Nome do animal é obrigatório'); setSubmitting(false); return; }
    if (!formData.especieId)         { toast.error('Espécie é obrigatória'); setSubmitting(false); return; }
    if (!formData.sexo)              { toast.error('Sexo é obrigatório'); setSubmitting(false); return; }
    if (!formData.localizacaoId)     { toast.error('Selecione ou crie o local do animal'); setSubmitting(false); return; }
    if (!formData.racaId)            { toast.error('Raça é obrigatória'); setSubmitting(false); return; }
    if (!formData.dataNascimento && !formData.idadeAnos) { toast.error('Informe a data de nascimento ou a idade'); setSubmitting(false); return; }
    if (formData.peso && Number(formData.peso) <= 0)     { toast.error('O peso deve ser positivo'); setSubmitting(false); return; }
    if (formData.idadeAnos && Number(formData.idadeAnos) <= 0) { toast.error('A idade deve ser positiva'); setSubmitting(false); return; }
    if (isEquino && (!formData.categoriaAnimal || !formData.tipoExercicio)) {
      toast.error('Categoria e tipo são obrigatórios para equinos'); setSubmitting(false); return;
    }

    // Vet criando animal novo (não encontrado) — valida dados do proprietário
    if (isVet && !isEditMode && statusBuscaAnimal === 'nao_encontrado') {
      if (!formProp.nomeCompleto.trim()) { toast.error('Nome do proprietário é obrigatório'); setSubmitting(false); return; }
      if (!formProp.email.trim())        { toast.error('E-mail do proprietário é obrigatório'); setSubmitting(false); return; }
      const digsTel = formProp.telefone.replace(/\D/g, '');
      if (digsTel && (digsTel.length < 10 || digsTel.length > 11)) {
        toast.error('Telefone inválido — use (00) 00000-0000'); setSubmitting(false); return;
      }
    }

    try {
      const vetSelecionado = formData.veterinarioUserId
        ? vets.find(v => v.vetUserId === formData.veterinarioUserId)
        : null;

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
        veterinarioNome:    vetSelecionado?.nome ?? null,
        veterinarioClinica: vetSelecionado ? `CRMV: ${vetSelecionado.crmv ?? '—'}` : null,
        veterinarioUserId:  formData.veterinarioUserId ?? null,
        localizacaoId:      formData.localizacaoId ?? null,
        tratadorId:         formData.tratadorId    ?? null,
        local:              locBusca.trim() || null,
        baia:               formData.baia.trim() || null,
        pelagem:            formData.pelagem.trim()            || null,
        altura:             formData.altura.trim()             || null,
        registroPassaporte: formData.registroPassaporte.trim() || null,
        finalidade:         formData.finalidades.length > 0 ? formData.finalidades.join('|') : null,
        seguradora:         formData.seguradora.trim() || null,
        // Vet vinculando animal existente sem vet
        ...(animalEncontrado && statusBuscaAnimal === 'sem_vet' && {
          animalExistenteId: animalEncontrado.id,
        }),
        // Vet criando animal novo → envia dados do proprietário
        ...(isVet && !isEditMode && statusBuscaAnimal === 'nao_encontrado' && {
          proprietario: {
            fullName: formProp.nomeCompleto.trim(),
            email:    formProp.email.trim(),
            phone:    formProp.telefone.trim()  || null,
            phone2:   formProp.telefone2.trim() || null,
          },
        }),
        // Informa o backend se o proprietário precisa aprovar ou vínculo é imediato
        ...(isVet && !isEditMode && (statusBuscaAnimal === 'sem_vet' || statusBuscaAnimal === 'nao_encontrado') && {
          pedirAutorizacao,
        }),
      };

      let createdAnimalId: number | null = null;

      if (photoFile) {
        const fd = new FormData();
        // Campos primitivos: string, number, boolean (objetos são tratados abaixo)
        Object.entries(payload).forEach(([k, v]) => {
          if (v != null && typeof v !== 'object') fd.append(k, String(v));
        });
        // proprietario é um objeto → precisa ser serializado manualmente
        if (isVet && !isEditMode && statusBuscaAnimal === 'nao_encontrado') {
          fd.append('proprietario', JSON.stringify({
            fullName: formProp.nomeCompleto.trim(),
            email:    formProp.email.trim(),
            phone:    formProp.telefone.trim()  || null,
            phone2:   formProp.telefone2.trim() || null,
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
      const vinculandoParaProprietario = (statusBuscaAnimal === 'sem_vet' || statusBuscaAnimal === 'nao_encontrado');
      const msgSucesso = vinculandoParaProprietario
        ? (pedirAutorizacao
            ? 'Solicitação enviada! O proprietário receberá um e-mail para autorizar o vínculo.'
            : 'Vínculo estabelecido com sucesso!')
        : isEditMode ? 'Animal atualizado com sucesso!' : 'Animal cadastrado com sucesso!';

      toast.success(msgSucesso);
      await refreshSelectedAnimal();

      const returnTo = (location.state as { nome?: string; returnTo?: string } | null)?.returnTo;
      if (!isEditMode && localStorage.getItem('s2vet_ob') === 'a') {
        localStorage.setItem('s2vet_ob', 'd');
        navigate('/');
      } else if (returnTo && !isEditMode) {
        navigate(createdAnimalId ? `${returnTo}/${createdAnimalId}` : returnTo);
      } else if (isVet) {
        navigate('/animais-vet');
      } else {
        navigate('/meus-animais');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })
        .response?.data?.mensagem ?? 'Erro ao salvar animal';
      toast.error(msg);
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
        <BotaoVoltar para={isVet ? '/animais-vet' : '/meus-animais'} className="mb-4" />
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Você não tem permissão para {isEditMode ? 'alterar' : 'criar'} animais.</p>
        </div>
      </PageContainer>
    );
  }

  const inputClass = 'w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition-colors';

  return (
    <>
    <PageContainer maxWidth="2xl">

      <BotaoVoltar para={isVet ? '/animais-vet' : '/meus-animais'} className="mb-4" />

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
              <button type="button" onClick={() => { setPhotoPreview(null); setPhotoFile(null); }}
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
                          setFormProp({ nomeCompleto: '', email: '', telefone: '' });
                          setProprietarioExistente(null);
                        }
                      }}
                      onBlur={e => isVet && !isEditMode && buscarAnimalExistente(e.target.value)}
                      placeholder="Ex: Trovão, Mel, Rex..."
                      className={inputClass}
                    />
                    {buscandoAnimal && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Sexo <span className="text-red-500">*</span></label>
                  <select
                    value={formData.sexo}
                    onChange={e => setFormData({ ...formData, sexo: e.target.value })}
                    className={inputClass}
                  >
                    <option value="" disabled>Selecione o sexo</option>
                    <option value="Macho">Macho</option>
                    <option value="Fêmea">Fêmea</option>
                  </select>
                </div>
              </div>

              {/* Animal com vet de outra equipe — bloqueado */}
              {statusBuscaAnimal === 'com_vet' && (
                <div className="mt-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>{formData.nome}</strong> já está sob cuidados de outro veterinário no S2Vet.
                    O cadastro não pode ser realizado.
                  </span>
                </div>
              )}

              {/* Animal com vet da mesma equipe — informativo */}
              {statusBuscaAnimal === 'minha_equipe' && (
                <div className="mt-2 flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs text-emerald-700">
                  <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>{formData.nome}</strong> já está sob responsabilidade de um veterinário
                    da sua equipe. Nenhuma ação necessária.
                  </span>
                </div>
              )}

              {/* Animal sem vet — pode vincular */}
              {statusBuscaAnimal === 'sem_vet' && animalEncontrado && (
                <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>{formData.nome}</strong> já está cadastrado sem veterinário responsável.
                    Os dados do proprietário foram preenchidos automaticamente.{' '}
                    {pedirAutorizacao
                      ? 'Após salvar, um e-mail será enviado ao proprietário para autorizar o vínculo. O animal ficará bloqueado até a aprovação.'
                      : 'Após salvar, o vínculo será estabelecido imediatamente e o proprietário receberá um e-mail informativo.'}
                  </span>
                </div>
              )}

              {/* Animal não encontrado — novo cadastro */}
              {statusBuscaAnimal === 'nao_encontrado' && isVet && !isEditMode && (
                <p className="mt-1 text-xs text-emerald-600">
                  ✓ Animal não encontrado — será criado um novo cadastro.
                </p>
              )}
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
                    onBlur={() => setTimeout(() => setLocDropdownOpen(false), 200)}
                    placeholder={formData.especieId ? 'Buscar ou criar local...' : 'Selecione a espécie primeiro'}
                    disabled={!formData.especieId}
                    className={`${inputClass} pr-8 ${!formData.especieId ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}
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
                          setFormData(p => ({ ...p, localizacaoId: loc.id }));
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
                    {locBusca.trim() && filteredLocs.length === 0 && (
                      <button type="button"
                        onMouseDown={() => { setNovoLocalNome(locBusca); setCriandoLocal(true); setLocDropdownOpen(false); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-blue-600 text-sm flex items-center gap-2 border-t border-gray-100">
                        <Plus size={13} />
                        Criar "{locBusca}"
                      </button>
                    )}
                  </div>
                )}
              </div>
              {labelBaia && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    {labelBaia}
                  </label>
                  <input
                    type="text"
                    value={formData.baia}
                    onChange={e => setFormData({ ...formData, baia: e.target.value })}
                    placeholder={isEquino ? 'Ex: B-12' : 'Ex: L-03'}
                    className={inputClass}
                  />
                </div>
              )}
            </div>

            {/* ── 3. Espécie + Raça ─────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Espécie <span className="text-red-500">*</span></label>
                <select
                  value={formData.especieId}
                  onChange={e => setFormData({ ...formData, especieId: parseInt(e.target.value), racaId: null })}
                  className={inputClass}
                >
                  <option value={0} disabled>Selecione a espécie</option>
                  {especies.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Raça <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.racaId || ''}
                  onChange={e => setFormData({ ...formData, racaId: parseInt(e.target.value) })}
                  className={inputClass}
                >
                  <option value="">Selecione</option>
                  {racasFiltradas.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
                </select>
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
                  className={inputClass}
                />
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
                  className={`${inputClass} ${formData.dataNascimento ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}
                />
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
                        if (d > h) { toast.error('Data futura não permitida.'); return; }
                        setFormData({ ...formData, dataNascimento: e.target.value, idadeAnos: '' });
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
                <select
                  value={formData.pelagem}
                  onChange={e => setFormData(p => ({ ...p, pelagem: e.target.value }))}
                  className={inputClass}
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
              <select
                value=""
                onChange={e => {
                  const val = e.target.value;
                  if (val && !formData.finalidades.includes(val))
                    setFormData(p => ({ ...p, finalidades: [...p.finalidades, val] }));
                }}
                className={inputClass}
              >
                <option value="">Adicionar finalidade...</option>
                {FINALIDADES.filter(f => !formData.finalidades.includes(f)).map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
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
                    <select
                      value={formData.categoriaAnimal}
                      onChange={e => setFormData({ ...formData, categoriaAnimal: e.target.value, tipoExercicio: '' })}
                      disabled={!temIdadeOuData}
                      className={`${inputClass} ${!temIdadeOuData ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}
                    >
                      <option value="">Selecione a categoria</option>
                      {categoriasDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Tipo / Estágio <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.tipoExercicio}
                      onChange={e => setFormData({ ...formData, tipoExercicio: e.target.value })}
                      disabled={!formData.categoriaAnimal || tiposDisponiveis.length === 0}
                      className={`${inputClass} ${(!formData.categoriaAnimal || tiposDisponiveis.length === 0) ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}
                    >
                      <option value="">Selecione o tipo</option>
                      {tiposDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
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
                  placeholder="Buscar ou criar tratador…"
                  className={`${inputClass} pr-8`}
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
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 flex items-center justify-between text-sm border-b border-gray-50 last:border-0">
                      <span className="font-medium text-gray-800">{t.nome}</span>
                      {t.telefone && <span className="text-xs text-gray-400 ml-2 shrink-0">{t.telefone}</span>}
                    </button>
                  ))}
                  {filteredTrats.length === 0 && tratBusca.trim() && (
                    <p className="px-4 py-2 text-xs text-gray-400 italic">Nenhum resultado para "{tratBusca}"</p>
                  )}
                  {tratBusca.trim() && filteredTrats.length === 0 && (
                    <button type="button"
                      onMouseDown={() => abrirModalNovoTratador(tratBusca)}
                      className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-blue-600 text-sm flex items-center gap-2 border-t border-gray-100">
                      <Plus size={13} />
                      Criar "{tratBusca}"
                    </button>
                  )}
                </div>
              )}
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
                              setFormProp(p => ({ ...p, email: v, nomeCompleto: '', telefone: '' }));
                              setProprietarioExistente(null);
                            }
                          }}
                          onBlur={e => buscarProprietarioPorEmail(e.target.value)}
                          placeholder="email@exemplo.com"
                          disabled={isEditMode || statusBuscaAnimal === 'sem_vet'}
                          className={`${inputClass} ${(isEditMode || statusBuscaAnimal === 'sem_vet') ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
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
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Nome Completo {!isEditMode && <span className="text-red-500">*</span>}
                      </label>
                      <input
                        type="text"
                        value={formProp.nomeCompleto}
                        onChange={e => setFormProp(p => ({ ...p, nomeCompleto: e.target.value }))}
                        placeholder="Nome do proprietário"
                        disabled={isEditMode || statusBuscaAnimal === 'sem_vet' || proprietarioExistente === true}
                        className={`${inputClass} ${(isEditMode || statusBuscaAnimal === 'sem_vet' || proprietarioExistente === true) ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                      />
                    </div>
                  </div>
                  {/* Telefones */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Telefone 1</label>
                      <input
                        type="tel"
                        value={formProp.telefone}
                        onChange={e => setFormProp(p => ({ ...p, telefone: mascaraTelefone(e.target.value) }))}
                        placeholder="(00) 00000-0000"
                        disabled={isEditMode || statusBuscaAnimal === 'sem_vet' || proprietarioExistente === true}
                        className={`${inputClass} ${(isEditMode || statusBuscaAnimal === 'sem_vet' || proprietarioExistente === true) ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Telefone 2</label>
                      <input
                        type="tel"
                        value={formProp.telefone2}
                        onChange={e => setFormProp(p => ({ ...p, telefone2: mascaraTelefone(e.target.value) }))}
                        placeholder="(00) 00000-0000"
                        disabled={isEditMode || statusBuscaAnimal === 'sem_vet' || proprietarioExistente === true}
                        className={`${inputClass} ${(isEditMode || statusBuscaAnimal === 'sem_vet' || proprietarioExistente === true) ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                      />
                    </div>
                  </div>
                  {/* Checkbox "Pedir Autorização?" — apenas para novos vínculos */}
                  {!isEditMode && (statusBuscaAnimal === 'sem_vet' || statusBuscaAnimal === 'nao_encontrado') && (
                    <div className="border border-gray-200 rounded-2xl p-3 bg-gray-50 space-y-2">
                      <label className="flex items-start gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={pedirAutorizacao}
                          onChange={e => setPedirAutorizacao(e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300 accent-blue-600 mt-0.5 flex-shrink-0"
                        />
                        <div>
                          <span className="text-sm font-semibold text-gray-700">Solicitar autorização ao proprietário</span>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {pedirAutorizacao
                              ? 'O proprietário receberá um e-mail com os dados de acesso (se conta nova) e um link para autorizar o vínculo.'
                              : 'O vínculo será estabelecido imediatamente. O proprietário receberá um e-mail informativo (sem necessidade de aprovação).'}
                          </p>
                        </div>
                      </label>
                    </div>
                  )}

                  {!isEditMode && proprietarioExistente === true && (
                    <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs text-emerald-700">
                      <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />
                      <span>Proprietário encontrado. Dados preenchidos automaticamente.</span>
                    </div>
                  )}
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

            {/* ── 9. Veterinário (apenas proprietários) ────────────────────── */}
            {!isVet && (
              <div className="pt-2 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-700 mb-3">Veterinário Responsável</p>
                <div className="mb-3">
                  <label className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1">
                    <UserCheck size={14} className="text-emerald-600" />
                    Veterinário cadastrado no S2Vet
                  </label>
                  <select
                    value={formData.veterinarioUserId ?? ''}
                    onChange={e => setFormData(p => ({
                      ...p, veterinarioUserId: e.target.value ? Number(e.target.value) : null,
                    }))}
                    className={inputClass}
                  >
                    <option value="">Não cadastrado</option>
                    {vetsFiltrados.length === 0 && formData.especieId !== 0 && (
                      <option disabled value="">Nenhum veterinário atende esta espécie</option>
                    )}
                    {vetsFiltrados.map(v => (
                      <option key={v.vetUserId} value={v.vetUserId}>
                        {v.nome}{v.crmv ? ` — CRMV: ${v.crmv}` : ''}
                      </option>
                    ))}
                  </select>

                  {formData.veterinarioUserId && !isEditMode && (
                    <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                      <span>
                        Após salvar, uma <strong>solicitação de vínculo</strong> será enviada ao veterinário por e-mail.
                        O animal ficará vinculado somente após o aceite.
                      </span>
                    </div>
                  )}

                  {vetFoiAlterado && (
                    <div className="mt-2 flex items-start gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                      <RefreshCw size={13} className="flex-shrink-0 mt-0.5" />
                      <span>
                        O veterinário será alterado. Uma nova <strong>solicitação de vínculo</strong> será enviada
                        por e-mail ao veterinário selecionado. O vínculo atual será cancelado.
                      </span>
                    </div>
                  )}

                  {isEditMode && !vetFoiAlterado && vetStatusAtual === 'PENDENTE' && (
                    <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                      <span>
                        Este veterinário ainda não aceitou a solicitação de vínculo.
                        Um e-mail de aprovação já foi enviado.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Legenda campos obrigatórios */}
            <p className="text-xs text-gray-400">
              <span className="text-red-500">*</span> Campos obrigatórios
            </p>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting || statusBuscaAnimal === 'com_vet' || statusBuscaAnimal === 'minha_equipe'}
              className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3.5 rounded-2xl font-semibold text-base md:text-lg transition-colors"
            >
              {submitting
                ? (isEditMode ? 'Atualizando...' : 'Cadastrando...')
                : statusBuscaAnimal === 'minha_equipe'
                  ? 'Animal já com sua equipe'
                  : statusBuscaAnimal === 'com_vet'
                    ? 'Cadastro bloqueado — animal com outro vet'
                    : statusBuscaAnimal === 'sem_vet'
                      ? (pedirAutorizacao ? 'Solicitar autorização ao proprietário' : 'Vincular diretamente')
                      : isEditMode ? 'Atualizar Animal' : 'Salvar e Continuar'}
            </button>

          </form>
        </div>
    </PageContainer>

    {/* ── Mini-modal: criar localização inline ──────────────────────────── */}

    {criandoLocal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <MapPin size={16} className="text-emerald-600" />
            Novo Local
          </h3>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Nome <span className="text-red-500">*</span>
            </label>
            <input
              value={novoLocalNome}
              onChange={e => setNovoLocalNome(e.target.value)}
              className={inputClass}
              placeholder="Ex: Haras Bela Vista"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Tipo <span className="text-red-500">*</span>
            </label>
            <select
              value={novoLocalTipo}
              onChange={e => setNovoLocalTipo(e.target.value)}
              className={inputClass}
            >
              <option value="">Selecione o tipo</option>
              {tiposCompativeis.map(t => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => { setCriandoLocal(false); setNovoLocalNome(''); setNovoLocalTipo(''); }}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleCriarLocal}
              disabled={salvandoLocal || !novoLocalNome.trim() || !novoLocalTipo}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {salvandoLocal ? 'Salvando...' : 'Criar local'}
            </button>
          </div>
        </div>
      </div>
    )}

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

          <div className="relative">
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Local de Trabalho <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={novoTratLocBusca}
                onChange={e => {
                  setNovoTratLocBusca(e.target.value);
                  setNovoTratLocOpen(true);
                  if (novoTratLocId) setNovoTratLocId(null);
                }}
                onFocus={() => setNovoTratLocOpen(true)}
                onBlur={() => setTimeout(() => setNovoTratLocOpen(false), 200)}
                placeholder="Buscar localização…"
                className={`${inputClass} pr-8`}
                autoComplete="off"
              />
              {novoTratLocId
                ? <CheckCircle2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
                : novoTratLocBusca && (
                  <button type="button"
                    onMouseDown={() => { setNovoTratLocBusca(''); setNovoTratLocId(null); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-400">
                    <X size={14} />
                  </button>
                )
              }
            </div>
            {novoTratLocOpen && (
              <div className="absolute z-20 w-full bg-white border border-gray-200 shadow-xl rounded-xl mt-1 max-h-44 overflow-y-auto">
                {localizacoes
                  .filter(l => !novoTratLocBusca.trim() || l.nome.toLowerCase().includes(novoTratLocBusca.toLowerCase()))
                  .map(loc => (
                    <button key={loc.id} type="button"
                      onMouseDown={() => { setNovoTratLocId(loc.id); setNovoTratLocBusca(loc.nome); setNovoTratLocOpen(false); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 text-sm border-b border-gray-50 last:border-0">
                      <span className="font-medium text-gray-800">{loc.nome}</span>
                    </button>
                  ))}
                {novoTratLocBusca.trim() && localizacoes.filter(l => l.nome.toLowerCase().includes(novoTratLocBusca.toLowerCase())).length === 0 && (
                  <p className="px-4 py-2 text-xs text-gray-400 italic">Nenhum resultado para "{novoTratLocBusca}"</p>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setModalNovoTrat(false)}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
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
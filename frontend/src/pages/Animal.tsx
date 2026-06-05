// src/pages/Animal.tsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Calendar, Camera, UserCheck, AlertCircle, RefreshCw, MapPin, CheckCircle2 } from 'lucide-react';
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
  nome:              string;
  especieId:         number;
  racaId:            number | null;
  peso:              string;
  dataNascimento:    string;
  idadeAnos:         string;
  sexo:              string;
  categoriaAnimal:   string;
  tipoExercicio:     string;
  veterinarioUserId: number | null;
  local:             string;
  baia:              string;
}

interface FormProprietario {
  nomeCompleto: string;
  email:        string;
  telefone:     string;
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

// ─── Componente principal ─────────────────────────────────────────────────────
const Animal = () => {
  const { refreshSelectedAnimal } = useSelectedAnimal();
  const { user }                  = useAuth();
  const navigate                  = useNavigate();
  const { id }                    = useParams<{ id: string }>();
  const isEditMode                = !!id;

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

  // ── Busca por nome (vet, novo cadastro) ────────────────────────────────────
  const [buscandoAnimal,    setBuscandoAnimal]    = useState(false);
  const [animalEncontrado,  setAnimalEncontrado]  = useState<AnimalEncontrado | null>(null);
  const [statusBuscaAnimal, setStatusBuscaAnimal] = useState<StatusBusca>('idle');

  // ── Busca proprietário por email ───────────────────────────────────────────
  const [buscandoProprietario,   setBuscandoProprietario]   = useState(false);
  const [proprietarioExistente,  setProprietarioExistente]  = useState<boolean | null>(null);

  // ── Formulário ─────────────────────────────────────────────────────────────
  const [formData, setFormData] = useState<FormData>({
    nome: '', especieId: 0, racaId: null, peso: '',
    dataNascimento: '', idadeAnos: '', sexo: '',
    categoriaAnimal: '', tipoExercicio: '',
    veterinarioUserId: null,
    local: '', baia: '',
  });

  const [formProp, setFormProp] = useState<FormProprietario>({
    nomeCompleto: '', email: '', telefone: '',
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

  const vetFoiAlterado = isEditMode
    && formData.veterinarioUserId !== null
    && formData.veterinarioUserId !== vetOriginalId;

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

        // Filtrar espécies pelo perfil do vet logado
        if (isVet) {
          try {
            const meRes = await fetch('/api/users/me', {
              headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            });
            if (meRes.ok) {
              const meData = await meRes.json();
              const especiesDoVet: number[] = meData.especiesAtendidas ?? [];
              setEspecies(
                especiesDoVet.length > 0
                  ? todasEspecies.filter(e => especiesDoVet.includes(e.id))
                  : todasEspecies
              );
            } else {
              setEspecies(todasEspecies);
            }
          } catch {
            setEspecies(todasEspecies);
          }
        } else {
          setEspecies(todasEspecies);
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
            local:             a.local            ?? '',
            baia:              a.baia             ?? '',
          });
          if (a.photoUrl) setPhotoPreview(a.photoUrl);
          if (a.user) {
            setFormProp({
              nomeCompleto: a.user.fullName ?? '',
              email:        a.user.email   ?? '',
              telefone:     a.user.phone   ?? '',
            });
          }
        }
      } catch (err) {
        console.error(err);
        toast.error('Erro ao carregar dados');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isEditMode, isVet]);

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
              telefone:     animal.proprietario.phone    ?? '',
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
          telefone:     res.data.phone    ?? '',
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

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (statusBuscaAnimal === 'com_vet' || statusBuscaAnimal === 'minha_equipe') {
      toast.error(`${formData.nome} já está sob cuidados de um veterinário`);
      return;
    }

    setSubmitting(true);

    if (!formData.nome?.trim())  { toast.error('Nome do animal é obrigatório'); setSubmitting(false); return; }
    if (!formData.especieId)     { toast.error('Espécie é obrigatória'); setSubmitting(false); return; }
    if (!formData.sexo)          { toast.error('Sexo é obrigatório'); setSubmitting(false); return; }
    if (!formData.local?.trim()) { toast.error('Local do animal é obrigatório'); setSubmitting(false); return; }
    if (!formData.racaId)        { toast.error('Raça é obrigatória'); setSubmitting(false); return; }
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
        local:              formData.local.trim(),
        baia:               formData.baia.trim() || null,
        // Vet vinculando animal existente sem vet
        ...(animalEncontrado && statusBuscaAnimal === 'sem_vet' && {
          animalExistenteId: animalEncontrado.id,
        }),
        // Vet criando animal novo → envia dados do proprietário
        ...(isVet && !isEditMode && statusBuscaAnimal === 'nao_encontrado' && {
          proprietario: {
            fullName: formProp.nomeCompleto.trim(),
            email:    formProp.email.trim(),
            phone:    formProp.telefone.trim() || null,
          },
        }),
      };

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
            phone:    formProp.telefone.trim() || null,
          }));
        }
        fd.append('foto', photoFile);
        const cfg = { headers: { 'Content-Type': 'multipart/form-data' } };

        if (isEditMode) {
          await api.put(`/animais/${id}`, fd, cfg);
        } else {
          await api.post('/animais', fd, cfg);
        }
      } else {
        if (isEditMode) {
          await api.put(`/animais/${id}`, payload);
        } else {
          await api.post('/animais', payload);
        }
      }

      // Mensagem de sucesso contextual
      const msgSucesso = statusBuscaAnimal === 'sem_vet'
        ? 'Solicitação enviada! O proprietário receberá um e-mail para autorizar o vínculo.'
        : isEditMode ? 'Animal atualizado com sucesso!' : 'Animal cadastrado com sucesso!';

      toast.success(msgSucesso);
      await refreshSelectedAnimal();

      if (!isEditMode && localStorage.getItem('s2vet_ob') === 'a') {
        localStorage.setItem('s2vet_ob', 'd');
        navigate('/');
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
  if (loading) return (
    <PageContainer maxWidth="2xl">
      <div className="flex items-center justify-center py-20 text-gray-500">
        Carregando...
      </div>
    </PageContainer>
  );

  const inputClass = 'w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition-colors';

  return (
    <PageContainer maxWidth="2xl">

      <BotaoVoltar para={isVet ? '/animais-vet' : '/meus-animais'} className="mb-4" />

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

            {/* ── 1. Nome do animal ─────────────────────────────────────────── */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
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
                    Os dados do proprietário foram preenchidos automaticamente.
                    Após salvar, um e-mail será enviado ao proprietário para autorizar o vínculo.
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

            {/* ── 2. Local + Espécie ───────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="flex items-center gap-1">
                    <MapPin size={14} className="text-emerald-600" />
                    Local do Animal <span className="text-red-500">*</span>
                  </span>
                </label>
                <input
                  type="text"
                  value={formData.local}
                  onChange={e => setFormData({ ...formData, local: e.target.value })}
                  placeholder="Ex: Fazenda Santa Clara, Haras Bela Vista..."
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Espécie <span className="text-red-500">*</span></label>
                <select
                  value={formData.especieId}
                  onChange={e => setFormData({ ...formData, especieId: parseInt(e.target.value), racaId: null })}
                  className={inputClass}
                >
                  <option value={0} disabled>Selecione a espécie</option>
                  {especies.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
            </div>

            {/* ── 3. Proprietário (apenas vets) ────────────────────────────── */}
            {isVet && (
              <div className="pb-4 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-700 mb-3">Proprietário</p>
                <div className="space-y-3">
                  {/* E-mail primeiro — lookup automático ao sair do campo */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
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
                  {/* Nome e telefone — preenchidos automaticamente se usuário existir */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
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
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                      <input
                        type="tel"
                        value={formProp.telefone}
                        onChange={e => setFormProp(p => ({ ...p, telefone: e.target.value }))}
                        placeholder="(00) 00000-0000"
                        disabled={isEditMode || statusBuscaAnimal === 'sem_vet' || proprietarioExistente === true}
                        className={`${inputClass} ${(isEditMode || statusBuscaAnimal === 'sem_vet' || proprietarioExistente === true) ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                      />
                    </div>
                  </div>
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
                  {!isEditMode && statusBuscaAnimal === 'idle' && (
                    <div className="flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-500">
                      <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                      <span>Digite o nome do animal acima para verificar se já está cadastrado.</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── 4. Baia/Leito + Sexo ─────────────────────────────────────── */}
            <div className={labelBaia ? 'grid grid-cols-2 gap-4' : ''}>
              {labelBaia && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sexo <span className="text-red-500">*</span></label>
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

            {/* ── 5. Raça + Peso ────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Peso (kg) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number" step="0.1" min="0.1" placeholder="Ex: 450"
                  value={formData.peso}
                  onChange={e => setFormData({ ...formData, peso: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>

            {/* ── 6. Idade + Data ───────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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

            {/* ── 7. NRC — equinos ──────────────────────────────────────────── */}
            {isEquino && (
              <>
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-sm font-semibold text-gray-600 mb-1">Perfil NRC</p>
                  {!temIdadeOuData && <p className="text-xs text-amber-600">Informe a idade ou data para ver as categorias.</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
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
                {formData.categoriaAnimal && tiposDisponiveis.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tipo / Estágio <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.tipoExercicio}
                      onChange={e => setFormData({ ...formData, tipoExercicio: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">Selecione o tipo</option>
                      {tiposDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* ── 8. Veterinário (apenas proprietários) ────────────────────── */}
            {!isVet && (
              <div className="pt-2 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-600 mb-3">Veterinário Responsável</p>
                <div className="mb-3">
                  <label className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
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
                      ? 'Solicitar autorização ao proprietário'
                      : isEditMode ? 'Atualizar Animal' : 'Salvar e Continuar'}
            </button>

          </form>
        </div>
    </PageContainer>
  );
};

export default Animal;
// src/pages/Animal.tsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { ArrowLeft, Calendar, Camera, UserCheck, AlertCircle, RefreshCw } from 'lucide-react';

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
  nome: string; especieId: number; racaId: number | null; peso: string;
  dataNascimento: string; idadeAnos: string; sexo: string;
  categoriaAnimal: string; tipoExercicio: string;
  veterinarioUserId: number | null;
}

interface FormProprietario {
  nomeCompleto: string;
  email:        string;
  telefone:     string;
}

interface Vet {
  vetUserId: number; nome: string; crmv: string | null;
  email: string; especies: { id: number; nome: string }[];
}

// Solicitação retornada pelo ANIMAL_INCLUDE (inclui ACEITO e PENDENTE)
interface Solicitacao {
  status:    string;
  vetUserId: number;
  veterinario?: { id: number; fullName: string; email: string } | null;
}

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

  const role          = (user?.role ?? user?.userType ?? '').toUpperCase();
  const userTypeUpper = (user?.userType ?? '').toUpperCase();
  const isVet         = role === 'VETERINARIO' || userTypeUpper === 'VETERINARIO';

  const [loading,        setLoading]        = useState(true);
  const [submitting,     setSubmitting]     = useState(false);
  const [photoPreview,   setPhotoPreview]   = useState<string | null>(null);
  const [photoFile,      setPhotoFile]      = useState<File | null>(null);
  const [especies,       setEspecies]       = useState<{ id: number; nome: string }[]>([]);
  const [todasRacas,     setTodasRacas]     = useState<{ id: number; nome: string; especieId: number }[]>([]);
  const [racasFiltradas, setRacasFiltradas] = useState<{ id: number; nome: string }[]>([]);
  const [vets,           setVets]           = useState<Vet[]>([]);
  const [vetsFiltrados,  setVetsFiltrados]  = useState<Vet[]>([]);

  // Vet original carregado no edit mode — detecta se houve mudança
  const [vetOriginalId, setVetOriginalId] = useState<number | null>(null);
  // Status da solicitação carregada (PENDENTE ou ACEITO) — exibe badge correto
  const [vetStatusAtual, setVetStatusAtual] = useState<string | null>(null);

  // Formulário principal
  const [formData, setFormData] = useState<FormData>({
    nome: '', especieId: 0, racaId: null, peso: '',
    dataNascimento: '', idadeAnos: '', sexo: '',
    categoriaAnimal: '', tipoExercicio: '',
    veterinarioUserId: null,
  });

  // Formulário do proprietário (apenas para vets)
  const [formProp, setFormProp] = useState<FormProprietario>({
    nomeCompleto: '', email: '', telefone: '',
  });

  // ─── Computados ─────────────────────────────────────────────────────────────
  const especieAtual = especies.find(e => e.id === formData.especieId);
  const isEquino     = !!especieAtual && (
    especieAtual.nome.toLowerCase().includes('equino') ||
    especieAtual.nome.toLowerCase().includes('cavalo')
  );

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

  // Detecta se o vet foi alterado no edit mode (para exibir aviso)
  const vetFoiAlterado = isEditMode
    && formData.veterinarioUserId !== null
    && formData.veterinarioUserId !== vetOriginalId;

  // ─── Efeitos de limpeza ──────────────────────────────────────────────────────
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

  // ─── Carregamento inicial ─────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const [espRes, racRes] = await Promise.all([
          api.get('/especies'),
          api.get('/racas'),
        ]);
        const vetRes       = await api.get('/veterinarios').catch(() => ({ data: { dados: [] } }));
        const especiesData = espRes.data?.dados ?? espRes.data ?? [];
        const racasData    = racRes.data?.dados  ?? racRes.data  ?? [];
        const vetsData     = vetRes.data?.dados  ?? [];

        setEspecies(especiesData);
        setTodasRacas(racasData);
        setVets(vetsData);
        setVetsFiltrados(vetsData);

        if (isEditMode && id) {
          const animalRes = await api.get(`/animais/${id}`);
          const a = animalRes.data?.dados ?? animalRes.data;

          // ANIMAL_INCLUDE agora retorna ACEITO e PENDENTE — usar diretamente
          // sem a segunda chamada separada a /veterinarios/solicitacoes
          const solicitacoes: Solicitacao[] = a.solicitacoes ?? [];
          const solAceita   = solicitacoes.find(s => s.status === 'ACEITO');
          const solPendente = solicitacoes.find(s => s.status === 'PENDENTE');
          const solAtual    = solAceita ?? solPendente ?? null;

          const vetCarregadoId = solAtual?.vetUserId ?? null;

          setVetOriginalId(vetCarregadoId);
          setVetStatusAtual(solAtual?.status ?? null);

          setFormData({
            nome:            a.nome            ?? '',
            especieId:       a.especieId        ?? 0,
            racaId:          a.racaId           ?? null,
            peso:            a.peso?.toString() ?? '',
            dataNascimento:  a.dataNascimento   ? a.dataNascimento.split('T')[0] : '',
            idadeAnos:       a.idadeAnos        ? String(a.idadeAnos) : '',
            sexo:            a.sexo             ?? '',
            categoriaAnimal: a.categoriaAnimal  ?? '',
            tipoExercicio:   a.tipoExercicio    ?? '',
            veterinarioUserId: vetCarregadoId,
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
  }, [id, isEditMode]);

  // ─── Handlers ────────────────────────────────────────────────────────────────
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
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

  // ─── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    // Validações do animal
    if (!formData.nome?.trim())                           { toast.error('Nome do animal é obrigatório'); setSubmitting(false); return; }
    if (!formData.racaId)                                 { toast.error('Raça é obrigatória');           setSubmitting(false); return; }
    if (!formData.dataNascimento && !formData.idadeAnos)  { toast.error('Informe a data de nascimento ou a idade'); setSubmitting(false); return; }
    if (formData.peso && Number(formData.peso) <= 0)      { toast.error('O peso deve ser positivo'); setSubmitting(false); return; }
    if (formData.idadeAnos && Number(formData.idadeAnos) <= 0) { toast.error('A idade deve ser positiva'); setSubmitting(false); return; }
    if (isEquino && (!formData.categoriaAnimal || !formData.tipoExercicio)) {
      toast.error('Categoria e tipo são obrigatórios para equinos'); setSubmitting(false); return;
    }

    // Validações do proprietário (apenas vet, novo cadastro)
    if (isVet && !isEditMode) {
      if (!formProp.nomeCompleto.trim()) { toast.error('Nome do proprietário é obrigatório'); setSubmitting(false); return; }
      if (!formProp.email.trim())        { toast.error('E-mail do proprietário é obrigatório'); setSubmitting(false); return; }
    }

    try {
      const vetSelecionado = formData.veterinarioUserId
        ? vets.find(v => v.vetUserId === formData.veterinarioUserId)
        : null;

      // ── Payload base ────────────────────────────────────────────────────────
      // veterinarioUserId é enviado sempre — backend detecta mudança internamente
      // e cria a solicitação PENDENTE + dispara email quando necessário
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
        // ↓ CAMPO CRÍTICO: enviado em criação E edição — backend processa a mudança
        veterinarioUserId:  formData.veterinarioUserId ?? null,
        // Vet envia dados do proprietário apenas na criação
        ...(isVet && !isEditMode && {
          proprietario: {
            fullName: formProp.nomeCompleto.trim(),
            email:    formProp.email.trim(),
            phone:    formProp.telefone.trim() || null,
          },
        }),
      };

      let animalId: number;

      // ── Com foto (multipart) ─────────────────────────────────────────────
      if (photoFile) {
        const fd = new FormData();

        // Campos primitivos
        Object.entries(payload).forEach(([k, v]) => {
          if (v != null && typeof v !== 'object') fd.append(k, String(v));
        });

        // veterinarioUserId — garantir que vai mesmo sendo número
        if (formData.veterinarioUserId != null) {
          fd.append('veterinarioUserId', String(formData.veterinarioUserId));
        }

        // Proprietário como JSON separado (multipart não aceita objetos aninhados)
        if (isVet && !isEditMode) {
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
          animalId = Number(id);
        } else {
          const r  = await api.post('/animais', fd, cfg);
          animalId = r.data.dados.id;
        }

      // ── Sem foto (JSON) ──────────────────────────────────────────────────
      } else {
        if (isEditMode) {
          await api.put(`/animais/${id}`, payload);
          animalId = Number(id);
        } else {
          const r  = await api.post('/animais', payload);
          animalId = r.data.dados.id;
        }
      }

      // Vet criando animal novo → vínculo direto ACEITO (backend também faz, mas
      // mantemos como upsert de segurança para garantir o registro imediato)
      if (isVet && !isEditMode && animalId) {
        await api.post('/animais/vincular-vet', {
          animalId,
          vetUserId: user?.id,
        }).catch(err => console.warn('[vincularVet]', err));
      }

      // Nota: a solicitação de vínculo (PENDENTE + email) é criada pelo BACKEND
      // dentro de criar() e atualizar() — não é mais responsabilidade do frontend.

      toast.success(isEditMode ? 'Animal atualizado com sucesso!' : 'Animal cadastrado com sucesso!');
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

  // ─── Render ───────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-500">Carregando...</p>
      </div>
    </div>
  );

  const inputClass = 'w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition-colors';

  return (
    <div className="min-h-screen bg-gray-50 p-3 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white shadow-2xl rounded-3xl p-4 md:p-8 border border-gray-100">

          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => navigate(isVet ? '/animais-vet' : '/meus-animais')}
              className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium">
              <ArrowLeft size={20} />
              <span className="text-base md:text-lg">Voltar</span>
            </button>
          </div>

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

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* ── Seção: Proprietário (apenas vets) ─────────────────────────── */}
            {isVet && (
              <div className="pb-4 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-700 mb-3">Proprietário</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nome Completo {!isEditMode && <span className="text-red-500">*</span>}
                    </label>
                    <input type="text" value={formProp.nomeCompleto}
                      onChange={e => setFormProp(p => ({ ...p, nomeCompleto: e.target.value }))}
                      placeholder="Nome do proprietário"
                      disabled={isEditMode}
                      className={`${inputClass} ${isEditMode ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                      <input type="tel" value={formProp.telefone}
                        onChange={e => setFormProp(p => ({ ...p, telefone: e.target.value }))}
                        placeholder="(00) 00000-0000"
                        disabled={isEditMode}
                        className={`${inputClass} ${isEditMode ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        E-mail {!isEditMode && <span className="text-red-500">*</span>}
                      </label>
                      <input type="email" value={formProp.email}
                        onChange={e => setFormProp(p => ({ ...p, email: e.target.value }))}
                        placeholder="email@exemplo.com"
                        disabled={isEditMode}
                        className={`${inputClass} ${isEditMode ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`} />
                    </div>
                  </div>
                  {!isEditMode && (
                    <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-xs text-blue-700">
                      <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                      <span>Senha inicial: <strong>Inicial#001</strong>. Se o e-mail já estiver cadastrado, o animal será vinculado ao usuário existente.</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Nome */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nome do animal <span className="text-red-500">*</span>
              </label>
              <input type="text" value={formData.nome}
                onChange={e => setFormData({ ...formData, nome: e.target.value })}
                placeholder="Ex: Trovão, Mel, Rex..."
                className={inputClass} />
            </div>

            {/* Espécie + Sexo */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Espécie</label>
                <select value={formData.especieId}
                  onChange={e => setFormData({ ...formData, especieId: parseInt(e.target.value), racaId: null })}
                  className={inputClass}>
                  <option value={0} disabled>Selecione a espécie</option>
                  {especies.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
                <select value={formData.sexo}
                  onChange={e => setFormData({ ...formData, sexo: e.target.value })}
                  className={inputClass}>
                  <option value="" disabled>Selecione o sexo</option>
                  <option value="Macho">Macho</option>
                  <option value="Fêmea">Fêmea</option>
                </select>
              </div>
            </div>

            {/* Raça + Peso */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Raça <span className="text-red-500">*</span>
                </label>
                <select value={formData.racaId || ''}
                  onChange={e => setFormData({ ...formData, racaId: parseInt(e.target.value) })}
                  className={inputClass}>
                  <option value="">Selecione</option>
                  {racasFiltradas.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Peso (kg) <span className="text-red-500">*</span>
                </label>
                <input type="number" step="0.1" min="0.1" placeholder="Ex: 450" value={formData.peso}
                  onChange={e => setFormData({ ...formData, peso: e.target.value })}
                  className={inputClass} />
              </div>
            </div>

            {/* Idade + Data */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Idade (anos){!temIdadeOuData && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input type="number" min="1" step="1" placeholder="Ex: 5" value={formData.idadeAnos}
                  disabled={!!formData.dataNascimento}
                  onChange={e => setFormData({ ...formData, idadeAnos: e.target.value })}
                  className={`${inputClass} ${formData.dataNascimento ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`} />
                {formData.dataNascimento && <p className="text-xs text-gray-400 mt-1">Calculada pela data</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Data de nascimento{!temIdadeOuData && <span className="text-red-500 ml-1">*</span>}
                </label>
                <div className="relative">
                  <input type="text" placeholder="dd/mm/aaaa" autoComplete="off"
                    value={formData.dataNascimento ? formData.dataNascimento.split('-').reverse().join('/') : ''}
                    onChange={handleDateTextChange}
                    className={`${inputClass} pr-10`} />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center">
                    <Calendar size={18} className="text-emerald-600 pointer-events-none" />
                    <input type="date" max={new Date().toISOString().split('T')[0]}
                      value={formData.dataNascimento?.includes('-') ? formData.dataNascimento : ''}
                      onChange={e => {
                        if (!e.target.value) return;
                        const d = new Date(e.target.value + 'T00:00');
                        const h = new Date(); h.setHours(0, 0, 0, 0);
                        if (d > h) { toast.error('Data futura não permitida.'); return; }
                        setFormData({ ...formData, dataNascimento: e.target.value, idadeAnos: '' });
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
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

            {/* NRC — equinos */}
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
                  <select value={formData.categoriaAnimal}
                    onChange={e => setFormData({ ...formData, categoriaAnimal: e.target.value, tipoExercicio: '' })}
                    disabled={!temIdadeOuData}
                    className={`${inputClass} ${!temIdadeOuData ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}>
                    <option value="">Selecione a categoria</option>
                    {categoriasDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                {formData.categoriaAnimal && tiposDisponiveis.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tipo / Estágio <span className="text-red-500">*</span>
                    </label>
                    <select value={formData.tipoExercicio}
                      onChange={e => setFormData({ ...formData, tipoExercicio: e.target.value })}
                      className={inputClass}>
                      <option value="">Selecione o tipo</option>
                      {tiposDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* Veterinário — apenas para proprietários (não vets) */}
            {!isVet && (
              <div className="pt-2 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-600 mb-3">Veterinário Responsável</p>
                <div className="mb-3">
                  <label className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                    <UserCheck size={14} className="text-emerald-600" />
                    Veterinário cadastrado no S2Vet
                  </label>
                  <select value={formData.veterinarioUserId ?? ''}
                    onChange={e => setFormData(p => ({
                      ...p, veterinarioUserId: e.target.value ? Number(e.target.value) : null,
                    }))}
                    className={inputClass}>
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

                  {/* Aviso: novo cadastro — solicitação será enviada */}
                  {formData.veterinarioUserId && !isEditMode && (
                    <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                      <span>
                        Após salvar, uma <strong>solicitação de vínculo</strong> será enviada ao veterinário por e-mail.
                        O animal ficará vinculado somente após o aceite.
                      </span>
                    </div>
                  )}

                  {/* Aviso: edição — vet foi trocado */}
                  {vetFoiAlterado && (
                    <div className="mt-2 flex items-start gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                      <RefreshCw size={13} className="flex-shrink-0 mt-0.5" />
                      <span>
                        O veterinário será alterado. Uma nova <strong>solicitação de vínculo</strong> será enviada
                        por e-mail ao veterinário selecionado. O vínculo atual será cancelado.
                      </span>
                    </div>
                  )}

                  {/* Info: vet com solicitação PENDENTE carregada */}
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

            {/* Submit */}
            <button type="submit" disabled={submitting}
              className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3.5 rounded-2xl font-semibold text-base md:text-lg transition-colors">
              {submitting
                ? (isEditMode ? 'Atualizando...' : 'Cadastrando...')
                : (isEditMode ? 'Atualizar Animal'  : 'Salvar e Continuar')}
            </button>

          </form>
        </div>  
      </div>
    </div>
  );
};

export default Animal;
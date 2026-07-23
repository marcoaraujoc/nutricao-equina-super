// src/pages/CadastroPessoal.tsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import EspecialidadeSelector from '../components/EspecialidadeSelector';
import { CheckCircle2, XCircle, Loader2, Info, User } from 'lucide-react';
import InlineError from '../components/InlineError';

type CrmvStatus = 'idle' | 'checking' | 'valido' | 'invalido' | 'indice_vazio' | 'erro';

const CRMV_REGEX = /^\d{1,6}\/(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i;

const mascaraTelefone = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2)  return `(${d}`;
  if (d.length <= 6)  return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
};

const mascaraCEP = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0,5)}-${d.slice(5)}`;
};

// Dias da semana (0=Dom … 6=Sáb) — convenção de Date.getDay()
const DIAS_SEMANA_ATEND = [
  { v: 0, l: 'Dom' }, { v: 1, l: 'Seg' }, { v: 2, l: 'Ter' }, { v: 3, l: 'Qua' },
  { v: 4, l: 'Qui' }, { v: 5, l: 'Sex' }, { v: 6, l: 'Sáb' },
];

const LABEL_TIPO_USUARIO: Record<string, string> = {
  PROPRIETARIO: 'Proprietário(a)',
  VETERINARIO:  'Médico(a) Veterinário(a)',
  ESTAGIARIO:   'Estagiário(a)',
  FORNECEDOR:   'Fornecedor(a)',
  ADMIN:        'Administrador(a)',
};

// ── Label com asterisco de obrigatório ────────────────────────────────────────
function Label({ text, required, optional }: { text: string; required?: boolean; optional?: boolean }) {
  return (
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {text}
      {required && <span className="text-red-500 ml-0.5">*</span>}
      {optional && <span className="text-gray-400 text-xs font-normal ml-1">(opcional)</span>}
    </label>
  );
}

export default function CadastroPessoal() {
  const { user, refreshUser }      = useAuth();
  const { refreshSelectedAnimal }  = useSelectedAnimal();
  const navigate                   = useNavigate();
  const { loading: loadingPerms }  = usePermissoes();
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [crmvStatus,  setCrmvStatus]  = useState<CrmvStatus>('idle');
  const fromConvite = localStorage.getItem('s2vet_ob') === 'convite';
  const crmvTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [especies,        setEspecies]        = useState<{ id: number; nome: string }[]>([]);
  const [especiesLoaded,  setEspeciesLoaded]  = useState(false);
  const [especiesErro,    setEspeciesErro]    = useState(false);
  // Verdadeiro quando o usuário entrou via convite — espécies são herdadas e ficam bloqueadas
  const [isConvidadoFlag, setIsConvidadoFlag] = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Cargo na equipe (ex: GESTOR) — definido quando foi incluído como membro
  const [cargoEquipe,     setCargoEquipe]     = useState<string | null>(null);
  // Membro de alguma equipe → habilita o expediente de atendimento
  const [temEquipe,       setTemEquipe]       = useState(false);

  // Gestor: sem dados profissionais (CRMV/espécies/subespecialidade) e tipo travado
  const isGestorEquipe = cargoEquipe === 'GESTOR';

  const carregarEspecies = () => {
    setEspeciesErro(false);
    setEspeciesLoaded(false);
    api.get('/especialidades/especies')
      .then(res => {
        const lista = res.data?.dados ?? res.data ?? [];
        setEspecies(Array.isArray(lista) ? lista : []);
      })
      .catch(() => setEspeciesErro(true))
      .finally(() => setEspeciesLoaded(true));
  };

  useEffect(() => { carregarEspecies(); }, []);

  // Espécies que a empresa atende — quando o membro foi convidado (cadastro de equipe
  // primeiro), as especialidades ficam restritas ao que a empresa atende.
  const [especiesEmpresa, setEspeciesEmpresa] = useState<number[]>([]);
  useEffect(() => {
    if (loadingPerms) return;
    api.get('/equipes/especies-atendidas')
      .then(res => {
        const lista = res.data?.dados?.especiesAtendidas ?? [];
        setEspeciesEmpresa(Array.isArray(lista) ? lista : []);
      })
      .catch(() => setEspeciesEmpresa([]));
  }, [loadingPerms]);

  const [form, setForm] = useState({
    nomeCompleto:      '',
    telefone:          '',
    email:             '',
    cep:               '',
    endereco:          '',
    complemento:       '',
    bairro:            '',
    cidade:            '',
    estado:            '',
    tipoUsuario:       'VETERINARIO',
    crmv:              '',
    especiesAtendidas: [] as number[],
    subespecialidades: [] as string[],
    especialidadeIds:  [] as number[],
    diasAtendimento:   [] as number[],   // 0=Dom … 6=Sáb
    horaInicioAtend:   '',               // HH:MM
    horaFimAtend:      '',               // HH:MM
  });

  // Filtro de especialidades: convidado → espécies da empresa; cadastro direto →
  // as espécies que o próprio veterinário atende. Vazio = mostra todas.
  // (Depois do useState do form — referenciar `form` antes da declaração causava
  // "Cannot access 'form' before initialization".)
  const especiesFiltroEspecialidade = (isConvidadoFlag || temEquipe) && especiesEmpresa.length > 0
    ? especiesEmpresa
    : form.especiesAtendidas;

  useEffect(() => {
    if (loadingPerms) return;
    const loadUserData = async () => {
      if (!user?.email) { setLoading(false); return; }
      try {
        // Sessão por cookie HttpOnly — o cookie é enviado automaticamente
        const res = await fetch('/api/users/me', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setForm({
            nomeCompleto:      data.fullName          || '',
            telefone:          data.phone             || '',
            email:             data.email             || '',
            cep:               data.cep               || '',
            endereco:          data.endereco          || '',
            complemento:       data.complemento       || '',
            bairro:            data.bairro            || '',
            cidade:            data.cidade            || '',
            estado:            data.estado            || '',
            tipoUsuario:       data.userType          || 'VETERINARIO',
            crmv:              data.crmv              || '',
            especiesAtendidas: data.especiesAtendidas || [],
            subespecialidades: data.subespecialidades || [],
            especialidadeIds:  data.especialidadeIds  || [],
            // Expediente de atendimento — preenche com o que já existe no banco
            diasAtendimento:   data.diasTrabalho
              ? String(data.diasTrabalho).split(',').map(Number).filter((n: number) => n >= 0 && n <= 6)
              : [],
            horaInicioAtend:   data.horaInicioTrabalho || '',
            horaFimAtend:      data.horaFimTrabalho    || '',
          });
          if (data.isConvidado) setIsConvidadoFlag(true);
          setCargoEquipe(data.cargoEquipe ?? null);
          setTemEquipe(!!data.temEquipe);
        }
      } catch (err) {
        console.error('Erro ao carregar dados do usuário:', err);
      } finally {
        setLoading(false);
      }
    };
    loadUserData();
  }, [user?.email, loadingPerms]);

  const buscarCep = async (cep: string) => {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    try {
      const res  = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const data = await res.json();
      if (data.erro) { setErroInline('CEP não encontrado'); return; }
      setForm(prev => ({
        ...prev,
        endereco: data.logradouro || '',
        bairro:   data.bairro     || '',
        cidade:   data.localidade || '',
        estado:   data.uf         || '',
      }));
    } catch {
      setErroInline('Erro ao buscar CEP. Verifique sua conexão.');
    }
  };

  const maskCRMV = (value: string): string => {
    const digitos = value.replace(/\D/g, '').slice(0, 6);
    const letras  = value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2);
    if (!digitos) return '';
    if (!letras)  return digitos;
    return `${digitos}/${letras}`;
  };

  const verificarCRMV = (crmv: string) => {
    if (crmvTimerRef.current) clearTimeout(crmvTimerRef.current);
    if (!CRMV_REGEX.test(crmv.trim())) { setCrmvStatus('idle'); return; }

    setCrmvStatus('checking');
    crmvTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.get('/crmv/validar', { params: { crmv: crmv.trim() } });
        const { valido, motivo } = res.data.dados ?? {};
        if (valido === true)  setCrmvStatus('valido');
        else if (valido === false && motivo === 'nao_encontrado') setCrmvStatus('invalido');
        else if (motivo === 'indice_vazio') setCrmvStatus('indice_vazio');
        else setCrmvStatus('erro');
      } catch {
        setCrmvStatus('erro');
      }
    }, 600);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (name === 'tipoUsuario') setCrmvStatus('idle');
  };

  const toggleEspecie = (id: number) => {
    setForm(prev => ({
      ...prev,
      especiesAtendidas: prev.especiesAtendidas.includes(id)
        ? prev.especiesAtendidas.filter(eid => eid !== id)
        : [...prev.especiesAtendidas, id],
    }));
  };

  // ── Validação em JS — sem popup do browser ────────────────────────────────
  const validar = (): boolean => {
    if (!form.nomeCompleto.trim()) {
      setErroInline('Nome completo é obrigatório');
      return false;
    }
    if (!form.telefone.trim()) {
      setErroInline('Telefone é obrigatório');
      return false;
    }
    if (form.telefone.replace(/\D/g, '').length < 10) {
      setErroInline('Telefone inválido');
      return false;
    }
    if (!form.cep.trim()) {
      setErroInline('CEP é obrigatório');
      return false;
    }
    if (!form.endereco.trim()) {
      setErroInline('Endereço é obrigatório');
      return false;
    }
    if (!form.bairro.trim()) {
      setErroInline('Bairro é obrigatório');
      return false;
    }
    if (!form.cidade.trim()) {
      setErroInline('Cidade é obrigatória');
      return false;
    }
    if (!form.estado.trim()) {
      setErroInline('Estado é obrigatório');
      return false;
    }
    if (form.tipoUsuario === 'VETERINARIO' && !isGestorEquipe) {
      if (!form.crmv.trim()) {
        setErroInline('CRMV é obrigatório para Médicos Veterinários');
        return false;
      }
      if (!CRMV_REGEX.test(form.crmv.trim())) {
        setErroInline('Formato de CRMV inválido. Use o formato: 12345/SP');
        return false;
      }
      if (crmvStatus === 'invalido') {
        setErroInline('CRMV não encontrado no cadastro do CFMV. Verifique o número e o estado.');
        return false;
      }
      if (crmvStatus === 'checking') {
        setErroInline('Aguarde a verificação do CRMV ser concluída');
        return false;
      }
      if (!isConvidadoFlag && form.especiesAtendidas.length === 0 && especies.length > 0) {
        setErroInline('Selecione ao menos uma espécie atendida');
        return false;
      }
    }
    // Especialidade: obrigatória para VET e FORNECEDOR (gestor não preenche)
    if ((form.tipoUsuario === 'VETERINARIO' || form.tipoUsuario === 'FORNECEDOR') && !isGestorEquipe) {
      if (form.especialidadeIds.length === 0) {
        setErroInline('Selecione ao menos uma especialidade');
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validar()) return;

    setSaving(true);

    const payload = {
      fullName:    form.nomeCompleto.trim(),
      phone:       form.telefone.trim(),
      cep:         form.cep.trim(),
      endereco:    form.endereco.trim(),
      complemento: form.complemento.trim(),
      bairro:      form.bairro.trim(),
      cidade:      form.cidade.trim(),
      estado:      form.estado.trim().toUpperCase(),
      userType:    form.tipoUsuario,
      ...(form.tipoUsuario === 'VETERINARIO' && !isGestorEquipe && {
        crmv:              form.crmv.trim(),
        especiesAtendidas: form.especiesAtendidas,
        subespecialidades: form.subespecialidades,
      }),
      // Especialidades do catálogo (VET e FORNECEDOR) — fonte única
      ...((form.tipoUsuario === 'VETERINARIO' || form.tipoUsuario === 'FORNECEDOR') && !isGestorEquipe && {
        especialidadeIds: form.especialidadeIds,
      }),
      // Expediente de atendimento (grava no MembroEquipe do contexto ativo)
      ...(temEquipe && {
        diasTrabalho:       form.diasAtendimento,
        horaInicioTrabalho: form.horaInicioAtend,
        horaFimTrabalho:    form.horaFimAtend,
      }),
    };

    try {
      const res     = await fetch('/api/users/me', {
        method:      'PUT',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify(payload),
      });
      const resData = await res.json();

      if (res.ok) {
        // O backend renovou o cookie de acesso com o userType atualizado.
        // Recarrega o perfil (identidade vem de /me).
        await refreshUser();
        toast.success('Cadastro pessoal salvo com sucesso!');

        await refreshSelectedAnimal();

        if (form.tipoUsuario === 'VETERINARIO') {
          localStorage.setItem('s2vet_ob', 'd');
          navigate('/mapa-atendimento');
        } else {
          const ob = localStorage.getItem('s2vet_ob');
          if (ob === 'p') {
            localStorage.setItem('s2vet_ob', 'a');
            navigate('/animais');
          } else if (ob === 'convite') {
            localStorage.removeItem('s2vet_ob');
            navigate('/');
          } else {
            navigate('/meus-animais');
          }
        }
      } else {
        setErroInline(resData.error || 'Não foi possível salvar o cadastro. Tente novamente.');
      }
    } catch {
      setErroInline('Erro de conexão com o servidor. Verifique sua internet e tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageContainer maxWidth="2xl">
        <div className="flex items-center justify-center py-20 text-gray-500">
          Carregando dados...
        </div>
      </PageContainer>
    );
  }

  const inputClass = 'w-full px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-emerald-500 text-gray-900';

  return (
    <PageContainer maxWidth="2xl">
      <InlineError message={erroInline} className="mb-4" />


      <BotaoVoltar className="mb-4" />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-gray-900">
          <User size={22} className="text-emerald-600" />
          Cadastro Pessoal
        </h1>
      </div>
      <p className="text-gray-500 mb-6 text-sm sm:text-base">
        Complete suas informações para continuar
      </p>

      <div className="bg-white shadow rounded-3xl p-5 sm:p-8">

        {/* noValidate desativa o popup do browser — usamos toast no lugar */}
        <form onSubmit={handleSubmit} noValidate className="space-y-5">

          {/* Nome */}
          <div>
            <Label text="Nome Completo" required />
            <input
              type="text" name="nomeCompleto" value={form.nomeCompleto}
              onChange={handleChange} className={inputClass}
              placeholder="Seu nome completo"
            />
          </div>

          {/* Telefone + Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <Label text="Telefone" required />
              <input
                type="tel" name="telefone" value={form.telefone}
                onChange={e => setForm(prev => ({ ...prev, telefone: mascaraTelefone(e.target.value) }))}
                className={inputClass}
                placeholder="(11) 99999-9999"
              />
            </div>
            <div>
              <Label text="E-mail" />
              <input
                type="email" name="email" value={form.email} readOnly
                className="w-full px-4 py-3 border border-gray-300 bg-gray-100 rounded-2xl text-gray-500 cursor-not-allowed"
              />
            </div>
          </div>

          {/* CEP */}
          <div>
            <Label text="CEP" required />
            <input
              type="text" name="cep" maxLength={9} value={form.cep}
              onChange={e => {
                const masked = mascaraCEP(e.target.value);
                setForm(prev => ({ ...prev, cep: masked }));
                if (masked.replace(/\D/g, '').length === 8) buscarCep(masked);
              }}
              className={inputClass}
              placeholder="00000-000"
            />
          </div>

          {/* Endereço + Complemento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <Label text="Endereço" required />
              <input
                type="text" name="endereco" value={form.endereco}
                onChange={handleChange} className={inputClass}
                placeholder="Rua, Avenida..."
              />
            </div>
            <div>
              <Label text="Complemento" optional />
              <input
                type="text" name="complemento" value={form.complemento}
                onChange={handleChange} className={inputClass}
                placeholder="Apto, Sala..."
              />
            </div>
          </div>

          {/* Bairro + Cidade + Estado */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            <div>
              <Label text="Bairro" required />
              <input
                type="text" name="bairro" value={form.bairro}
                onChange={handleChange} className={inputClass}
              />
            </div>
            <div>
              <Label text="Cidade" required />
              <input
                type="text" name="cidade" value={form.cidade}
                onChange={handleChange} className={inputClass}
              />
            </div>
            <div>
              <Label text="Estado" required />
              <input
                type="text" name="estado" maxLength={2} value={form.estado}
                onChange={handleChange} className={`${inputClass} uppercase`}
                placeholder="SP"
              />
            </div>
          </div>

          {/* Tipo de Usuário */}
          <div>
            <Label text="Tipo de Usuário" required />
            {(fromConvite || isGestorEquipe) ? (
              <div className="flex items-center gap-2 px-4 py-3 border border-gray-200 bg-gray-50 rounded-2xl">
                <span className="text-gray-800 font-medium">
                  {isGestorEquipe
                    ? 'Gestor(a)'
                    : LABEL_TIPO_USUARIO[form.tipoUsuario] ?? form.tipoUsuario}
                </span>
                <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
                  <Info size={11} /> Definido pela equipe
                </span>
              </div>
            ) : (
              <select name="tipoUsuario" value={form.tipoUsuario} onChange={handleChange}
                className={inputClass}>
                <option value="PROPRIETARIO">Proprietário</option>
                <option value="VETERINARIO">Médico Veterinário</option>
              </select>
            )}
          </div>

          {/* ── Dados profissionais — só para veterinários (gestor não preenche) ── */}
          {form.tipoUsuario === 'VETERINARIO' && !isGestorEquipe && (
            <div className="pt-2 border-t border-gray-100 space-y-5">
              <p className="text-sm font-semibold text-gray-600">Dados Profissionais</p>

              <div>
                <Label text="CRMV" required />
                <input
                  type="text" name="crmv" value={form.crmv}
                  onChange={e => {
                    const masked = maskCRMV(e.target.value);
                    setForm(prev => ({ ...prev, crmv: masked }));
                    setCrmvStatus('idle');
                    verificarCRMV(masked);
                  }}
                  placeholder="12345/SP" maxLength={9}
                  className={inputClass}
                />
                {crmvStatus === 'idle' && (
                  <p className="text-xs text-gray-400 mt-1">Formato: 12345/SP</p>
                )}
                {crmvStatus === 'checking' && (
                  <p className="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
                    <Loader2 size={12} className="animate-spin" /> Verificando no CFMV...
                  </p>
                )}
                {crmvStatus === 'valido' && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-600 mt-1">
                    <CheckCircle2 size={12} /> CRMV encontrado no cadastro do CFMV
                  </p>
                )}
                {crmvStatus === 'invalido' && (
                  <p className="flex items-center gap-1.5 text-xs text-red-600 mt-1">
                    <XCircle size={12} /> CRMV não encontrado no cadastro do CFMV
                  </p>
                )}
                {(crmvStatus === 'indice_vazio' || crmvStatus === 'erro') && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-600 mt-1">
                    <Info size={12} /> Verificação indisponível — formato aceito
                  </p>
                )}
              </div>

              {/* Espécies: convidado = automático; independente = seleção */}
              {isConvidadoFlag ? (
                <div>
                  <Label text="Espécies atendidas" />
                  {form.especiesAtendidas.length > 0 && especiesLoaded && especies.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {especies.filter(e => form.especiesAtendidas.includes(e.id)).map(e => (
                        <span key={e.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium rounded-2xl">
                          {e.nome}
                        </span>
                      ))}
                      <p className="w-full text-xs text-gray-400 mt-1 flex items-center gap-1">
                        <Info size={11} /> Definido automaticamente pela equipe
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">
                      Será configurado automaticamente ao entrar na equipe.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <Label text="Espécies atendidas" required />
                  {!especiesLoaded ? (
                    <p className="flex items-center gap-1.5 text-xs text-gray-400">
                      <Loader2 size={12} className="animate-spin" /> Carregando espécies...
                    </p>
                  ) : especiesErro ? (
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-red-500">Erro ao carregar espécies.</p>
                      <button type="button" onClick={carregarEspecies}
                        className="text-xs text-emerald-600 underline">Tentar novamente</button>
                    </div>
                  ) : especies.length === 0 ? (
                    <p className="text-xs text-amber-600">Nenhuma espécie cadastrada. Contate o administrador.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {especies.map(esp => {
                        const selecionada = form.especiesAtendidas.includes(esp.id);
                        return (
                          <label key={esp.id}
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl border cursor-pointer transition-colors select-none ${
                              selecionada
                                ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                                : 'border-gray-200 bg-white text-gray-700 hover:border-emerald-300'
                            }`}>
                            <input type="checkbox" className="accent-emerald-600 flex-shrink-0"
                              checked={selecionada} onChange={() => toggleEspecie(esp.id)} />
                            <span className="text-sm font-medium">{esp.nome}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

            </div>
          )}

          {/* ── Especialidade — VET e FORNECEDOR (gestor não preenche) ── */}
          {(form.tipoUsuario === 'VETERINARIO' || form.tipoUsuario === 'FORNECEDOR') && !isGestorEquipe && (
            <div className="pt-2 border-t border-gray-100">
              <Label text="Especialidade" required />
              <p className="text-xs text-gray-400 mb-2">
                {(isConvidadoFlag || temEquipe) && especiesEmpresa.length > 0
                  ? 'Especialidades das espécies que a empresa atende. Selecione uma ou mais.'
                  : 'Selecione as espécies atendidas acima para listar as especialidades. Uma ou mais.'}
              </p>
              <EspecialidadeSelector
                value={form.especialidadeIds}
                onChange={ids => setForm(prev => ({ ...prev, especialidadeIds: ids }))}
                especieIds={especiesFiltroEspecialidade}
                emptyText={(isConvidadoFlag || temEquipe) && especiesEmpresa.length > 0
                  ? 'A empresa ainda não configurou as espécies atendidas. Contate o gestor.'
                  : 'Selecione ao menos uma espécie atendida para listar as especialidades.'}
              />
            </div>
          )}

          {/* ── Dias e horário de atendimento (expediente do profissional) ── */}
          {temEquipe && form.tipoUsuario !== 'PROPRIETARIO' && (
            <div>
              <Label text="Dias e horário de atendimento" optional />
              <div className="flex flex-wrap gap-1.5 mt-1 mb-3">
                {DIAS_SEMANA_ATEND.map(d => {
                  const on = form.diasAtendimento.includes(d.v);
                  return (
                    <button key={d.v} type="button"
                      onClick={() => setForm(prev => ({
                        ...prev,
                        diasAtendimento: on
                          ? prev.diasAtendimento.filter(x => x !== d.v)
                          : [...prev.diasAtendimento, d.v].sort((a, b) => a - b),
                      }))}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                        on ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}>
                      {d.l}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Entra às</label>
                  <input type="time" step={1800} value={form.horaInicioAtend}
                    onChange={e => setForm(prev => ({ ...prev, horaInicioAtend: e.target.value }))}
                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Sai às</label>
                  <input type="time" step={1800} value={form.horaFimAtend}
                    onChange={e => setForm(prev => ({ ...prev, horaFimAtend: e.target.value }))}
                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:border-emerald-500 focus:outline-none" />
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                A Agenda libera seus horários apenas nos dias e na faixa informados.
                Deixe em branco para herdar o expediente da empresa.
              </p>
            </div>
          )}

          {/* Legenda campos obrigatórios */}
          <p className="text-xs text-gray-400">
            <span className="text-red-500">*</span> Campos obrigatórios
          </p>

          <button
            type="submit" disabled={saving}
            className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white py-4 rounded-3xl text-base sm:text-lg font-semibold mt-2 transition-colors"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>

        </form>
      </div>
    </PageContainer>
  );
}

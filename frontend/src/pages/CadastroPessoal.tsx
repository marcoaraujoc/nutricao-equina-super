// src/pages/CadastroPessoal.tsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { useEmpresa } from '../contexts/EmpresaContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import EspecialidadeSelector from '../components/EspecialidadeSelector';
import {
  conflitoEntreLocais, resumoLocal,
  RASCUNHO_LOCAL_VAZIO, uniaoEspecialidadesLocais, PERFIS_COM_ESPECIALIDADE,
  TEMPO_CONSULTA_PADRAO_SISTEMA, LocalTrabalhoFields,
  type LocalTrabalhoForm,
} from '../components/UsuarioFormModal';
import { CheckCircle2, XCircle, Loader2, Info, User, Plus, MapPin, Pencil, Trash2 } from 'lucide-react';
import InlineError from '../components/InlineError';
import FieldError from '../components/FieldError';

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

// O tipo de usuário DENTRO de uma empresa é o CARGO que o gestor atribuiu
// (MembroEquipe.cargo) — é por empresa, então o mesmo e-mail é estagiário numa e
// veterinário na outra. Este mapa rotula o cargo do contexto ativo; o `userType`
// global do login não manda nesta tela.
const LABEL_CARGO_EQUIPE: Record<string, string> = {
  GESTOR:       'Gestor(a)',
  VETERINARIO:  'Médico(a) Veterinário(a)',
  ESTAGIARIO:   'Estagiário(a)',
  ENFERMEIRO:   'Enfermeiro(a)',
  SECRETARIA:   'Secretaria',
  FINANCEIRO:   'Financeiro',
  FORNECEDOR:   'Fornecedor(a)',
  PRESTADOR:    'Prestador(a) de serviço',
  PROPRIETARIO: 'Proprietário(a)',
};

// Cargos que exercem atuação clínica — só eles têm especialidade e tempo de consulta
// (mesma regra do backend: ver CLAUDE.md §15). Estagiário, enfermeiro, secretaria,
// financeiro e gestor informam apenas local e horário de trabalho.
const CARGOS_COM_ESPECIALIDADE = ['VETERINARIO', 'FORNECEDOR', 'PRESTADOR'];

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
  // Contexto ativo (seletor de empresa) — o cadastro carregado é o DESTA empresa
  const { loading: empresaLoading, contextoAtivo } = useEmpresa();
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
  // Erro de ação (salvar/conexão) exibido inline junto ao botão Salvar
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erros por campo — validados conforme o usuário passa pelos campos (onBlur) e no submit
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Locais de trabalho — mesmo fluxo de "Incluir Membro": um rascunho é preenchido e
  // só entra na lista via "Adicionar" (que já bloqueia local repetido e conflito de horário)
  const [rascunhoLocal,    setRascunhoLocal]    = useState<LocalTrabalhoForm>(RASCUNHO_LOCAL_VAZIO);
  const [mostrarFormLocal, setMostrarFormLocal] = useState(false);
  const [erroLocal,        setErroLocal]        = useState<string | null>(null);
  // Índice do local em edição (null = adicionando um novo)
  const [editIndex,        setEditIndex]        = useState<number | null>(null);
  // Locais definidos na INCLUSÃO como membro (pelo gestor) — bound: o dia/horário que o
  // profissional informar por local deve caber dentro deste. Snapshot imutável do load.
  const [locaisBase,       setLocaisBase]       = useState<LocalTrabalhoForm[]>([]);
  // Cargo na equipe (ex: GESTOR) — definido quando foi incluído como membro
  const [cargoEquipe,     setCargoEquipe]     = useState<string | null>(null);
  // Membro de alguma equipe → habilita o expediente de atendimento
  const [temEquipe,       setTemEquipe]       = useState(false);

  // Gestor: sem dados profissionais (CRMV/espécies/subespecialidade)
  const isGestorEquipe = cargoEquipe === 'GESTOR';
  // Membro de equipe NESTE contexto → o tipo de usuário é o cargo que o gestor
  // atribuiu, exibido em somente leitura. Sem vínculo (cadastro direto) é que ele
  // escolhe entre Proprietário e Médico Veterinário.
  const tipoDefinidoPelaEquipe = !!cargoEquipe;

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

  // Expediente da EMPRESA — todo membro fica restrito a esses dias/horário
  const [expedienteEmpresa, setExpedienteEmpresa] = useState<{ dias: number[] | null; ini: string | null; fim: string | null }>({ dias: null, ini: null, fim: null });
  // Tempo de consulta padrão da empresa — vale para a especialidade sem tempo próprio
  const [tempoPadraoEmpresa, setTempoPadraoEmpresa] = useState(TEMPO_CONSULTA_PADRAO_SISTEMA);
  useEffect(() => {
    if (loadingPerms) return;
    api.get('/equipes/horario-atendimento')
      .then(res => {
        const d = res.data?.dados;
        if (!d) return;
        setExpedienteEmpresa({
          dias: d.diasAtendimento ? String(d.diasAtendimento).split(',').map(Number).filter((n: number) => n >= 0 && n <= 6) : null,
          ini:  d.horaInicioAtendimento || null,
          fim:  d.horaFimAtendimento    || null,
        });
        if (Number(d.tempoConsultaPadrao) > 0) setTempoPadraoEmpresa(Number(d.tempoConsultaPadrao));
      })
      .catch(() => {});
  }, [loadingPerms]);

  // Mapa id→nome de especialidade — exibe os nomes nas linhas de local já adicionadas
  const [espNomeById, setEspNomeById] = useState<Record<number, string>>({});
  useEffect(() => {
    api.get('/especialidades')
      .then(res => {
        const lista: Array<{ id: number; nome: string }> = res.data?.dados ?? [];
        const m: Record<number, string> = {};
        for (const e of lista) m[e.id] = e.nome;
        setEspNomeById(m);
      })
      .catch(() => {});
  }, []);

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
    // Locais de trabalho já cadastrados (pelo gestor ou pelo próprio profissional)
    locaisTrabalho:    [] as LocalTrabalhoForm[],
  });

  // Filtro de especialidades: convidado → espécies da empresa; cadastro direto →
  // as espécies que o próprio veterinário atende. Vazio = mostra todas.
  // (Depois do useState do form — referenciar `form` antes da declaração causava
  // "Cannot access 'form' before initialization".)
  const especiesFiltroEspecialidade = (isConvidadoFlag || temEquipe) && especiesEmpresa.length > 0
    ? especiesEmpresa
    : form.especiesAtendidas;

  // Só VETERINARIO e FORNECEDOR têm especialidade (e tempo de consulta). Estagiário,
  // enfermeiro, secretaria, financeiro e gestor informam APENAS local e horário de
  // trabalho. (Depois do useState do form — ver comentário acima sobre TDZ.)
  //
  // Dentro de uma empresa quem decide é o CARGO, não o `userType` do login: a mesma
  // pessoa é ESTAGIÁRIA aqui (sem CRMV/especialidade) e VETERINÁRIA na outra clínica.
  // Sem vínculo (cadastro direto) cai no tipo que ela mesma escolheu.
  const perfilComEspecialidade = cargoEquipe
    ? CARGOS_COM_ESPECIALIDADE.includes(cargoEquipe)
    : PERFIS_COM_ESPECIALIDADE.includes(form.tipoUsuario);

  // Tipo de usuário exibido: o cargo do contexto quando há vínculo.
  const labelTipoUsuario = cargoEquipe
    ? (LABEL_CARGO_EQUIPE[cargoEquipe] ?? cargoEquipe)
    : (LABEL_TIPO_USUARIO[form.tipoUsuario] ?? form.tipoUsuario);

  // Atua como veterinário NESTA empresa (CRMV, espécies, especialidade). Vale o CARGO
  // do contexto: quem é VETERINARIO no login mas ESTAGIÁRIA aqui não preenche CRMV.
  const atuaComoVet = cargoEquipe
    ? cargoEquipe === 'VETERINARIO'
    : form.tipoUsuario === 'VETERINARIO';

  // Rótulos do que a EMPRESA preenche quando o campo do local fica em branco
  const diasEmpresaLabel = expedienteEmpresa.dias && expedienteEmpresa.dias.length > 0
    ? [...expedienteEmpresa.dias].sort((a, b) => a - b)
        .map(d => DIAS_SEMANA_ATEND.find(x => x.v === d)?.l ?? d).join(', ')
    : 'todos os dias';
  const horarioEmpresaLabel = expedienteEmpresa.ini || expedienteEmpresa.fim
    ? `${expedienteEmpresa.ini ?? '00:00'}–${expedienteEmpresa.fim ?? '24:00'}`
    : 'dia inteiro';

  useEffect(() => {
    if (loadingPerms || empresaLoading) return;
    const loadUserData = async () => {
      if (!user?.email) { setLoading(false); return; }
      try {
        // OBRIGATÓRIO usar o axios (`api`), não `fetch` cru: é o interceptor dele que
        // injeta `x-empresa-id`/`x-equipe-id` (contexto ativo do seletor). Com fetch,
        // a requisição saía SEM contexto e o backend caía no fallback — o vínculo de
        // equipe MAIS RECENTE — devolvendo o cadastro e o tipo de OUTRA empresa.
        const res = await api.get('/users/me');
        if (res.data) {
          const data = res.data;
          // Locais definidos na inclusão como membro (bound do horário do profissional)
          const locaisCarregados: LocalTrabalhoForm[] = (data.locaisTrabalho ?? []).map((l: {
            localizacaoId: number; localizacaoNome: string | null;
            diasTrabalho: string | null; horaInicioTrabalho: string | null; horaFimTrabalho: string | null;
            especialidadeIds?: number[];
            temposConsulta?: Record<number, number>;
          }) => ({
            localizacaoId:   l.localizacaoId,
            localizacaoNome: l.localizacaoNome ?? '',
            diasTrabalho:    l.diasTrabalho
              ? String(l.diasTrabalho).split(',').map(Number).filter((n: number) => n >= 0 && n <= 6)
              : [],
            horaInicioTrabalho: l.horaInicioTrabalho || '',
            horaFimTrabalho:    l.horaFimTrabalho    || '',
            especialidadeIds:   Array.isArray(l.especialidadeIds) ? l.especialidadeIds : [],
            temposConsulta:     l.temposConsulta ?? {},
          }));
          // Snapshot imutável do bound (cópia — não muda quando o form é editado)
          setLocaisBase(locaisCarregados.map(l => ({
            ...l, diasTrabalho: [...l.diasTrabalho], especialidadeIds: [...l.especialidadeIds],
            temposConsulta: { ...l.temposConsulta },
          })));
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
            // Locais de trabalho já cadastrados — abrem preenchidos e editáveis
            locaisTrabalho: locaisCarregados,
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
    // Espera o contexto ativo resolver (mesmo gate do usePermissoes): sem ele a
    // chamada sai sem `x-empresa-id` e volta o cadastro da empresa errada. E recarrega
    // quando a empresa do seletor muda.
  }, [user?.email, loadingPerms, empresaLoading, contextoAtivo?.empresaId, contextoAtivo?.equipeId]);

  const buscarCep = async (cep: string) => {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    try {
      const res  = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const data = await res.json();
      if (data.erro) { setErrors(prev => ({ ...prev, cep: 'CEP não encontrado' })); return; }
      setErrors(prev => ({ ...prev, cep: '', endereco: '', bairro: '', cidade: '', estado: '' }));
      setForm(prev => ({
        ...prev,
        endereco: data.logradouro || '',
        bairro:   data.bairro     || '',
        cidade:   data.localidade || '',
        estado:   data.uf         || '',
      }));
    } catch {
      setErrors(prev => ({ ...prev, cep: 'Erro ao buscar CEP. Verifique sua conexão.' }));
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

  // Limpa o erro de um campo assim que o usuário começa a corrigi-lo
  const limparErro = (name: string) =>
    setErrors(prev => (prev[name] ? { ...prev, [name]: '' } : prev));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (name === 'tipoUsuario') setCrmvStatus('idle');
    limparErro(name);
  };

  const toggleEspecie = (id: number) => {
    setForm(prev => ({
      ...prev,
      especiesAtendidas: prev.especiesAtendidas.includes(id)
        ? prev.especiesAtendidas.filter(eid => eid !== id)
        : [...prev.especiesAtendidas, id],
    }));
    limparErro('especiesAtendidas');
  };

  // ── Validação por campo — sem popup do browser ────────────────────────────
  // Retorna a mensagem de erro do campo (ou '' quando válido).
  const validarCampo = (name: string): string => {
    switch (name) {
      case 'nomeCompleto':
        return form.nomeCompleto.trim() ? '' : 'Nome completo é obrigatório';
      case 'telefone':
        if (!form.telefone.trim()) return 'Telefone é obrigatório';
        if (form.telefone.replace(/\D/g, '').length < 10) return 'Telefone inválido';
        return '';
      case 'cep':
        return form.cep.trim() ? '' : 'CEP é obrigatório';
      case 'endereco':
        return form.endereco.trim() ? '' : 'Endereço é obrigatório';
      case 'bairro':
        return form.bairro.trim() ? '' : 'Bairro é obrigatório';
      case 'cidade':
        return form.cidade.trim() ? '' : 'Cidade é obrigatória';
      case 'estado':
        return form.estado.trim() ? '' : 'Estado é obrigatório';
      case 'crmv':
        if (atuaComoVet) {
          if (!form.crmv.trim()) return 'CRMV é obrigatório para Médicos Veterinários';
          if (!CRMV_REGEX.test(form.crmv.trim())) return 'Formato de CRMV inválido. Use o formato: 12345/SP';
          if (crmvStatus === 'invalido') return 'CRMV não encontrado no cadastro do CFMV. Verifique o número e o estado.';
          if (crmvStatus === 'checking') return 'Aguarde a verificação do CRMV ser concluída';
        }
        return '';
      case 'especiesAtendidas':
        if (atuaComoVet && !isConvidadoFlag
            && form.especiesAtendidas.length === 0 && especies.length > 0) {
          return 'Selecione ao menos uma espécie atendida';
        }
        return '';
      case 'especialidadeIds':
        // Especialidade é OPCIONAL: o veterinário que não informar nenhuma assume
        // Clínica Médica (aplicado no backend) e o fornecedor pode ficar sem.
        return '';
      case 'locaisTrabalho':
        if (temEquipe) {
          if (form.locaisTrabalho.some(l => !l.localizacaoId)) {
            return 'Selecione o local de cada linha de trabalho (ou remova a linha vazia).';
          }
          const conflito = conflitoEntreLocais(form.locaisTrabalho);
          if (conflito) return conflito;
          // Especialidade no local é OPCIONAL — veterinário sem nenhuma assume Clínica
          // Médica (backend) e fornecedor pode ficar sem.
        }
        return '';
      default:
        return '';
    }
  };

  // Ordem dos campos — usada para validar tudo no submit e rolar até o 1º erro
  const ORDEM_CAMPOS = [
    'nomeCompleto', 'telefone', 'cep', 'endereco', 'bairro', 'cidade', 'estado',
    'crmv', 'especiesAtendidas', 'especialidadeIds', 'locaisTrabalho',
  ];

  // Valida um campo quando o usuário sai dele (onBlur)
  const handleBlur = (name: string) =>
    setErrors(prev => ({ ...prev, [name]: validarCampo(name) }));

  // Rola até o primeiro campo com erro e foca-o (mantém o erro visível na tela)
  const focarPrimeiroErro = (errs: Record<string, string>) => {
    const chave = ORDEM_CAMPOS.find(k => errs[k]);
    if (!chave) return;
    const el = document.getElementById(`campo-${chave}`)
      ?? (document.getElementsByName(chave)[0] as HTMLElement | undefined);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof el.focus === 'function') { try { el.focus({ preventScroll: true }); } catch { /* noop */ } }
  };

  // ── Bound do local pelo EXPEDIENTE DA EMPRESA ─────────────────────────────
  // Todo membro fica restrito ao dia/horário da empresa. Retorna a mensagem de
  // erro se o local extrapolar; null se estiver dentro (ou empresa sem restrição).
  const validarExpedienteEmpresa = (local: LocalTrabalhoForm): string | null => {
    const { dias, ini, fim } = expedienteEmpresa;
    const nomeDia = (n: number) => DIAS_SEMANA_ATEND.find(x => x.v === n)?.l ?? String(n);
    if (dias && dias.length > 0) {
      const fora = local.diasTrabalho.filter(d => !dias.includes(d));
      if (fora.length > 0) {
        return `Dias fora do expediente da empresa (permitido: ${[...dias].sort((a, b) => a - b).map(nomeDia).join(', ')}).`;
      }
    }
    if (ini && local.horaInicioTrabalho && local.horaInicioTrabalho < ini) {
      return `Entrada antes do expediente da empresa (a partir de ${ini}).`;
    }
    if (fim && local.horaFimTrabalho && local.horaFimTrabalho > fim) {
      return `Saída após o expediente da empresa (até ${fim}).`;
    }
    return null;
  };

  // ── Bound do local pela INCLUSÃO como membro ──────────────────────────────
  // O horário definido pelo gestor ao incluir o membro é o que manda. O dia/horário
  // que o profissional informar por local deve caber DENTRO dele. Retorna a mensagem
  // de erro se extrapolar (dia fora ou horário fora da faixa); null se estiver ok.
  //
  // O MESMO local pode ter VÁRIAS linhas base (turnos com especialidades diferentes),
  // então basta caber em UMA delas — validar contra a primeira encontrada reprovaria o
  // turno da tarde por causa da faixa do turno da manhã.
  const validarDentroDaBase = (local: LocalTrabalhoForm): string | null => {
    const bases = locaisBase.filter(b => b.localizacaoId === local.localizacaoId);
    if (bases.length === 0) return null; // local não definido na inclusão → sem limite da equipe
    const nomeDia = (n: number) => DIAS_SEMANA_ATEND.find(x => x.v === n)?.l ?? String(n);

    const cabeEm = (base: LocalTrabalhoForm): string | null => {
      if (base.diasTrabalho.length > 0) {
        const fora = local.diasTrabalho.filter(d => !base.diasTrabalho.includes(d));
        if (fora.length > 0) {
          const permitidos = [...base.diasTrabalho].sort((a, b) => a - b).map(nomeDia).join(', ');
          return `Dias fora do definido pela equipe (permitido: ${permitidos}).`;
        }
      }
      if (base.horaInicioTrabalho && local.horaInicioTrabalho && local.horaInicioTrabalho < base.horaInicioTrabalho) {
        return `Entrada antes do definido pela equipe (a partir de ${base.horaInicioTrabalho}).`;
      }
      if (base.horaFimTrabalho && local.horaFimTrabalho && local.horaFimTrabalho > base.horaFimTrabalho) {
        return `Saída após o definido pela equipe (até ${base.horaFimTrabalho}).`;
      }
      return null;
    };

    let primeiroErro: string | null = null;
    for (const base of bases) {
      const erro = cabeEm(base);
      if (!erro) return null;                       // coube em algum turno da equipe
      if (primeiroErro === null) primeiroErro = erro;
    }
    return primeiroErro;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    ORDEM_CAMPOS.forEach(c => { const msg = validarCampo(c); if (msg) errs[c] = msg; });
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      focarPrimeiroErro(errs);
      return;
    }
    setErrors({});

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
      ...(atuaComoVet && {
        crmv:              form.crmv.trim(),
        especiesAtendidas: form.especiesAtendidas,
        subespecialidades: form.subespecialidades,
      }),
      // Especialidades do profissional (VET e FORNECEDOR): COM equipe = união das
      // especialidades dos locais; SEM equipe = seletor standalone. Estagiário e demais
      // perfis não enviam especialidade nenhuma — só local e horário.
      ...(perfilComEspecialidade && {
        // Com equipe: união dos locais. Vazia (legado sem especialidade por local) →
        // undefined para não apagar as especialidades já cadastradas.
        especialidadeIds: temEquipe
          ? (uniaoEspecialidadesLocais(form.locaisTrabalho).length > 0
              ? uniaoEspecialidadesLocais(form.locaisTrabalho)
              : undefined)
          : form.especialidadeIds,
      }),
      // Expediente do profissional = LOCAIS de trabalho (o backend deriva o agregado
      // para a Agenda). Não há mais expediente geral avulso no cadastro pessoal.
      ...(temEquipe && {
        locaisTrabalho: form.locaisTrabalho
          .filter(l => l.localizacaoId)
          .map(l => ({
            localizacaoId:      l.localizacaoId,
            diasTrabalho:       l.diasTrabalho,
            horaInicioTrabalho: l.horaInicioTrabalho || '',
            horaFimTrabalho:    l.horaFimTrabalho    || '',
            // Perfil sem atuação clínica leva o local "pelado": local, dias e horário
            especialidadeIds:   perfilComEspecialidade ? (l.especialidadeIds ?? []) : [],
            temposConsulta:     perfilComEspecialidade ? (l.temposConsulta   ?? {}) : {},
          })),
      }),
    };

    try {
      // axios (`api`): leva `x-empresa-id`/`x-equipe-id` — o cadastro é gravado na
      // empresa ATIVA. Com `fetch` cru ia sem contexto e caía na empresa errada.
      const put     = await api.put('/users/me', payload);
      const resData = put.data ?? {};
      const res     = { ok: put.status >= 200 && put.status < 300 };

      if (res.ok) {
        // O backend renovou o cookie de acesso com o userType atualizado.
        // Recarrega o perfil (identidade vem de /me).
        await refreshUser();
        toast.success('Cadastro pessoal salvo com sucesso!');

        await refreshSelectedAnimal();

        // Profissional (qualquer cargo da empresa: gestor, vet, estagiário, enfermeiro,
        // secretaria, financeiro, fornecedor) vai ao Mapa de Atendimento. Só o CLIENTE
        // segue o fluxo de animais. Antes, só quem tinha `tipoUsuario` VETERINARIO caía
        // no mapa — os demais iam parar em "meus animais", que não é tela deles.
        const ehClienteAqui = !cargoEquipe && form.tipoUsuario === 'PROPRIETARIO';
        if (!ehClienteAqui) {
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
    } catch (err: unknown) {
      // O axios REJEITA em 4xx/5xx (o `fetch` antigo devolvia res.ok=false), então o
      // motivo real vinha do servidor e era descartado como "erro de conexão".
      // Só é falha de rede quando não há resposta nenhuma.
      const resposta = (err as { response?: { data?: { error?: string; mensagem?: string } } })?.response;
      setErroInline(
        resposta
          ? (resposta.data?.error ?? resposta.data?.mensagem ?? 'Não foi possível salvar o cadastro. Tente novamente.')
          : 'Erro de conexão com o servidor. Verifique sua internet e tente novamente.',
      );
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

  const inputBase = 'w-full px-4 py-3 border rounded-2xl focus:outline-none text-gray-900';
  const inputCls = (name: string) =>
    `${inputBase} ${errors[name]
      ? 'border-red-400 focus:border-red-500'
      : 'border-gray-300 focus:border-emerald-500'}`;

  return (
    <PageContainer maxWidth="2xl">
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
              onChange={handleChange} onBlur={() => handleBlur('nomeCompleto')}
              className={inputCls('nomeCompleto')}
              placeholder="Seu nome completo"
            />
            <FieldError message={errors.nomeCompleto} />
          </div>

          {/* Telefone + Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <Label text="Telefone" required />
              <input
                type="tel" name="telefone" value={form.telefone}
                onChange={e => { setForm(prev => ({ ...prev, telefone: mascaraTelefone(e.target.value) })); limparErro('telefone'); }}
                onBlur={() => handleBlur('telefone')}
                className={inputCls('telefone')}
                placeholder="(11) 99999-9999"
              />
              <FieldError message={errors.telefone} />
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
                limparErro('cep');
                if (masked.replace(/\D/g, '').length === 8) buscarCep(masked);
              }}
              onBlur={() => handleBlur('cep')}
              className={inputCls('cep')}
              placeholder="00000-000"
            />
            <FieldError message={errors.cep} />
          </div>

          {/* Endereço + Complemento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <Label text="Endereço" required />
              <input
                type="text" name="endereco" value={form.endereco}
                onChange={handleChange} onBlur={() => handleBlur('endereco')}
                className={inputCls('endereco')}
                placeholder="Rua, Avenida..."
              />
              <FieldError message={errors.endereco} />
            </div>
            <div>
              <Label text="Complemento" optional />
              <input
                type="text" name="complemento" value={form.complemento}
                onChange={handleChange} className={inputCls('complemento')}
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
                onChange={handleChange} onBlur={() => handleBlur('bairro')}
                className={inputCls('bairro')}
              />
              <FieldError message={errors.bairro} />
            </div>
            <div>
              <Label text="Cidade" required />
              <input
                type="text" name="cidade" value={form.cidade}
                onChange={handleChange} onBlur={() => handleBlur('cidade')}
                className={inputCls('cidade')}
              />
              <FieldError message={errors.cidade} />
            </div>
            <div>
              <Label text="Estado" required />
              <input
                type="text" name="estado" maxLength={2} value={form.estado}
                onChange={handleChange} onBlur={() => handleBlur('estado')}
                className={`${inputCls('estado')} uppercase`}
                placeholder="SP"
              />
              <FieldError message={errors.estado} />
            </div>
          </div>

          {/* Tipo de Usuário */}
          <div>
            <Label text="Tipo de Usuário" required />
            {/* Com vínculo na empresa ativa, o tipo é o CARGO que o gestor atribuiu —
                somente leitura e por empresa (estagiária aqui, veterinária na outra).
                O select só existe para cadastro direto, sem equipe. */}
            {(fromConvite || tipoDefinidoPelaEquipe) ? (
              <div className="flex items-center gap-2 px-4 py-3 border border-gray-200 bg-gray-50 rounded-2xl">
                <span className="text-gray-800 font-medium">{labelTipoUsuario}</span>
                <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
                  <Info size={11} /> Definido pela equipe
                </span>
              </div>
            ) : (
              <select name="tipoUsuario" value={form.tipoUsuario} onChange={handleChange}
                className={inputCls('tipoUsuario')}>
                <option value="PROPRIETARIO">Proprietário</option>
                <option value="VETERINARIO">Médico Veterinário</option>
              </select>
            )}
          </div>

          {/* ── Dados profissionais — só para veterinários (gestor não preenche) ── */}
          {atuaComoVet && (
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
                    limparErro('crmv');
                    verificarCRMV(masked);
                  }}
                  onBlur={() => handleBlur('crmv')}
                  placeholder="12345/SP" maxLength={9}
                  className={inputCls('crmv')}
                />
                <FieldError message={errors.crmv} />
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
                <div id="campo-especiesAtendidas">
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
                  <FieldError message={errors.especiesAtendidas} />
                </div>
              )}

            </div>
          )}

          {/* ── Especialidade STANDALONE — só sem equipe (profissional solo).
              Com equipe, a especialidade é definida POR LOCAL (abaixo). ── */}
          {(form.tipoUsuario === 'VETERINARIO' || form.tipoUsuario === 'FORNECEDOR') && !isGestorEquipe && !temEquipe && (
            <div className="pt-2 border-t border-gray-100" id="campo-especialidadeIds">
              <Label text="Especialidade" optional />
              <p className="text-xs text-gray-400 mb-2">
                {form.tipoUsuario === 'VETERINARIO'
                  ? 'Sem nenhuma selecionada, você assume Clínica Médica.'
                  : 'Opcional — o fornecedor pode ficar sem especialidade.'}
              </p>
              <EspecialidadeSelector
                value={form.especialidadeIds}
                onChange={ids => { setForm(prev => ({ ...prev, especialidadeIds: ids })); limparErro('especialidadeIds'); }}
                especieIds={especiesFiltroEspecialidade}
                emptyText={(isConvidadoFlag || temEquipe) && especiesEmpresa.length > 0
                  ? 'A empresa ainda não configurou as espécies atendidas. Contate o gestor.'
                  : 'Selecione ao menos uma espécie atendida para listar as especialidades.'}
              />
              <FieldError message={errors.especialidadeIds} />
            </div>
          )}

          {/* ── Locais de trabalho (local + dias + horário) ──────────────────
              Mesmo fluxo do "Incluir Membro": um rascunho é preenchido e só entra na
              lista via "Adicionar", que bloqueia local repetido e conflito de horário. */}
          {temEquipe && form.tipoUsuario !== 'PROPRIETARIO' && (
            <div id="campo-locaisTrabalho">
              <Label text="Locais de trabalho" optional />

              {/* Locais já adicionados — cada um em UMA linha */}
              {form.locaisTrabalho.length > 0 ? (
                <div className="space-y-1.5 mt-1 mb-3">
                  {form.locaisTrabalho.map((lt, idx) => (
                    <div key={idx} className="flex items-start gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                      <MapPin size={13} className="text-emerald-600 flex-shrink-0 mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 truncate">
                            {lt.localizacaoNome || `Local #${lt.localizacaoId}`}
                          </span>
                          {resumoLocal(lt) && <span className="text-xs text-gray-500 truncate">— {resumoLocal(lt)}</span>}
                        </div>
                        {(lt.especialidadeIds ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {lt.especialidadeIds.map(id => (
                              <span key={id} className="text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full font-medium">
                                {espNomeById[id] ?? `#${id}`} · {lt.temposConsulta?.[id] ?? tempoPadraoEmpresa} min
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button type="button"
                          onClick={() => {
                            setRascunhoLocal(lt);
                            setEditIndex(idx);
                            setErroLocal(null);
                            setMostrarFormLocal(true);
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                          <Pencil size={13} /> Alterar
                        </button>
                        <button type="button"
                          onClick={() => {
                            setForm(prev => ({
                              ...prev,
                              locaisTrabalho: prev.locaisTrabalho.filter((_, i) => i !== idx),
                            }));
                            if (editIndex === idx) { setMostrarFormLocal(false); setEditIndex(null); setRascunhoLocal(RASCUNHO_LOCAL_VAZIO); }
                            limparErro('locaisTrabalho');
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={13} /> Excluir
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-1 mb-3">
                  Nenhum local informado — você herda o expediente da empresa.
                </p>
              )}

              {/* Botão que revela o formulário do novo local */}
              {!mostrarFormLocal && (
                <>
                  <button type="button"
                    onClick={() => { setErroLocal(null); setEditIndex(null); setRascunhoLocal(RASCUNHO_LOCAL_VAZIO); setMostrarFormLocal(true); }}
                    className="flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-semibold hover:bg-emerald-50 transition-colors">
                    <Plus size={13} /> Adicionar local e horário de trabalho
                  </button>
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    O mesmo local pode entrar mais de uma vez, com outros dias, horário e
                    especialidade — ex.: clínico seg/qua/sex e dermatologista ter/qui na
                    mesma hípica.
                  </p>
                </>
              )}

              {/* Formulário do novo local: local + dias + horas em UMA linha;
                  os botões ficam numa linha própria abaixo. */}
              {mostrarFormLocal && (
                <div className="p-3 bg-gray-50/60 border border-gray-200 rounded-2xl space-y-3">
                  {/* MESMO formulário do "Incluir/Editar Membro" — componente único
                      (LocalTrabalhoFields): mesma distribuição de campos, classes e textos. */}
                  <LocalTrabalhoFields
                    rascunho={rascunhoLocal}
                    onChange={fn => setRascunhoLocal(fn)}
                    onDirty={() => setErroLocal(null)}
                    comEspecialidades={perfilComEspecialidade}
                    especieIds={especiesFiltroEspecialidade}
                    espNomeById={espNomeById}
                    tempoPadraoEmpresa={tempoPadraoEmpresa}
                    diasEmpresaLabel={diasEmpresaLabel}
                    horarioEmpresaLabel={horarioEmpresaLabel}
                    textoEspecialidade={form.tipoUsuario === 'VETERINARIO'
                      ? 'sem nenhuma, você assume Clínica Médica'
                      : 'opcional'}
                    emptyTextEspecialidade="Selecione as espécies atendidas para listar as especialidades."
                  />

                  <div className="flex justify-end gap-2">
                    <button type="button"
                      onClick={() => { setMostrarFormLocal(false); setRascunhoLocal(RASCUNHO_LOCAL_VAZIO); setErroLocal(null); setEditIndex(null); }}
                      className="px-3 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-xs font-semibold hover:bg-gray-100">
                      Cancelar
                    </button>
                    <button type="button"
                      onClick={() => {
                        if (!rascunhoLocal.localizacaoId) { setErroLocal('Selecione o local'); return; }
                        if (rascunhoLocal.horaInicioTrabalho && rascunhoLocal.horaFimTrabalho
                            && rascunhoLocal.horaInicioTrabalho >= rascunhoLocal.horaFimTrabalho) {
                          setErroLocal('A hora de entrada deve ser menor que a de saída'); return;
                        }
                        // Ignora o próprio item ao editar (não conflita consigo mesmo)
                        const outros = form.locaisTrabalho.filter((_, i) => i !== editIndex);
                        // O mesmo local pode se repetir com outros dias/horário/especialidade
                        // (clínico seg/qua/sex e dermatologista ter/qui na mesma Hípica);
                        // o que não pode é sobrepor o turno de outra linha.
                        const conflito = conflitoEntreLocais([...outros, rascunhoLocal]);
                        if (conflito) { setErroLocal(conflito); return; }
                        // Dia/horário deve caber no expediente da empresa (o que manda)…
                        const foraEmpresa = validarExpedienteEmpresa(rascunhoLocal);
                        if (foraEmpresa) { setErroLocal(foraEmpresa); return; }
                        // …e dentro do que foi definido na inclusão como membro
                        const foraDaBase = validarDentroDaBase(rascunhoLocal);
                        if (foraDaBase) { setErroLocal(foraDaBase); return; }
                        setForm(prev => ({
                          ...prev,
                          locaisTrabalho: editIndex === null
                            ? [...prev.locaisTrabalho, rascunhoLocal]
                            : prev.locaisTrabalho.map((x, i) => i === editIndex ? rascunhoLocal : x),
                        }));
                        setRascunhoLocal(RASCUNHO_LOCAL_VAZIO);
                        setErroLocal(null);
                        setMostrarFormLocal(false);
                        setEditIndex(null);
                        limparErro('locaisTrabalho');
                      }}
                      className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold">
                      {editIndex === null ? 'Adicionar' : 'Salvar'}
                    </button>
                  </div>
                </div>
              )}
              {erroLocal && <p className="text-xs text-red-600 mt-1.5">{erroLocal}</p>}
              <FieldError message={errors.locaisTrabalho} />
            </div>
          )}

          {/* Legenda campos obrigatórios */}
          <p className="text-xs text-gray-400">
            <span className="text-red-500">*</span> Campos obrigatórios
          </p>

          {/* Erro de salvamento/conexão — junto ao botão, visível ao agir */}
          <InlineError message={erroInline} />

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

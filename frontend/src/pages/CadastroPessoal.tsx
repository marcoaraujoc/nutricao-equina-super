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
import FotoEditorModal from '../components/FotoEditorModal';
import {
  conflitoEntreLocais, resumoLocal,
  RASCUNHO_LOCAL_VAZIO, uniaoEspecialidadesLocais, PERFIS_COM_ESPECIALIDADE,
  TEMPO_CONSULTA_PADRAO_SISTEMA, LocalTrabalhoFields, rotuloPagamento,
  type LocalTrabalhoForm,
} from '../components/UsuarioFormModal';
import { CheckCircle2, XCircle, Loader2, Info, User, Plus, MapPin, Pencil, Trash2, Camera } from 'lucide-react';
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

// Compressão da foto antes do envio — MESMA função de Animal.tsx/Configuracoes.tsx.
// 600px basta: a foto é exibida como avatar (48px) e no modal de detalhes.
const comprimirImagem = (file: File, maxWidth = 600, qualidade = 0.82): Promise<File> =>
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
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg', lastModified: Date.now(),
          }));
        },
        'image/jpeg', qualidade,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });

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

// Cargos que podem informar especialidade e tempo de consulta (mesma regra do
// backend: ver CLAUDE.md §15). Estagiário, enfermeiro, secretaria e financeiro
// informam apenas local e horário de trabalho.
// ⚠️ GESTOR entrou em 2026-08-04: ele PODE cadastrar especialidade, mas nunca é
// obrigado — quem obriga (assumindo Clínica Médica quando nada é informado) é o
// backend, e só para VETERINARIO. Gestor sem especialidade continua válido.
const CARGOS_COM_ESPECIALIDADE = ['VETERINARIO', 'FORNECEDOR', 'PRESTADOR', 'GESTOR'];

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
  // Foto do cadastro NESTA empresa. `fotoFile`/`fotoRemovida` só valem no submit —
  // a foto é enviada junto com o Salvar, não ao escolher o arquivo (sair da tela sem
  // salvar não pode trocar a foto que a clínica já tem).
  const [fotoPreview,  setFotoPreview]  = useState<string | null>(null);
  const [fotoFile,     setFotoFile]     = useState<File | null>(null);
  const [fotoRemovida, setFotoRemovida] = useState(false);
  // Arquivo (recém-escolhido) ou URL (foto já salva) em edição no FotoEditorModal
  const [editandoFoto, setEditandoFoto] = useState<File | string | null>(null);
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
  // Cargo na equipe (ex: GESTOR) — definido quando foi incluído como membro
  const [cargoEquipe,     setCargoEquipe]     = useState<string | null>(null);
  // Vínculo com a empresa ativa — SOMENTE LEITURA aqui: quem define remuneração e
  // acesso é o gestor, no cadastro do membro. O PUT deste formulário nem os envia,
  // e o backend descartaria (salvarVinculo só grava CAMPOS_CADASTRO).
  const [vinculoEmpresa, setVinculoEmpresa] = useState<{
    tipoPagamento: string | null; formaPagamento: string | null;
    valorPagamento: number | null; acessoSistema: boolean | null;
  } | null>(null);
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
          setFotoPreview(data.fotoUrl ?? null);
          setFotoFile(null);
          setFotoRemovida(false);
          if (data.isConvidado) setIsConvidadoFlag(true);
          setCargoEquipe(data.cargoEquipe ?? null);
          setVinculoEmpresa({
            tipoPagamento:  data.tipoPagamento  ?? null,
            formaPagamento: data.formaPagamento ?? null,
            valorPagamento: data.valorPagamento ?? null,
            acessoSistema:  data.acessoSistema  ?? null,
          });
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

  // Escolher o arquivo NÃO grava nada: abre o editor (zoom + reposicionamento). O
  // avatar é `object-cover`, então sem enquadramento a foto em pé vira "queixo e testa".
  const handleFotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditandoFoto(file);
    e.target.value = ''; // permite reescolher o MESMO arquivo depois de remover
  };

  // O editor já devolve recortado no tamanho final; a compressão é só a garantia de
  // que um arquivo enorme não sobe caso o recorte volte maior que o limite.
  const handleFotoAjustada = async (arquivo: File) => {
    setEditandoFoto(null);
    const comprimido = await comprimirImagem(arquivo);
    setFotoFile(comprimido);
    setFotoRemovida(false);
    const reader = new FileReader();
    reader.onloadend = () => setFotoPreview(reader.result as string);
    reader.readAsDataURL(comprimido);
  };

  const handleRemoverFoto = () => {
    setFotoPreview(null);
    setFotoFile(null);
    setFotoRemovida(true);
  };

  /**
   * Envia a foto DEPOIS do PUT /users/me. Rota separada porque o cadastro é JSON e a
   * foto é multipart. Falha aqui não invalida o cadastro que já foi salvo — só avisa.
   */
  const enviarFoto = async () => {
    if (!fotoFile && !fotoRemovida) return;
    try {
      if (fotoRemovida) {
        await api.delete('/users/me/foto');
      } else if (fotoFile) {
        const fd = new FormData();
        fd.append('foto', fotoFile);
        await api.put('/users/me/foto', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      setFotoFile(null);
      setFotoRemovida(false);
    } catch (err) {
      const resposta = (err as { response?: { data?: { error?: string } } })?.response;
      toast.error(resposta?.data?.error ?? 'Cadastro salvo, mas a foto não pôde ser enviada.');
    }
  };

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

  // NOTA: NÃO existe bound pelo que o gestor definiu na inclusão do membro.
  // O profissional é dono do próprio expediente e pode trocar dias e horários aqui —
  // o que o gestor lançou na inclusão é ponto de partida, não teto. O único limite é
  // o EXPEDIENTE DA EMPRESA (validarExpedienteEmpresa), que o backend também aplica
  // em updateMe. Não reintroduzir a validação contra o snapshot da inclusão: era ela
  // que travava a alteração de dias/horário no Cadastro Pessoal.

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
        // A foto vai numa chamada à parte (multipart) — ver enviarFoto.
        await enviarFoto();
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

        {/* Foto do cadastro NESTA empresa (tb_usuario_empresa.foto_url) — é ela que a
            tela de Equipe exibe. Só é enviada ao salvar o formulário.
            MESMO formato da foto do animal (`Animal.tsx`): 128px, `rounded-3xl`, fundo
            neutro e o vazio convidando a ação (câmera + "Adicionar foto") em vez das
            INICIAIS. Iniciais são bom fallback em LISTA (é o que a tela de Equipe faz,
            e lá continua), mas num formulário elas parecem conteúdo já preenchido e
            escondem que ali se clica para enviar a foto. */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <label className="cursor-pointer group">
            <div className="w-32 h-32 rounded-3xl border-4 border-emerald-600 overflow-hidden bg-gray-50 shadow-inner transition-all group-hover:scale-105 flex items-center justify-center">
              {fotoPreview
                ? <img src={fotoPreview} alt="Sua foto" className="w-full h-full object-cover" />
                : <div className="flex flex-col items-center gap-1 text-emerald-500 p-3">
                    <Camera size={28} />
                    <span className="text-xs font-medium text-gray-400 text-center leading-tight">Adicionar foto</span>
                  </div>
              }
            </div>
            <input type="file" accept="image/*" className="hidden" onChange={handleFotoChange} />
          </label>
          {fotoPreview && (
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setEditandoFoto(fotoPreview)}
                className="text-xs text-emerald-700 hover:text-emerald-800 underline transition-colors">
                Ajustar foto
              </button>
              <button type="button" onClick={handleRemoverFoto}
                className="text-xs text-gray-400 hover:text-red-500 underline transition-colors">
                Remover foto
              </button>
            </div>
          )}
        </div>

        {/* Zoom + reposicionamento. Devolve o arquivo já recortado. */}
        {editandoFoto && (
          <FotoEditorModal
            origem={editandoFoto}
            onConfirmar={handleFotoAjustada}
            onCancelar={() => setEditandoFoto(null)}
          />
        )}

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
              </div>
            ) : (
              <select name="tipoUsuario" value={form.tipoUsuario} onChange={handleChange}
                className={inputCls('tipoUsuario')}>
                <option value="PROPRIETARIO">Proprietário</option>
                <option value="VETERINARIO">Médico Veterinário</option>
              </select>
            )}
          </div>

          {/* Remuneração e acesso — o que a clínica acordou com esta pessoa.
              Aparecem para CONFERÊNCIA, nunca para edição: mudar o próprio salário
              ou se autoconceder acesso é decisão do gestor, não de quem preenche
              o cadastro. Só há o que mostrar quando existe vínculo com a empresa. */}
          {(rotuloPagamento(vinculoEmpresa?.tipoPagamento, vinculoEmpresa?.formaPagamento, vinculoEmpresa?.valorPagamento)
            || vinculoEmpresa?.acessoSistema != null) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label text="Pagamento" />
                <div className="flex items-center gap-2 px-4 py-3 border border-gray-200 bg-gray-50 rounded-2xl">
                  <span className="text-gray-800 font-medium">
                    {rotuloPagamento(vinculoEmpresa?.tipoPagamento, vinculoEmpresa?.formaPagamento, vinculoEmpresa?.valorPagamento)
                      ?? 'Não informado'}
                  </span>
                </div>
              </div>
              <div>
                <Label text="Acesso ao sistema" />
                <div className="flex items-center gap-2 px-4 py-3 border border-gray-200 bg-gray-50 rounded-2xl">
                  <span className={`font-medium ${vinculoEmpresa?.acessoSistema === false ? 'text-red-600' : 'text-gray-800'}`}>
                    {vinculoEmpresa?.acessoSistema === false ? 'Sem acesso' : 'Liberado'}
                  </span>
                </div>
              </div>
            </div>
          )}

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
                <button type="button"
                  onClick={() => { setErroLocal(null); setEditIndex(null); setRascunhoLocal(RASCUNHO_LOCAL_VAZIO); setMostrarFormLocal(true); }}
                  className="flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-semibold hover:bg-emerald-50 transition-colors">
                  <Plus size={13} /> Adicionar local e horário de trabalho
                </button>
              )}

              {/* Formulário do novo local: local + dias + horas em UMA linha;
                  os botões ficam numa linha própria abaixo. */}
              {mostrarFormLocal && (
                <div className="p-3 bg-gray-50/60 border border-gray-200 rounded-2xl space-y-3">
                  {/* MESMO formulário do "Incluir/Editar Membro" — componente único
                      (LocalTrabalhoFields): mesma distribuição de campos, classes e textos.
                      `textoEspecialidade` segue `atuaComoVet`, não `form.tipoUsuario`:
                      só quem atua como vet NESTA empresa cai no padrão Clínica Médica.
                      O gestor tem `tipoUsuario` VETERINARIO no login, mas para ele a
                      especialidade é opcional — prometer o padrão seria mentira. */}
                  <LocalTrabalhoFields
                    rascunho={rascunhoLocal}
                    onChange={fn => setRascunhoLocal(fn)}
                    onDirty={() => setErroLocal(null)}
                    comEspecialidades={perfilComEspecialidade}
                    especieIds={especiesFiltroEspecialidade}
                    tempoPadraoEmpresa={tempoPadraoEmpresa}
                    diasEmpresaLabel={diasEmpresaLabel}
                    horarioEmpresaLabel={horarioEmpresaLabel}
                    textoEspecialidade={atuaComoVet
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
                        // Único limite: o expediente da empresa (o mesmo que o backend aplica)
                        const foraEmpresa = validarExpedienteEmpresa(rascunhoLocal);
                        if (foraEmpresa) { setErroLocal(foraEmpresa); return; }
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

          {/* Botões no tamanho padrão da aplicação (mesmas classes da tela de
              prescrição), alinhados à direita. */}
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => navigate(-1)}
              className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>

        </form>
      </div>
    </PageContainer>
  );
}

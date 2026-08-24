// src/pages/CadastroEmpresa.tsx
//
// CADASTRO DA EMPRESA — tela única do Gestor (2026-08-17, layout refeito em 2026-08-19).
//
// Reverte o modelo de 2026-08-16 (ADMIN edita, gestor só lê) e substitui as antigas
// `/cadastro/empresa` (identidade fiscal — este arquivo) + `/configuracoes`
// (preferências operacionais — `Configuracoes.tsx`, removida). O Admin agora cria só o
// GESTOR (ver `pages/CriacaoGestor.tsx`); a empresa nasce com identidade em branco, e é
// aqui que o próprio gestor a completa — sob a MESMA obrigatoriedade de preenchimento
// que antes travava só o expediente (ver ProtectedRoute + UserController.getMe).
//
// Ordem da tela (2026-08-19, para casar com o mockup): logotipo → Identificação
// (com o WhatsApp de conexão na mesma linha de e-mail/telefone) → Endereço da empresa →
// espécies/expediente → fechamento de fatura/tempo de consulta/validade do orçamento →
// Gestor Responsável e Tipo de Plano (leitura) → Outros gestores. Os campos "operacionais"
// (logo, WhatsApp, espécies, expediente, fechamento, tempo de consulta, validade do
// orçamento) vêm do hook `useConfiguracaoOperacional` — extraído do antigo componente
// `ConfiguracoesOperacionaisSection` porque o layout novo intercala esses campos com os
// de Identificação/Endereço em vez de empurrá-los para uma seção própria no fim.
//
// TODOS os campos de texto/seleção da tela usam a MESMA caixa (altura, borda, foco) —
// o padrão é o que a caixa do WhatsApp já tinha (`py-2.5` + anel de foco), não o padrão
// mais alto (`py-3`) de `CampoForm.INPUT_CLS` usado noutras telas de cadastro.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Loader2, Users2, AlertTriangle, UserPlus,
  Camera, MessageCircle, QrCode, Power,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ErroAcao, { classeErro, temErro, type ErroAcaoDados } from '../components/ErroAcao';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useEmpresa } from '../contexts/EmpresaContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { soDigitos, mascaraDocumento, mascaraTelefone, mascaraCep } from '../utils/mascaras';
import Campo from '../components/CampoForm';
import UsuarioFormModal, {
  type UsuarioFormValues, HoraInput, TEMPOS_CONSULTA, TEMPO_CONSULTA_PADRAO_SISTEMA,
} from '../components/UsuarioFormModal';
import {
  useConfiguracaoOperacional, maskWhatsapp, DIAS_SEMANA, ORDINAIS,
  VALIDADE_ORC_MIN, VALIDADE_ORC_MAX, type TipoSelecao,
} from '../hooks/useConfiguracaoOperacional';

interface UsoAssentos {
  limite:      number | null;
  ocupados:    number;
  ilimitado:   boolean;
  disponiveis: number | null;
}

interface PlanoContratado {
  slug:           string;
  nome:           string;
  valor:          number | null;
  validadeDias:   number | null;
  limiteUsuarios: number | null;
  status:         string;
  fimEm:          string | null;
  limiteOverride: number | null;
}

interface PessoaResumo {
  id?:           number;
  fullName:      string | null;
  email:         string | null;
  phone:         string | null;
  ativo?:        boolean;
  /** Só em `gestores` — quando o vínculo de GESTOR foi criado NESTA empresa. */
  dataInclusao?: string | null;
}

const moedaBR = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatarData = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

interface CadastroEmpresaDados {
  id:                number;
  nome:              string;
  razaoSocial:       string | null;
  nomeFantasia:      string | null;
  documento:         string | null;
  tipoDocumento:     string | null;
  inscricaoEstadual: string | null;
  emailContato:      string | null;
  telefone:          string | null;
  whatsapp:          string | null;
  cep:               string | null;
  endereco:          string | null;
  numero:            string | null;
  complemento:       string | null;
  bairro:            string | null;
  cidade:            string | null;
  estado:            string | null;
  status:            string;
  plano:             PlanoContratado | null;
  uso:               UsoAssentos;
  gestorResponsavel: PessoaResumo | null;
  gestores:          PessoaResumo[];
}

/**
 * Campos editáveis, SEMPRE string. Derivar de `CadastroEmpresaDados` com `Omit` traria
 * `string | null` do DTO, e input controlado com `null` é `undefined` na prática — React
 * troca para não-controlado e o campo para de responder. Ausência aqui é string vazia; a
 * conversão para `null` acontece na borda, ao salvar.
 */
type Form = Record<
  'nome' | 'razaoSocial' | 'nomeFantasia' | 'documento' | 'inscricaoEstadual' | 'emailContato' |
  'telefone' | 'cep' | 'endereco' | 'numero' | 'complemento' | 'bairro' |
  'cidade' | 'estado',
  string
>;

const FORM_VAZIO: Form = {
  nome: '', razaoSocial: '', nomeFantasia: '', documento: '', inscricaoEstadual: '',
  emailContato: '', telefone: '', cep: '', endereco: '',
  numero: '', complemento: '', bairro: '', cidade: '', estado: '',
};

const STATUS_LABEL: Record<string, { texto: string; cls: string }> = {
  ATIVA:     { texto: 'Ativa',     cls: 'bg-emerald-100 text-emerald-700' },
  SUSPENSA:  { texto: 'Suspensa',  cls: 'bg-red-100 text-red-700'         },
  CANCELADA: { texto: 'Cancelada', cls: 'bg-gray-200 text-gray-600'       },
};

// Caixa ÚNICA para todo campo de texto/seleção da tela — mesma altura/borda/foco da
// caixa do WhatsApp (anel de foco), pedido explicitamente para não haver campo "mais
// alto" que os outros (o padrão py-3 sem anel de `CampoForm.INPUT_CLS` fica só para as
// outras telas de cadastro, que não pediram essa uniformização).
// ⚠️ Altura EXPLÍCITA (`h-[42px]`), não só via padding: o botão Conectar/Desconectar
// usa fonte menor (text-xs) que o input (text-sm), e dependendo só do padding para
// dar a altura, o line-height diferente entre os dois deixava o botão mais baixo que
// os campos ao lado — mesma altura fixa nos dois é o que garante o alinhamento.
const INPUT =
  'w-full h-[42px] border border-gray-300 rounded-2xl px-4 py-2.5 text-sm text-gray-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-500 ' +
  'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed';

// Mesma caixa, para campos estreitos (Número, UF) — só a largura muda.
const inputEstreito = (largura: string) => `${largura} ${INPUT}`;

// Abre/Fecha — caixa própria, SEM reaproveitar `INPUT`: o padding do `INPUT`
// compartilhado (px-4 = 32px) não dá pra sobrepor com um `px-*` menor (Tailwind
// sempre aplica o valor maior do par nessa combinação, não o que vem depois na
// classe) — por isso essa caixa é construída do zero, com padding próprio.
const INPUT_HORARIO =
  'w-[60px] h-[42px] border border-gray-300 rounded-2xl px-1 py-2.5 text-sm text-gray-900 text-center ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-500 ' +
  'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed';

export default function CadastroEmpresa() {
  const { user } = useAuth();
  const { isGestor, loading: loadingPerms } = usePermissoes();
  const { loading: empresaLoading, contextoAtivo } = useEmpresa();
  const { empresaConfigurada, refreshSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const op = useConfiguracaoOperacional();

  const isAdminPlataforma =
    user?.userType?.toUpperCase() === 'ADMIN' || user?.role?.toUpperCase() === 'ADMIN';
  // Quem edita agora é o GESTOR da empresa ativa (2026-08-17) — o Admin continua
  // podendo editar (mesma resolução de `empresaDoGestorNoContexto` no backend), mas
  // deixou de ser o único.
  const podeEditar = isGestor || isAdminPlataforma;

  const [dados,      setDados]      = useState<CadastroEmpresaDados | null>(null);
  const [form,       setForm]       = useState<Form>(FORM_VAZIO);
  const [loading,    setLoading]    = useState(true);
  const [salvando,   setSalvando]   = useState(false);
  const [semAcesso,  setSemAcesso]  = useState(false);
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [erroSalvar, setErroSalvar] = useState<ErroAcaoDados | null>(null);

  // Capturado uma única vez, no primeiro render: se a empresa AINDA não estava
  // completa quando a página abriu, este acesso é o gate de primeiro login do gestor
  // (ProtectedRoute redirecionou para cá) — ao salvar, leva para dentro do app. Mesmo
  // padrão que a antiga Configuracoes.tsx já usava.
  const [completandoPrimeiroAcesso] = useState(() => !empresaConfigurada);

  const [showIncluirGestor, setShowIncluirGestor] = useState(false);
  const [enviandoGestor,    setEnviandoGestor]    = useState(false);
  const [erroGestorModal,   setErroGestorModal]   = useState<string | null>(null);

  const [buscandoCep, setBuscandoCep] = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const cnpjTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = (campo: keyof Form, valor: string) => setForm(f => ({ ...f, [campo]: valor }));

  // CEP → ViaCEP (mesmo padrão de CadastroProprietario/CriacaoGestor): busca ao
  // completar os 8 dígitos, preenche logradouro/bairro/cidade/UF sem sobrescrever o
  // que a pessoa já tiver digitado à mão nesses campos.
  const buscarCEP = async (cep: string) => {
    const nums = soDigitos(cep);
    if (nums.length !== 8) return;
    setBuscandoCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${nums}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm(f => ({
          ...f,
          endereco: data.logradouro ?? f.endereco,
          bairro:   data.bairro     ?? f.bairro,
          cidade:   data.localidade ?? f.cidade,
          estado:   data.uf         ?? f.estado,
        }));
      }
    } catch { /* silencioso */ }
    finally { setBuscandoCep(false); }
  };

  // CNPJ → BrasilAPI, via PROXY do backend (`GET /empresas/cnpj/:cnpj`): busca ao
  // completar os 14 dígitos (debounce — evita disparar a cada tecla enquanto o usuário
  // ainda está digitando/apagando).
  //
  // ⚠️ NÃO chamar `brasilapi.com.br` direto do navegador aqui — isso já causou
  // "blocked by CORS policy" no console: a BrasilAPI só garante o cabeçalho de CORS na
  // resposta de SUCESSO, então qualquer instabilidade dela (5xx, timeout, rate limit)
  // aparece no browser como bloqueio de CORS em vez do erro real. Servidor→servidor
  // não tem CORS — ver `EmpresaCadastroController.buscarCnpj`.
  const buscarCNPJ = async (nums: string) => {
    setBuscandoCnpj(true);
    try {
      const res = await api.get(`/empresas/cnpj/${nums}`);
      const data = res.data?.dados;
      if (!data) throw new Error();
      const enderecoStr = data.logradouro
        ? `${data.logradouro}${data.numero ? ', ' + data.numero : ''}`
        : '';
      setForm(f => ({
        ...f,
        razaoSocial:  data.razao_social  ?? f.razaoSocial,
        nomeFantasia: data.nome_fantasia || f.nomeFantasia,
        emailContato: data.email         || f.emailContato,
        telefone:     data.ddd_telefone_1 ? mascaraTelefone(data.ddd_telefone_1) : f.telefone,
        cep:          data.cep ? mascaraCep(soDigitos(data.cep)) : f.cep,
        endereco:     enderecoStr        || f.endereco,
        complemento:  data.complemento   ?? f.complemento,
        bairro:       data.bairro        ?? f.bairro,
        cidade:       data.municipio     ?? f.cidade,
        estado:       data.uf            ?? f.estado,
      }));
      toast.success('Dados do CNPJ preenchidos automaticamente');
    } catch {
      toast('CNPJ válido, mas não foi possível buscar os dados.', { icon: 'ℹ️' });
    } finally { setBuscandoCnpj(false); }
  };

  const handleDocumentoChange = (raw: string) => {
    const masked = mascaraDocumento(raw);
    set('documento', masked);
    const nums = soDigitos(masked);
    if (nums.length === 14) {
      if (cnpjTimerRef.current) clearTimeout(cnpjTimerRef.current);
      cnpjTimerRef.current = setTimeout(() => buscarCNPJ(nums), 300);
    }
  };

  const handleCepChange = (raw: string) => {
    const masked = mascaraCep(raw);
    set('cep', masked);
    if (soDigitos(masked).length === 8) buscarCEP(masked);
  };

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/empresas/cadastro');
      if (!res.data) { setSemAcesso(true); return; }   // GET 403 → data null
      const d = res.data.dados as CadastroEmpresaDados;
      setDados(d);
      setForm({
        nome:              d.nome ?? '',
        razaoSocial:       d.razaoSocial       ?? '',
        nomeFantasia:      d.nomeFantasia      ?? '',
        documento:         d.documento ? mascaraDocumento(d.documento) : '',
        inscricaoEstadual: d.inscricaoEstadual ?? '',
        emailContato:      d.emailContato      ?? '',
        telefone:          d.telefone ? mascaraTelefone(d.telefone) : '',
        cep:               d.cep ? mascaraCep(d.cep) : '',
        endereco:          d.endereco    ?? '',
        numero:            d.numero      ?? '',
        complemento:       d.complemento ?? '',
        bairro:            d.bairro      ?? '',
        cidade:            d.cidade      ?? '',
        estado:            d.estado      ?? '',
      });
      setSemAcesso(false);
      setErroInline(null);
    } catch {
      setErroInline('Erro ao carregar o cadastro da empresa.');
    } finally { setLoading(false); }
  }, []);

  // Nenhum fetch escopado por empresa antes de o contexto ativo resolver — senão volta
  // o cadastro da empresa errada (armadilha documentada no CLAUDE.md).
  useEffect(() => {
    if (loadingPerms || empresaLoading) return;
    carregar();
  }, [loadingPerms, empresaLoading, contextoAtivo?.empresaId, carregar]);

  const ehCnpj = soDigitos(form.documento).length === 14;

  const salvar = async () => {
    if (!podeEditar) return;
    setErroSalvar(null);

    if (!form.nome.trim()) {
      setErroSalvar({ mensagem: 'Nome da empresa é obrigatório.', campos: ['nome'] });
      return;
    }
    const doc = soDigitos(form.documento);
    if (!doc) {
      setErroSalvar({ mensagem: 'CNPJ / CPF é obrigatório.', campos: ['documento'] });
      return;
    }
    if (doc.length !== 11 && doc.length !== 14) {
      setErroSalvar({ mensagem: 'Documento deve ter 11 dígitos (CPF) ou 14 (CNPJ).', campos: ['documento'] });
      return;
    }
    if (!form.telefone.trim()) {
      setErroSalvar({ mensagem: 'Telefone é obrigatório.', campos: ['telefone'] });
      return;
    }
    if (doc.length === 14 && !form.razaoSocial.trim()) {
      setErroSalvar({
        mensagem: 'Razão Social é obrigatória para CNPJ.',
        campos: ['razaoSocial'],
      });
      return;
    }
    if (!(form.cep.trim() && form.endereco.trim() && form.bairro.trim() && form.cidade.trim() && form.estado.trim())) {
      setErroSalvar({
        mensagem: 'Endereço é obrigatório (CEP, logradouro, bairro, cidade e UF).',
        campos: ['cep', 'endereco', 'bairro', 'cidade', 'estado'],
      });
      return;
    }
    if (form.estado.trim().length !== 2) {
      setErroSalvar({ mensagem: 'Estado deve ter 2 letras (UF).', campos: ['estado'] });
      return;
    }

    setSalvando(true);
    try {
      await api.put('/empresas/cadastro', {
        ...form,
        documento: doc,
        telefone:  form.telefone.trim(),
        cep:       soDigitos(form.cep),
        estado:    form.estado.trim().toUpperCase(),
      });

      // Campos operacionais (espécies, expediente, fechamento, WhatsApp, logo…) — mesma
      // obrigatoriedade, endpoint diferente (PUT /equipes/configuracoes).
      const okOperacional = await op.salvar();
      if (!okOperacional) {
        // Erro já aparece abaixo do botão (ErroAcao do hook); só encerra o salvando.
        setSalvando(false);
        return;
      }

      toast.success('Cadastro da empresa atualizado');
      await carregar();

      // Recarrega cadastroCompleto/empresaConfigurada no contexto — sem isso o
      // Sidebar continua mostrando "Funcionalidades bloqueadas" e o ProtectedRoute
      // continua redirecionando para cá até um F5 manual.
      await refreshSelectedAnimal();
      if (completandoPrimeiroAcesso) {
        navigate('/painel-principal');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroSalvar({ mensagem: msg ?? 'Erro ao salvar o cadastro.' });
    } finally { setSalvando(false); }
  };

  const handleIncluirGestor = async (values: UsuarioFormValues) => {
    setEnviandoGestor(true);
    setErroGestorModal(null);
    try {
      await api.post('/equipes/incluir-membro', {
        email:        values.email,
        cargo:        'GESTOR',
        fullName:     values.fullName,
        phone:        values.phone,
        cep:          values.cep.trim()         || null,
        endereco:     values.endereco.trim()    || null,
        complemento:  values.complemento.trim() || null,
        bairro:       values.bairro.trim()      || null,
        cidade:       values.cidade.trim()      || null,
        estado:       values.estado.trim()      || null,
        // Gestor é sócio/dono da empresa — sem forma de pagamento a registrar aqui
        // (o backend não a exige para cargo GESTOR).
        acessoSistema: values.acessoSistema !== false,
      });
      toast.success('Gestor incluído com sucesso!');
      setShowIncluirGestor(false);
      carregar();
    } catch (err: unknown) {
      setErroGestorModal((err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao incluir gestor');
    } finally { setEnviandoGestor(false); }
  };

  if (!loadingPerms && !podeEditar && semAcesso) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Apenas o gestor da empresa ativa pode ver este cadastro.</p>
        </div>
      </PageContainer>
    );
  }

  const st = STATUS_LABEL[dados?.status ?? 'ATIVA'] ?? STATUS_LABEL.ATIVA;
  const uso = dados?.uso;
  const carregandoTudo = loading || op.loading;

  // Status de conexão do WhatsApp → cor da luz. Falha (indisponível no servidor OU
  // erro na última tentativa de conectar/desconectar) SEMPRE vence e pinta de
  // vermelho — mesmo que `op.waStatus` ainda diga outra coisa. Âmbar só na espera do
  // QR (transitório). Carregando fica cinza parado — ainda não se sabe a cor certa.
  const waFalhou      = !op.waDisponivel || Boolean(op.erroAcao);
  const waConectado   = !waFalhou && op.waStatus === 'CONECTADO';
  const waAguardando  = !waFalhou && op.waStatus === 'AGUARDANDO_QR';
  const waCarregando  = !waFalhou && op.waStatus === 'CARREGANDO';
  const waCorCls = waFalhou
    ? 'bg-red-500'
    : waConectado
    ? 'bg-emerald-500'
    : waAguardando
    ? 'bg-amber-400'
    : waCarregando
    ? 'bg-gray-300'
    : 'bg-red-500';
  // Carregando não pisca (ainda não há cor definitiva); os demais estados piscam
  // "de dentro para fora, como uma onda" — anel que se expande e desaparece por
  // cima do ponto sólido (padrão `animate-ping` do Tailwind), repetindo.
  const waPulsa = !waCarregando;
  const waDotTitulo = waFalhou
    ? (op.erroAcao?.mensagem ?? 'Falha ao conectar com o serviço de WhatsApp')
    : waConectado
    ? 'WhatsApp conectado'
    : waAguardando
    ? 'Aguardando leitura do QR Code'
    : waCarregando
    ? 'Verificando conexão…'
    : 'WhatsApp desconectado';

  // Caixa de leitura no padrão de CadastroPessoal.tsx (Pagamento / Acesso ao sistema):
  // rótulo em cima + valor num box cinza claro com borda — nunca um input, é conferência.
  const Leitura = ({ label, valor, tone = 'text-black/50' }: { label: string; valor: React.ReactNode; tone?: string }) => (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
      <div className={`text-sm ${tone}`}>{valor}</div>
    </div>
  );

  return (
    // 5xl (não 2xl como o Cadastro Pessoal): esta tela tem grids de até 6 colunas e a
    // tabela de "Outros gestores" — no 2xl (672px) elas ficariam espremidas. A
    // FORMATAÇÃO (cartão único, rótulos, inputs, divisores, botões) é a mesma;
    // a largura acompanha o conteúdo, que aqui é mais denso.
    <PageContainer maxWidth="5xl">
      <BotaoVoltar className="mb-4" />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-gray-900">
          <Building2 size={22} className="text-emerald-600" />
          Cadastro da Empresa
        </h1>
      </div>
      <p className="text-gray-500 mb-6 text-sm sm:text-base">
        {dados?.nome ?? '—'}
        <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.texto}</span>
      </p>

      <InlineError message={erroInline} className="mb-4" />

      {carregandoTudo ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          Carregando dados...
        </div>
      ) : (
        <div className="bg-white shadow rounded-3xl p-5 sm:p-8">
          <div className="space-y-5">

            {/* Empresa suspensa: o gestor precisa saber POR QUE ninguém entra (D3) */}
            {dados?.status === 'SUSPENSA' && (
              <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-red-50 border border-red-200 text-sm text-red-700">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <span>
                  <b>Empresa suspensa.</b> Ninguém consegue entrar no sistema por esta empresa
                  enquanto a situação não for regularizada. Quem também trabalha em outra clínica
                  continua acessando aquela normalmente.
                </span>
              </div>
            )}

            {/* ── Logotipo ────────────────────────────────────────────────────── */}
            <div className="flex flex-col items-center gap-3">
              <label className={podeEditar ? 'cursor-pointer group' : ''}>
                <div className="w-32 h-32 rounded-3xl border-4 border-emerald-600 overflow-hidden bg-gray-50 shadow-inner transition-all group-hover:scale-105 flex items-center justify-center">
                  {op.logoPreview
                    ? <img src={op.logoPreview} alt="Logotipo da empresa" className="w-full h-full object-contain" />
                    : <div className="flex flex-col items-center gap-1 text-emerald-500 p-3">
                        <Camera size={28} />
                        <span className="text-xs font-medium text-gray-400 text-center leading-tight">Adicionar logotipo</span>
                      </div>
                  }
                </div>
                {podeEditar && <input type="file" accept="image/*" className="hidden" onChange={op.handleLogoChange} />}
              </label>
              {podeEditar && op.logoPreview && (
                <button type="button" onClick={op.handleRemoverLogo}
                  className="text-xs text-gray-400 hover:text-red-500 underline transition-colors">
                  Remover logotipo
                </button>
              )}
            </div>

            {/* ── Identificação ──────────────────────────────────────────────── */}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-sm font-semibold text-gray-600 mb-4">Identificação</p>
              <div className="space-y-4 sm:space-y-6">
                {/* CNPJ/CPF, Nome da Empresa e Nome Fantasia na MESMA linha. Sem CNPJ
                    (documento é CPF), Nome Fantasia não se aplica e some — Nome da
                    Empresa toma o espaço dela para a linha continuar cheia. */}
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-4 sm:gap-6">
                  <Campo label="CNPJ / CPF *" className="sm:col-span-2">
                    <div className="relative">
                      <input className={classeErro(erroSalvar, 'documento', INPUT)} disabled={!podeEditar} value={form.documento} placeholder="00.000.000/0000-00"
                        onChange={e => handleDocumentoChange(e.target.value)} />
                      {buscandoCnpj && <Loader2 size={14} className="animate-spin text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2" />}
                    </div>
                  </Campo>
                  <Campo label="Nome da Empresa *" className={ehCnpj ? 'sm:col-span-2' : 'sm:col-span-4'}>
                    <input className={classeErro(erroSalvar, 'nome', INPUT)} disabled={!podeEditar} value={form.nome} onChange={e => set('nome', e.target.value)} />
                  </Campo>
                  {ehCnpj && (
                    <Campo label="Nome Fantasia" className="sm:col-span-2">
                      <input className={INPUT} disabled={!podeEditar} value={form.nomeFantasia} onChange={e => set('nomeFantasia', e.target.value)} />
                    </Campo>
                  )}
                </div>

                {ehCnpj && (
                  <div className="grid grid-cols-1 sm:grid-cols-6 gap-4 sm:gap-6">
                    <Campo label="Razão Social *" className="sm:col-span-4">
                      <input className={classeErro(erroSalvar, 'razaoSocial', INPUT)} disabled={!podeEditar} value={form.razaoSocial} onChange={e => set('razaoSocial', e.target.value)} />
                    </Campo>
                    <Campo label="Inscrição Estadual" className="sm:col-span-2">
                      <input className={INPUT} disabled={!podeEditar} value={form.inscricaoEstadual} onChange={e => set('inscricaoEstadual', e.target.value)} />
                    </Campo>
                  </div>
                )}

                {/* E-mail, Telefone, WhatsApp, Status e o botão único de conectar/
                    desconectar — TUDO na mesma linha, SEMPRE (nunca quebra: `flex-nowrap`
                    + `overflow-x-auto` — se a tela for estreita demais para os 5 itens,
                    a linha rola na horizontal em vez do botão cair para baixo). Telefone
                    e WhatsApp têm largura FIXA (16 caracteres + só o padding que o input
                    já usa, sem folga extra); o E-mail é quem absorve o espaço sobrando. */}
                <div className="flex flex-nowrap items-end gap-4 sm:gap-6 overflow-x-auto pb-1">
                  <Campo label="E-mail de Contato" className="flex-1 min-w-[260px]">
                    <input className={INPUT} disabled={!podeEditar} type="email" value={form.emailContato} onChange={e => set('emailContato', e.target.value)} />
                  </Campo>

                  <Campo label="Telefone *" className="w-[162px] flex-shrink-0">
                    <input className={classeErro(erroSalvar, 'telefone', INPUT)} disabled={!podeEditar} value={form.telefone} placeholder="(11) 3333-4444"
                      onChange={e => set('telefone', mascaraTelefone(e.target.value))} />
                  </Campo>

                  {/* WhatsApp + Status + Botão formam um GRUPO à parte, com espaçamento
                      MENOR entre si (gap-2) do que o resto da linha (gap-4/6) — são
                      peças de uma mesma ação, não campos independentes. */}
                  <div className="flex items-end gap-2 flex-shrink-0">
                    {/* WhatsApp da empresa — só o número aqui; status e botão são itens
                        PRÓPRIOS do grupo, a seguir. */}
                    <Campo label="WhatsApp da Empresa" className="w-[162px] flex-shrink-0">
                      <div className="relative">
                        <MessageCircle size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
                        <input
                          type="tel"
                          inputMode="numeric"
                          disabled={!podeEditar}
                          value={op.whatsapp}
                          onChange={e => op.setWhatsapp(maskWhatsapp(e.target.value))}
                          placeholder="(11) 98765-4321"
                          className={`${classeErro(op.erroAcao, 'whatsapp', INPUT)} pl-10 pr-2`}
                        />
                      </div>
                    </Campo>

                    {/* Status da conexão (Evolution API) — sem rótulo (a cor já diz
                        tudo); a luz pisca "de dentro para fora, como uma onda" — anel
                        que se expande e desaparece por cima do ponto sólido, repetindo. */}
                    <div className="h-[42px] flex items-center justify-center flex-shrink-0">
                      <span className="relative inline-flex w-2.5 h-2.5" role="status" title={waDotTitulo} aria-label={waDotTitulo}>
                        {waPulsa && (
                          <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${waCorCls}`} />
                        )}
                        <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${waCorCls}`} />
                      </span>
                    </div>

                    {/* Botão ÚNICO: conecta ou desconecta, conforme o estado atual. Largura
                        FIXA (independente do rótulo mudar de "Conectar" para
                        "Desconectar") e conteúdo CENTRALIZADO — vira uma caixa igual às
                        demais da linha, não um botão "solto" do tamanho do texto. */}
                    {podeEditar && (
                      <div className="w-36 flex-shrink-0">
                        <label className="block text-sm font-medium text-gray-700 mb-1 invisible">Ação</label>
                        <button
                          type="button"
                          onClick={op.handleWaToggle}
                          disabled={op.waAcao || !op.waDisponivel || waAguardando}
                          title={waConectado ? 'Desconectar WhatsApp' : 'Conectar WhatsApp'}
                          className={`w-full h-[42px] flex items-center justify-center gap-1.5 px-3 rounded-2xl text-xs font-semibold whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            waConectado
                              ? 'border border-red-200 text-red-600 hover:bg-red-50'
                              : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                          }`}
                        >
                          {op.waAcao || waAguardando
                            ? <Loader2 size={12} className="animate-spin" />
                            : waConectado ? <Power size={12} /> : <QrCode size={12} />}
                          {waAguardando ? 'Aguardando leitura…' : waConectado ? 'Desconectar' : 'Conectar'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Erro da AÇÃO (conectar/desconectar) logo abaixo da linha que a
                    disparou (§6 do CLAUDE.md) — antes só aparecia lá embaixo, perto do
                    Salvar, e uma falha aqui parecia "não fez nada". */}
                <ErroAcao erro={op.erroAcao} />

                {!op.waDisponivel && (
                  <p className="text-[11px] text-amber-600">
                    Integração de WhatsApp não configurada no servidor — contate o administrador do sistema.
                  </p>
                )}
                {op.waQr && (
                  <div className="flex flex-col items-center gap-2 border border-gray-200 rounded-2xl p-4">
                    <img
                      src={op.waQr.startsWith('data:') ? op.waQr : `data:image/png;base64,${op.waQr}`}
                      alt="QR Code do WhatsApp"
                      className="w-52 h-52 rounded-xl border border-gray-200"
                    />
                    <p className="text-xs text-gray-500 text-center">
                      Abra o WhatsApp no celular da clínica → <b>Aparelhos conectados</b> → <b>Conectar aparelho</b> e leia o código.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Endereço da empresa ────────────────────────────────────────── */}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-sm font-semibold text-gray-600 mb-4">Endereço da Empresa</p>
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-4 sm:gap-6">
                <Campo label="CEP *" className="sm:col-span-2">
                  <div className="relative">
                    <input className={classeErro(erroSalvar, 'cep', INPUT)} disabled={!podeEditar} value={form.cep} placeholder="00000-000"
                      onChange={e => handleCepChange(e.target.value)} />
                    {buscandoCep && <Loader2 size={14} className="animate-spin text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2" />}
                  </div>
                </Campo>
                <Campo label="Logradouro *" className="sm:col-span-3">
                  <input className={classeErro(erroSalvar, 'endereco', INPUT)} disabled={!podeEditar} value={form.endereco} onChange={e => set('endereco', e.target.value)} />
                </Campo>
                <Campo label="Número" className="sm:col-span-1">
                  <input className={INPUT} disabled={!podeEditar} value={form.numero} onChange={e => set('numero', e.target.value)} />
                </Campo>
                <Campo label="Complemento" className="sm:col-span-2">
                  <input className={INPUT} disabled={!podeEditar} value={form.complemento} onChange={e => set('complemento', e.target.value)} />
                </Campo>
                <Campo label="Bairro *" className="sm:col-span-2">
                  <input className={classeErro(erroSalvar, 'bairro', INPUT)} disabled={!podeEditar} value={form.bairro} onChange={e => set('bairro', e.target.value)} />
                </Campo>
                <Campo label="Cidade *" className="sm:col-span-1">
                  <input className={classeErro(erroSalvar, 'cidade', INPUT)} disabled={!podeEditar} value={form.cidade} onChange={e => set('cidade', e.target.value)} />
                </Campo>
                <Campo label="UF *" className="sm:col-span-1">
                  <input className={classeErro(erroSalvar, 'estado', INPUT)} disabled={!podeEditar} maxLength={2} value={form.estado}
                    onChange={e => set('estado', e.target.value.toUpperCase())} />
                </Campo>
              </div>
            </div>

            {/* ── Espécies atendidas + Dias de atendimento + Horário de atendimento ──
                Os três grupos SEMPRE na mesma linha (`flex-nowrap`, nunca quebra —
                mesmo tratamento da linha de E-mail/Telefone/WhatsApp: se a tela for
                estreita demais, rola na horizontal em vez de empilhar), separados só
                por espaço (sem divisória). */}
            <div className="pt-2 border-t border-gray-100">
              <div className="flex flex-nowrap items-start gap-8 overflow-x-auto pb-1">
                <div className="flex-shrink-0">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Espécies Atendidas <span className="text-red-500">*</span>
                  </label>
                  <div className={`flex flex-wrap gap-2 ${temErro(op.erroAcao, 'especies') ? 'ring-1 ring-red-300 rounded-2xl p-1' : ''}`}>
                    {op.especies.map(e => {
                      const on = op.especiesAtendidas.includes(e.id);
                      return (
                        <button key={e.id} type="button" disabled={!podeEditar}
                          onClick={() => op.setEspeciesAtendidas(prev => on ? prev.filter(x => x !== e.id) : [...prev, e.id])}
                          className={`px-3 py-2.5 rounded-2xl border text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                            on ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}>
                          {e.nome}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex-shrink-0">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Dias de Atendimento <span className="text-red-500">*</span>
                  </label>
                  <div className={`flex flex-wrap gap-1.5 ${temErro(op.erroAcao, 'dias') ? 'ring-1 ring-red-300 rounded-2xl p-1' : ''}`}>
                    {DIAS_SEMANA.map(d => {
                      const on = op.diasAtend.includes(d.v);
                      return (
                        <button key={d.v} type="button" disabled={!podeEditar}
                          onClick={() => op.setDiasAtend(prev => on ? prev.filter(x => x !== d.v) : [...prev, d.v].sort((a, b) => a - b))}
                          className={`px-2.5 py-2.5 rounded-2xl text-xs font-bold border transition-colors disabled:cursor-not-allowed ${
                            on ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}>
                          {d.l}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Abre / Fecha — dois campos INDEPENDENTES, rótulo em cima da caixa
                    (mesmo padrão de Espécies/Dias), sem o título "Horário de
                    atendimento" agrupando os dois por cima. */}
                <div className="flex items-start gap-2 flex-shrink-0">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2">Abre</label>
                    <HoraInput value={op.horaInicio} onChange={op.setHoraInicio}
                      className={classeErro(op.erroAcao, 'horaInicio', INPUT_HORARIO)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2">Fecha</label>
                    <HoraInput value={op.horaFim} onChange={op.setHoraFim}
                      className={classeErro(op.erroAcao, 'horaFim', INPUT_HORARIO)} />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Fechamento da fatura + Tempo de consulta padrão + Validade do orçamento ── */}
            <div className="pt-2 border-t border-gray-100">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Fechamento da Fatura
                  </label>
                  <select
                    value={op.tipoSelecao}
                    disabled={!podeEditar}
                    onChange={e => { op.setTipoSelecao(e.target.value as TipoSelecao); op.setErroDia(null); }}
                    className={`${INPUT} bg-white`}
                  >
                    <option value="ULTIMO_DIA_MES">Último dia do mês</option>
                    <option value="PRIMEIRO_DIA_MES">Primeiro dia do mês</option>
                    <option value="DIA_ESPECIFICO">Dia específico do mês</option>
                    <option value="DIA_UTIL">Dia útil do mês</option>
                  </select>

                  {op.tipoSelecao === 'DIA_ESPECIFICO' && (
                    <>
                      <input
                        type="number"
                        min={1}
                        max={28}
                        disabled={!podeEditar}
                        value={op.diaEspecifico}
                        onChange={e => { op.setDiaEspecifico(e.target.value); op.setErroDia(null); }}
                        placeholder="Ex: 5 (1 a 28)"
                        className={`${INPUT} mt-2 ${op.erroDia ? 'border-red-400 ring-1 ring-red-300' : ''}`}
                      />
                      {op.erroDia && <p className="text-xs text-red-600 mt-1">{op.erroDia}</p>}
                    </>
                  )}

                  {op.tipoSelecao === 'DIA_UTIL' && (
                    <select
                      value={op.nDiaUtil}
                      disabled={!podeEditar}
                      onChange={e => op.setNDiaUtil(e.target.value)}
                      className={`${INPUT} mt-2 bg-white`}
                    >
                      {ORDINAIS.map((label, i) => (
                        <option key={i} value={i + 1}>{label} dia útil</option>
                      ))}
                    </select>
                  )}

                  <p className="text-xs text-gray-400 mt-1">
                    {op.tipoSelecao === 'DIA_UTIL'
                      ? 'Dia útil considera fins de semana e feriados nacionais.'
                      : op.tipoSelecao === 'DIA_ESPECIFICO'
                      ? 'O dia específico vai de 1 a 28 para existir em todos os meses do ano.'
                      : 'Se o dia escolhido não existir no mês, a fatura fecha no último dia do mês.'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Tempo de Consulta <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={op.tempoConsultaPadrao}
                    disabled={!podeEditar}
                    onChange={e => op.setTempoConsultaPadrao(e.target.value)}
                    className={classeErro(op.erroAcao, 'tempoConsulta', `${INPUT} bg-white`)}
                  >
                    <option value="">Selecione…</option>
                    {TEMPOS_CONSULTA.map(m => (
                      <option key={m} value={m}>{m} min</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Padrão do sistema, se nenhum for escolhido: {TEMPO_CONSULTA_PADRAO_SISTEMA} min.</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Validade do Orçamento
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={VALIDADE_ORC_MIN}
                      max={VALIDADE_ORC_MAX}
                      disabled={!podeEditar}
                      value={op.validadeOrcamento}
                      onChange={e => op.setValidadeOrcamento(e.target.value)}
                      placeholder="Sem validade"
                      className={classeErro(op.erroAcao, 'validadeOrcamento', inputEstreito('w-24'))}
                    />
                    <span className="text-sm text-gray-500">dias</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Em branco, o orçamento não expira.
                  </p>
                </div>

                {/* ⚠️ O FUSO HORÁRIO NÃO APARECE MAIS AQUI (removido a pedido, 2026-08-24):
                    o campo era só leitura e não havia nada a fazer com ele nesta tela.
                    O fuso CONTINUA existindo e valendo — é ele que faz o horário das
                    doses, da agenda e dos avisos seguirem o relógio de quem atende. Só
                    deixou de ser exibido. Ele é DEDUZIDO do CEP/UF que este mesmo
                    cadastro coleta (`lib/fusoEmpresa.js#fusoPorEndereco`), chega ao
                    front por `GET /equipes/logo` e é aplicado pelo `EmpresaContext`.
                    Não reintroduzir como campo editável: ninguém precisa saber o que é
                    "America/Cuiaba" para cadastrar uma clínica — foi essa a razão de o
                    seletor ter saído da tela em 2026-08-23. Para corrigir um caso que o
                    endereço não decide, o caminho é o override
                    `EmpresaConfiguracao.fusoHorario`, fora da UI do gestor. */}
              </div>
            </div>

            {/* ── Gestor Responsável e Tipo de Plano — nome/telefone/e-mail do cadastro
                feito pelo Admin (leitura) + o plano contratado (leitura; trocar de
                plano é ato comercial, do ADMIN) ── */}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-1.5">
                <Users2 size={14} className="text-gray-400" /> Gestor Responsável e Tipo de Plano
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                <Leitura label="Nome" valor={dados?.gestorResponsavel?.fullName ?? '—'} />
                <Leitura label="Telefone" valor={dados?.gestorResponsavel?.phone ?? '—'} />
                <Leitura label="E-mail" valor={dados?.gestorResponsavel?.email ?? '—'} />
                {dados?.plano ? (
                  <>
                    <Leitura label="Plano" valor={dados.plano.nome} />
                    <Leitura label="Valor" valor={<>{moedaBR(dados.plano.valor)}{dados.plano.valor != null && <span className="text-gray-400 font-normal"> /mês</span>}</>} />
                    <Leitura label="Situação" valor={dados.plano.status} />
                    <Leitura label="Usuários com acesso" valor={`${uso?.ocupados ?? 0}${uso?.ilimitado ? ' (sem limite)' : ` de ${uso?.limite}`}`} />
                    {!uso?.ilimitado && (
                      <Leitura label="Disponíveis" valor={uso?.disponiveis} tone={uso?.disponiveis === 0 ? 'text-red-600' : 'text-emerald-700'} />
                    )}
                  </>
                ) : (
                  /* Empresa sem assinatura é ILIMITADA por decisão (lib/planoEmpresa.js) —
                     e o gestor precisa ver isso, não um espaço em branco. */
                  <Leitura
                    label="Plano"
                    tone="text-gray-500"
                    valor={<>Nenhum plano atribuído — sem limite.<span className="text-gray-400 font-normal"> {uso?.ocupados ?? 0} com acesso hoje.</span></>}
                  />
                )}
              </div>
            </div>

            {/* ── Outros gestores ────────────────────────────────────────────── */}
            <div className="pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-sm font-semibold text-gray-600">Outros Gestores</p>
                {podeEditar && (
                  <button type="button" onClick={() => setShowIncluirGestor(true)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800">
                    <UserPlus size={14} /> Incluir gestor
                  </button>
                )}
              </div>
              {(dados?.gestores?.length ?? 0) === 0 ? (
                <p className="text-sm text-gray-500">Nenhum gestor cadastrado.</p>
              ) : (
                <>
                  {/* Desktop — grid em 4 colunas */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="py-2 pr-3 text-left text-xs font-semibold text-gray-500">Nome</th>
                          <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500">E-mail</th>
                          <th className="py-2 px-3 text-left text-xs font-semibold text-gray-500">Telefone</th>
                          <th className="py-2 pl-3 text-left text-xs font-semibold text-gray-500">Data Inclusão</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {dados!.gestores.map(g => (
                          <tr key={g.id}>
                            <td className="py-2.5 pr-3">
                              <span className="text-sm text-gray-900">{g.fullName ?? '—'}</span>
                              {g.id === dados?.gestorResponsavel?.id && (
                                <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Responsável</span>
                              )}
                              {g.ativo === false && (
                                <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600">Inativo</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-sm text-gray-500">{g.email ?? '—'}</td>
                            <td className="py-2.5 px-3 text-sm text-gray-500">{g.phone ?? '—'}</td>
                            <td className="py-2.5 pl-3 text-sm text-gray-500">{formatarData(g.dataInclusao)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile — cards */}
                  <div className="md:hidden space-y-2">
                    {dados!.gestores.map(g => (
                      <div key={g.id} className="px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
                        <p className="text-sm font-semibold text-gray-800 truncate">
                          {g.fullName ?? '—'}
                          {g.id === dados?.gestorResponsavel?.id && (
                            <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Responsável</span>
                          )}
                          {g.ativo === false && (
                            <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600">Inativo</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{g.email}{g.phone ? ` · ${g.phone}` : ''}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">Incluído em {formatarData(g.dataInclusao)}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Somente quem edita salva — para quem só vê não há botão nenhum aqui (§6 do
                CLAUDE.md: ação que a pessoa não pode executar não é renderizada). */}
            {podeEditar && (
              <>
                {/* Erro da AÇÃO logo abaixo do botão que a disparou (§6 do CLAUDE.md) */}
                <div className="flex justify-end gap-2 mt-2">
                  <button type="button" onClick={() => navigate(-1)} disabled={salvando}
                    className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                    Cancelar
                  </button>
                  <button type="button" onClick={salvar} disabled={salvando}
                    className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors">
                    {salvando ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
                <ErroAcao erro={erroSalvar} />
                <ErroAcao erro={op.erroAcao} />
              </>
            )}
          </div>
        </div>
      )}

      {showIncluirGestor && (
        <UsuarioFormModal
          titulo="Incluir Gestor"
          infoNota="A pessoa será adicionada imediatamente como gestora desta empresa. Um e-mail de boas-vindas será enviado."
          textoBotao="Incluir"
          ocultarPerfil
          comVinculoEmpresa
          ocultarPagamento
          initial={{ perfil: 'GESTOR', cargos: ['GESTOR'] }}
          salvando={enviandoGestor}
          erroServidor={erroGestorModal}
          onClose={() => { setShowIncluirGestor(false); setErroGestorModal(null); }}
          onSubmit={handleIncluirGestor}
        />
      )}
    </PageContainer>
  );
}

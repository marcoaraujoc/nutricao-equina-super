// src/pages/Equipe.tsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Users2, Mail, ToggleLeft, ToggleRight,
  Loader2, X, Search,
  Pencil, Check,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar   from '../components/BotaoVoltar';
import UsuarioFormModal, { type UsuarioFormValues } from '../components/UsuarioFormModal';
import InlineError from '../components/InlineError';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Membro {
  id:        number;
  cargo:     string;
  cargos?:   string[];
  createdAt: string;
  diasTrabalho?:       string | null;  // CSV 0-6 (agregado — Agenda)
  horaInicioTrabalho?: string | null;  // HH:MM
  horaFimTrabalho?:    string | null;  // HH:MM
  locaisTrabalho?: Array<{
    localizacaoId:      number;
    localizacaoNome:    string | null;
    diasTrabalho:       string | null;
    horaInicioTrabalho: string | null;
    horaFimTrabalho:    string | null;
    especialidadeIds?:  number[];
    temposConsulta?:    Record<number, number>;
  }>;
  user: {
    id:       number;
    fullName: string;
    email:    string;
    userType: string;
    ativo:    boolean;
    phone?:       string | null;
    cep?:         string | null;
    endereco?:    string | null;
    complemento?: string | null;
    bairro?:      string | null;
    cidade?:      string | null;
    estado?:      string | null;
    // Foto do cadastro NESTA empresa (tb_usuario_empresa.foto_url), enviada pelo
    // próprio profissional no Cadastro Pessoal. null = sem foto → iniciais.
    fotoUrl?:     string | null;
    fornecedorPerfil?: { tipoServico?: string | null } | null;
    especialidades?: Array<{ especialidadeId: number; especialidade?: { id: number; nome: string } }>;
    // Vínculo com ESTA empresa (tb_usuario_empresa): remuneração e acesso ao sistema
    tipoPagamento?:  string | null;
    formaPagamento?: string | null;
    valorPagamento?: number | null;
    acessoSistema?:  boolean;
  };
  equipe?: { nome: string };
}

// Dias da semana (0=Dom … 6=Sáb) — mesma convenção de Date.getDay()
const DIAS_SEMANA_LABEL: Record<number, string> = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' };

// Converte os locais do formulário para o payload do backend (dias como array).
type LocalTrabalhoValue = NonNullable<UsuarioFormValues['locaisTrabalho']>[number];
const mapLocaisParaPayload = (locais?: LocalTrabalhoValue[]) =>
  (locais ?? [])
    .filter(l => l.localizacaoId)
    .map(l => ({
      localizacaoId:      l.localizacaoId,
      diasTrabalho:       l.diasTrabalho,
      horaInicioTrabalho: l.horaInicioTrabalho || '',
      horaFimTrabalho:    l.horaFimTrabalho || '',
      especialidadeIds:   l.especialidadeIds ?? [],
      temposConsulta:     l.temposConsulta ?? {},
    }));

// Especialidades do membro (catálogo por espécie) — fallback para tipoServico legado do Fornecedor
function especialidadesDoMembro(m: Membro): string[] {
  const espec = (m.user.especialidades ?? [])
    .map(e => e.especialidade?.nome)
    .filter((n): n is string => !!n);
  if (espec.length > 0) return espec;
  return m.user.fornecedorPerfil?.tipoServico
    ? m.user.fornecedorPerfil.tipoServico.split(',').map(t => t.trim()).filter(Boolean)
    : [];
}

// "Seg, Ter · 08:00–12:00" — dias (CSV 0-6) + faixa de horário
function formatarDiasHorario(dias: string | null | undefined, inicio?: string | null, fim?: string | null): string | null {
  const nums = dias
    ? String(dias).split(',').map(Number).filter(n => n >= 0 && n <= 6).sort((a, b) => a - b)
    : [];
  const diasLabel = nums.length > 0 ? nums.map(d => DIAS_SEMANA_LABEL[d]).join(', ') : null;
  const horaLabel = inicio && fim ? `${inicio}–${fim}` : null;
  if (!diasLabel && !horaLabel) return null;
  return [diasLabel, horaLabel].filter(Boolean).join(' · ');
}

// Expediente POR LOCAL — o membro pode trabalhar em vários locais (e no MESMO local
// mais de uma vez, com outra especialidade e outros dias). Cada linha carrega a
// ESPECIALIDADE daquele turno, para se ler tudo junto:
//   "Clínica Médica · Centro Hípico H.P — Seg, Qua, Qui · 08:00–14:00"
// Sem locais cadastrados, cai no expediente agregado do vínculo (compatibilidade com
// quem configurou antes dos locais); vazio = herda da empresa.
function expedientePorLocal(
  m: Membro,
  nomeEspecialidade: (id: number) => string,
): { especialidades: string[]; local: string | null; quando: string | null }[] {
  // `quando` null = dias/horário em branco no cadastro, que HERDAM o expediente da
  // empresa. A linha continua valendo (o local e a especialidade são reais) — antes
  // ela era descartada e o turno sumia da tela junto com a especialidade dele.
  const locais = (m.locaisTrabalho ?? []).map(l => ({
    especialidades: (l.especialidadeIds ?? []).map(nomeEspecialidade),
    local:  l.localizacaoNome ?? `Local #${l.localizacaoId}`,
    quando: formatarDiasHorario(l.diasTrabalho, l.horaInicioTrabalho, l.horaFimTrabalho),
  }));
  if (locais.length > 0) return locais;

  const agregado = formatarDiasHorario(m.diasTrabalho, m.horaInicioTrabalho, m.horaFimTrabalho);
  return agregado ? [{ especialidades: [], local: null, quando: agregado }] : [];
}

// Iniciais para quem ainda não enviou foto (mesmo fallback do Cadastro Pessoal)
const iniciaisDe = (nome: string): string =>
  nome.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';

/**
 * Avatar do membro — quadrado de 3 LINHAS (h-12 = 48px ≈ 3 linhas de texto da lista),
 * clicável: abre a ficha com especialidade, local, horário, telefone e e-mail.
 * É `button` de propósito (e não `div` com onClick): dá foco por teclado e Enter/Espaço
 * de graça, que é o mínimo para um elemento que abre um diálogo.
 */
function AvatarMembro({ membro, onClick, className = '' }: {
  membro: Membro; onClick: () => void; className?: string;
}) {
  const foto = membro.user.fotoUrl;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Ver dados de ${membro.user.fullName}`}
      aria-label={`Ver dados de ${membro.user.fullName}`}
      className={`w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 border border-gray-200 bg-emerald-50 flex items-center justify-center transition-all hover:ring-2 hover:ring-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${className}`}
    >
      {foto
        ? <img src={foto} alt="" className="w-full h-full object-cover" />
        : <span className="text-sm font-bold text-emerald-700">{iniciaisDe(membro.user.fullName)}</span>}
    </button>
  );
}

/**
 * Ficha do membro — abre ao clicar na foto. Mostra o que a equipe precisa para
 * acionar a pessoa: especialidade, local, horário, telefone e e-mail. É só LEITURA;
 * quem edita é o gestor, pelo botão Editar da linha.
 */
function FichaMembro({ membro, linhas, especialidades, onFechar }: {
  membro: Membro;
  linhas: { especialidades: string[]; local: string | null; quando: string | null }[];
  especialidades: string[];
  onFechar: () => void;
}) {
  const u = membro.user;
  // Sem linha por local, a especialidade ainda aparece (vem do cadastro do membro).
  const listaEspecialidades = linhas.length > 0
    ? [...new Set(linhas.flatMap(l => (l.especialidades.length > 0 ? l.especialidades : especialidades)))]
    : especialidades;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onFechar}>
      <div
        className="bg-white rounded-3xl w-full max-w-md shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 rounded-t-2xl">
          <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 border border-gray-200 bg-emerald-50 flex items-center justify-center">
            {u.fotoUrl
              ? <img src={u.fotoUrl} alt="" className="w-full h-full object-cover" />
              : <span className="text-base font-bold text-emerald-700">{iniciaisDe(u.fullName)}</span>}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-gray-900 truncate">{u.fullName}</p>
            <p className="text-xs text-gray-400 truncate">{labelCargo(membro.cargo)}</p>
          </div>
          <button type="button" onClick={onFechar}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Especialidade</p>
            {listaEspecialidades.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {listaEspecialidades.map(t => (
                  <span key={t} className="text-[11px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">{t}</span>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400">Não informada</p>}
          </div>

          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
              Local e horário de atendimento
            </p>
            {linhas.length === 0 ? (
              <p className="text-sm text-gray-400">Expediente padrão da empresa</p>
            ) : (
              <ul className="space-y-1.5">
                {linhas.map((l, i) => (
                  <li key={i} className="text-sm text-gray-700">
                    <span className="font-medium">{l.local ?? 'Sem local definido'}</span>
                    <span className="block text-xs text-gray-500">
                      {l.quando ?? 'expediente da empresa'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 pt-1 border-t border-gray-50">
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Telefone</p>
              {u.phone
                ? <a href={`tel:${u.phone.replace(/\D/g, '')}`} className="text-sm text-emerald-700 hover:underline">{u.phone}</a>
                : <p className="text-sm text-gray-400">Não informado</p>}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">E-mail</p>
              <a href={`mailto:${u.email}`} className="text-sm text-emerald-700 hover:underline break-all">{u.email}</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const labelCargo = (cargo: string): string => ({
  GESTOR:       'Gestor',
  VETERINARIO:  'Veterinário',
  ESTAGIARIO:   'Estagiário',
  ENFERMEIRO:   'Enfermeiro',
  SECRETARIA:   'Secretaria',
  FINANCEIRO:   'Financeiro',
  FORNECEDOR:   'Fornecedor',
  ADMIN:        'Administrador',
  MEMBRO:       'Membro',
  PROPRIETARIO: 'Proprietário',
} as Record<string,string>)[cargo] ?? cargo;

const badgeCargo = (cargo: string): string => ({
  GESTOR:       'bg-purple-100 text-purple-700',
  VETERINARIO:  'bg-emerald-100 text-emerald-700',
  ESTAGIARIO:   'bg-blue-100 text-blue-700',
  ENFERMEIRO:   'bg-cyan-100 text-cyan-700',
  SECRETARIA:   'bg-amber-100 text-amber-700',
  FINANCEIRO:   'bg-orange-100 text-orange-700',
  FORNECEDOR:   'bg-teal-100 text-teal-700',
  ADMIN:        'bg-red-100 text-red-700',
  MEMBRO:       'bg-gray-100 text-gray-600',
  PROPRIETARIO: 'bg-purple-100 text-purple-700',
} as Record<string,string>)[cargo] ?? 'bg-gray-100 text-gray-600';

// ─── Componente ──────────────────────────────────────────────────────────────

export default function Equipe() {
  const { user }                                          = useAuth();
  // Backend (EquipeController.atualizarMembro) bloqueia gestor editando OUTRO gestor —
  // a própria linha é liberada, e ADMIN da plataforma passa por cima da regra toda.
  // Mostrar o botão Editar num membro GESTOR alheio para quem não é ADMIN abriria o
  // modal para um salvar que sempre volta 403.
  const isAdminPlataforma = (user?.role ?? user?.userType ?? '').toUpperCase() === 'ADMIN';
  const [membros,       setMembros]                       = useState<Membro[]>([]);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro do cadastro de membro — vai para DENTRO do modal (é lá que a ação acontece);
  // no topo da página ficaria escondido atrás dele.
  const [erroModal,  setErroModal]  = useState<string | null>(null);
  const [equipeId,      setEquipeId]                      = useState<number | null>(null);
  const [isGestor,       setIsGestor]                       = useState(false);
  const [loading,       setLoading]                       = useState(true);
  const [showConvite,   setShowConvite]                   = useState(false);
  const [enviando,      setEnviando]                      = useState(false);
  const [togglingId,    setTogglingId]                    = useState<number | null>(null);
  const [filtroAtivo,   setFiltroAtivo]                   = useState<'all' | 'ativo' | 'inativo'>('ativo');
  const [busca,         setBusca]                         = useState('');
  const [membroEditando,   setMembroEditando]             = useState<Membro | null>(null);
  // Ficha aberta ao clicar na foto (somente leitura)
  const [membroFicha,      setMembroFicha]                = useState<Membro | null>(null);
  const [salvandoEdicao,    setSalvandoEdicao]             = useState(false);
  const [erroSenhaEdicao,   setErroSenhaEdicao]            = useState('');
  // Catálogo de especialidades (id → nome) — nomeia a especialidade de cada linha
  // de local, inclusive as que não estão no vínculo do próprio membro.
  const [catalogoEspec,     setCatalogoEspec]               = useState<Record<number, string>>({});
  const [nomeEquipe,        setNomeEquipe]                  = useState('');
  const [editandoNome,      setEditandoNome]                = useState(false);
  const [novoNome,          setNovoNome]                    = useState('');
  const [salvandoNome,      setSalvandoNome]                = useState(false);

  const carregarMembros = async () => {
    try {
      // Catálogo id→nome buscado junto (mesmo padrão da Agenda): a especialidade
      // configurada no LOCAL pode não estar no vínculo UsuarioEspecialidade do membro
      // (ex.: fornecedor), e "Especialidade #4" na tela não ajuda ninguém.
      const [res, resCat] = await Promise.all([
        api.get('/equipes/membros'),
        api.get('/especialidades').catch(() => null),
      ]);
      const cat: Record<number, string> = {};
      for (const e of (resCat?.data?.dados ?? []) as Array<{ id: number; nome: string }>) {
        cat[e.id] = e.nome;
      }
      setCatalogoEspec(cat);
      const dados = res.data?.dados ?? [];
      setMembros(dados);
      setEquipeId(res.data?.equipeId ?? null);
      setIsGestor(res.data?.isGestor ?? false);
      const nome = dados[0]?.equipe?.nome ?? '';
      setNomeEquipe(nome);
      setNovoNome(nome);
    } catch { setMembros([]); }
    finally { setLoading(false); }
  };

  const handleRenomearEquipe = async () => {
    if (!equipeId || !novoNome.trim() || novoNome.trim() === nomeEquipe) {
      setEditandoNome(false);
      return;
    }
    setSalvandoNome(true);
    try {
      await api.patch(`/equipes/${equipeId}/nome`, { nome: novoNome.trim() });
      setNomeEquipe(novoNome.trim());
      setEditandoNome(false);
      toast.success('Nome da equipe atualizado');
    } catch (err: unknown) {
      setErroInline((err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao renomear equipe');
    } finally { setSalvandoNome(false); }
  };

  useEffect(() => { carregarMembros(); }, []);

  const handleIncluirMembro = async (values: UsuarioFormValues) => {
    setEnviando(true);
    setErroModal(null);
    try {
      await api.post('/equipes/incluir-membro', {
        email:        values.email,
        cargo:        values.perfil,
        fullName:     values.fullName,
        phone:        values.phone,
        cep:          values.cep.trim()         || null,
        endereco:     values.endereco.trim()    || null,
        complemento:  values.complemento.trim() || null,
        bairro:       values.bairro.trim()      || null,
        cidade:       values.cidade.trim()      || null,
        estado:       values.estado.trim()      || null,
        fornecedorId: values.fornecedorId ?? null,
        tipoServico:  values.tipoServico  ?? null,
        especialidadeIds:   values.especialidadeIds ?? [],
        locaisTrabalho:     mapLocaisParaPayload(values.locaisTrabalho),
        // Vínculo com a empresa: remuneração (obrigatória) e acesso ao sistema
        tipoPagamento:  values.tipoPagamento,
        formaPagamento: values.formaPagamento ?? 'VALOR',
        valorPagamento: Number(values.valorPagamento),
        acessoSistema:  values.acessoSistema !== false,
        equipeId,  // inclui na equipe gerenciada nesta tela (não na do contexto ativo)
      });
      toast.success('Membro incluído com sucesso!');
      setShowConvite(false);
      // Busca em aberto esconderia justamente quem acabou de ser incluído
      setBusca('');
      carregarMembros();
    } catch (err: unknown) {
      setErroModal((err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao incluir membro');
    } finally { setEnviando(false); }
  };

  const handleToggle = async (membro: Membro) => {
    setTogglingId(membro.id);
    try {
      await api.patch(`/equipes/membros/${membro.id}/toggle`);
      toast.success(`${membro.user.fullName} ${membro.user.ativo === false ? 'ativado' : 'desativado'}`);
      carregarMembros();
    } catch { setErroInline('Erro ao alterar status'); }
    finally { setTogglingId(null); }
  };

const handleSalvarEdicao = async (values: UsuarioFormValues) => {
    if (!membroEditando) return;
    setSalvandoEdicao(true);
    setErroSenhaEdicao('');
    setErroModal(null);
    try {
      const cargos = values.cargos?.length ? values.cargos : [values.perfil];
      await api.put(`/equipes/membros/${membroEditando.id}`, {
        fullName:    values.fullName,
        email:       values.email.trim().toLowerCase(),
        cargo:       cargos[0],
        phone:       values.phone,
        ativo:       values.ativo,
        senha:       values.senha || undefined,
        cep:         values.cep.trim()         || null,
        endereco:    values.endereco.trim()    || null,
        complemento: values.complemento.trim() || null,
        bairro:      values.bairro.trim()      || null,
        cidade:      values.cidade.trim()      || null,
        estado:      values.estado.trim()      || null,
        locaisTrabalho:     mapLocaisParaPayload(values.locaisTrabalho),
        ...(values.especialidadeIds !== undefined && { especialidadeIds: values.especialidadeIds }),
        // GESTOR sem nada preenchido: UsuarioFormModal manda `tipoPagamento: undefined`
        // (campo opcional para o cargo). Sem este guard, `formaPagamento ?? 'VALOR'` e
        // `Number(undefined)` forçavam os outros dois campos no payload mesmo assim, e
        // o backend (que só exige o trio quando ALGUM deles chega) voltava 400 pedindo
        // o tipo de pagamento mesmo com a seção em branco.
        ...(values.tipoPagamento !== undefined && {
          tipoPagamento:  values.tipoPagamento,
          formaPagamento: values.formaPagamento ?? 'VALOR',
          valorPagamento: Number(values.valorPagamento),
        }),
        acessoSistema:  values.acessoSistema !== false,
      });
      if (equipeId) {
        await api.patch(`/equipes/${equipeId}/membros/${membroEditando.user.id}/cargos`, { cargos });
      }
      toast.success('Perfil atualizado');
      setMembroEditando(null);
      setBusca('');
      carregarMembros();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao atualizar perfil';
      if (/senha/i.test(msg)) setErroSenhaEdicao(msg);
      else setErroModal(msg);
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const membrosAtivos   = membros.filter(m => m.user.ativo !== false);
  const membrosInativos = membros.filter(m => m.user.ativo === false);
  const porStatus = filtroAtivo === 'all' ? membros
    : filtroAtivo === 'ativo' ? membrosAtivos
    : membrosInativos;
  const q = busca.trim().toLowerCase();
  const membrosVisiveis = q
    ? porStatus.filter(m =>
        m.user.fullName.toLowerCase().includes(q) ||
        m.user.email.toLowerCase().includes(q) ||
        (m.user.fornecedorPerfil?.tipoServico ?? '').toLowerCase().includes(q)
      )
    : porStatus;

  // ─── Render ───────────────────────────────────────────────────────────────

  const nomeEspecialidade = (id: number): string => catalogoEspec[id] ?? `Especialidade #${id}`;
  // "Clínica Médica · Centro Hípico H.P — Seg, Qua, Qui · 08:00–14:00"
  const linhasExpediente = (m: Membro) => expedientePorLocal(m, nomeEspecialidade);

  return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar />

      <InlineError message={erroInline} className="mt-3" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2 mb-4">
        <div>
          {editandoNome ? (
            <div className="flex items-center gap-2">
              <Users2 size={24} className="text-emerald-600 flex-shrink-0" />
              <input
                autoFocus
                value={novoNome}
                onChange={e => setNovoNome(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRenomearEquipe();
                  if (e.key === 'Escape') { setNovoNome(nomeEquipe); setEditandoNome(false); }
                }}
                className="text-xl font-bold text-gray-900 border-b-2 border-emerald-500 bg-transparent outline-none w-56"
              />
              <button onClick={handleRenomearEquipe} disabled={salvandoNome}
                className="p-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
                {salvandoNome ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              </button>
              <button onClick={() => { setNovoNome(nomeEquipe); setEditandoNome(false); }}
                className="p-1 text-gray-400 hover:text-gray-600">
                <X size={15} />
              </button>
            </div>
          ) : (
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Users2 size={24} className="text-emerald-600" />
              {nomeEquipe || 'Minha Equipe'}
              {isGestor && (
                <button onClick={() => setEditandoNome(true)}
                  title="Renomear equipe"
                  className="p-1 text-emerald-500 hover:text-emerald-700 transition-colors">
                  <Pencil size={14} />
                </button>
              )}
            </h1>
          )}
          <p className="text-sm text-gray-500 mt-0.5">
            {membros.length > 0
              ? `${membrosAtivos.length} membro${membrosAtivos.length !== 1 ? 's' : ''} ativo${membrosAtivos.length !== 1 ? 's' : ''}`
              : 'Nenhum membro ainda'}
            {isGestor && <span className="ml-2 text-[10px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">Gestor</span>}
          </p>
        </div>
        {isGestor && (
          <button onClick={() => setShowConvite(true)}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold text-sm transition-colors">
            <Mail size={16} /> Incluir Membro
          </button>
        )}
      </div>

      {/* Busca + Filtro */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          {/* name/autoComplete neutros: sem isso o navegador trata como campo de nome
              e reoferece/preenche o nome digitado no cadastro que acabou de ser salvo */}
          <input
            type="text"
            name="busca-equipe"
            autoComplete="off"
            data-lpignore="true"
            data-form-type="other"
            placeholder="Buscar por nome, e-mail ou tipo de serviço..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white transition-colors"
          />
          {busca && (
            <button onClick={() => setBusca('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex border border-gray-200 rounded-xl overflow-hidden text-sm flex-shrink-0">
          {(['all', 'ativo', 'inativo'] as const).map(v => (
            <button key={v} onClick={() => setFiltroAtivo(v)}
              className={`px-4 py-2.5 font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
                filtroAtivo === v ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}>
              {v === 'all' ? 'Todos' : v === 'ativo' ? 'Ativos' : 'Inativos'}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      ) : membros.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Users2 size={40} className="mx-auto mb-4 text-gray-200" />
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Sua equipe está vazia</h2>
          <p className="text-sm text-gray-400 mb-6">Convide veterinários, estagiários e colaboradores.</p>
          {isGestor && (
            <button onClick={() => setShowConvite(true)}
              className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-2xl font-semibold text-sm transition-colors">
              Incluir primeiro membro
            </button>
          )}
        </div>
      ) : membrosVisiveis.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
          <Users2 size={32} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-400">
            {busca ? `Nenhum membro encontrado para "${busca}".` : `Nenhum membro ${filtroAtivo === 'ativo' ? 'ativo' : 'inativo'} encontrado.`}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {membrosVisiveis.map(m => {
              const ativo = m.user.ativo !== false;
              const cargos = m.cargos?.length ? m.cargos : [m.cargo];
              return (
                <div key={m.id} className={`bg-white rounded-2xl border p-4 shadow-sm ${!ativo ? 'opacity-60' : 'border-gray-100'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <AvatarMembro membro={m} onClick={() => setMembroFicha(m)} className="mr-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900 truncate">{m.user.fullName}</p>
                        {m.user.id === user?.id && (
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Você</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{m.user.email}</p>
                      {m.user.phone && (
                        <p className="text-xs text-gray-500 mt-0.5">{m.user.phone}</p>
                      )}
                      {/* Especialidade + local + dias/horário na MESMA linha (um bloco
                          por turno) — mesma leitura da tabela do desktop. */}
                      {linhasExpediente(m).length === 0
                        ? especialidadesDoMembro(m).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {especialidadesDoMembro(m).map(t => (
                                <span key={t} className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )
                        : linhasExpediente(m).map((e, i) => {
                            // Local sem especialidade própria (cadastro anterior ao campo
                            // por local): cai nas do membro, para não sumir da tela.
                            const chips = e.especialidades.length > 0 ? e.especialidades : especialidadesDoMembro(m);
                            return (
                              <div key={i} className="flex flex-wrap items-center gap-1 mt-1">
                                {chips.map(t => (
                                  <span key={t} className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">
                                    {t}
                                  </span>
                                ))}
                                <span className="text-[11px] text-gray-500">
                                  🕒 {e.local ? <span className="font-semibold text-gray-600">{e.local}</span> : null}
                                  {e.local ? ' — ' : ''}
                                  {e.quando ?? <span className="text-gray-400">expediente da empresa</span>}
                                </span>
                              </div>
                            );
                          })}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {cargos.map(c => (
                          <span key={c} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ativo ? badgeCargo(c) : 'bg-gray-100 text-gray-400'}`}>
                            {labelCargo(c)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  {(isGestor || m.user.id !== user?.id) && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                      {isGestor && (m.cargo !== 'GESTOR' || isAdminPlataforma || m.user.id === user?.id) && (
                        <button onClick={() => setMembroEditando(m)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-emerald-200 rounded-lg text-xs text-emerald-600 hover:bg-emerald-50 transition-colors">
                          <Pencil size={11} /> Editar
                        </button>
                      )}
                      {m.user.id !== user?.id && (
                        <button onClick={() => handleToggle(m)} disabled={togglingId === m.id}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-blue-200 rounded-lg text-xs text-blue-600 hover:bg-blue-50 transition-colors">
                          {togglingId === m.id
                            ? <Loader2 size={11} className="animate-spin" />
                            : ativo ? <ToggleRight size={11} /> : <ToggleLeft size={11} />
                          }
                          {ativo ? 'Desativar' : 'Ativar'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop */}
          <div className="hidden md:block bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Especialidade e expediente</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Cargo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  {(isGestor) && <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {membrosVisiveis.map(m => {
                  const ativo = m.user.ativo !== false;
                  const cargos = m.cargos?.length ? m.cargos : [m.cargo];
                  return (
                    <tr key={m.id} className={`hover:bg-gray-50 transition-colors ${!ativo ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <AvatarMembro membro={m} onClick={() => setMembroFicha(m)} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-900">{m.user.fullName}</p>
                              {m.user.id === user?.id && (
                                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Você</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 truncate">{m.user.email}</p>
                          </div>
                        </div>
                      </td>
                      {/* Especialidade + local + dias/horário na MESMA linha: cada turno
                          se lê inteiro, sem cruzar duas colunas. Um mesmo local aparece
                          uma vez por turno (clínico seg/qua/sex, dermato ter/qui). */}
                      <td className="px-4 py-3">
                        {linhasExpediente(m).length === 0 ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {especialidadesDoMembro(m).map(t => (
                              <span key={t} className="text-[11px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {linhasExpediente(m).map((e, i) => {
                              // Local sem especialidade própria (cadastro anterior ao campo
                              // por local): cai nas do membro, para não sumir da tela.
                              const chips = e.especialidades.length > 0 ? e.especialidades : especialidadesDoMembro(m);
                              return (
                                <div key={i} className="flex flex-wrap items-center gap-1">
                                  {chips.map(t => (
                                    <span key={t} className="text-[11px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">
                                      {t}
                                    </span>
                                  ))}
                                  <span className="text-xs text-gray-600 whitespace-nowrap">
                                    {e.local && <span className="font-semibold text-gray-700">{e.local}</span>}
                                    {e.local ? ' — ' : ''}
                                    {e.quando ?? <span className="text-gray-400">expediente da empresa</span>}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {cargos.map(c => (
                            <span key={c} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ativo ? badgeCargo(c) : 'bg-gray-100 text-gray-400'}`}>
                              {labelCargo(c)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                          {ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      {isGestor && (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {(m.cargo !== 'GESTOR' || isAdminPlataforma || m.user.id === user?.id) && (
                              <button onClick={() => setMembroEditando(m)} title="Editar perfil"
                                className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                                <Pencil size={14} />
                              </button>
                            )}
                            {m.user.id !== user?.id && (
                              <button onClick={() => handleToggle(m)} disabled={togglingId === m.id}
                                title={ativo ? 'Desativar' : 'Ativar'}
                                className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
                                {togglingId === m.id
                                  ? <Loader2 size={14} className="animate-spin" />
                                  : ativo ? <ToggleRight size={14} /> : <ToggleLeft size={14} />
                                }
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Ficha do membro — abre ao clicar na foto (somente leitura) */}
      {membroFicha && (
        <FichaMembro
          membro={membroFicha}
          linhas={linhasExpediente(membroFicha)}
          especialidades={especialidadesDoMembro(membroFicha)}
          onFechar={() => setMembroFicha(null)}
        />
      )}

      {/* Modal Incluir Membro */}
      {showConvite && (
        <UsuarioFormModal
          titulo="Incluir Membro"
          equipeId={equipeId}
          infoNota="A pessoa será adicionada imediatamente à equipe. Um e-mail de boas-vindas será enviado."
          textoBotao="Incluir"
          comFornecedor
          comExpediente
          comVinculoEmpresa
          salvando={enviando}
          erroServidor={erroModal}
          onClose={() => { setShowConvite(false); setErroModal(null); }}
          onSubmit={handleIncluirMembro}
        />
      )}

      {/* Modal Editar Membro — mesmo formulário do Incluir.
          Senha NÃO aparece aqui: só o ADMIN e a própria pessoa alteram a senha de uma
          conta. O gestor edita o cadastro do membro, nunca a credencial dele. */}
      {membroEditando && (
        <UsuarioFormModal
          titulo="Editar Membro"
          modoEdicao
          equipeId={equipeId}
          permitirSenha={membroEditando.user.id === user?.id}
          erroSenhaServidor={erroSenhaEdicao}
          ocultarPerfil
          comExpediente
          comVinculoEmpresa
          textoBotao="Salvar"
          salvando={salvandoEdicao}
          erroServidor={erroModal}
          onClose={() => { setMembroEditando(null); setErroSenhaEdicao(''); setErroModal(null); }}
          onSubmit={handleSalvarEdicao}
          initial={{
            fullName:    membroEditando.user.fullName,
            email:       membroEditando.user.email,
            phone:       membroEditando.user.phone       ?? '',
            perfil:      membroEditando.cargo,
            cargos:      membroEditando.cargos?.length ? membroEditando.cargos : [membroEditando.cargo],
            ativo:       membroEditando.user.ativo !== false,
            cep:         membroEditando.user.cep         ?? '',
            endereco:    membroEditando.user.endereco    ?? '',
            complemento: membroEditando.user.complemento ?? '',
            bairro:      membroEditando.user.bairro      ?? '',
            cidade:      membroEditando.user.cidade      ?? '',
            estado:      membroEditando.user.estado      ?? '',
            locaisTrabalho: (membroEditando.locaisTrabalho ?? []).map(l => ({
              localizacaoId:      l.localizacaoId,
              localizacaoNome:    l.localizacaoNome ?? '',
              diasTrabalho:       l.diasTrabalho
                ? String(l.diasTrabalho).split(',').map(Number).filter(n => n >= 0 && n <= 6)
                : [],
              horaInicioTrabalho: l.horaInicioTrabalho ?? '',
              horaFimTrabalho:    l.horaFimTrabalho    ?? '',
              especialidadeIds:   l.especialidadeIds   ?? [],
              temposConsulta:     l.temposConsulta     ?? {},
            })),
            especialidadeIds:   (membroEditando.user.especialidades ?? []).map(e => e.especialidadeId),
            tipoPagamento:  (membroEditando.user.tipoPagamento as 'SALARIO' | 'COMISSAO' | null) ?? '',
            formaPagamento: (membroEditando.user.formaPagamento as 'VALOR' | 'PERCENTUAL' | null) ?? 'VALOR',
            valorPagamento: membroEditando.user.valorPagamento != null ? String(membroEditando.user.valorPagamento) : '',
            acessoSistema:  membroEditando.user.acessoSistema !== false,
          }}
        />
      )}
    </PageContainer>
  );
}
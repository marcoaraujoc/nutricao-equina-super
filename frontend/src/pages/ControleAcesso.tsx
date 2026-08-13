// src/pages/ControleAcesso.tsx
// Página de controle de acesso com abas por papel:
//
// ADMIN:
//   1. Permissões Globais  — configura locks por UserType (propagado a todas as equipes)
//   2. Profissionais       — vista global de todos os gestores/membros
//   3. Logs de Auditoria
//
// GESTOR:
//   1. Matriz de Perfis    — gerencia permissões por cargo (itens locked são read-only)
//   2. Profissionais       — membros da equipe
//   3. Logs de Auditoria

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Shield, Users2, Activity,
  CheckSquare, Check, Loader2,
  Trash2, UserCheck, ShieldCheck, ShieldX,
  Search, Eye, CheckCircle2, XCircle,
  Stethoscope, Apple, Clock,
  DollarSign, Users, PawPrint, AlertCircle,
  RefreshCw, Plus, X, Building2, ChevronRight,
  LayoutDashboard, FlaskConical, Printer, Pill,
  Lock, Globe, Pencil, Ban, Mail, Wrench, ChevronDown, CalendarDays, Syringe, Package,
  ToggleLeft, ToggleRight, MapPin,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar   from '../components/BotaoVoltar';
import UsuarioFormModal, { type UsuarioFormValues } from '../components/UsuarioFormModal';
import { useAuth } from '../contexts/AuthContext';
import { isValidEmail } from '../utils/validators';
import FieldError, { inputErrCls } from '../components/FieldError';
import ConfirmModal from '../components/ConfirmModal';
import InlineError from '../components/InlineError';
import FotoAnimal from '../components/FotoAnimal';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Nivel = 'NENHUM' | 'LEITURA' | 'PROPRIO' | 'EQUIPE' | 'FULL' | 'NEGADO';

interface AcaoItem {
  slug:   string;
  acao:   string;
  label:  string;
  nivel:  Nivel;
  locked: boolean;
}

type MatrizAgrupada = Record<string, Record<string, AcaoItem[]>>;

interface PerfilResumo {
  cargo:        string;
  label?:       string;
  descricao?:   string;
  totalMembros: number;
  resumo:       { ver: number; editar: number; excluir: number };
}

interface Membro {
  id:        number;
  cargo:     string;
  cargos?:   string[];
  /** Perfis do usuário no sistema todo (todas as equipes + dono de empresa) */
  perfisGlobais?: string[];
  ativo?:    boolean;
  createdAt: string;
  user: { id: number; fullName: string; email: string; userType: string; ativo?: boolean };
}

interface ProprietarioEquipe {
  userId:      number;
  fullName:    string;
  email:       string;
  permissoes?: Record<string, boolean>;
}

interface AdminMembro {
  id:    number;
  cargo: string;
  user:  { id: number; fullName: string; email: string; ativo: boolean };
}

interface AdminEquipe {
  id:      number;
  nome:    string;
  membros: AdminMembro[];
}

interface AdminEmpresa {
  id:      number;
  nome:    string;
  cnpj:    string | null;
  equipes: AdminEquipe[];
}

interface LogAuditoria {
  id:              number;
  alvoUserId:      number;
  alvoUserNome:    string;
  alvoUserEmail:   string;
  moduloSlug:      string;
  moduloLabel:     string;
  nivelAnterior:   string | null;
  nivelNovo:       string;
  alteradoPorId:   number;
  alteradoPorNome: string;
  createdAt:       string;
}

// ─── Utilitários CPF / CNPJ ──────────────────────────────────────────────────

function validarCPF(cpf: string): boolean {
  const n = cpf.replace(/\D/g, '');
  if (n.length !== 11 || /^(\d)\1+$/.test(n)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(n[i]) * (10 - i);
  let r = (s * 10) % 11; if (r >= 10) r = 0;
  if (r !== Number(n[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(n[i]) * (11 - i);
  r = (s * 10) % 11; if (r >= 10) r = 0;
  return r === Number(n[10]);
}

function validarCNPJ(cnpj: string): boolean {
  const n = cnpj.replace(/\D/g, '');
  if (n.length !== 14 || /^(\d)\1+$/.test(n)) return false;
  const calc = (s: string, w: number[]) => {
    const r = w.reduce((acc, v, i) => acc + Number(s[i]) * v, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calc(n, w1) === Number(n[12]) && calc(n, w2) === Number(n[13]);
}

function mascaraCPF(v: string): string {
  return v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

function mascaraCNPJ(v: string): string {
  return v.replace(/\D/g, '').slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
}

// ─── Constantes estáticas ─────────────────────────────────────────────────────

const CARGO_INFO: Record<string, { label: string; desc: string; cor: string; tipo?: string }> = {
  GESTOR:        { label: 'Gestor',        desc: 'Acesso total irrestrito. Bypass de todas as permissões do sistema.',                       cor: 'purple',  tipo: 'SISTEMA' },
  VETERINARIO:  { label: 'Veterinário',  desc: 'Acesso clínico completo: prontuários, exames, prescrições e nutrição.',                    cor: 'emerald', tipo: 'SISTEMA' },
  FORNECEDOR:   { label: 'Fornecedor',   desc: 'Fornecedor de serviços. Acesso configurável pelo gestor da equipe.',                         cor: 'teal',    tipo: 'SISTEMA' },
  ESTAGIARIO:   { label: 'Estagiário',   desc: 'Acesso de leitura por padrão. Permissões elevadas pelo gestor conforme necessário.',         cor: 'blue',    tipo: 'SISTEMA' },
  PROPRIETARIO: { label: 'Proprietário', desc: 'Proprietário de animais. Acesso de leitura configurável pelo gestor.',                      cor: 'amber',   tipo: 'SISTEMA' },
  SECRETARIA:   { label: 'Secretaria',   desc: 'Recepção e administrativo: agendamentos, cadastros e financeiro básico.',                    cor: 'amber' },
  FINANCEIRO:   { label: 'Financeiro',   desc: 'Setor financeiro: acesso completo ao módulo de faturas e cobrança.',                        cor: 'orange' },
  ENFERMEIRO:   { label: 'Enfermeiro',   desc: 'Técnico de enfermagem: execução de prescrições, vacinas e evoluções.',                      cor: 'cyan' },
  ADMIN:        { label: 'Administrador',desc: 'Gerência operacional e suporte técnico. Acesso amplo sem permissões financeiras.',           cor: 'red' },
  MEMBRO:       { label: 'Membro',       desc: 'Membro da equipe com acesso básico configurável.',                                          cor: 'gray' },
};

const USER_TYPES_GERENCIADOS = ['GESTOR', 'VETERINARIO', 'ESTAGIARIO', 'PROPRIETARIO'] as const;
type UserTypeGerenciado = typeof USER_TYPES_GERENCIADOS[number];

const USER_TYPE_INFO: Record<UserTypeGerenciado, { label: string; desc: string; cor: string }> = {
  GESTOR:        { label: 'Gestores',        desc: 'Permissões globais para todos os gestores. O que for concedido aqui fica bloqueado e não pode ser alterado por nenhuma função inferior.',  cor: 'purple' },
  VETERINARIO:  { label: 'Veterinários',  desc: 'Permissões base para todos os profissionais veterinários da plataforma.',    cor: 'emerald' },
  ESTAGIARIO:   { label: 'Estagiários',   desc: 'Permissões base para todos os estagiários da plataforma.',                   cor: 'blue' },
  PROPRIETARIO: { label: 'Proprietários', desc: 'Permissões base (leitura) disponíveis para proprietários de animais.',        cor: 'amber' },
};

const MODULO_INFO: Record<string, { label: string; icon: React.ReactNode }> = {
  dashboard:      { label: 'Dashboard',           icon: <LayoutDashboard size={14} /> },
  cadastro:       { label: 'Cadastro',            icon: <Users2          size={14} /> },
  animais:        { label: 'Animais & Pacientes', icon: <PawPrint        size={14} /> },
  agenda:         { label: 'Agenda',              icon: <CalendarDays    size={14} /> },
  atendimento:    { label: 'Atendimento',         icon: <Stethoscope     size={14} /> },
  enfermagem:     { label: 'Enfermagem',          icon: <Activity        size={14} /> },
  estoque:        { label: 'Estoque',             icon: <Package         size={14} /> },
  farmacia:       { label: 'Farmácia',            icon: <FlaskConical    size={14} /> },
  vacina:         { label: 'Vacinas',             icon: <Syringe         size={14} /> },
  nutricao:       { label: 'Nutricional',         icon: <Apple           size={14} /> },
  exames:         { label: 'Exames',              icon: <FlaskConical    size={14} /> },
  financeiro:     { label: 'Financeiro',          icon: <DollarSign      size={14} /> },
  equipe:         { label: 'Equipe & Acessos',    icon: <Users           size={14} /> },
  medicamentos:   { label: 'Medicamentos',        icon: <Pill            size={14} /> },
  procedimentos:  { label: 'Procedimentos',       icon: <Activity        size={14} /> },
};

// Ordem dos módulos espelhando o Sidebar
// 'animais' e 'equipe' são filhos de 'cadastro' — ver MODULO_CHILDREN
const MODULO_ORDER = [
  'dashboard', 'cadastro', 'agenda', 'atendimento',
  'enfermagem', 'estoque', 'nutricao', 'exames', 'financeiro',
  'medicamentos', 'procedimentos',
];

const SUBMODULO_LABEL: Record<string, string> = {
  geral:              'Visão Geral',
  animais:            'Animais & Pacientes',
  proprietario:       'Proprietários',
  tratador:           'Tratadores',
  fornecedor:         'Fornecedores',
  procedimento:       'Procedimentos (Empresa)',
  evolucoes:          'Evolução Clínica',
  prescricoes:        'Prescrições',
  vacinas:            'Vacinas',
  agendamento:        'Agendamentos',
  agendamentos:       'Agenda',
  encaminhamentos:    'Encaminhamentos',
  exames:             'Exames & Laudos',
  prescricao:         'Execução de Prescrição',
  localizacao:        'Localizações de Animal',
  laboratorial:       'Exames Laboratoriais',
  imagem:             'Exames de Imagem',
  dietas:             'Planos de Dieta',
  relatorios:         'Relatórios Nutricionais',
  faturas:            'Faturas',
  membros:            'Equipe & Acessos',
  estoque:            'Estoque de Medicamentos',
  movimentacoes:      'Movimentações de Estoque',
  catalogo:           'Catálogo',
};

const ACAO_COLS: Array<{ acao: string; label: string; icon?: React.ReactNode }> = [
  { acao: 'ler',       label: 'VER'        },
  { acao: 'criar',     label: 'CRIAR'      },
  { acao: 'editar',    label: 'ALTERAR'    },
  { acao: 'deletar',   label: 'EXCLUIR'    },
  { acao: 'finalizar', label: 'FINALIZAR'  },
  { acao: 'imprimir',  label: 'IMPRIMIR', icon: <Printer size={9} /> },
];

const MODULO_ACAO_COLS_OVERRIDE: Record<string, Array<{ acao: string; label: string }>> = {
  // Enfermagem = execução de prescrições (enfermagem.prescricao.executar). A ação
  // principal é EXECUTAR — não existe criar/editar/finalizar aqui.
  // CANCELAR (= `deletar`, mesmo apelido usado em `agenda`) é o cancelamento da
  // prescrição pelo plantão: separado de EXECUTAR de propósito, senão quem aplica o
  // medicamento cancelaria o documento do veterinário sem que o gestor decidisse isso.
  enfermagem: [
    { acao: 'ler',      label: 'VER'      },
    { acao: 'executar', label: 'EXECUTAR' },
    { acao: 'deletar',  label: 'CANCELAR' },
    { acao: 'imprimir', label: 'IMPRIMIR' },
  ],
  // Agenda = atendimento.agendamentos.* (o que o app realmente enforça).
  // "Alterar" cobre confirmar/reagendar/trocar profissional/mudar status.
  agenda: [
    { acao: 'ler',     label: 'VER'      },
    { acao: 'criar',   label: 'CRIAR'    },
    { acao: 'editar',  label: 'ALTERAR'  },
    { acao: 'deletar', label: 'CANCELAR' },
  ],
  farmacia: [
    { acao: 'ler',      label: 'VER'      },
    { acao: 'criar',    label: 'CRIAR'    },
    { acao: 'editar',   label: 'ALTERAR'  },
    { acao: 'ajustar',  label: 'AJUSTAR'  },
    { acao: 'deletar',  label: 'EXCLUIR'  },
    { acao: 'imprimir', label: 'IMPRIMIR' },
  ],
  vacina: [
    { acao: 'ler',      label: 'VER'      },
    { acao: 'criar',    label: 'CRIAR'    },
    { acao: 'editar',   label: 'ALTERAR'  },
    { acao: 'ajustar',  label: 'AJUSTAR'  },
    { acao: 'deletar',  label: 'EXCLUIR'  },
    { acao: 'imprimir', label: 'IMPRIMIR' },
  ],
};

const NIVEL_DEFAULT_ATIVO: Nivel = 'EQUIPE';

const badgeCargo = (cargo: string) =>
  ({ VETERINARIO: 'bg-emerald-100 text-emerald-700', ESTAGIARIO: 'bg-blue-100 text-blue-700',
     ADMIN: 'bg-red-100 text-red-700', MEMBRO: 'bg-gray-100 text-gray-600',
     GESTOR: 'bg-purple-100 text-purple-700', PROPRIETARIO: 'bg-amber-100 text-amber-700',
     FORNECEDOR: 'bg-teal-100 text-teal-700', SECRETARIA: 'bg-amber-100 text-amber-700',
     FINANCEIRO: 'bg-orange-100 text-orange-700', ENFERMEIRO: 'bg-cyan-100 text-cyan-700',
  } as Record<string,string>)[cargo] ?? 'bg-gray-100 text-gray-600';

// Perfis do membro NESTA equipe (cargos locais) + perfis que ele tem em outras
// equipes/empresas do sistema (perfisGlobais vem do backend — listarMembros)
function perfisDoMembro(m: Membro) {
  const locais   = m.cargos && m.cargos.length > 0 ? m.cargos : [m.cargo];
  const externos = (m.perfisGlobais ?? []).filter(p => !locais.includes(p));
  return { locais, externos };
}

// Badges com TODOS os perfis do usuário: os desta equipe em cor cheia e os de
// outras equipes/empresas atenuados (ex: fornecedora aqui que é gestora da própria empresa)
function BadgesPerfis({ m }: { m: Membro }) {
  const { locais, externos } = perfisDoMembro(m);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {locais.map(c => (
        <span key={c} className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeCargo(c)}`}>
          {(CARGO_INFO[c]?.label ?? c).toUpperCase()}
        </span>
      ))}
      {externos.map(c => (
        <span key={`ext-${c}`} title="Perfil em outra equipe desta empresa"
          className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold opacity-60 ring-1 ring-inset ring-gray-300 ${badgeCargo(c)}`}>
          {(CARGO_INFO[c]?.label ?? c).toUpperCase()}
        </span>
      ))}
    </div>
  );
}

// ─── Utilitário ───────────────────────────────────────────────────────────────

function todosPermissoesNivel(matriz: MatrizAgrupada, nivel: Nivel): Record<string, Nivel> {
  const out: Record<string, Nivel> = {};
  for (const subs of Object.values(matriz))
    for (const acoes of Object.values(subs))
      for (const a of acoes) if (!a.locked) out[a.slug] = nivel;
  return out;
}

// ─── Componente: checkbox de permissão ───────────────────────────────────────

// 3 estados: NENHUM (não conceder) → EQUIPE (conceder) → NEGADO (negar explicitamente)
function PermCheck({ nivel, onChange, locked }: { nivel: Nivel; onChange: (n: Nivel) => void; locked?: boolean }) {
  if (locked) {
    return (
      <div
        title="Permissão definida pelo administrador do sistema — não pode ser alterada"
        className="w-5 h-5 rounded-md flex items-center justify-center bg-slate-100 border border-slate-200 cursor-not-allowed"
      >
        {nivel !== 'NENHUM' && nivel !== 'NEGADO'
          ? <Lock size={9} className="text-slate-400" />
          : <Lock size={9} className="text-slate-300" />}
      </div>
    );
  }

  const handleClick = () => {
    if (nivel === 'NENHUM')  return onChange(NIVEL_DEFAULT_ATIVO);
    if (nivel === 'NEGADO')  return onChange('NENHUM');
    // concedido (LEITURA/PROPRIO/EQUIPE/FULL) → NEGADO
    return onChange('NEGADO');
  };

  if (nivel === 'NEGADO') {
    return (
      <button
        onClick={handleClick}
        title="Negado — clique para limpar"
        className="w-5 h-5 rounded-md flex items-center justify-center transition-all flex-shrink-0 bg-red-500 hover:bg-red-600 shadow-sm"
      >
        <Ban size={11} strokeWidth={3} className="text-white" />
      </button>
    );
  }

  const ativo = nivel !== 'NENHUM';
  return (
    <button
      onClick={handleClick}
      title={ativo ? 'Concedido — clique para negar' : 'Não concedido — clique para conceder'}
      className={`w-5 h-5 rounded-md flex items-center justify-center transition-all flex-shrink-0
        ${ativo ? 'bg-emerald-500 hover:bg-emerald-600 shadow-sm' : 'border-2 border-gray-300 hover:border-emerald-400 bg-white'}`}
    >
      {ativo && <Check size={13} strokeWidth={3} className="text-white" />}
    </button>
  );
}

// ─── Sub-componente: corpo da matriz (reutilizado em TabMatriz e TabPermissoesGlobais) ───

interface MatrizBodyProps {
  matriz:     MatrizAgrupada;
  onConceder: () => void;
  onRevogar:  () => void;
  onSave:     () => void;
  onChange:   (slug: string, nivel: Nivel) => void;
  nDirty:     number;
  saving:     boolean;
  saveLabel:  string;
  hideActions?: boolean;
}

// Módulos absorvidos como filhos de outro módulo no agrupamento visual
const MODULO_CHILDREN: Record<string, string[]> = { cadastro: ['animais', 'equipe'] };
const MODULO_ABSORBED = new Set(Object.values(MODULO_CHILDREN).flat());

// Grupos-pai — agrupam visualmente módulos distintos sem mesclar sub-slugs (evita colisão de chaves)
const MODULO_PARENT_GROUPS: Array<{ key: string; label: string; icon: React.ReactNode; members: string[] }> = [
  { key: 'estoque', label: 'Estoque', icon: <Package size={14} />, members: ['farmacia', 'vacina'] },
];
const MODULO_IN_PARENT = new Set(MODULO_PARENT_GROUPS.flatMap(g => g.members));

// Módulos virtuais — extraem submódulos de outro módulo e os exibem como seção própria
// Os slugs são os mesmos; alterar em um lugar altera no outro
const VIRTUAL_MODULES: Array<{ key: string; fromModulo: string; submoduloKeys: string[] }> = [
  { key: 'agenda', fromModulo: 'atendimento', submoduloKeys: ['agendamentos'] },
];

// Submódulos que recebem label diferente quando exibidos dentro de certo módulo pai
const SUBMODULO_LABEL_OVERRIDE: Record<string, Record<string, string>> = {
  agenda:      { agendamentos: 'Agenda' },
  vacina:      { estoque: 'Estoque de Vacinas' },
};

function MatrizBody({ matriz, onConceder, onRevogar, onSave, onChange, nDirty, saving, saveLabel, hideActions }: MatrizBodyProps) {
  const [collapsed,       setCollapsed]       = useState<Record<string, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleModulo = (mod: string) =>
    setCollapsed(prev => ({ ...prev, [mod]: !(prev[mod] ?? true) }));
  const toggleGroup = (key: string) =>
    setCollapsedGroups(prev => ({ ...prev, [key]: !(prev[key] ?? true) }));

  // Entradas reais (excluindo filhos absorvidos e membros de grupos-pai)
  const realEntries = Object.entries(matriz)
    .filter(([mod]) => !MODULO_ABSORBED.has(mod) && !MODULO_IN_PARENT.has(mod))
    .map(([mod, subs]) => ({ key: mod, submodulos: subs, isVirtual: false }));

  // Entradas virtuais (submódulos extraídos de outro módulo pai)
  // Só renderiza se o módulo-pai tiver os submódulos esperados E o key não existir já como módulo real
  const virtualEntries = VIRTUAL_MODULES
    .filter(vm => matriz[vm.fromModulo] && !matriz[vm.key])
    .map(vm => {
      const submodulos: MatrizAgrupada[string] = {};
      for (const sub of vm.submoduloKeys) {
        if (matriz[vm.fromModulo]?.[sub]) submodulos[sub] = matriz[vm.fromModulo][sub];
      }
      return { key: vm.key, submodulos, isVirtual: true };
    })
    .filter(({ submodulos }) => Object.keys(submodulos).length > 0);

  const entries = [...realEntries, ...virtualEntries]
    .sort((a, b) => (MODULO_ORDER.indexOf(a.key) + 1 || 999) - (MODULO_ORDER.indexOf(b.key) + 1 || 999));

  // Lista de renderização: injeta grupos-pai na posição do MODULO_ORDER
  type RenderItem =
    | { kind: 'single'; key: string; submodulos: MatrizAgrupada[string]; isVirtual: boolean }
    | { kind: 'group';  group: typeof MODULO_PARENT_GROUPS[0]; memberEntries: Array<{ key: string; submodulos: MatrizAgrupada[string] }> };

  const renderList: RenderItem[] = [];
  for (const orderKey of MODULO_ORDER) {
    const group = MODULO_PARENT_GROUPS.find(g => g.key === orderKey);
    if (group) {
      const memberEntries = group.members
        .filter(m => matriz[m])
        .map(m => ({ key: m, submodulos: matriz[m] }));
      if (memberEntries.length > 0) renderList.push({ kind: 'group', group, memberEntries });
      continue;
    }
    const entry = entries.find(e => e.key === orderKey);
    if (entry) renderList.push({ kind: 'single', ...entry });
  }
  for (const entry of entries) {
    if (!MODULO_ORDER.includes(entry.key)) renderList.push({ kind: 'single', ...entry });
  }

  const renderSubmodulos = (submodulos: MatrizAgrupada[string], moduloKey: string) => {
    const cols = MODULO_ACAO_COLS_OVERRIDE[moduloKey] ?? ACAO_COLS;
    return Object.entries(submodulos)
      .sort(([a], [b]) => (SUBMODULO_LABEL[a] ?? a).localeCompare(SUBMODULO_LABEL[b] ?? b, 'pt-BR'))
      .map(([sub, acoes], si) => {
        const mapaAcoes = Object.fromEntries(acoes.map(a => [a.acao, a]));
        const label = SUBMODULO_LABEL_OVERRIDE[moduloKey]?.[sub] ?? SUBMODULO_LABEL[sub] ?? sub;
        return (
          <div key={sub} className={si > 0 ? 'border-t border-gray-100' : ''}>
            <div className="flex items-center px-4 py-3 hover:bg-white/60 transition-colors">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700">{label}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
              </div>
              {cols.map(c => {
                const item = mapaAcoes[c.acao];
                if (!item) return (
                  <div key={c.acao} className="w-16 flex justify-center">
                    <div className="w-5 h-5 rounded border-2 border-dashed border-gray-200" title="Não disponível" />
                  </div>
                );
                return (
                  <div key={c.acao} className="w-16 flex justify-center">
                    <PermCheck nivel={item.nivel} locked={item.locked} onChange={n => onChange(item.slug, n)} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      });
  };

  const renderModulo = (modulo: string, submodulos: MatrizAgrupada[string], isVirtual: boolean) => {
    const allSubmodulos: MatrizAgrupada[string] = { ...submodulos };
    if (!isVirtual) {
      for (const child of MODULO_CHILDREN[modulo] ?? []) {
        if (matriz[child]) Object.assign(allSubmodulos, matriz[child]);
      }
      const virtualClaimed = new Set(
        VIRTUAL_MODULES.filter(vm => vm.fromModulo === modulo).flatMap(vm => vm.submoduloKeys)
      );
      for (const claimed of virtualClaimed) delete allSubmodulos[claimed];
    }
    const isCollapsed = collapsed[modulo] ?? true;
    return (
      <div key={modulo} className="border border-gray-100 rounded-xl overflow-hidden bg-gray-50">
        <button
          onClick={() => toggleModulo(modulo)}
          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-100 transition-colors"
        >
          <span className="text-gray-500">{MODULO_INFO[modulo]?.icon}</span>
          <p className="flex-1 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider">
            {MODULO_INFO[modulo]?.label ?? modulo}
          </p>
          <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`} />
        </button>
        {!isCollapsed && (
          <div className="border-t border-gray-100">
            <div className="flex items-center px-4 py-2 border-b border-gray-100 bg-gray-100/60">
              <div className="flex-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Funcionalidade</div>
              {(MODULO_ACAO_COLS_OVERRIDE[modulo] ?? ACAO_COLS).map(c => (
                <div key={c.acao} className="w-16 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider">{c.label}</div>
              ))}
            </div>
            {renderSubmodulos(allSubmodulos, modulo)}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {!hideActions && (
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
          <button onClick={onConceder}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200 transition-colors">
            <CheckCircle2 size={12} /> Conceder Tudo
          </button>
          <button onClick={onRevogar}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-semibold border border-red-200 transition-colors">
            <XCircle size={12} /> Revogar Tudo
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {renderList.map(item => {
          if (item.kind === 'group') {
            const { group, memberEntries } = item;
            const isGroupCollapsed = collapsedGroups[group.key] ?? true;
            return (
              <div key={group.key} className="border border-gray-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-gray-500">{group.icon}</span>
                  <p className="flex-1 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider">{group.label}</p>
                  <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${isGroupCollapsed ? '-rotate-90' : ''}`} />
                </button>
                {!isGroupCollapsed && (
                  <div className="border-t border-gray-100 bg-gray-50/50 p-2 space-y-2">
                    {memberEntries.map(({ key, submodulos }) => renderModulo(key, submodulos, false))}
                  </div>
                )}
              </div>
            );
          }
          return renderModulo(item.key, item.submodulos, item.isVirtual);
        })}
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {nDirty > 0
            ? <span className="text-amber-600 font-medium">{nDirty} alteração{nDirty > 1 ? 'ões' : ''} pendente{nDirty > 1 ? 's' : ''}</span>
            : 'Sem alterações'}
        </p>
        <button onClick={onSave} disabled={saving || nDirty === 0}
          className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
          {saveLabel}
        </button>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 1 — Matriz de Perfis (Gestor)
// ═══════════════════════════════════════════════════════════════════════════════

function TabMatriz({ equipeId }: { equipeId: number }) {
  const [perfis,      setPerfis]      = useState<PerfilResumo[]>([]);
  const [cargoSel,    setCargoSel]    = useState<string | null>(null);
  const [matriz,      setMatriz]      = useState<MatrizAgrupada>({});
  const [dirty,       setDirty]       = useState<Record<string, Nivel>>({});
  const [loadPerfis,  setLoadPerfis]  = useState(true);
  const [loadMatriz,  setLoadMatriz]  = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState<string | null>(null);
  const [excluindo,   setExcluindo]   = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const carregarMatriz = useCallback(async (cargo: string) => {
    setLoadMatriz(true);
    setDirty({});
    try {
      const res = await api.get(`/equipes/${equipeId}/perfis/${cargo}`);
      setMatriz(res.data.dados?.matriz ?? {});
    } catch { setErroInline('Erro ao carregar matriz'); }
    finally  { setLoadMatriz(false); }
  }, [equipeId]);

  const carregarPerfis = useCallback(async () => {
    setLoadPerfis(true);
    try {
      const res = await api.get(`/equipes/${equipeId}/perfis`);
      const lista: PerfilResumo[] = res.data.dados ?? [];
      setPerfis(lista);
      if (lista.length > 0 && !cargoSel) {
        setCargoSel(lista[0].cargo);
        carregarMatriz(lista[0].cargo);
      }
    } catch { setErroInline('Erro ao carregar perfis'); }
    finally  { setLoadPerfis(false); }
  }, [equipeId, carregarMatriz]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { carregarPerfis(); }, [carregarPerfis]);

  const handleSelCargo = (cargo: string) => {
    setCargoSel(cargo);
    carregarMatriz(cargo);
  };

  const handleChange = (slug: string, nivel: Nivel) => {
    setDirty(prev => ({ ...prev, [slug]: nivel }));
    setMatriz(prev => {
      const next = structuredClone(prev);
      for (const subs of Object.values(next))
        for (const acoes of Object.values(subs))
          for (const a of acoes) if (a.slug === slug) a.nivel = nivel;
      return next;
    });
  };

  const handleConcederTudo = () => {
    const alts = todosPermissoesNivel(matriz, 'FULL');
    setDirty(prev => ({ ...prev, ...alts }));
    setMatriz(prev => {
      const next = structuredClone(prev);
      for (const subs of Object.values(next))
        for (const acoes of Object.values(subs))
          for (const a of acoes) if (!a.locked) a.nivel = 'FULL';
      return next;
    });
  };

  const handleRevogarTudo = () => {
    const alts = todosPermissoesNivel(matriz, 'NENHUM');
    setDirty(prev => ({ ...prev, ...alts }));
    setMatriz(prev => {
      const next = structuredClone(prev);
      for (const subs of Object.values(next))
        for (const acoes of Object.values(subs))
          for (const a of acoes) if (!a.locked) a.nivel = 'NENHUM';
      return next;
    });
  };

  const handleSalvar = async () => {
    if (!cargoSel || Object.keys(dirty).length === 0) return;
    setSaving(true);
    try {
      await api.put(`/equipes/${equipeId}/perfis/${cargoSel}`, { permissoes: dirty });
      toast.success('Matriz salva e aplicada a todos os membros do perfil');
      setDirty({});
      carregarPerfis();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao salvar';
      setErroInline(msg);
    } finally { setSaving(false); }
  };

  const handleExcluirPerfil = async () => {
    if (!confirmExcluir) return;
    setExcluindo(true);
    try {
      await api.delete(`/equipes/${equipeId}/perfis/${confirmExcluir}`);
      toast.success('Perfil removido');
      if (cargoSel === confirmExcluir) { setCargoSel(null); setMatriz({}); setDirty({}); }
      setConfirmExcluir(null);
      carregarPerfis();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao remover perfil';
      setErroInline(msg);
    } finally { setExcluindo(false); }
  };

  const perfilSel = cargoSel ? perfis.find(p => p.cargo === cargoSel) : null;
  const infoSel   = perfilSel
    ? { label: perfilSel.label ?? (CARGO_INFO[perfilSel.cargo]?.label ?? perfilSel.cargo), desc: perfilSel.descricao ?? CARGO_INFO[perfilSel.cargo]?.desc ?? '' }
    : null;
  const nDirty    = Object.keys(dirty).length;

  // Conta itens locked na matriz selecionada
  const nLocked = Object.values(matriz).flatMap(s => Object.values(s)).flatMap(a => a).filter(a => a.locked).length;

  return (
    <div className="flex gap-4 h-full min-h-[520px]">
      <InlineError message={erroInline} className="m-3" />

      {/* Painel esquerdo — lista de cargos */}
      <div className="w-72 flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Cargos & Perfis</p>
          <button onClick={carregarPerfis} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {loadPerfis ? (
            <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-emerald-500" /></div>
          ) : perfis.length === 0 ? (
            <p className="text-center text-xs text-gray-400 py-6">Nenhum perfil encontrado.</p>
          ) : (
            perfis.map(p => {
              const labelExib   = p.label ?? CARGO_INFO[p.cargo]?.label ?? p.cargo;
              const descExib    = p.descricao ?? CARGO_INFO[p.cargo]?.desc ?? '';
              const isSel       = cargoSel === p.cargo;
              const podeDeletar = p.totalMembros === 0 && !['GESTOR', 'VETERINARIO', 'ESTAGIARIO', 'PROPRIETARIO'].includes(p.cargo);
              const isSistema   = ['GESTOR', 'VETERINARIO', 'ESTAGIARIO', 'PROPRIETARIO'].includes(p.cargo);
              return (
                <div
                  key={p.cargo}
                  className={`relative group rounded-xl px-3 py-2.5 border transition-all cursor-pointer ${
                    isSel ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                  onClick={() => handleSelCargo(p.cargo)}
                >
                  <div className="flex items-start justify-between gap-1 mb-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeCargo(p.cargo)}`}>
                        {labelExib.toUpperCase()}
                      </span>
                      {isSistema && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase tracking-wide">
                          SISTEMA
                        </span>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); if (podeDeletar) setConfirmExcluir(p.cargo); }}
                      disabled={!podeDeletar}
                      title={podeDeletar ? 'Remover perfil' : 'Perfil padrão ou com membros não pode ser removido'}
                      className={`opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all ${
                        podeDeletar ? 'text-gray-400 hover:text-red-500 cursor-pointer' : 'text-gray-200 cursor-not-allowed'
                      }`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  {descExib && <p className="text-[11px] text-gray-500 leading-snug line-clamp-2 mb-2">{descExib}</p>}
                  <div className="flex gap-2 text-[10px] text-gray-400">
                    <span><Eye size={9} className="inline mr-0.5" />{p.resumo.ver} ver</span>
                    <span><CheckSquare size={9} className="inline mr-0.5" />{p.resumo.editar} editar</span>
                    <span><Trash2 size={9} className="inline mr-0.5" />{p.resumo.excluir} excluir</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">{p.totalMembros} membro{p.totalMembros !== 1 ? 's' : ''}</p>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Painel direito — matriz */}
      <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
        {!cargoSel ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mb-4">
              <Shield size={24} className="text-emerald-400" />
            </div>
            <p className="font-semibold text-gray-700 mb-1">Selecione um perfil</p>
            <p className="text-sm text-gray-400">Clique em um cargo à esquerda para ver e editar sua matriz de permissões.</p>
          </div>
        ) : loadMatriz ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={22} className="animate-spin text-emerald-500" />
          </div>
        ) : (
          <>
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Shield size={15} className="text-emerald-600" />
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm">MATRIZ: {infoSel?.label.toUpperCase()}</p>
                  <p className="text-xs text-gray-400 italic mt-0.5 max-w-md">&ldquo;{infoSel?.desc}&rdquo;</p>
                  {cargoSel === 'GESTOR' && (
                    <div className="flex items-center gap-1 mt-1.5 text-[10px] text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-2 py-1 w-fit">
                      <ShieldCheck size={9} />
                      <span>Gestores têm bypass total — permissões bloqueadas aqui valem para toda a equipe</span>
                    </div>
                  )}
                  {nLocked > 0 && cargoSel !== 'GESTOR' && (
                    <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 w-fit">
                      <Lock size={9} />
                      <span>{nLocked} permiss{nLocked > 1 ? 'ões bloqueadas' : 'ão bloqueada'} pelo administrador</span>
                    </div>
                  )}
                  {nLocked > 0 && cargoSel === 'GESTOR' && (
                    <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 w-fit">
                      <Lock size={9} />
                      <span>{nLocked} permiss{nLocked > 1 ? 'ões bloqueadas' : 'ão bloqueada'} globalmente pelo administrador</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={handleConcederTudo}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200 transition-colors">
                  <CheckCircle2 size={12} /> Conceder Tudo
                </button>
                <button onClick={handleRevogarTudo}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-semibold border border-red-200 transition-colors">
                  <XCircle size={12} /> Revogar Tudo
                </button>
              </div>
            </div>

            <MatrizBody
              matriz={matriz}
              onConceder={handleConcederTudo}
              onRevogar={handleRevogarTudo}
              onSave={handleSalvar}
              onChange={handleChange}
              nDirty={nDirty}
              saving={saving}
              saveLabel="Aplicar ao perfil"
              hideActions
            />
          </>
        )}
      </div>

      {/* Modal — Confirmar exclusão de perfil */}
      {confirmExcluir && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center">
            <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Remover perfil?</h2>
            <p className="text-sm text-gray-500 mb-6">
              O perfil{' '}
              <strong className="text-gray-700">
                {perfis.find(p => p.cargo === confirmExcluir)?.label ?? confirmExcluir}
              </strong>{' '}
              será removido permanentemente.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmExcluir(null)} disabled={excluindo}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm hover:bg-gray-50 disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={handleExcluirPerfil} disabled={excluindo}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-2xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
                {excluindo ? <Loader2 size={13} className="animate-spin" /> : null}
                Remover
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA ADMIN — Permissões Globais por UserType
// ═══════════════════════════════════════════════════════════════════════════════

function TabPermissoesGlobais() {
  const [userTypeSel,  setUserTypeSel]  = useState<UserTypeGerenciado | null>(null);
  const [matriz,       setMatriz]       = useState<MatrizAgrupada>({});
  const [dirty,        setDirty]        = useState<Record<string, Nivel>>({});
  const [loadMatriz,   setLoadMatriz]   = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [configExiste, setConfigExiste] = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const carregarMatriz = useCallback(async (ut: UserTypeGerenciado) => {
    setLoadMatriz(true);
    setDirty({});
    try {
      const res = await api.get(`/equipes/admin/global/usertype/${ut}`);
      setMatriz(res.data.dados?.matriz ?? {});
      setConfigExiste(res.data.dados?.configuracaoExistente ?? false);
    } catch { setErroInline('Erro ao carregar matriz global'); }
    finally  { setLoadMatriz(false); }
  }, []);

  const handleSelUserType = (ut: UserTypeGerenciado) => {
    setUserTypeSel(ut);
    carregarMatriz(ut);
  };

  const handleChange = (slug: string, nivel: Nivel) => {
    setDirty(prev => ({ ...prev, [slug]: nivel }));
    setMatriz(prev => {
      const next = structuredClone(prev);
      for (const subs of Object.values(next))
        for (const acoes of Object.values(subs))
          for (const a of acoes) if (a.slug === slug) a.nivel = nivel;
      return next;
    });
  };

  const handleConcederTudo = () => {
    const alts: Record<string, Nivel> = {};
    for (const subs of Object.values(matriz))
      for (const acoes of Object.values(subs))
        for (const a of acoes) alts[a.slug] = 'FULL';
    setDirty(prev => ({ ...prev, ...alts }));
    setMatriz(prev => {
      const next = structuredClone(prev);
      for (const subs of Object.values(next))
        for (const acoes of Object.values(subs))
          for (const a of acoes) a.nivel = 'FULL';
      return next;
    });
  };

  const handleRevogarTudo = () => {
    const alts: Record<string, Nivel> = {};
    for (const subs of Object.values(matriz))
      for (const acoes of Object.values(subs))
        for (const a of acoes) alts[a.slug] = 'NENHUM';
    setDirty(prev => ({ ...prev, ...alts }));
    setMatriz(prev => {
      const next = structuredClone(prev);
      for (const subs of Object.values(next))
        for (const acoes of Object.values(subs))
          for (const a of acoes) a.nivel = 'NENHUM';
      return next;
    });
  };

  const handleSalvar = async () => {
    if (!userTypeSel || Object.keys(dirty).length === 0) return;
    setSaving(true);
    try {
      const res = await api.put(`/equipes/admin/global/usertype/${userTypeSel}`, { permissoes: dirty });
      const { equipesAtualizadas, membrosAtualizados } = res.data.dados ?? {};
      toast.success(`Permissões globais aplicadas: ${equipesAtualizadas} equipe(s), ${membrosAtualizados} membro(s) atualizados`);
      setDirty({});
      setConfigExiste(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao salvar';
      setErroInline(msg);
    } finally { setSaving(false); }
  };

  const infoSel = userTypeSel ? USER_TYPE_INFO[userTypeSel] : null;
  const nDirty  = Object.keys(dirty).length;

  return (
    <div className="flex gap-4 h-full min-h-[520px]">
      <InlineError message={erroInline} className="m-3" />

      {/* Painel esquerdo — UserTypes */}
      <div className="w-72 flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Tipos de Usuário</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Permissões base propagadas a todas as equipes</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {USER_TYPES_GERENCIADOS.map(ut => {
            const info  = USER_TYPE_INFO[ut];
            const isSel = userTypeSel === ut;
            return (
              <div
                key={ut}
                onClick={() => handleSelUserType(ut)}
                className={`rounded-xl px-3 py-2.5 border cursor-pointer transition-all ${
                  isSel ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeCargo(ut)}`}>
                  {info.label.toUpperCase()}
                </span>
                <p className="text-[11px] text-gray-500 leading-snug mt-2">{info.desc}</p>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 bg-amber-50/50">
          <div className="flex items-start gap-2 text-[10px] text-amber-700">
            <Lock size={10} className="flex-shrink-0 mt-0.5" />
            <span>Permissões salvas aqui ficam <strong>bloqueadas</strong> em todas as equipes e não podem ser alteradas por funções inferiores.</span>
          </div>
        </div>
      </div>

      {/* Painel direito — matriz global */}
      <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
        {!userTypeSel ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mb-4">
              <Globe size={24} className="text-amber-400" />
            </div>
            <p className="font-semibold text-gray-700 mb-1">Selecione um tipo de usuário</p>
            <p className="text-sm text-gray-400">Configure as permissões base que serão aplicadas globalmente a todas as equipes.</p>
          </div>
        ) : loadMatriz ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={22} className="animate-spin text-emerald-500" />
          </div>
        ) : (
          <>
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Globe size={15} className="text-amber-600" />
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm">GLOBAL: {infoSel?.label.toUpperCase()}</p>
                  <p className="text-xs text-gray-400 italic mt-0.5">&ldquo;{infoSel?.desc}&rdquo;</p>
                  {configExiste ? (
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-0.5 w-fit">
                      <Lock size={9} /><span>Configuração ativa — propagada a todas as equipes</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-0.5 w-fit">
                      <AlertCircle size={9} /><span>Ainda não configurado — exibindo defaults do sistema</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={handleConcederTudo}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200 transition-colors">
                  <CheckCircle2 size={12} /> Conceder Tudo
                </button>
                <button onClick={handleRevogarTudo}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-semibold border border-red-200 transition-colors">
                  <XCircle size={12} /> Revogar Tudo
                </button>
              </div>
            </div>

            <MatrizBody
              matriz={matriz}
              onConceder={handleConcederTudo}
              onRevogar={handleRevogarTudo}
              onSave={handleSalvar}
              onChange={handleChange}
              nDirty={nDirty}
              saving={saving}
              saveLabel="Aplicar globalmente"
              hideActions
            />
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA — Gerenciar Profissionais
// ═══════════════════════════════════════════════════════════════════════════════

function TabProfissionais({ equipeId, isGestor, isAdmin, onEmpresasChange }: {
  equipeId: number;
  isGestor:  boolean;
  isAdmin?: boolean;
  onEmpresasChange?: () => void;
}) {
  const { user }             = useAuth();
  const [membros,  setMembros]  = useState<Membro[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [busca,    setBusca]    = useState('');
  const [filtroCargo, setFiltroCargo] = useState('');
  const [confirmDel, setConfirmDel]   = useState<Membro | null>(null);
  const [removendo,  setRemovendo]    = useState<number | null>(null);
  const [, setAlterandoCargo] = useState<number | null>(null);
  const [editandoCargos, setEditandoCargos] = useState<{ membroId: number; userId: number; atual: string[] } | null>(null);
  const [togglingId,     setTogglingId]     = useState<number | null>(null);
  const [proprietarios,  setProprietarios]  = useState<ProprietarioEquipe[]>([]);

  interface ConviteEnviado {
    id:        number;
    email:     string;
    cargo:     string;
    status:    'PENDENTE' | 'ACEITO' | 'RECUSADO' | 'CANCELADO';
    createdAt: string;
    expiresAt: string;
    equipe?:   { nome: string; empresa?: { nome: string } };
  }
  const [convitesEnviados,   setConvitesEnviados]   = useState<ConviteEnviado[]>([]);
  const [loadingConvites,    setLoadingConvites]    = useState(false);

  const [showConvite,     setShowConvite]     = useState(false);
  const [conviteNome,     setConviteNome]     = useState('');
  const [conviteEmail,    setConviteEmail]    = useState('');
  const [conviteCargo,    setConviteCargo]    = useState('VETERINARIO');
  const [conviteTipoDoc,  setConviteTipoDoc]  = useState<'CNPJ' | 'CPF'>('CNPJ');
  const [conviteDoc,      setConviteDoc]      = useState('');
  const [conviteDocErro,  setConviteDocErro]  = useState('');
  const [conviteEmailErro,setConviteEmailErro]= useState('');
  const [conviteNomeErro, setConviteNomeErro] = useState('');
  const [conviteEspecies, setConviteEspecies] = useState<number[]>([]);
  const [buscandoCnpj,    setBuscandoCnpj]    = useState(false);
  const [enviandoConvite, setEnviandoConvite] = useState(false);
  const cnpjTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Combobox: texto digitado para equipe (CPF) ou empresa (CNPJ)
  const [comboInput,        setComboInput]        = useState('');
  const [showComboDropdown, setShowComboDropdown] = useState(false);
  const [selecionadoId,     setSelecionadoId]     = useState<number | null>(null);
  const [comboErro,         setComboErro]         = useState('');
  const comboRef = useRef<HTMLDivElement>(null);

  const [especies,             setEspecies]             = useState<{ id: number; nome: string }[]>([]);
  const [loadingEspecies,      setLoadingEspecies]      = useState(false);
  const [especiesEquipe,       setEspeciesEquipe]       = useState<{ id: number; nome: string }[]>([]);
  const [loadingEspeciesEquipe,setLoadingEspeciesEquipe]= useState(false);

  // Sem SETTER de propósito: quem os preenchia era o "Incluir Gestor" do ADMIN, removido
  // em 2026-08-16 (o gestor é associado na criação da empresa). Ficam nos valores iniciais
  // — o modal do ADMIN, que os lê, não tem mais como ser aberto.
  const [empresasDisponiveis] = useState<AdminEmpresa[]>([]);
  const [loadingEmpresas]     = useState(false);

  // Empresas pessoais (sem CNPJ) — modo CPF. Label principal = nome da EMPRESA
  // (não da equipe); a equipe aparece como subtítulo. O id segue sendo o da equipe
  // (o backend recebe equipeId ao selecionar existente).
  const equipesAdmin = empresasDisponiveis
    .filter(e => e.cnpj == null)
    .flatMap(e => e.equipes.map(eq => ({ id: eq.id, nome: e.nome, empresaNome: `Equipe: ${eq.nome}` })));
  // Filtra por texto digitado; CNPJ mode mostra só empresas com CNPJ, CPF mode só sem CNPJ
  const comboOpcoes = conviteTipoDoc === 'CNPJ'
    ? empresasDisponiveis
        .filter(e => e.cnpj != null)
        .filter(e => !comboInput || e.nome.toLowerCase().includes(comboInput.toLowerCase()) ||
          (e.cnpj ?? '').includes(comboInput.replace(/\D/g, '')))
    : equipesAdmin.filter(eq =>
        !comboInput || eq.nome.toLowerCase().includes(comboInput.toLowerCase()) ||
        eq.empresaNome.toLowerCase().includes(comboInput.toLowerCase()));

  // Se não há seleção e há texto digitado → será criado novo
  const criandoNovo = !selecionadoId && !!comboInput.trim();

  // ⚠️ `carregarEmpresasDisponiveis` foi REMOVIDA junto com o botão "Incluir Gestor"
  // (2026-08-16): era o único chamador. O modal do ADMIN continua no arquivo, mas já
  // não tem como ser aberto — por isso a lista de empresas ficar vazia não tem efeito
  // observável. Para reativar o fluxo, o loader volta aqui e chama
  // GET /equipes/admin/todas-empresas.

  useEffect(() => {
    if (!isAdmin) return;
    setLoadingEspecies(true);
    api.get('/especies')
      .then(r => setEspecies(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingEspecies(false));
  }, [isAdmin]);

  useEffect(() => {
    if (!selecionadoId) { setEspeciesEquipe([]); return; }
    setLoadingEspeciesEquipe(true);
    const url = conviteTipoDoc === 'CNPJ'
      ? `/equipes/empresa/${selecionadoId}/especies`
      : `/equipes/${selecionadoId}/especies`;
    api.get(url)
      .then(r => setEspeciesEquipe(r.data?.dados ?? []))
      .catch(() => setEspeciesEquipe([]))
      .finally(() => setLoadingEspeciesEquipe(false));
  }, [selecionadoId, conviteTipoDoc]);

  const [perfisDisponiveis, setPerfisDisponiveis] = useState<Array<{ slug: string; label: string }>>([]);
  const [adminEmpresas,    setAdminEmpresas]    = useState<AdminEmpresa[]>([]);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      // Admin com equipe selecionada → filtra por equipe; sem equipe → lista todas as empresas
      if (isAdmin && equipeId) {
        const res = await api.get(`/equipes/${equipeId}/membros`);
        setMembros(res.data?.dados ?? []);
      } else if (isAdmin) {
        const res = await api.get('/equipes/admin/todas-empresas');
        setAdminEmpresas(res.data?.dados ?? []);
      } else {
        const res = await api.get(`/equipes/membros?equipeId=${equipeId}`);
        setMembros(res.data?.dados ?? []);
        if (equipeId && isGestor) {
          try {
            const resProps = await api.get(`/equipes/${equipeId}/proprietarios`);
            setProprietarios(resProps.data?.dados ?? []);
          } catch { /* silencioso */ }
        }
      }
    } catch { setErroInline('Erro ao carregar membros'); }
    finally  { setLoading(false); }

    if (isAdmin || isGestor) {
      setLoadingConvites(true);
      api.get('/equipes/convites')
        .then(r => setConvitesEnviados(
          (r.data?.dados ?? []).filter((c: ConviteEnviado) => c.status === 'PENDENTE' || c.status === 'ACEITO')
        ))
        .catch(() => {})
        .finally(() => setLoadingConvites(false));
    }
  }, [equipeId, isAdmin, isGestor]);

  const carregarPerfis = useCallback(async () => {
    // ADMIN na vista "todas as empresas" (nenhuma equipe selecionada) recebe
    // `equipeId={equipeId ?? 0}` do chamador (armadilha 0 é falsy mas é um id "válido"
    // pro template string). Sem este guard a chamada saía como GET /equipes/0/perfis:
    // equipe 0 não existe, e o backend tentava CRIAR os perfis padrão pra ela — sem
    // tenant válido pro RLS, o INSERT falhava e devolvia 500 com erro cru do Postgres.
    if (!equipeId) return;
    try {
      const res = await api.get(`/equipes/${equipeId}/perfis`);
      const lista = (res.data.dados ?? []) as Array<{ cargo: string; label?: string }>;
      // Remove GESTOR e PROPRIETARIO do seletor de cargo para membros da equipe
      const semReservados = lista.filter(p => p.cargo !== 'GESTOR' && p.cargo !== 'PROPRIETARIO');
      setPerfisDisponiveis(semReservados.map(p => ({ slug: p.cargo, label: p.label ?? p.cargo })));
    } catch (err) {
      console.error('[TabProfissionais] carregarPerfis:', err);
    }
  }, [equipeId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { if (isAdmin || isGestor) carregarPerfis(); }, [carregarPerfis, isAdmin, isGestor]);

  const resetConviteForm = () => {
    setConviteNome('');
    setConviteEmail('');
    setConviteDoc('');
    setConviteDocErro('');
    setConviteEmailErro('');
    setConviteNomeErro('');
    setConviteTipoDoc('CNPJ');
    setConviteEspecies([]);
    setEspeciesEquipe([]);
    setComboInput('');
    setSelecionadoId(null);
    setShowComboDropdown(false);
    setComboErro('');
    setBuscandoCnpj(false);
    if (cnpjTimerRef.current) clearTimeout(cnpjTimerRef.current);
  };

  const handleDoc = (raw: string) => {
    setConviteDocErro('');
    if (conviteTipoDoc === 'CPF') {
      setConviteDoc(mascaraCPF(raw));
    } else {
      const masked = mascaraCNPJ(raw);
      setConviteDoc(masked);
      const nums = raw.replace(/\D/g, '');
      if (nums.length === 14 && validarCNPJ(masked)) {
        if (cnpjTimerRef.current) clearTimeout(cnpjTimerRef.current);
        cnpjTimerRef.current = setTimeout(async () => {
          setBuscandoCnpj(true);
          try {
            const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${nums}`);
            if (r.ok) {
              const d = await r.json();
              const razao = d.razao_social ?? d.nome_fantasia ?? '';
              if (razao) { setComboInput(razao); setSelecionadoId(null); }
            }
          } catch { /* silencioso */ } finally { setBuscandoCnpj(false); }
        }, 400);
      }
    }
  };

  const handleConvidar = async () => {
    setConviteEmailErro('');
    setConviteNomeErro('');
    setConviteDocErro('');

    let hasError = false;

    if (!conviteEmail.trim()) {
      setConviteEmailErro('E-mail é obrigatório'); hasError = true;
    } else if (!isValidEmail(conviteEmail)) {
      setConviteEmailErro('E-mail inválido'); hasError = true;
    }

    if (isAdmin) {
      if (!comboInput.trim()) { setComboErro('Informe o nome da empresa'); hasError = true; }

      if (conviteTipoDoc === 'CNPJ') {
        if (!conviteNome.trim()) { setConviteNomeErro('Nome do profissional é obrigatório'); hasError = true; }
        if (criandoNovo) {
          const nums = conviteDoc.replace(/\D/g, '');
          if (nums.length !== 14 || !validarCNPJ(conviteDoc)) { setConviteDocErro('CNPJ inválido'); hasError = true; }
        }
      }
      if (conviteTipoDoc === 'CPF') {
        const nums = conviteDoc.replace(/\D/g, '');
        if (nums.length !== 11 || !validarCPF(conviteDoc)) { setConviteDocErro('CPF inválido'); hasError = true; }
        if (!conviteNome.trim()) { setConviteNomeErro('Nome é obrigatório'); hasError = true; }
      }
      if (!selecionadoId && conviteEspecies.length === 0) {
        setErroInline('Selecione ao menos uma espécie atendida');
        hasError = true;
      }
    }

    if (hasError) return;

    setEnviandoConvite(true);
    try {
      if (isAdmin) {
        const payload: Record<string, unknown> = {
          email:       conviteEmail.trim(),
          especiesIds: selecionadoId ? especiesEquipe.map(e => e.id) : conviteEspecies,
        };
        if (conviteTipoDoc === 'CNPJ') {
          payload.fullName = conviteNome.trim();
          if (selecionadoId) {
            const emp = empresasDisponiveis.find(e => e.id === selecionadoId);
            payload.empresaId   = selecionadoId;
            payload.empresaNome = emp?.nome ?? comboInput.trim();
          } else {
            payload.cnpj        = conviteDoc.trim();
            payload.empresaNome = comboInput.trim();
          }
        } else {
          payload.cpf      = conviteDoc.trim();
          payload.fullName = conviteNome.trim();
          // Nome da EMPRESA pessoal vem do campo Empresa (não do nome do profissional)
          payload.empresaNome = comboInput.trim();
          if (selecionadoId) {
            payload.equipeId = selecionadoId;
          }
          // Sem seleção: o backend cria a empresa pessoal e a equipe dela nasce com o
          // nome da PRÓPRIA EMPRESA (nunca um genérico) — ver convidarGestorAdmin.
        }
        await api.post('/equipes/admin/convidar-gestor', payload);
      } else {
        await api.post(`/equipes/${equipeId}/convidar`, {
          email:    conviteEmail.trim(),
          fullName: conviteNome.trim() || undefined,
          cargo:    conviteCargo,
        });
      }
      toast.success(isAdmin ? 'Gestor incluído com sucesso' : 'Convite enviado por e-mail');
      setShowConvite(false);
      resetConviteForm();
      carregar();
      onEmpresasChange?.(); // atualiza o seletor de empresas do topo (ADMIN) sem reload da página
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao enviar convite';
      setErroInline(msg);
    } finally { setEnviandoConvite(false); }
  };

  const handleSalvarCargos = async (cargosNovos: string[]) => {
    if (!editandoCargos) return;
    setAlterandoCargo(editandoCargos.membroId);
    try {
      await api.patch(`/equipes/${equipeId}/membros/${editandoCargos.userId}/cargos`, { cargos: cargosNovos });
      toast.success('Perfis atualizados');
      setEditandoCargos(null);
      carregar();
    } catch { setErroInline('Erro ao atualizar perfis'); }
    finally  { setAlterandoCargo(null); }
  };

  const handleRemover = async () => {
    if (!confirmDel) return;
    setRemovendo(confirmDel.id);
    try {
      if (isAdmin && confirmDel.cargo === 'GESTOR') {
        await api.delete(`/equipes/${equipeId}/gestor/${confirmDel.user.id}`);
        toast.success(`${confirmDel.user.fullName} removido e conta desativada`);
      } else {
        await api.delete(`/equipes/membros/${confirmDel.id}`);
        toast.success(`${confirmDel.user.fullName} removido`);
      }
      setConfirmDel(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao remover membro';
      setErroInline(msg);
    }
    finally  { setRemovendo(null); }
  };

  const [adminConfirmDel, setAdminConfirmDel] = useState<{
    membro: AdminMembro; equipeId: number; empresaNome: string;
  } | null>(null);

  const handleAdminRemover = async () => {
    if (!adminConfirmDel) return;
    setRemovendo(adminConfirmDel.membro.id);
    try {
      await api.delete(`/equipes/${adminConfirmDel.equipeId}/gestor/${adminConfirmDel.membro.user.id}`);
      toast.success(`${adminConfirmDel.membro.user.fullName} removido e conta excluída`);
      setAdminConfirmDel(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao remover gestor';
      setErroInline(msg);
    } finally { setRemovendo(null); }
  };

  const handleToggle = async (m: Membro) => {
    setTogglingId(m.id);
    try {
      await api.patch(`/equipes/membros/${m.id}/toggle`);
      const novoAtivo = m.user.ativo === false;
      setMembros(prev => prev.map(mb => mb.id === m.id
        ? { ...mb, user: { ...mb.user, ativo: novoAtivo } }
        : mb));
      toast.success(`${m.user.fullName} ${novoAtivo ? 'ativado' : 'desativado'}`);
    } catch { setErroInline('Erro ao alterar status'); }
    finally  { setTogglingId(null); }
  };

  const filtrados = membros.filter(m => {
    const buscaOk = !busca || m.user.fullName.toLowerCase().includes(busca.toLowerCase()) || m.user.email.toLowerCase().includes(busca.toLowerCase());
    const cargoOk = !filtroCargo || m.cargo === filtroCargo;
    return buscaOk && cargoOk;
  });

  const cargosUnicos = [...new Set(membros.map(m => m.cargo))].sort();

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <InlineError message={erroInline} className="m-3" />

      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="font-bold text-gray-900">Gerenciamento de Profissionais ({membros.length})</p>
          <p className="text-xs text-gray-400 mt-0.5">Cadastre a equipe e atribua perfis de acesso</p>
        </div>
        {(isGestor || isAdmin) && (
          <div className="flex items-center gap-2 flex-wrap">
            {!isAdmin && (
              <button
                onClick={() => {
                  setConviteCargo('PROPRIETARIO');
                  resetConviteForm();
                  setShowConvite(true);
                  carregarPerfis();
                }}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                <Plus size={14} /> Incluir Cliente
              </button>
            )}
            {/* ⚠️ "Incluir Gestor" (ADMIN) foi REMOVIDO em 2026-08-16. O gestor passou a
                ser associado na CRIAÇÃO DA EMPRESA (/admin/empresas), que agora dispara
                o e-mail de acesso com a senha inicial — era só isso que faltava e que
                obrigava a incluí-lo de novo por aqui. Duas portas para o mesmo vínculo
                significavam decidir em qual delas o e-mail sai.
                O modal do ADMIN e `convidarGestorAdmin` continuam montados, mas SEM
                ENTRADA NA UI; se a associação depois da criação voltar a ser necessária,
                é por eles. */}
            {!isAdmin && (
              <button
                onClick={() => {
                  setConviteCargo('VETERINARIO');
                  resetConviteForm();
                  setShowConvite(true);
                  carregarPerfis();
                }}
                className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-semibold transition-colors bg-emerald-600 hover:bg-emerald-700"
              >
                Incluir Membro
              </button>
            )}
          </div>
        )}
      </div>

      {isAdmin && !equipeId ? (
        /* ── Vista Admin global: lista todas as empresas ─────────────────────── */
        <div className="p-5 space-y-5">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-emerald-500" /></div>
          ) : adminEmpresas.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">Nenhuma empresa cadastrada.</div>
          ) : (
            adminEmpresas.map(emp => {
              const totalMembros = emp.equipes.reduce((acc, eq) => acc + eq.membros.length, 0);
              return (
                <div key={emp.id} className="rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2.5 px-5 py-3 bg-slate-50 border-b border-gray-200">
                    <Building2 size={14} className="text-emerald-500 flex-shrink-0" />
                    <p className="font-bold text-gray-800 text-sm">{emp.nome}</p>
                    <span className="ml-auto text-[11px] text-gray-400">
                      {totalMembros} membro{totalMembros !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {emp.equipes.map(eq =>
                    eq.membros.map(m => {
                      const isGestorMem = m.cargo === 'GESTOR';
                      const ativo      = m.user.ativo !== false;
                      return isGestorMem ? (
                        <div key={m.id} className="flex items-center gap-4 px-5 py-4 bg-purple-50/70 border-b border-purple-100">
                          <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center font-bold text-sm flex-shrink-0">
                            {m.user.fullName?.[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-bold text-gray-900">{m.user.fullName}</p>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">GESTOR</span>
                            </div>
                            <p className="text-xs text-gray-500">{m.user.email}</p>
                          </div>
                          <div className="hidden md:flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
                            <Building2 size={11} /><span>{emp.nome}</span>
                          </div>
                          <span className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${
                            ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${ativo ? 'bg-emerald-500' : 'bg-red-400'}`} />
                            {ativo ? 'Ativo' : 'Desativado'}
                          </span>
                          <button
                            onClick={() => setAdminConfirmDel({ membro: m, equipeId: eq.id, empresaNome: emp.nome })}
                            title="Remover gestor e excluir conta"
                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : (
                        <div key={m.id} className="flex items-center gap-3 pl-12 pr-5 py-3 border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                          <ChevronRight size={11} className="text-gray-300 flex-shrink-0" />
                          <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs flex-shrink-0">
                            {m.user.fullName?.[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{m.user.fullName}</p>
                            <p className="text-xs text-gray-400 truncate">{m.user.email}</p>
                          </div>
                          <span className="hidden md:block text-xs text-gray-400 flex-shrink-0 max-w-[130px] truncate">{eq.nome}</span>
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0 ${badgeCargo(m.cargo)}`}>
                            {(CARGO_INFO[m.cargo]?.label ?? m.cargo).toUpperCase()}
                          </span>
                          <span className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${
                            ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${ativo ? 'bg-emerald-500' : 'bg-red-400'}`} />
                            {ativo ? 'Ativo' : 'Desativado'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <>
          <div className="px-5 py-3 border-b border-gray-50 flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar por nome ou e-mail..."
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <select value={filtroCargo} onChange={e => setFiltroCargo(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 focus:outline-none focus:border-emerald-400 bg-white">
              <option value="">Todos os Perfis</option>
              {cargosUnicos.map(c => (
                <option key={c} value={c}>{CARGO_INFO[c]?.label ?? c}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-emerald-500" /></div>
          ) : filtrados.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">Nenhum profissional encontrado.</div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Profissional</th>
                      <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Perfis</th>
                      <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Status de Acesso</th>
                      <th className="px-5 py-3 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wider">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtrados.map(m => (
                      <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                              {m.user.fullName?.[0]?.toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold text-gray-900">{m.user.fullName}</p>
                                {m.user.id === user?.id && (
                                  <span className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Você</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-400">{m.user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <BadgesPerfis m={m} />
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                            m.user?.ativo !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${m.user?.ativo !== false ? 'bg-emerald-500' : 'bg-red-400'}`} />
                            {m.user?.ativo !== false ? 'Ativo' : 'Desativado'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {m.user.id !== user?.id && (
                              <button
                                onClick={() => handleToggle(m)}
                                disabled={togglingId === m.id}
                                title={m.user?.ativo !== false ? 'Desativar' : 'Ativar'}
                                className={`p-1.5 rounded-lg transition-colors ${
                                  m.user?.ativo !== false
                                    ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50'
                                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                }`}>
                                {togglingId === m.id
                                  ? <Loader2 size={16} className="animate-spin" />
                                  : m.user?.ativo !== false ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                              </button>
                            )}
                            {isGestor && m.user.id !== user?.id && m.cargo !== 'GESTOR' && (
                              <button
                                onClick={() => setEditandoCargos({ membroId: m.id, userId: m.user.id, atual: m.cargos && m.cargos.length > 0 ? m.cargos : [m.cargo] })}
                                className="p-1.5 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors"
                                title="Editar perfis">
                                <Pencil size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-gray-50">
                {filtrados.map(m => {
                  const ativo = m.user?.ativo !== false;
                  return (
                    <div key={m.id} className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                          {m.user.fullName?.[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{m.user.fullName}</p>
                          <p className="text-xs text-gray-400 truncate">{m.user.email}</p>
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${ativo ? 'bg-emerald-500' : 'bg-red-400'}`} />
                          {ativo ? 'Ativo' : 'Desativado'}
                        </span>
                      </div>
                      <div className="mt-2">
                        <BadgesPerfis m={m} />
                      </div>
                      {m.user.id !== user?.id && (
                        <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-gray-100">
                          {isGestor && m.cargo !== 'GESTOR' && (
                            <button
                              onClick={() => setEditandoCargos({ membroId: m.id, userId: m.user.id, atual: m.cargos && m.cargos.length > 0 ? m.cargos : [m.cargo] })}
                              className="px-3 py-1.5 text-xs text-emerald-600 border border-emerald-200 rounded-xl hover:bg-emerald-50 transition-colors">
                              Editar
                            </button>
                          )}
                          <button
                            onClick={() => handleToggle(m)}
                            disabled={togglingId === m.id}
                            className={`px-3 py-1.5 text-xs rounded-xl border transition-colors ${
                              ativo
                                ? 'text-amber-600 border-amber-200 hover:bg-amber-50'
                                : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'
                            }`}>
                            {togglingId === m.id ? 'Aguarde...' : ativo ? 'Desativar' : 'Ativar'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Seção — Convites enviados */}
      {(isAdmin || isGestor) && (
        <div className="mt-4 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-bold text-gray-900">Convites Enviados</p>
              <p className="text-xs text-gray-400 mt-0.5">Pendentes e aceitos</p>
            </div>
            {loadingConvites && <Loader2 size={14} className="animate-spin text-emerald-400" />}
          </div>
          {convitesEnviados.length === 0 && !loadingConvites ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">Nenhum convite enviado ainda.</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {convitesEnviados.map(c => {
                const pendente = c.status === 'PENDENTE';
                const expirado = pendente && new Date(c.expiresAt) < new Date();
                return (
                  <div key={c.id} className="px-5 py-3.5 flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900 truncate">{c.email}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeCargo(c.cargo)}`}>
                          {(CARGO_INFO[c.cargo]?.label ?? c.cargo).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {c.equipe && (
                          <span className="text-[11px] text-gray-400 truncate">
                            {c.equipe.empresa?.nome ?? c.equipe.nome}
                            {c.equipe.empresa && ` · ${c.equipe.nome}`}
                          </span>
                        )}
                        <span className="text-[11px] text-gray-300">·</span>
                        <span className="text-[11px] text-gray-400">
                          Enviado em {new Date(c.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })}
                          {' às '}
                          {new Date(c.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
                        </span>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${
                      expirado         ? 'bg-red-50 text-red-600'      :
                      pendente         ? 'bg-amber-50 text-amber-700'  :
                      /* ACEITO */       'bg-emerald-50 text-emerald-700'
                    }`}>
                      {expirado  ? <XCircle size={11} />      :
                       pendente  ? <Clock size={11} />         :
                                   <CheckCircle2 size={11} />}
                      {expirado ? 'Expirado' : pendente ? 'Pendente' : 'Aceito'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal — Convidar */}
      {showConvite && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isAdmin ? 'bg-emerald-100' : 'bg-emerald-100'}`}>
                  <Plus size={16} className={isAdmin ? 'text-emerald-700' : 'text-emerald-600'} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">
                    {isAdmin ? 'Incluir Gestor' : conviteCargo === 'PROPRIETARIO' ? 'Incluir Cliente' : 'Incluir Membro'}
                  </h2>
                  <p className="text-xs text-gray-400">{isAdmin ? 'Um e-mail informativo será enviado' : 'Um e-mail de convite será enviado'}</p>
                </div>
              </div>
              <button onClick={() => { setShowConvite(false); resetConviteForm(); }} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              {isAdmin && (
                <>
                  {/* Tipo de documento */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Tipo de documento <span className="text-red-500">*</span>
                    </label>
                    <div className="flex rounded-xl border border-gray-300 overflow-hidden">
                      {(['CNPJ', 'CPF'] as const).map(tipo => (
                        <button key={tipo} type="button"
                          onClick={() => {
                            setConviteTipoDoc(tipo);
                            setConviteDoc(''); setConviteDocErro('');
                            setConviteNome(''); setConviteNomeErro('');
                            setComboInput(''); setSelecionadoId(null);
                            setShowComboDropdown(false); setComboErro('');
                            setBuscandoCnpj(false);
                            if (cnpjTimerRef.current) clearTimeout(cnpjTimerRef.current);
                          }}
                          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${conviteTipoDoc === tipo ? 'bg-emerald-700 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                          {tipo}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* CNPJ — primeiro campo no modo CNPJ */}
                  {conviteTipoDoc === 'CNPJ' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        CNPJ <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          value={conviteDoc}
                          onChange={e => { setConviteDocErro(''); handleDoc(e.target.value); }}
                          placeholder="00.000.000/0000-00"
                          className={inputErrCls(!!conviteDocErro) + ' pr-10'}
                        />
                        {buscandoCnpj && (
                          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-emerald-500" />
                        )}
                      </div>
                      <FieldError message={conviteDocErro} />
                      {!conviteDocErro && <p className="text-[11px] text-gray-400 mt-1">Nome da empresa preenchido automaticamente ao digitar CNPJ válido.</p>}
                    </div>
                  )}

                  {/* Combobox: Equipe (CPF) ou Empresa (CNPJ) */}
                  <div ref={comboRef} className="relative">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Empresa <span className="text-red-500">*</span>
                      {selecionadoId ? (
                        <span className="ml-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">existente</span>
                      ) : criandoNovo ? (
                        <span className="ml-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">nova</span>
                      ) : null}
                    </label>
                    <input
                      value={comboInput}
                      onChange={e => {
                        setComboErro('');
                        setComboInput(e.target.value);
                        setSelecionadoId(null);
                        setShowComboDropdown(true);
                      }}
                      onFocus={() => setShowComboDropdown(true)}
                      onBlur={() => setTimeout(() => setShowComboDropdown(false), 150)}
                      placeholder="Selecione ou digite o nome da empresa..."
                      className={inputErrCls(!!comboErro)}
                      autoComplete="off"
                    />
                    <FieldError message={comboErro} />
                    {criandoNovo && !comboErro && (
                      <p className="text-[11px] text-emerald-600 mt-1">
                        Empresa "{comboInput}" será criada
                      </p>
                    )}

                    {/* Dropdown */}
                    {showComboDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
                        {loadingEmpresas ? (
                          <div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-400">
                            <Loader2 size={12} className="animate-spin" /> Carregando...
                          </div>
                        ) : comboOpcoes.length === 0 && !comboInput ? (
                          <div className="px-3 py-3 text-xs text-gray-400">
                            Nenhuma empresa cadastrada. Digite para criar.
                          </div>
                        ) : (
                          <>
                            {comboOpcoes.length > 0 && (
                              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                                Selecione a Empresa
                              </div>
                            )}
                            {comboOpcoes.map(item => (
                              <button key={item.id} type="button"
                                onMouseDown={() => {
                                  setComboInput(item.nome);
                                  setSelecionadoId(item.id);
                                  setShowComboDropdown(false);
                                  setComboErro('');
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-emerald-50 transition-colors">
                                <span className="flex-1 min-w-0">
                                  <span className="block text-sm font-medium text-gray-800 truncate">{item.nome}</span>
                                  {'empresaNome' in item && (item as { empresaNome: string }).empresaNome && (
                                    <span className="block text-[10px] text-gray-400">{(item as { empresaNome: string }).empresaNome}</span>
                                  )}
                                  {'cnpj' in item && (item as { cnpj?: string | null }).cnpj && (
                                    <span className="block text-[10px] text-gray-400">CNPJ: {(item as { cnpj: string }).cnpj}</span>
                                  )}
                                </span>
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Nome do profissional — sempre no modo CNPJ */}
                  {conviteTipoDoc === 'CNPJ' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Nome do profissional <span className="text-red-500">*</span>
                      </label>
                      <input
                        value={conviteNome}
                        onChange={e => { setConviteNomeErro(''); setConviteNome(e.target.value); }}
                        placeholder="Ex: Dr. João da Silva"
                        className={inputErrCls(!!conviteNomeErro)}
                      />
                      <FieldError message={conviteNomeErro} />
                    </div>
                  )}

                  {/* CPF + Nome — sempre para modo CPF */}
                  {conviteTipoDoc === 'CPF' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          CPF <span className="text-red-500">*</span>
                        </label>
                        <input
                          value={conviteDoc}
                          onChange={e => { setConviteDocErro(''); handleDoc(e.target.value); }}
                          placeholder="000.000.000-00"
                          className={inputErrCls(!!conviteDocErro)}
                        />
                        <FieldError message={conviteDocErro} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          Nome <span className="text-red-500">*</span>
                        </label>
                        <input
                          value={conviteNome}
                          onChange={e => { setConviteNomeErro(''); setConviteNome(e.target.value); }}
                          placeholder="Ex: João da Silva"
                          className={inputErrCls(!!conviteNomeErro)}
                        />
                        <FieldError message={conviteNomeErro} />
                      </div>
                    </>
                  )}
                </>
              )}

              {!isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome completo</label>
                  <input value={conviteNome} onChange={e => setConviteNome(e.target.value)} placeholder="Ex: João da Silva"
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">E-mail <span className="text-red-500">*</span></label>
                <input type="email" value={conviteEmail}
                  onChange={e => { setConviteEmailErro(''); setConviteEmail(e.target.value); }}
                  onKeyDown={e => e.key === 'Enter' && handleConvidar()}
                  placeholder="profissional@clinica.com"
                  className={inputErrCls(!!conviteEmailErro)} />
                <FieldError message={conviteEmailErro} />
              </div>

              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Espécies atendidas <span className="text-red-500">*</span>
                    {selecionadoId && (
                      <span className="ml-1.5 text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">da equipe</span>
                    )}
                  </label>
                  {selecionadoId ? (
                    loadingEspeciesEquipe ? (
                      <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                        <Loader2 size={12} className="animate-spin" /> Carregando espécies...
                      </div>
                    ) : especiesEquipe.length === 0 ? (
                      <p className="text-xs text-gray-400">Nenhuma espécie cadastrada nesta equipe.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {especiesEquipe.map(esp => (
                          <span
                            key={esp.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm font-medium"
                          >
                            <Check size={12} strokeWidth={3} className="text-emerald-500" />
                            {esp.nome}
                            <Lock size={10} className="text-emerald-400 ml-0.5" />
                          </span>
                        ))}
                      </div>
                    )
                  ) : loadingEspecies ? (
                    <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                      <Loader2 size={12} className="animate-spin" /> Carregando espécies...
                    </div>
                  ) : especies.length === 0 ? (
                    <p className="text-xs text-gray-400">Nenhuma espécie cadastrada.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {especies.filter(esp => esp.nome !== 'NA ÁGUA DE BEBIDA').map(esp => {
                        const selecionada = conviteEspecies.includes(esp.id);
                        return (
                          <button
                            key={esp.id}
                            type="button"
                            onClick={() =>
                              setConviteEspecies(prev =>
                                selecionada ? prev.filter(id => id !== esp.id) : [...prev, esp.id]
                              )
                            }
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm text-left transition-colors ${
                              selecionada
                                ? 'bg-emerald-50 border-emerald-400 text-emerald-800 font-medium'
                                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                          >
                            <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${
                              selecionada ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'
                            }`}>
                              {selecionada && <Check size={10} strokeWidth={3} className="text-white" />}
                            </span>
                            {esp.nome}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {conviteCargo === 'PROPRIETARIO' ? (
                <div className="flex items-center gap-2 px-4 py-2.5 border border-amber-200 bg-amber-50 rounded-xl">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">PROPRIETÁRIO</span>
                  <span className="text-sm text-amber-700">Acesso de cliente — permissões configuráveis pelo gestor</span>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Perfil de acesso</label>
                  {isAdmin ? (
                    <div className="flex items-center gap-2 px-4 py-2.5 border border-emerald-200 bg-emerald-50 rounded-xl">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">GESTOR</span>
                      <span className="text-sm text-emerald-700">Acesso total irrestrito à equipe</span>
                    </div>
                  ) : (
                    <select value={conviteCargo} onChange={e => setConviteCargo(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white">
                      {perfisDisponiveis.length > 0
                        ? perfisDisponiveis.filter(p => p.slug !== 'PROPRIETARIO').map(p => (
                            <option key={p.slug} value={p.slug}>{p.label.toUpperCase()}</option>
                          ))
                        : Object.entries(CARGO_INFO)
                            .filter(([c]) => c !== 'GESTOR' && c !== 'PROPRIETARIO')
                            .map(([c, info]) => (
                              <option key={c} value={c}>{info.label.toUpperCase()}</option>
                            ))
                      }
                    </select>
                  )}
                </div>
              )}

              <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${isAdmin ? 'bg-emerald-50 border border-emerald-100 text-emerald-700' : 'bg-emerald-50 border border-emerald-100 text-emerald-700'}`}>
                <Shield size={12} className="flex-shrink-0 mt-0.5" />
                <span>
                  {conviteCargo === 'PROPRIETARIO'
                    ? 'O cliente receberá um e-mail com o link de acesso para cadastrar seus animais.'
                    : isAdmin
                      ? 'O gestor terá acesso imediato após o cadastro. Um e-mail informativo será enviado com os dados de acesso.'
                      : 'O profissional receberá um e-mail com o link de acesso e uma senha temporária.'}
                </span>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowConvite(false); resetConviteForm(); }} disabled={enviandoConvite}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={handleConvidar} disabled={enviandoConvite || !conviteEmail.trim()}
                className={`flex-1 py-2.5 disabled:opacity-50 text-white rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 ${isAdmin ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {enviandoConvite ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />}
                {isAdmin ? 'Incluir Gestor' : 'Enviar Convite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal exclusão — gestor */}
      {confirmDel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center">
            <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Remover profissional?</h2>
            <p className="text-sm text-gray-500 mb-4">
              <strong className="text-gray-700">{confirmDel.user.fullName}</strong> perderá acesso à equipe.
            </p>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setConfirmDel(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={handleRemover} disabled={removendo !== null}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-2xl text-sm font-semibold disabled:opacity-60">
                {removendo !== null ? 'Removendo...' : 'Remover'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal exclusão — admin */}
      {adminConfirmDel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center">
            <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Remover gestor?</h2>
            <p className="text-sm text-gray-500 mb-2">
              <strong className="text-gray-700">{adminConfirmDel.membro.user.fullName}</strong>{' '}
              será removido da equipe e sua conta será excluída do sistema.
            </p>
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-4">
              ⚠️ Esta ação exclui a conta do usuário, todos os dados e referências serão perdidos.
            </p>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setAdminConfirmDel(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={handleAdminRemover} disabled={removendo !== null}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-2xl text-sm font-semibold disabled:opacity-60">
                {removendo !== null ? 'Removendo...' : 'Remover e excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal — editar múltiplos cargos */}
      {editandoCargos && (
        <EditarCargosModal
          atual={editandoCargos.atual}
          perfisDisponiveis={perfisDisponiveis}
          onSalvar={handleSalvarCargos}
          onFechar={() => setEditandoCargos(null)}
        />
      )}

      {/* Seção — Proprietários */}
      {!isAdmin && isGestor && proprietarios.length > 0 && (
        <div className="mt-4 bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-100 bg-amber-50/60 flex items-center gap-2">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">PROPRIETÁRIOS</span>
            <p className="text-xs text-amber-600">Clientes com animais vinculados à equipe</p>
            <span className="ml-auto text-[11px] text-gray-400">{proprietarios.length} proprietário{proprietarios.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {proprietarios.map(p => (
              <div key={p.userId} className="px-5 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {p.fullName?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{p.fullName}</p>
                  <p className="text-xs text-gray-400">{p.email}</p>
                </div>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeCargo('PROPRIETARIO')}`}>
                  PROPRIETÁRIO
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── EditarCargosModal ────────────────────────────────────────────────────────

function EditarCargosModal({
  atual, perfisDisponiveis, onSalvar, onFechar,
}: {
  atual:              string[];
  perfisDisponiveis:  Array<{ slug: string; label: string }>;
  onSalvar:           (cargos: string[]) => void;
  onFechar:           () => void;
}) {
  const [selecionados, setSelecionados] = useState<string[]>(atual);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const toggle = (slug: string) =>
    setSelecionados(prev => prev.includes(slug) ? prev.filter(c => c !== slug) : [...prev, slug]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900">Atribuir Perfis</h2>
          <button onClick={onFechar} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">Selecione um ou mais perfis. As permissões serão a combinação de todos os selecionados.</p>

        <InlineError message={erroInline} className="mb-4" />
        <div className="space-y-2 max-h-60 overflow-y-auto mb-5">
          {(perfisDisponiveis.length > 0 ? perfisDisponiveis : Object.entries(CARGO_INFO).filter(([c]) => c !== 'GESTOR' && c !== 'PROPRIETARIO').map(([slug, info]) => ({ slug, label: info.label }))).map(p => (
            <label key={p.slug} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${selecionados.includes(p.slug) ? 'border-emerald-300 bg-emerald-50' : 'border-gray-100 hover:bg-gray-50'}`}>
              <input type="checkbox" checked={selecionados.includes(p.slug)} onChange={() => toggle(p.slug)} className="w-4 h-4 accent-emerald-600" />
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeCargo(p.slug)}`}>{p.label.toUpperCase()}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={onFechar} className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={() => { if (selecionados.length > 0) onSalvar(selecionados); else setErroInline('Selecione ao menos um perfil'); }}
            disabled={selecionados.length === 0}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-2xl text-sm font-semibold">
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA — Auditoria
// ═══════════════════════════════════════════════════════════════════════════════

interface GrupoAuditoria {
  chave:          string;
  tipo:           'MASSA' | 'INDIVIDUAL';
  alteradoPorNome: string;
  alvoUserNome:   string;
  createdAt:      string;
  nivelNovo:      string;
  registros:      LogAuditoria[];
}

function gerarGrupos(logs: LogAuditoria[]): GrupoAuditoria[] {
  const mapa: Record<string, LogAuditoria[]> = {};
  for (const l of logs) {
    const chave = `${l.alteradoPorId ?? l.alteradoPorNome}_${l.alvoUserId ?? l.alvoUserNome}_${new Date(l.createdAt).toISOString().slice(0, 19)}`;
    if (!mapa[chave]) mapa[chave] = [];
    mapa[chave].push(l);
  }
  return Object.entries(mapa).map(([chave, regs]) => ({
    chave,
    tipo:            regs.length > 2 ? 'MASSA' : 'INDIVIDUAL',
    alteradoPorNome: regs[0].alteradoPorNome,
    alvoUserNome:    regs[0].alvoUserNome,
    createdAt:       regs[0].createdAt,
    nivelNovo:       regs[0].nivelNovo,
    registros:       regs,
  }));
}

function iconeTipoLog(grupo: GrupoAuditoria) {
  if (grupo.tipo === 'MASSA') {
    const todosNenhum = grupo.registros.every(r => r.nivelNovo === 'NENHUM');
    return todosNenhum
      ? <XCircle size={15} className="text-amber-600" />
      : <CheckCircle2 size={15} className="text-emerald-600" />;
  }
  const anterior = grupo.registros[0].nivelAnterior;
  const novo     = grupo.registros[0].nivelNovo;
  if (!anterior) return <UserCheck size={15} className="text-blue-600" />;
  if (novo === 'NENHUM') return <ShieldX size={15} className="text-red-500" />;
  return <ShieldCheck size={15} className="text-emerald-600" />;
}

function corBordaTipoLog(grupo: GrupoAuditoria) {
  if (grupo.tipo === 'MASSA') {
    const todosNenhum = grupo.registros.every(r => r.nivelNovo === 'NENHUM');
    return todosNenhum ? 'border-l-amber-400' : 'border-l-emerald-400';
  }
  if (grupo.registros[0].nivelNovo === 'NENHUM') return 'border-l-red-300';
  return 'border-l-emerald-400';
}

function textoDescricaoLog(grupo: GrupoAuditoria): string {
  if (grupo.tipo === 'MASSA') {
    const todosNenhum = grupo.registros.every(r => r.nivelNovo === 'NENHUM');
    const acao = todosNenhum ? 'REVOGADAS COMPLETAMENTE' : 'CONCEDIDAS';
    return `Todas as permissões foram ${acao} por ${grupo.alteradoPorNome}.`;
  }
  const r = grupo.registros[0];
  const nivelLabel = ({ NENHUM:'Sem acesso', LEITURA:'Leitura', PROPRIO:'Próprio', EQUIPE:'Equipe', FULL:'Total' } as Record<string,string>)[r.nivelNovo] ?? r.nivelNovo;
  return `"${r.moduloLabel}" alterado para ${nivelLabel} por ${grupo.alteradoPorNome}.`;
}

function tituloTipoLog(grupo: GrupoAuditoria): string {
  if (grupo.tipo === 'MASSA') {
    const todosNenhum = grupo.registros.every(r => r.nivelNovo === 'NENHUM');
    return todosNenhum ? 'REVOGAÇÃO EM MASSA' : 'CONCESSÃO EM MASSA';
  }
  if (!grupo.registros[0].nivelAnterior) return 'NOVA PERMISSÃO';
  if (grupo.registros[0].nivelNovo === 'NENHUM') return 'PERMISSÃO REVOGADA';
  return 'PERMISSÃO ALTERADA';
}

function TabAuditoria({ equipeId }: { equipeId: number }) {
  const [logs,     setLogs]     = useState<LogAuditoria[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [page,     setPage]     = useState(1);
  const [total,    setTotal]    = useState(0);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const LIMIT = 30;

  const carregar = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await api.get(`/equipes/${equipeId}/auditoria?page=${p}&limit=${LIMIT}`);
      setLogs(res.data?.registros ?? []);
      setTotal(res.data?.total ?? 0);
    } catch { setErroInline('Erro ao carregar logs'); }
    finally  { setLoading(false); }
  }, [equipeId]);

  useEffect(() => { carregar(page); }, [carregar, page]);

  const grupos  = gerarGrupos(logs);
  const temMais = page * LIMIT < total;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <InlineError message={erroInline} className="m-3" />

      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="font-bold text-gray-900">Registro de Auditoria de Segurança</p>
          <p className="text-xs text-gray-400 mt-0.5">Fluxo cronológico de atividades, alterações de permissões e acessos</p>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full font-medium">{total} registro{total > 1 ? 's' : ''}</span>
          )}
          <button onClick={() => carregar(page)} className="p-1.5 text-gray-400 hover:text-emerald-600 rounded-lg transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-emerald-500" /></div>
      ) : grupos.length === 0 ? (
        <div className="py-12 text-center">
          <Activity size={32} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-400">Nenhuma alteração de permissão registrada ainda.</p>
        </div>
      ) : (
        <div className="px-5 py-4 space-y-3">
          {grupos.map(g => (
            <div key={g.chave}
              className={`border-l-4 ${corBordaTipoLog(g)} bg-gray-50 rounded-r-xl px-4 py-3`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 bg-white rounded-lg border border-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                    {iconeTipoLog(g)}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-700 tracking-wide">{tituloTipoLog(g)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{textoDescricaoLog(g)}</p>
                    <p className="text-[10px] text-gray-400 mt-1">
                      Agente: <strong className="text-gray-600">{g.alteradoPorNome}</strong>
                      {' '}· Alvo: <strong className="text-gray-600">{g.alvoUserNome}</strong>
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 flex-shrink-0 mt-1">
                  {new Date(g.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  {' • '}
                  {new Date(g.createdAt).toLocaleDateString('pt-BR')}
                </p>
              </div>
              {g.tipo === 'MASSA' && g.registros.length <= 6 && (
                <div className="mt-2 flex flex-wrap gap-1 pl-9">
                  {g.registros.map(r => (
                    <span key={r.id} className="text-[9px] px-1.5 py-0.5 bg-white border border-gray-200 rounded-full text-gray-500">
                      {r.moduloLabel.split('—')[1]?.trim() ?? r.moduloLabel}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {temMais && (
            <div className="pt-2 flex justify-center">
              <button onClick={() => setPage(p => p + 1)}
                className="px-5 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 font-medium">
                Carregar mais
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA — Equipe (membros profissionais: Veterinário, Estagiário, Prestador)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Modal: Gerenciar Acesso do Prestador (2 níveis) ──────────────────────────

interface AnimalDesignacao {
  id:            number;
  nome:          string;
  photoUrl:      string | null;
  especie:       { nome: string } | null;
  /** Localização cadastrada; `local` é o texto legado usado como fallback */
  localizacaoId: number | null;
  localizacao:   { id: number; nome: string } | null;
  local:         string | null;
}

interface AnimalDesignado {
  id:          number;
  ativo:       boolean;
  dataInicio:  string;
  dataFim:     string | null;
  motivo:      string | null;
  animal:      AnimalDesignacao;
}

type AnimalDisponivel = AnimalDesignacao;

// Chave e rótulo do local de um animal. Animal sem localização cadastrada cai no
// texto legado `local`; sem nenhum dos dois vira o grupo "Sem local".
const SEM_LOCAL = '__sem_local__';

function chaveLocal(a: AnimalDesignacao): string {
  if (a.localizacaoId) return `id:${a.localizacaoId}`;
  const texto = a.local?.trim();
  return texto ? `txt:${texto.toLocaleLowerCase('pt-BR')}` : SEM_LOCAL;
}

function rotuloLocal(a: AnimalDesignacao): string {
  return a.localizacao?.nome ?? a.local?.trim() ?? 'Sem local';
}

// Busca por nome sem depender de acento/caixa ("cafe" acha "Cafe" e "Café").
// Mesma normalização usada em RelatorioNutricional.tsx.
function normalizarBusca(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function GerenciarAcessoPrestadorModal({
  equipeId, prestadorUserId, prestadorNome, onClose,
}: {
  equipeId:        number;
  prestadorUserId: number;
  prestadorNome:   string;
  onClose:         () => void;
}) {
  const [loading,  setLoading]  = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [designacoes,        setDesignacoes]        = useState<AnimalDesignado[]>([]);
  const [animaisDisponiveis, setAnimaisDisponiveis] = useState<AnimalDisponivel[]>([]);
  const [motivo,             setMotivo]             = useState('');

  // Seleção MÚLTIPLA no padrão do "inserir exames" (SubModuloExames): botão abre um
  // dropdown com busca e checkbox por item, e os marcados viram chips numerados.
  const [animaisSel,     setAnimaisSel]     = useState<number[]>([]);
  const [showAnimalDrop, setShowAnimalDrop] = useState(false);
  const [animalSearch,   setAnimalSearch]   = useState('');
  const animalDropdownRef = useRef<HTMLDivElement>(null);

  // Filtro por local (haras/localização cadastrada): recorta o dropdown e o alcance
  // do "Marcar todos" — sem filtro, é a base inteira.
  const [filtroLocal, setFiltroLocal] = useState('');

  const [confirmRemover,      setConfirmRemover]      = useState<{ animalId: number; nomeAnimal: string } | null>(null);
  const [confirmRemoverTodos, setConfirmRemoverTodos] = useState(false);
  const [removendoTodos,      setRemovendoTodos]      = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/equipes/${equipeId}/prestadores/${prestadorUserId}/designacoes`);
      setDesignacoes(res.data?.dados?.designacoes ?? []);
      setAnimaisDisponiveis(res.data?.dados?.animaisDisponiveis ?? []);
    } catch { setErroInline('Erro ao carregar designações'); }
    finally  { setLoading(false); }
  }, [equipeId, prestadorUserId]);

  useEffect(() => { carregar(); }, [carregar]);

  // Click-outside fecha o dropdown e limpa a busca (mesmo padrão de SubModuloExames).
  useEffect(() => {
    if (!showAnimalDrop) { setAnimalSearch(''); return; }
    const handler = (e: MouseEvent) => {
      if (!animalDropdownRef.current?.contains(e.target as Node)) setShowAnimalDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAnimalDrop]);

  const toggleAnimal = (animalId: number) =>
    setAnimaisSel(prev => prev.includes(animalId) ? prev.filter(id => id !== animalId) : [...prev, animalId]);

  // Locais presentes na lista de disponíveis, para popular o filtro. Só aparecem
  // locais que têm animal a designar — filtro que não filtra nada é ruído.
  const locaisDisponiveis = useMemo(() => {
    const mapa = new Map<string, { chave: string; label: string; total: number }>();
    animaisDisponiveis.forEach(a => {
      const chave = chaveLocal(a);
      const item  = mapa.get(chave);
      if (item) item.total += 1;
      else mapa.set(chave, { chave, label: rotuloLocal(a), total: 1 });
    });
    return [...mapa.values()].sort((x, y) => x.label.localeCompare(y.label, 'pt-BR'));
  }, [animaisDisponiveis]);

  // Escopo do local: o que o dropdown lista E o que o "Inserir todos" concede.
  const disponiveisNoLocal = useMemo(
    () => (filtroLocal ? animaisDisponiveis.filter(a => chaveLocal(a) === filtroLocal) : animaisDisponiveis),
    [animaisDisponiveis, filtroLocal],
  );

  // A busca do dropdown é digitada DENTRO dele (não é filtro de tela) — por isso não
  // entra no alcance do "Inserir todos", igual ao dropdown de exames.
  const visiveisNoDropdown = useMemo(() => {
    const termo = normalizarBusca(animalSearch.trim());
    return termo ? disponiveisNoLocal.filter(a => normalizarBusca(a.nome).includes(termo)) : disponiveisNoLocal;
  }, [disponiveisNoLocal, animalSearch]);

  // Trocar o local descarta os marcados que saíram do escopo — não se insere quem
  // não está mais visível.
  useEffect(() => {
    setAnimaisSel(prev => prev.filter(id => disponiveisNoLocal.some(a => a.id === id)));
  }, [disponiveisNoLocal]);

  const nomePorId = useMemo(
    () => new Map(animaisDisponiveis.map(a => [a.id, a.nome])),
    [animaisDisponiveis],
  );

  // Um único caminho de inserção: os animais MARCADOS no dropdown (o "Marcar todos"
  // de lá cobre o caso de conceder o local inteiro). Sempre pela rota de lote —
  // marcar 1 ou 20 é a mesma chamada, numa transaction só.
  const handleInserirMarcados = async () => {
    if (animaisSel.length === 0) { setErroInline('Marque ao menos um animal'); return; }
    setSalvando(true);
    try {
      const res = await api.post(`/equipes/${equipeId}/prestadores/${prestadorUserId}/designacoes/lote`, {
        animalIds: animaisSel, motivo,
      });
      const n = res.data?.dados?.concedidos ?? animaisSel.length;
      toast.success(`Acesso concedido a ${n} animal${n === 1 ? '' : 'is'}`);
      setAnimaisSel([]); setMotivo(''); setAnimalSearch(''); setShowAnimalDrop(false);
      carregar();
    } catch { setErroInline('Erro ao conceder acesso'); }
    finally  { setSalvando(false); }
  };

  const handleRemover = (animalId: number, nomeAnimal: string) => {
    setConfirmRemover({ animalId, nomeAnimal });
  };

  const handleRemoverConfirmado = async () => {
    if (!confirmRemover) return;
    const { animalId } = confirmRemover;
    setConfirmRemover(null);
    try {
      await api.delete(`/equipes/${equipeId}/prestadores/${prestadorUserId}/designacoes/${animalId}`);
      toast.success('Acesso removido');
      carregar();
    } catch { setErroInline('Erro ao remover acesso'); }
  };

  // Revoga de uma vez todo o acesso vigente (DELETE sem :animalId). Uma chamada só —
  // um DELETE por animal poderia parar no meio e deixar acesso revogado pela metade.
  const handleRemoverTodos = async () => {
    setConfirmRemoverTodos(false);
    setErroInline(null);
    setRemovendoTodos(true);
    try {
      const res = await api.delete(`/equipes/${equipeId}/prestadores/${prestadorUserId}/designacoes`);
      const n = res.data?.dados?.removidos ?? ativas.length;
      toast.success(`Acesso removido de ${n} animal${n === 1 ? '' : 'is'}`);
      carregar();
    } catch { setErroInline('Erro ao remover os acessos'); }
    finally  { setRemovendoTodos(false); }
  };

  // Só o acesso VIGENTE aparece na tela. As designações inativas seguem no banco
  // (histórico/auditoria) e continuam vindo no GET — apenas não são exibidas.
  const ativas = designacoes.filter(d => d.ativo);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">

        <InlineError message={erroInline} className="mx-6 mt-4 flex-shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-100 flex items-center justify-center">
              <Wrench size={16} className="text-teal-700" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Gerenciar Acesso</h2>
              <p className="text-xs text-gray-400">{prestadorNome}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
            <X size={16} />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-teal-500" /></div>
          ) : (
            <div className="space-y-5">

              {/* Conceder acesso */}
              <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-teal-700 uppercase tracking-widest mb-3">Concessão de Acesso aos Pacientes</p>
                <div className="space-y-2">

                  {/* Filtro por local — recorta o dropdown e o "Marcar todos" */}
                  <div className="relative">
                    <MapPin size={12} className="absolute left-2.5 top-3 text-gray-400 pointer-events-none" />
                    <select value={filtroLocal} onChange={e => setFiltroLocal(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl pl-7 pr-3 py-2.5 text-sm bg-white focus:outline-none focus:border-teal-500">
                      <option value="">Todos os locais ({animaisDisponiveis.length})</option>
                      {locaisDisponiveis.map(l => (
                        <option key={l.chave} value={l.chave}>{l.label} ({l.total})</option>
                      ))}
                    </select>
                  </div>

                  {/* Seleção múltipla no padrão do "inserir exames": botão → dropdown
                      com busca e checkbox por animal. Só o NOME do animal na linha. */}
                  <div className="relative" ref={animalDropdownRef}>
                    {showAnimalDrop ? (
                      <div className="flex items-center gap-2 px-3 py-2.5 border border-teal-400 rounded-xl bg-white">
                        <PawPrint size={14} className="text-teal-400 flex-shrink-0" />
                        <input autoFocus type="text" value={animalSearch}
                          onChange={e => setAnimalSearch(e.target.value)}
                          placeholder="Buscar animal..."
                          name="busca-animal-designacao" autoComplete="off"
                          className="flex-1 text-sm text-gray-900 outline-none placeholder:text-gray-400 placeholder:italic" />
                        {animalSearch && (
                          <button type="button"
                            onMouseDown={e => { e.preventDefault(); setAnimalSearch(''); }}
                            className="text-gray-400 hover:text-gray-600">
                            <X size={12} />
                          </button>
                        )}
                        <ChevronDown size={14} className="text-gray-400 rotate-180 flex-shrink-0" />
                      </div>
                    ) : (
                      <button type="button" onClick={() => setShowAnimalDrop(true)}
                        className="w-full flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm hover:border-teal-400 transition-colors">
                        <div className="flex items-center gap-2 text-gray-400 italic">
                          <PawPrint size={14} className="text-gray-300 flex-shrink-0" />
                          <span className="text-left truncate">
                            {animaisSel.length === 0
                              ? 'Clique e digite para buscar o animal...'
                              : `${animaisSel.length} de ${disponiveisNoLocal.length} animal(is) marcado(s)`}
                          </span>
                        </div>
                        <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
                      </button>
                    )}

                    {showAnimalDrop && (
                      <div className="absolute top-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-56 overflow-y-auto">
                        {/* Marcar todos do escopo atual (todos os locais ou só o filtrado) —
                            é o que substitui um segundo botão "inserir todos". */}
                        {visiveisNoDropdown.length > 0 && (
                          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50/70 sticky top-0">
                            {/* Marcar todos encerra a escolha: fecha o dropdown para os
                                chips e o botão Inserir ficarem visíveis na hora. */}
                            <button type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => {
                                setAnimaisSel(disponiveisNoLocal.map(a => a.id));
                                setShowAnimalDrop(false);
                              }}
                              className="text-[11px] font-semibold text-teal-700 hover:text-teal-900">
                              Marcar todos ({disponiveisNoLocal.length})
                            </button>
                            {animaisSel.length > 0 && (
                              <button type="button"
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => setAnimaisSel([])}
                                className="text-[11px] font-medium text-gray-400 hover:text-gray-600">
                                Limpar
                              </button>
                            )}
                          </div>
                        )}
                        {visiveisNoDropdown.length === 0 ? (
                          <p className="text-xs text-gray-400 italic px-4 py-3">
                            {animalSearch.trim()
                              ? `Nenhum resultado para “${animalSearch.trim()}”`
                              : 'Nenhum animal disponível nesta seleção'}
                          </p>
                        ) : visiveisNoDropdown.map(a => {
                          const checked = animaisSel.includes(a.id);
                          return (
                            <label key={a.id}
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => toggleAnimal(a.id)}
                              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${checked ? 'bg-teal-50/60' : ''}`}>
                              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                checked ? 'bg-teal-600 border-teal-600' : 'border-gray-300'
                              }`}>
                                {checked && <Check size={10} className="text-white" strokeWidth={3} />}
                              </div>
                              <span className={`text-sm ${checked ? 'text-teal-800 font-medium' : 'text-gray-700'}`}>{a.nome}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Animais marcados como chips numerados */}
                  {animaisSel.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                          Animais selecionados ({animaisSel.length})
                        </p>
                        <button type="button" onClick={() => setAnimaisSel([])}
                          className="text-[11px] text-teal-600 hover:text-teal-800 font-medium">
                          Limpar tudo
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {animaisSel.map(id => (
                          <span key={id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-teal-200 bg-teal-50 text-teal-800 text-xs font-medium">
                            {nomePorId.get(id) ?? `#${id}`}
                            <button type="button" onClick={() => toggleAnimal(id)}
                              className="text-teal-400 hover:text-teal-700 transition-colors flex-shrink-0">
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <input value={motivo} onChange={e => setMotivo(e.target.value)}
                    placeholder="Motivo (opcional)"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-500" />

                  {/* Um único botão, no padrão do "Incluir Membro" da tela */}
                  <div className="flex justify-end pt-1">
                    <button onClick={handleInserirMarcados} disabled={salvando || animaisSel.length === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                      {salvando && <Loader2 size={14} className="animate-spin" />}
                      Inserir{animaisSel.length > 1 ? ` (${animaisSel.length})` : ''}
                    </button>
                  </div>
                </div>
              </div>

              {/* Animais com acesso ativo */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                    Com acesso ativo ({ativas.length})
                  </p>
                  {ativas.length > 0 && (
                    <button onClick={() => setConfirmRemoverTodos(true)} disabled={removendoTodos}
                      title="Revogar o acesso do prestador a todos os animais"
                      className="flex items-center gap-1.5 px-2.5 py-1 border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 rounded-lg text-[11px] font-semibold transition-colors">
                      {removendoTodos ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      Remover todos
                    </button>
                  )}
                </div>
                {ativas.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Nenhum animal designado.</p>
                ) : (
                  <div className="space-y-2">
                    {ativas.map(d => (
                      <div key={d.id} className="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl">
                        <div className="w-9 h-9 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                          <FotoAnimal url={d.animal.photoUrl} nome={d.animal.nome} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{d.animal.nome}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {d.animal.especie?.nome ?? '—'}
                            <span className="text-gray-300"> · </span>
                            {rotuloLocal(d.animal)}
                            {d.motivo && ` · ${d.motivo}`}
                          </p>
                        </div>
                        <button onClick={() => handleRemover(d.animal.id, d.animal.nome)}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="w-full py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Fechar Janela
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmRemoverTodos}
        titulo="Remover todos os acessos"
        mensagem={
          <>
            Remover o acesso de <strong>{prestadorNome}</strong> a{' '}
            <strong>todos os {ativas.length} animal{ativas.length === 1 ? '' : 'is'}</strong> designado{ativas.length === 1 ? '' : 's'}?
            {' '}Ele deixa de ver esses pacientes até ser designado novamente.
          </>
        }
        variante="perigo"
        labelConfirmar="Remover todos"
        onConfirmar={handleRemoverTodos}
        onCancelar={() => setConfirmRemoverTodos(false)}
      />

      <ConfirmModal
        open={confirmRemover != null}
        titulo="Remover acesso ao animal"
        mensagem={
          confirmRemover
            ? <>Tem certeza que deseja remover o acesso de <strong>{prestadorNome}</strong> ao animal <strong>"{confirmRemover.nomeAnimal}"</strong>?</>
            : ''
        }
        variante="aviso"
        labelConfirmar="Remover acesso"
        onConfirmar={handleRemoverConfirmado}
        onCancelar={() => setConfirmRemover(null)}
      />
    </div>
  );
}

function TabEquipe({ equipeId, isGestor }: { equipeId: number; isGestor: boolean }) {
  const { user }       = useAuth();
  const [membros,      setMembros]      = useState<Membro[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [busca,        setBusca]        = useState('');
  const [filtroCargo,  setFiltroCargo]  = useState('');
  const [confirmDel,   setConfirmDel]   = useState<Membro | null>(null);
  const [removendo,    setRemovendo]    = useState<number | null>(null);
  const [, setAlterandoCargo] = useState<number | null>(null);
  const [editandoCargos, setEditandoCargos] = useState<{ membroId: number; userId: number; atual: string[] } | null>(null);
  const [togglingId,     setTogglingId]     = useState<number | null>(null);
  const [perfisDisponiveis, setPerfisDisponiveis] = useState<Array<{ slug: string; label: string }>>([]);

  // Modal de gerenciamento de acesso do prestador
  const [modalAcesso, setModalAcesso] = useState<{ userId: number; nome: string } | null>(null);

  // Modal de inclusão
  const [showModal,  setShowModal]  = useState(false);
  const [enviando,   setEnviando]   = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro da inclusão — exibido DENTRO do modal, onde o cadastro está sendo feito
  const [erroModal,  setErroModal]  = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/equipes/membros?equipeId=${equipeId}`);
      // Exibe só profissionais DESTA equipe. O corte é pelo CARGO, não pelo
      // `userType` do login: quem é cliente em outra clínica (userType global
      // PROPRIETARIO) mas foi cadastrado aqui como veterinária sumia da lista.
      // ADMIN continua saindo pelo userType — esse é global de plataforma.
      const todos: Membro[] = res.data?.dados ?? [];
      setMembros(todos.filter(m => m.cargo !== 'PROPRIETARIO' && m.user.userType !== 'ADMIN'));
    } catch { setErroInline('Erro ao carregar membros'); }
    finally  { setLoading(false); }
  }, [equipeId]);

  const carregarPerfis = useCallback(async () => {
    try {
      const res = await api.get(`/equipes/${equipeId}/perfis`);
      const lista = (res.data.dados ?? []) as Array<{ cargo: string; label?: string }>;
      setPerfisDisponiveis(lista.filter(p => p.cargo !== 'GESTOR' && p.cargo !== 'PROPRIETARIO').map(p => ({ slug: p.cargo, label: p.label ?? p.cargo })));
    } catch { /* silencioso */ }
  }, [equipeId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { if (isGestor) carregarPerfis(); }, [carregarPerfis, isGestor]);

  const handleIncluirModal = async (values: UsuarioFormValues) => {
    setEnviando(true);
    setErroModal(null);
    try {
      if (values.perfil === 'FORNECEDOR') {
        const res = await api.post('/equipes/incluir-membro', {
          email:        values.email,
          cargo:        'FORNECEDOR',
          fullName:     values.fullName,
          phone:        values.phone,
          fornecedorId: values.fornecedorId ?? null,
          tipoServico:  values.tipoServico  ?? null,
          especialidadeIds: values.especialidadeIds ?? [],
          tipoPagamento:  values.tipoPagamento,
          formaPagamento: values.formaPagamento ?? 'VALOR',
          valorPagamento: Number(values.valorPagamento),
          acessoSistema:  values.acessoSistema !== false,
          equipeId,
        });
        toast.success('Fornecedor incluído. Selecione os animais com acesso.');
        setShowModal(false);
        // Busca em aberto esconderia justamente quem acabou de ser incluído
        setBusca('');
        carregar();
        const dados = (res.data as { dados?: { userId?: number; fullName?: string } })?.dados;
        if (dados?.userId) {
          setModalAcesso({ userId: dados.userId, nome: dados.fullName ?? values.fullName });
        }
      } else {
        // O convite carrega o acordo: é aplicado ao vínculo quando a pessoa aceita
        await api.post(`/equipes/${equipeId}/convidar`, {
          email:    values.email,
          fullName: values.fullName || undefined,
          cargo:    values.perfil,
          tipoPagamento:  values.tipoPagamento,
          formaPagamento: values.formaPagamento ?? 'VALOR',
          valorPagamento: Number(values.valorPagamento),
          acessoSistema:  values.acessoSistema !== false,
        });
        toast.success('Convite enviado por e-mail');
        setShowModal(false);
        setBusca('');
        carregar();
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao incluir membro';
      setErroModal(msg);
    } finally { setEnviando(false); }
  };

  const handleSalvarCargos = async (cargosNovos: string[]) => {
    if (!editandoCargos) return;
    setAlterandoCargo(editandoCargos.membroId);
    try {
      await api.patch(`/equipes/${equipeId}/membros/${editandoCargos.userId}/cargos`, { cargos: cargosNovos });
      toast.success('Perfis atualizados');
      setEditandoCargos(null);
      carregar();
    } catch { setErroInline('Erro ao atualizar perfis'); }
    finally  { setAlterandoCargo(null); }
  };

  const handleRemover = async () => {
    if (!confirmDel) return;
    setRemovendo(confirmDel.id);
    try {
      await api.delete(`/equipes/membros/${confirmDel.id}`);
      toast.success(`${confirmDel.user.fullName} removido`);
      setConfirmDel(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao remover';
      setErroInline(msg);
    } finally { setRemovendo(null); }
  };

  const handleToggle = async (m: Membro) => {
    setTogglingId(m.id);
    try {
      await api.patch(`/equipes/membros/${m.id}/toggle`);
      const novoAtivo = m.user.ativo === false;
      setMembros(prev => prev.map(mb => mb.id === m.id
        ? { ...mb, user: { ...mb.user, ativo: novoAtivo } }
        : mb));
      toast.success(`${m.user.fullName} ${novoAtivo ? 'ativado' : 'desativado'}`);
    } catch { setErroInline('Erro ao alterar status'); }
    finally  { setTogglingId(null); }
  };

  const filtrados = membros.filter(m => {
    const buscaOk = !busca || m.user.fullName.toLowerCase().includes(busca.toLowerCase()) || m.user.email.toLowerCase().includes(busca.toLowerCase());
    const cargoOk = !filtroCargo || m.cargo === filtroCargo;
    return buscaOk && cargoOk;
  });

  const hasPrestador = membros.some(m => m.cargo === 'FORNECEDOR');

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <InlineError message={erroInline} className="m-3" />

      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="font-bold text-gray-900">Equipe ({membros.length})</p>
          <p className="text-xs text-gray-400 mt-0.5">Veterinários, estagiários e prestadores de serviço</p>
        </div>
        {isGestor && (
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-colors">
            Incluir Membro
          </button>
        )}
      </div>

      {/* Banner de orientação para acesso de prestador */}
      {hasPrestador && isGestor && (
        <div className="mx-5 mt-4 mb-1 flex items-start gap-3 bg-teal-50 border border-teal-200 rounded-xl px-4 py-3">
          <Wrench size={15} className="text-teal-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-teal-700">
            <span className="font-semibold">Fornecedores de serviço</span> só visualizam pacientes que você liberar.
            Clique em <span className="font-semibold">"Gerenciar Acesso"</span> na linha do fornecedor para definir quais animais ele pode acessar.
          </p>
        </div>
      )}

      <div className="px-5 py-3 border-b border-gray-50 flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          {/* name/autoComplete neutros: sem isso o navegador trata como campo de nome
              e reoferece/preenche o nome digitado no cadastro que acabou de ser salvo */}
          <input value={busca} onChange={e => setBusca(e.target.value)}
            name="busca-membros" autoComplete="off" data-lpignore="true" data-form-type="other"
            placeholder="Buscar por nome ou e-mail..."
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-400" />
        </div>
        <select value={filtroCargo} onChange={e => setFiltroCargo(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 focus:outline-none focus:border-emerald-400 bg-white">
          <option value="">Todos os Perfis</option>
          {[...new Set(membros.map(m => m.cargo))].sort().map(c => (
            <option key={c} value={c}>{CARGO_INFO[c]?.label ?? c}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-emerald-500" /></div>
      ) : filtrados.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">Nenhum membro encontrado.</div>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Profissional</th>
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Perfis</th>
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Status</th>
                  {hasPrestador && <th className="px-5 py-3 text-left text-[11px] font-bold text-teal-500 uppercase tracking-wider">Acesso a Pacientes</th>}
                  <th className="px-5 py-3 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtrados.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                          {m.user.fullName?.[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-gray-900">{m.user.fullName}</p>
                            {m.user.id === user?.id && <span className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Você</span>}
                          </div>
                          <p className="text-xs text-gray-400">{m.user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <BadgesPerfis m={m} />
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${m.user?.ativo !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${m.user?.ativo !== false ? 'bg-emerald-500' : 'bg-red-400'}`} />
                        {m.user?.ativo !== false ? 'Ativo' : 'Desativado'}
                      </span>
                    </td>
                    {hasPrestador && (
                      <td className="px-5 py-3.5">
                        {m.cargo === 'FORNECEDOR' && isGestor ? (
                          <button
                            onClick={() => setModalAcesso({ userId: m.user.id, nome: m.user.fullName })}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors">
                            <Wrench size={13} /> Gerenciar Acesso
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {m.user.id !== user?.id && (
                          <button
                            onClick={() => handleToggle(m)}
                            disabled={togglingId === m.id}
                            title={m.user?.ativo !== false ? 'Desativar' : 'Ativar'}
                            className={`p-1.5 rounded-lg transition-colors ${
                              m.user?.ativo !== false
                                ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50'
                                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                            }`}>
                            {togglingId === m.id
                              ? <Loader2 size={16} className="animate-spin" />
                              : m.user?.ativo !== false ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                          </button>
                        )}
                        {isGestor && m.user.id !== user?.id && m.cargo !== 'GESTOR' && (
                          <button
                            onClick={() => setEditandoCargos({ membroId: m.id, userId: m.user.id, atual: m.cargos && m.cargos.length > 0 ? m.cargos : [m.cargo] })}
                            className="p-1.5 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="Editar perfis">
                            <Pencil size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden divide-y divide-gray-50">
            {filtrados.map(m => {
              const ativo = m.user?.ativo !== false;
              return (
                <div key={m.id} className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {m.user.fullName?.[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{m.user.fullName}</p>
                      <p className="text-xs text-gray-400 truncate">{m.user.email}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${ativo ? 'bg-emerald-500' : 'bg-red-400'}`} />
                      {ativo ? 'Ativo' : 'Desativado'}
                    </span>
                  </div>
                  <div className="mt-2">
                    <BadgesPerfis m={m} />
                  </div>
                  {m.user.id !== user?.id && (
                    <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-gray-100">
                      {m.cargo === 'FORNECEDOR' && isGestor && (
                        <button
                          onClick={() => setModalAcesso({ userId: m.user.id, nome: m.user.fullName })}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 rounded-xl transition-colors">
                          <Wrench size={11} /> Acesso
                        </button>
                      )}
                      {isGestor && m.cargo !== 'GESTOR' && (
                        <button
                          onClick={() => setEditandoCargos({ membroId: m.id, userId: m.user.id, atual: m.cargos && m.cargos.length > 0 ? m.cargos : [m.cargo] })}
                          className="px-3 py-1.5 text-xs text-emerald-600 border border-emerald-200 rounded-xl hover:bg-emerald-50 transition-colors">
                          Editar
                        </button>
                      )}
                      <button
                        onClick={() => handleToggle(m)}
                        disabled={togglingId === m.id}
                        className={`px-3 py-1.5 text-xs rounded-xl border transition-colors ${
                          ativo
                            ? 'text-amber-600 border-amber-200 hover:bg-amber-50'
                            : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'
                        }`}>
                        {togglingId === m.id ? 'Aguarde...' : ativo ? 'Desativar' : 'Ativar'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modal — Gerenciar Acesso Prestador */}
      {modalAcesso && (
        <GerenciarAcessoPrestadorModal
          equipeId={equipeId}
          prestadorUserId={modalAcesso.userId}
          prestadorNome={modalAcesso.nome}
          onClose={() => setModalAcesso(null)}
        />
      )}

      {/* Modal — Incluir Membro */}
      {showModal && (
        <UsuarioFormModal
          titulo="Incluir Membro"
          equipeId={equipeId}
          infoNota="Fornecedor: incluído imediatamente. Veterinário/Estagiário: convite por e-mail."
          textoBotao="Incluir"
          comFornecedor
          comVinculoEmpresa
          salvando={enviando}
          erroServidor={erroModal}
          onClose={() => { setShowModal(false); setErroModal(null); }}
          onSubmit={handleIncluirModal}
        />
      )}

      {/* Modal — Confirmar remoção */}
      {confirmDel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center">
            <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Remover membro?</h2>
            <p className="text-sm text-gray-500 mb-4"><strong className="text-gray-700">{confirmDel.user.fullName}</strong> perderá acesso à equipe.</p>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setConfirmDel(null)} className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={handleRemover} disabled={removendo !== null}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-2xl text-sm font-semibold disabled:opacity-60">
                {removendo !== null ? 'Removendo...' : 'Remover'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editandoCargos && (
        <EditarCargosModal
          atual={editandoCargos.atual}
          perfisDisponiveis={perfisDisponiveis}
          onSalvar={handleSalvarCargos}
          onFechar={() => setEditandoCargos(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA — Convites
// ═══════════════════════════════════════════════════════════════════════════════

interface ConviteItem {
  id:        number;
  email:     string;
  cargo:     string;
  status:    'PENDENTE' | 'ACEITO' | 'RECUSADO' | 'CANCELADO';
  createdAt: string;
  expiresAt: string;
  equipe?:   { nome: string; empresa?: { nome: string } };
}

function TabConvites({ equipeId, isGestor }: { equipeId: number; isGestor: boolean }) {
  const [convites,  setConvites]  = useState<ConviteItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [cancelando, setCancelando] = useState<number | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/equipes/convites');
      setConvites(res.data?.dados ?? []);
    } catch { setErroInline('Erro ao carregar convites'); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const handleCancelar = async (conviteId: number) => {
    setCancelando(conviteId);
    try {
      await api.delete(`/equipes/${equipeId}/convites/${conviteId}`);
      toast.success('Convite cancelado');
      carregar();
    } catch { setErroInline('Erro ao cancelar convite'); }
    finally  { setCancelando(null); }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <InlineError message={erroInline} className="m-3" />

      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="font-bold text-gray-900">Convites Enviados</p>
          <p className="text-xs text-gray-400 mt-0.5">Pendentes, aceitos e cancelados</p>
        </div>
        <button onClick={carregar} className="p-1.5 text-gray-400 hover:text-emerald-600 rounded-lg transition-colors">
          {loading ? <Loader2 size={14} className="animate-spin text-emerald-400" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {convites.length === 0 && !loading ? (
        <div className="px-5 py-12 text-center">
          <Mail size={32} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-400">Nenhum convite enviado ainda.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {convites.map(c => {
            const pendente = c.status === 'PENDENTE';
            const expirado = pendente && new Date(c.expiresAt) < new Date();
            return (
              <div key={c.id} className="px-5 py-3.5 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.email}</p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeCargo(c.cargo)}`}>
                      {(CARGO_INFO[c.cargo]?.label ?? c.cargo).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {c.equipe && (
                      <span className="text-[11px] text-gray-400 truncate">
                        {c.equipe.empresa?.nome ?? c.equipe.nome}
                        {c.equipe.empresa && ` · ${c.equipe.nome}`}
                      </span>
                    )}
                    <span className="text-[11px] text-gray-300">·</span>
                    <span className="text-[11px] text-gray-400">
                      {new Date(c.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })}
                    </span>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${
                  expirado         ? 'bg-red-50 text-red-600'      :
                  pendente         ? 'bg-amber-50 text-amber-700'  :
                  c.status === 'ACEITO' ? 'bg-emerald-50 text-emerald-700' :
                                     'bg-gray-100 text-gray-500'
                }`}>
                  {expirado  ? <XCircle size={11} />      :
                   pendente  ? <Clock size={11} />         :
                   c.status === 'ACEITO' ? <CheckCircle2 size={11} /> :
                               <XCircle size={11} />}
                  {expirado ? 'Expirado' : pendente ? 'Pendente' : c.status === 'ACEITO' ? 'Aceito' : 'Cancelado/Recusado'}
                </span>
                {pendente && !expirado && isGestor && (
                  <button onClick={() => handleCancelar(c.id)} disabled={cancelando === c.id}
                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0" title="Cancelar convite">
                    {cancelando === c.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

interface EquipeOpcao {
  id:          number;
  nome:        string;
  empresaId:   number;
  empresaNome: string;
}

type AbaAdmin = 'globais' | 'profissionais' | 'auditoria';
type AbaGestor = 'matriz' | 'equipe' | 'convites' | 'auditoria';
type Aba = AbaAdmin | AbaGestor;

export default function ControleAcesso() {
  const { user }     = useAuth();
  const isAdmin      = user?.role === 'ADMIN';

  const [aba,          setAba]          = useState<Aba>(isAdmin ? 'globais' : 'matriz');
  const [equipeId,     setEquipeId]     = useState<number | null>(null);
  const [, setEmpresaId]    = useState<number | null>(null);
  const [isGestor,      setIsGestor]      = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [auditTotal,   setAuditTotal]   = useState(0);
  const [todasEquipes, setTodasEquipes] = useState<EquipeOpcao[]>([]);

  const carregarEquipe = (eqId?: number) => {
    setLoading(true);
    const url = eqId ? `/equipes/membros?equipeId=${eqId}` : '/equipes/membros';
    api.get(url)
      .then(r => {
        const id = r.data?.equipeId ?? null;
        setEquipeId(id);
        setEmpresaId(r.data?.empresaId ?? null);
        setIsGestor(isAdmin ? true : (r.data?.isGestor ?? false));
        if (r.data?.todasEquipes) setTodasEquipes(r.data.todasEquipes);
        if (id) return api.get(`/equipes/${id}/auditoria?page=1&limit=1`);
      })
      .then(r => r && setAuditTotal(r.data?.total ?? 0))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { carregarEquipe(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ABAS_ADMIN: Array<{ id: AbaAdmin; label: string; icon: React.ReactNode }> = [
    { id: 'globais',       label: 'Permissões Globais', icon: <Globe     size={15} /> },
    { id: 'profissionais', label: 'Profissionais',      icon: <Users2    size={15} /> },
    { id: 'auditoria',    label: 'Logs de Auditoria',  icon: <Activity  size={15} /> },
  ];

  // Matriz de Perfis só aparece no desktop (desktopOnly)
  const ABAS_GESTOR: Array<{ id: AbaGestor; label: string; icon: React.ReactNode; badge?: number; desktopOnly?: boolean }> = [
    { id: 'matriz',    label: 'Matriz de Perfis',  icon: <Shield    size={15} />, desktopOnly: true },
    { id: 'equipe',    label: 'Profissionais',      icon: <Users2    size={15} /> },
    { id: 'convites',  label: 'Convites',           icon: <Mail      size={15} /> },
    { id: 'auditoria', label: 'Logs de Auditoria',  icon: <Activity  size={15} />, badge: auditTotal },
  ];

  const ABAS = isAdmin ? ABAS_ADMIN : ABAS_GESTOR;

  if (loading) {
    return (
      <PageContainer>
        <BotaoVoltar className="mb-6" />
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-emerald-500" />
        </div>
      </PageContainer>
    );
  }

  if (!isAdmin && !equipeId) {
    return (
      <PageContainer>
        <BotaoVoltar className="mb-6" />
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle size={36} className="text-amber-400 mb-3" />
          <p className="font-semibold text-gray-700 mb-1">Sem equipe configurada</p>
          <p className="text-sm text-gray-400">Configure uma equipe na página de Equipe para gerenciar permissões.</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar className="mb-6" />
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <Shield size={20} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Controle de Acesso</h1>
            <p className="text-sm text-gray-500">
              {isAdmin
                ? 'Gerencie permissões globais por tipo de usuário e profissionais das equipes'
                : 'Gerencie permissões, perfis e auditoria da sua equipe'}
            </p>
          </div>
        </div>

        {isAdmin && todasEquipes.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-medium">Empresa:</span>
            <select
              value={equipeId ?? ''}
              onChange={e => carregarEquipe(Number(e.target.value))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:border-emerald-400 shadow-sm"
            >
              {todasEquipes.map(eq => (
                <option key={eq.id} value={eq.id}>
                  {eq.empresaNome || eq.nome}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 mb-6 overflow-x-auto">
        {ABAS.map(a => {
          const isDesktopOnly = 'desktopOnly' in a && a.desktopOnly;
          return (
            <button
              key={a.id}
              onClick={() => setAba(a.id)}
              className={`${isDesktopOnly ? 'hidden md:flex' : 'flex'} items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex-1 justify-center
                ${aba === a.id
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'}`}
            >
              {a.icon}
              {a.label}
              {'badge' in a && a.badge != null && a.badge > 0 && (
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full ml-1">
                  {a.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isAdmin && aba === 'globais'       && <TabPermissoesGlobais />}
      {isAdmin && aba === 'profissionais' && <TabProfissionais equipeId={equipeId ?? 0} isGestor={isGestor} isAdmin={isAdmin} onEmpresasChange={() => carregarEquipe(equipeId ?? undefined)} />}
      {!isAdmin && aba === 'equipe'       && equipeId && <TabEquipe equipeId={equipeId} isGestor={isGestor} />}
      {!isAdmin && aba === 'convites'     && equipeId && <TabConvites equipeId={equipeId} isGestor={isGestor} />}
      {aba === 'auditoria'                && equipeId && <TabAuditoria equipeId={equipeId} />}
      {!isAdmin && aba === 'matriz'          && equipeId && (
        <>
          <div className="md:hidden bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-center gap-3 mb-4">
            <Shield size={16} className="text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-700">A Matriz de Perfis está disponível apenas na versão desktop.</p>
          </div>
          <div className="hidden md:block">
            <TabMatriz equipeId={equipeId} />
          </div>
        </>
      )}
    </PageContainer>
  );
}

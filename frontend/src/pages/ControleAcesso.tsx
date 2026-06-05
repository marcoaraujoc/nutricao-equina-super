// src/pages/ControleAcesso.tsx
// Página de controle de acesso com abas por papel:
//
// ADMIN:
//   1. Permissões Globais  — configura locks por UserType (propagado a todas as equipes)
//   2. Profissionais       — vista global de todos os sócios/membros
//   3. Logs de Auditoria
//
// SÓCIO:
//   1. Matriz de Perfis    — gerencia permissões por cargo (itens locked são read-only)
//   2. Profissionais       — membros da equipe
//   3. Logs de Auditoria

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Shield, Users2, Activity,
  CheckSquare, Check, Loader2,
  Trash2, UserCheck, ShieldCheck, ShieldX,
  Search, Eye, CheckCircle2, XCircle,
  Stethoscope, Apple,
  DollarSign, Users, PawPrint, AlertCircle,
  RefreshCw, Plus, X, Building2, ChevronRight,
  LayoutDashboard, FlaskConical, Printer, Pill,
  Lock, Globe, Pencil,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar   from '../components/BotaoVoltar';
import { useAuth } from '../contexts/AuthContext';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Nivel = 'NENHUM' | 'LEITURA' | 'PROPRIO' | 'EQUIPE' | 'FULL';

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
  ativo?:    boolean;
  createdAt: string;
  user: { id: number; fullName: string; email: string; userType: string };
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

// ─── Constantes estáticas ─────────────────────────────────────────────────────

const CARGO_INFO: Record<string, { label: string; desc: string; cor: string; tipo?: string }> = {
  SOCIO:        { label: 'Sócio',        desc: 'Acesso total irrestrito. Bypass de todas as permissões do sistema.',                    cor: 'purple', tipo: 'SISTEMA' },
  VETERINARIO:  { label: 'Veterinário',  desc: 'Acesso clínico completo e gerência de prontuários, exames e triagem de pacientes.',      cor: 'emerald' },
  ESTAGIARIO:   { label: 'Estagiário',   desc: 'Acesso de leitura por padrão. Permissões elevadas pelo sócio conforme necessário.',      cor: 'blue' },
  PROPRIETARIO: { label: 'Proprietário', desc: 'Proprietário de animais. Acesso de leitura configurável pelo sócio da equipe.',          cor: 'amber', tipo: 'SISTEMA' },
  ADMIN:        { label: 'Administrador',desc: 'Gerência operacional e suporte técnico. Acesso amplo sem permissões financeiras.',        cor: 'red' },
  MEMBRO:       { label: 'Membro',       desc: 'Membro da equipe com acesso básico configurável.',                                       cor: 'gray' },
};

const USER_TYPES_GERENCIADOS = ['SOCIO', 'VETERINARIO', 'ESTAGIARIO', 'PROPRIETARIO'] as const;
type UserTypeGerenciado = typeof USER_TYPES_GERENCIADOS[number];

const USER_TYPE_INFO: Record<UserTypeGerenciado, { label: string; desc: string; cor: string }> = {
  SOCIO:        { label: 'Sócios',        desc: 'Permissões globais para todos os sócios. O que for concedido aqui fica bloqueado e não pode ser alterado por nenhuma função inferior.',  cor: 'purple' },
  VETERINARIO:  { label: 'Veterinários',  desc: 'Permissões base para todos os profissionais veterinários da plataforma.',    cor: 'emerald' },
  ESTAGIARIO:   { label: 'Estagiários',   desc: 'Permissões base para todos os estagiários da plataforma.',                   cor: 'blue' },
  PROPRIETARIO: { label: 'Proprietários', desc: 'Permissões base (leitura) disponíveis para proprietários de animais.',        cor: 'amber' },
};

const MODULO_INFO: Record<string, { label: string; icon: React.ReactNode }> = {
  dashboard:      { label: 'Dashboard',            icon: <LayoutDashboard size={14} /> },
  animais:        { label: 'Animais & Pacientes',  icon: <PawPrint        size={14} /> },
  atendimento:    { label: 'Clínica',              icon: <Stethoscope     size={14} /> },
  nutricao:       { label: 'Nutrição',             icon: <Apple           size={14} /> },
  financeiro:     { label: 'Financeiro',           icon: <DollarSign      size={14} /> },
  equipe:         { label: 'Equipe & Acessos',     icon: <Users           size={14} /> },
  farmacia:       { label: 'Farmácia',             icon: <FlaskConical    size={14} /> },
  medicamentos:   { label: 'Medicamentos',         icon: <Pill            size={14} /> },
  procedimentos:  { label: 'Procedimentos',        icon: <Activity        size={14} /> },
};

const SUBMODULO_LABEL: Record<string, string> = {
  geral:          'Visão Geral',
  animais:        'Animais & Pacientes',
  evolucoes:      'Evolução',
  prescricoes:    'Prescrições',
  exames:         'Exames & Laudos',
  dietas:         'Planos de Dieta',
  relatorios:     'Relatórios Nutricionais',
  faturas:        'Faturas',
  membros:        'Equipe & Acessos',
  estoque:        'Estoque de Medicamentos',
  movimentacoes:  'Movimentações de Estoque',
  catalogo:       'Catálogo',
};

const ACAO_COLS: Array<{ acao: string; label: string; icon?: React.ReactNode }> = [
  { acao: 'ler',      label: 'VER'      },
  { acao: 'criar',    label: 'CRIAR'    },
  { acao: 'editar',   label: 'ALTERAR'  },
  { acao: 'deletar',  label: 'EXCLUIR'  },
  { acao: 'imprimir', label: 'IMPRIMIR', icon: <Printer size={9} /> },
];

const NIVEL_DEFAULT_ATIVO: Nivel = 'EQUIPE';

const badgeCargo = (cargo: string) =>
  ({ VETERINARIO: 'bg-emerald-100 text-emerald-700', ESTAGIARIO: 'bg-blue-100 text-blue-700',
     ADMIN: 'bg-red-100 text-red-700', MEMBRO: 'bg-gray-100 text-gray-600',
     SOCIO: 'bg-purple-100 text-purple-700', PROPRIETARIO: 'bg-amber-100 text-amber-700' } as Record<string,string>)[cargo] ?? 'bg-gray-100 text-gray-600';

// ─── Utilitário ───────────────────────────────────────────────────────────────

function todosPermissoesNivel(matriz: MatrizAgrupada, nivel: Nivel): Record<string, Nivel> {
  const out: Record<string, Nivel> = {};
  for (const subs of Object.values(matriz))
    for (const acoes of Object.values(subs))
      for (const a of acoes) if (!a.locked) out[a.slug] = nivel;
  return out;
}

// ─── Componente: checkbox de permissão ───────────────────────────────────────

function PermCheck({ nivel, onChange, locked }: { nivel: Nivel; onChange: (n: Nivel) => void; locked?: boolean }) {
  if (locked) {
    return (
      <div
        title="Permissão definida pelo administrador do sistema — não pode ser alterada"
        className="w-5 h-5 rounded-md flex items-center justify-center bg-slate-100 border border-slate-200 cursor-not-allowed"
      >
        {nivel !== 'NENHUM'
          ? <Lock size={9} className="text-slate-400" />
          : <Lock size={9} className="text-slate-300" />}
      </div>
    );
  }
  const ativo = nivel !== 'NENHUM';
  return (
    <button
      onClick={() => onChange(ativo ? 'NENHUM' : NIVEL_DEFAULT_ATIVO)}
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

function MatrizBody({ matriz, onConceder, onRevogar, onSave, onChange, nDirty, saving, saveLabel, hideActions }: MatrizBodyProps) {
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

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {Object.entries(matriz).map(([modulo, submodulos]) => (
          <div key={modulo}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-gray-500">{MODULO_INFO[modulo]?.icon}</span>
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                {MODULO_INFO[modulo]?.label ?? modulo}
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center px-4 py-2 border-b border-gray-100 bg-gray-100/60">
                <div className="flex-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Funcionalidade</div>
                {ACAO_COLS.map(c => (
                  <div key={c.acao} className="w-16 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider">{c.label}</div>
                ))}
              </div>
              {Object.entries(submodulos).map(([sub, acoes], si) => {
                const mapaAcoes = Object.fromEntries(acoes.map(a => [a.acao, a]));
                return (
                  <div key={sub} className={si > 0 ? 'border-t border-gray-100' : ''}>
                    <div className="flex items-center px-4 py-3 hover:bg-white/60 transition-colors">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-700">{SUBMODULO_LABEL[sub] ?? sub}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
                      </div>
                      {ACAO_COLS.map(c => {
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
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {nDirty > 0
            ? <span className="text-amber-600 font-medium">{nDirty} alteração{nDirty > 1 ? 'ões' : ''} pendente{nDirty > 1 ? 's' : ''}</span>
            : 'Sem alterações'}
        </p>
        <button onClick={onSave} disabled={saving || nDirty === 0}
          className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
          {saveLabel}
        </button>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 1 — Matriz de Perfis (Sócio)
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

  const carregarPerfis = useCallback(async () => {
    setLoadPerfis(true);
    try {
      const res = await api.get(`/equipes/${equipeId}/perfis`);
      setPerfis(res.data.dados ?? []);
    } catch { toast.error('Erro ao carregar perfis'); }
    finally  { setLoadPerfis(false); }
  }, [equipeId]);

  useEffect(() => { carregarPerfis(); }, [carregarPerfis]);

  const carregarMatriz = useCallback(async (cargo: string) => {
    setLoadMatriz(true);
    setDirty({});
    try {
      const res = await api.get(`/equipes/${equipeId}/perfis/${cargo}`);
      setMatriz(res.data.dados?.matriz ?? {});
    } catch { toast.error('Erro ao carregar matriz'); }
    finally  { setLoadMatriz(false); }
  }, [equipeId]);

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
      toast.error(msg);
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
      toast.error(msg);
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
            <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-indigo-500" /></div>
          ) : perfis.length === 0 ? (
            <p className="text-center text-xs text-gray-400 py-6">Nenhum perfil encontrado.</p>
          ) : (
            perfis.map(p => {
              const labelExib   = p.label ?? CARGO_INFO[p.cargo]?.label ?? p.cargo;
              const descExib    = p.descricao ?? CARGO_INFO[p.cargo]?.desc ?? '';
              const isSel       = cargoSel === p.cargo;
              const podeDeletar = p.totalMembros === 0 && !['SOCIO', 'VETERINARIO', 'ESTAGIARIO', 'PROPRIETARIO'].includes(p.cargo);
              const isSistema   = ['SOCIO', 'VETERINARIO', 'ESTAGIARIO', 'PROPRIETARIO'].includes(p.cargo);
              return (
                <div
                  key={p.cargo}
                  className={`relative group rounded-xl px-3 py-2.5 border transition-all cursor-pointer ${
                    isSel ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'
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
            <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mb-4">
              <Shield size={24} className="text-indigo-400" />
            </div>
            <p className="font-semibold text-gray-700 mb-1">Selecione um perfil</p>
            <p className="text-sm text-gray-400">Clique em um cargo à esquerda para ver e editar sua matriz de permissões.</p>
          </div>
        ) : loadMatriz ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={22} className="animate-spin text-indigo-500" />
          </div>
        ) : (
          <>
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Shield size={15} className="text-indigo-600" />
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm">MATRIZ: {infoSel?.label.toUpperCase()}</p>
                  <p className="text-xs text-gray-400 italic mt-0.5 max-w-md">&ldquo;{infoSel?.desc}&rdquo;</p>
                  {cargoSel === 'SOCIO' && (
                    <div className="flex items-center gap-1 mt-1.5 text-[10px] text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-2 py-1 w-fit">
                      <ShieldCheck size={9} />
                      <span>Sócios têm bypass total — permissões bloqueadas aqui valem para toda a equipe</span>
                    </div>
                  )}
                  {nLocked > 0 && cargoSel !== 'SOCIO' && (
                    <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 w-fit">
                      <Lock size={9} />
                      <span>{nLocked} permiss{nLocked > 1 ? 'ões bloqueadas' : 'ão bloqueada'} pelo administrador</span>
                    </div>
                  )}
                  {nLocked > 0 && cargoSel === 'SOCIO' && (
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

  const carregarMatriz = useCallback(async (ut: UserTypeGerenciado) => {
    setLoadMatriz(true);
    setDirty({});
    try {
      const res = await api.get(`/equipes/admin/global/usertype/${ut}`);
      setMatriz(res.data.dados?.matriz ?? {});
      setConfigExiste(res.data.dados?.configuracaoExistente ?? false);
    } catch { toast.error('Erro ao carregar matriz global'); }
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
      toast.error(msg);
    } finally { setSaving(false); }
  };

  const infoSel = userTypeSel ? USER_TYPE_INFO[userTypeSel] : null;
  const nDirty  = Object.keys(dirty).length;

  return (
    <div className="flex gap-4 h-full min-h-[520px]">
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
                  isSel ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'
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
            <Loader2 size={22} className="animate-spin text-indigo-500" />
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

function TabProfissionais({ equipeId, isSocio, isAdmin }: { equipeId: number; isSocio: boolean; isAdmin?: boolean }) {
  const { user }             = useAuth();
  const [membros,  setMembros]  = useState<Membro[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [busca,    setBusca]    = useState('');
  const [filtroCargo, setFiltroCargo] = useState('');
  const [confirmDel, setConfirmDel]   = useState<Membro | null>(null);
  const [removendo,  setRemovendo]    = useState<number | null>(null);
  const [alterandoCargo, setAlterandoCargo] = useState<number | null>(null);
  const [editandoCargos, setEditandoCargos] = useState<{ membroId: number; userId: number; atual: string[] } | null>(null);
  const [proprietarios,  setProprietarios]  = useState<ProprietarioEquipe[]>([]);

  const [showConvite,       setShowConvite]       = useState(false);
  const [conviteNome,       setConviteNome]       = useState('');
  const [conviteEmail,      setConviteEmail]      = useState('');
  const [conviteCargo,      setConviteCargo]      = useState('VETERINARIO');
  const [conviteEmpresa,    setConviteEmpresa]    = useState('');
  const [conviteCnpj,       setConviteCnpj]       = useState('');
  const [enviandoConvite,   setEnviandoConvite]   = useState(false);
  const [perfisDisponiveis, setPerfisDisponiveis] = useState<Array<{ slug: string; label: string }>>([]);
  const [adminEmpresas,    setAdminEmpresas]    = useState<AdminEmpresa[]>([]);

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
        if (equipeId && isSocio) {
          try {
            const resProps = await api.get(`/equipes/${equipeId}/proprietarios`);
            setProprietarios(resProps.data?.dados ?? []);
          } catch { /* silencioso */ }
        }
      }
    } catch { toast.error('Erro ao carregar membros'); }
    finally  { setLoading(false); }
  }, [equipeId, isAdmin, isSocio]);

  const carregarPerfis = useCallback(async () => {
    try {
      const res = await api.get(`/equipes/${equipeId}/perfis`);
      const lista = (res.data.dados ?? []) as Array<{ cargo: string; label?: string }>;
      // Remove SOCIO e PROPRIETARIO do seletor de cargo para membros da equipe
      const semReservados = lista.filter(p => p.cargo !== 'SOCIO' && p.cargo !== 'PROPRIETARIO');
      setPerfisDisponiveis(semReservados.map(p => ({ slug: p.cargo, label: p.label ?? p.cargo })));
    } catch (err) {
      console.error('[TabProfissionais] carregarPerfis:', err);
    }
  }, [equipeId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { if (isAdmin || isSocio) carregarPerfis(); }, [carregarPerfis, isAdmin, isSocio]);

  const handleConvidar = async () => {
    if (!conviteEmail.trim()) { toast.error('Informe o e-mail'); return; }
    if (isAdmin && !conviteEmpresa.trim()) { toast.error('Informe o nome da empresa'); return; }
    if (isAdmin && !conviteCnpj.trim())    { toast.error('Informe o CNPJ'); return; }
    setEnviandoConvite(true);
    try {
      if (isAdmin) {
        await api.post('/equipes/admin/convidar-socio', {
          email:       conviteEmail.trim(),
          fullName:    conviteNome.trim() || undefined,
          empresaNome: conviteEmpresa.trim(),
          cnpj:        conviteCnpj.trim(),
        });
      } else {
        await api.post(`/equipes/${equipeId}/convidar`, {
          email:    conviteEmail.trim(),
          fullName: conviteNome.trim() || undefined,
          cargo:    conviteCargo,
        });
      }
      toast.success('Convite enviado por e-mail');
      setShowConvite(false);
      setConviteNome('');
      setConviteEmail('');
      setConviteEmpresa('');
      setConviteCnpj('');
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao enviar convite';
      toast.error(msg);
    } finally { setEnviandoConvite(false); }
  };

  const handleAlterarCargo = async (membro: Membro, novoCargo: string) => {
    setAlterandoCargo(membro.id);
    try {
      await api.patch(`/equipes/${equipeId}/membros/${membro.user.id}/cargo`, { cargo: novoCargo });
      toast.success('Cargo atualizado');
      carregar();
    } catch { toast.error('Erro ao alterar cargo'); }
    finally  { setAlterandoCargo(null); }
  };

  const handleSalvarCargos = async (cargosNovos: string[]) => {
    if (!editandoCargos) return;
    setAlterandoCargo(editandoCargos.membroId);
    try {
      await api.patch(`/equipes/${equipeId}/membros/${editandoCargos.userId}/cargos`, { cargos: cargosNovos });
      toast.success('Perfis atualizados');
      setEditandoCargos(null);
      carregar();
    } catch { toast.error('Erro ao atualizar perfis'); }
    finally  { setAlterandoCargo(null); }
  };

  const handleRemover = async () => {
    if (!confirmDel) return;
    setRemovendo(confirmDel.id);
    try {
      if (isAdmin && confirmDel.cargo === 'SOCIO') {
        await api.delete(`/equipes/${equipeId}/socio/${confirmDel.user.id}`);
        toast.success(`${confirmDel.user.fullName} removido e conta desativada`);
      } else {
        await api.delete(`/equipes/membros/${confirmDel.id}`);
        toast.success(`${confirmDel.user.fullName} removido`);
      }
      setConfirmDel(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao remover membro';
      toast.error(msg);
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
      await api.delete(`/equipes/${adminConfirmDel.equipeId}/socio/${adminConfirmDel.membro.user.id}`);
      toast.success(`${adminConfirmDel.membro.user.fullName} removido e conta excluída`);
      setAdminConfirmDel(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao remover sócio';
      toast.error(msg);
    } finally { setRemovendo(null); }
  };

  const filtrados = membros.filter(m => {
    const buscaOk = !busca || m.user.fullName.toLowerCase().includes(busca.toLowerCase()) || m.user.email.toLowerCase().includes(busca.toLowerCase());
    const cargoOk = !filtroCargo || m.cargo === filtroCargo;
    return buscaOk && cargoOk;
  });

  const cargosUnicos = [...new Set(membros.map(m => m.cargo))].sort();

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="font-bold text-gray-900">Gerenciamento de Profissionais ({membros.length})</p>
          <p className="text-xs text-gray-400 mt-0.5">Cadastre a equipe e atribua perfis de acesso</p>
        </div>
        {(isSocio || isAdmin) && (
          <button
            onClick={() => {
              setConviteCargo(isAdmin ? 'SOCIO' : 'VETERINARIO');
              setConviteNome(''); setConviteEmail(''); setConviteEmpresa(''); setConviteCnpj('');
              setShowConvite(true);
              if (!isAdmin) carregarPerfis();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            <Plus size={14} /> {isAdmin ? 'Convidar Sócio' : 'Convidar Profissional'}
          </button>
        )}
      </div>

      {isAdmin && !equipeId ? (
        /* ── Vista Admin global: lista todas as empresas ─────────────────────── */
        <div className="p-5 space-y-5">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-indigo-500" /></div>
          ) : adminEmpresas.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">Nenhuma empresa cadastrada.</div>
          ) : (
            adminEmpresas.map(emp => {
              const totalMembros = emp.equipes.reduce((acc, eq) => acc + eq.membros.length, 0);
              return (
                <div key={emp.id} className="rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2.5 px-5 py-3 bg-slate-50 border-b border-gray-200">
                    <Building2 size={14} className="text-indigo-500 flex-shrink-0" />
                    <p className="font-bold text-gray-800 text-sm">{emp.nome}</p>
                    <span className="ml-auto text-[11px] text-gray-400">
                      {totalMembros} membro{totalMembros !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {emp.equipes.map(eq =>
                    eq.membros.map(m => {
                      const isSocioMem = m.cargo === 'SOCIO';
                      const ativo      = m.user.ativo !== false;
                      return isSocioMem ? (
                        <div key={m.id} className="flex items-center gap-4 px-5 py-4 bg-purple-50/70 border-b border-purple-100">
                          <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center font-bold text-sm flex-shrink-0">
                            {m.user.fullName?.[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-bold text-gray-900">{m.user.fullName}</p>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">SÓCIO</span>
                            </div>
                            <p className="text-xs text-gray-500">{m.user.email}</p>
                          </div>
                          <div className="hidden md:flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
                            <Building2 size={11} /><span>{emp.nome}</span>
                          </div>
                          <span className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${
                            ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${ativo ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                            {ativo ? 'Ativo' : 'Inativo'}
                          </span>
                          <button
                            onClick={() => setAdminConfirmDel({ membro: m, equipeId: eq.id, empresaNome: emp.nome })}
                            title="Remover sócio e excluir conta"
                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : (
                        <div key={m.id} className="flex items-center gap-3 pl-12 pr-5 py-3 border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                          <ChevronRight size={11} className="text-gray-300 flex-shrink-0" />
                          <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs flex-shrink-0">
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
                            ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${ativo ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                            {ativo ? 'Ativo' : 'Inativo'}
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
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400" />
            </div>
            <select value={filtroCargo} onChange={e => setFiltroCargo(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 focus:outline-none focus:border-indigo-400 bg-white">
              <option value="">Todos os Perfis</option>
              {cargosUnicos.map(c => (
                <option key={c} value={c}>{CARGO_INFO[c]?.label ?? c}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-indigo-500" /></div>
          ) : filtrados.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">Nenhum profissional encontrado.</div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Profissional</th>
                      <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Perfil Ativo</th>
                      <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">Status de Acesso</th>
                      <th className="px-5 py-3 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wider">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtrados.map(m => (
                      <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                              {m.user.fullName?.[0]?.toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold text-gray-900">{m.user.fullName}</p>
                                {m.user.id === user?.id && (
                                  <span className="text-[9px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">Você</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-400">{m.user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          {isSocio && m.user.id !== user?.id && m.cargo !== 'SOCIO' ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {(m.cargos && m.cargos.length > 0 ? m.cargos : [m.cargo]).map(c => (
                                <span key={c} className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeCargo(c)}`}>
                                  {(CARGO_INFO[c]?.label ?? c).toUpperCase()}
                                </span>
                              ))}
                              {alterandoCargo === m.id
                                ? <Loader2 size={12} className="animate-spin text-indigo-400" />
                                : (
                                  <button
                                    onClick={() => setEditandoCargos({ membroId: m.id, userId: m.user.id, atual: m.cargos && m.cargos.length > 0 ? m.cargos : [m.cargo] })}
                                    className="p-0.5 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded transition-colors"
                                    title="Editar perfis"
                                  >
                                    <Pencil size={11} />
                                  </button>
                                )
                              }
                            </div>
                          ) : (
                            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${badgeCargo(m.cargo)}`}>
                              {(CARGO_INFO[m.cargo]?.label ?? m.cargo).toUpperCase()}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                            m.ativo !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${m.ativo !== false ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                            {m.ativo !== false ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {m.user.id !== user?.id && isSocio && m.cargo !== 'SOCIO' && (
                            <button onClick={() => setConfirmDel(m)} title="Remover membro"
                              className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-gray-50">
                {filtrados.map(m => (
                  <div key={m.id} className="px-4 py-3.5 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {m.user.fullName?.[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{m.user.fullName}</p>
                      <p className="text-xs text-gray-400 truncate">{m.user.email}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${badgeCargo(m.cargo)}`}>
                      {(CARGO_INFO[m.cargo]?.label ?? m.cargo).toUpperCase()}
                    </span>
                    {m.user.id !== user?.id && isSocio && m.cargo !== 'SOCIO' && (
                      <button onClick={() => setConfirmDel(m)} className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Modal — Convidar */}
      {showConvite && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center">
                  <Plus size={16} className="text-indigo-600" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Convidar Profissional</h2>
                  <p className="text-xs text-gray-400">Um e-mail de convite será enviado</p>
                </div>
              </div>
              <button onClick={() => setShowConvite(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              {isAdmin && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Nome da empresa <span className="text-red-500">*</span>
                    </label>
                    <input value={conviteEmpresa} onChange={e => setConviteEmpresa(e.target.value)}
                      placeholder="Ex: Clínica Veterinária São Bento"
                      className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                    <p className="text-[11px] text-gray-400 mt-1">Se o CNPJ já estiver cadastrado, o sócio será adicionado à empresa existente.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">CNPJ <span className="text-red-500">*</span></label>
                    <input value={conviteCnpj} onChange={e => setConviteCnpj(e.target.value)}
                      placeholder="00.000.000/0000-00"
                      className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome completo</label>
                <input value={conviteNome} onChange={e => setConviteNome(e.target.value)} placeholder="Ex: João da Silva"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">E-mail <span className="text-red-500">*</span></label>
                <input type="email" value={conviteEmail} onChange={e => setConviteEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleConvidar()}
                  placeholder="profissional@clinica.com"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Perfil de acesso</label>
                {isAdmin ? (
                  <div className="flex items-center gap-2 px-4 py-2.5 border border-purple-200 bg-purple-50 rounded-xl">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">SÓCIO</span>
                    <span className="text-sm text-purple-700">Acesso total irrestrito à equipe</span>
                  </div>
                ) : (
                  <select value={conviteCargo} onChange={e => setConviteCargo(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 bg-white">
                    {perfisDisponiveis.length > 0
                      ? perfisDisponiveis.map(p => (
                          <option key={p.slug} value={p.slug}>{p.label.toUpperCase()}</option>
                        ))
                      : Object.entries(CARGO_INFO)
                          .filter(([c]) => c !== 'SOCIO' && c !== 'PROPRIETARIO')
                          .map(([c, info]) => (
                            <option key={c} value={c}>{info.label.toUpperCase()}</option>
                          ))
                    }
                  </select>
                )}
              </div>

              <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700">
                <Shield size={12} className="flex-shrink-0 mt-0.5" />
                <span>O profissional receberá um e-mail com o link de acesso e uma senha temporária.</span>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowConvite(false)} disabled={enviandoConvite}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={handleConvidar} disabled={enviandoConvite || !conviteEmail.trim()}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-2xl text-sm font-semibold flex items-center justify-center gap-2">
                {enviandoConvite ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />}
                Enviar Convite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal exclusão — sócio */}
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
            <h2 className="text-lg font-bold text-gray-900 mb-2">Remover sócio?</h2>
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
      {!isAdmin && isSocio && proprietarios.length > 0 && (
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
        <div className="space-y-2 max-h-60 overflow-y-auto mb-5">
          {(perfisDisponiveis.length > 0 ? perfisDisponiveis : Object.entries(CARGO_INFO).filter(([c]) => c !== 'SOCIO' && c !== 'PROPRIETARIO').map(([slug, info]) => ({ slug, label: info.label }))).map(p => (
            <label key={p.slug} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${selecionados.includes(p.slug) ? 'border-indigo-300 bg-indigo-50' : 'border-gray-100 hover:bg-gray-50'}`}>
              <input type="checkbox" checked={selecionados.includes(p.slug)} onChange={() => toggle(p.slug)} className="w-4 h-4 accent-indigo-600" />
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeCargo(p.slug)}`}>{p.label.toUpperCase()}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={onFechar} className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={() => { if (selecionados.length > 0) onSalvar(selecionados); else toast.error('Selecione ao menos um perfil'); }}
            disabled={selecionados.length === 0}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-2xl text-sm font-semibold">
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
  const LIMIT = 30;

  const carregar = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await api.get(`/equipes/${equipeId}/auditoria?page=${p}&limit=${LIMIT}`);
      setLogs(res.data?.registros ?? []);
      setTotal(res.data?.total ?? 0);
    } catch { toast.error('Erro ao carregar logs'); }
    finally  { setLoading(false); }
  }, [equipeId]);

  useEffect(() => { carregar(page); }, [carregar, page]);

  const grupos  = gerarGrupos(logs);
  const temMais = page * LIMIT < total;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="font-bold text-gray-900">Registro de Auditoria de Segurança</p>
          <p className="text-xs text-gray-400 mt-0.5">Fluxo cronológico de atividades, alterações de permissões e acessos</p>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full font-medium">{total} registro{total > 1 ? 's' : ''}</span>
          )}
          <button onClick={() => carregar(page)} className="p-1.5 text-gray-400 hover:text-indigo-600 rounded-lg transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-indigo-500" /></div>
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
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

interface EquipeOpcao {
  id:          number;
  nome:        string;
  empresaNome: string;
}

type AbaAdmin = 'globais' | 'profissionais' | 'auditoria';
type AbaSocio = 'matriz' | 'profissionais' | 'auditoria';
type Aba = AbaAdmin | AbaSocio;

export default function ControleAcesso() {
  const { user }     = useAuth();
  const isAdmin      = user?.role === 'ADMIN';

  const [aba,          setAba]          = useState<Aba>(isAdmin ? 'globais' : 'matriz');
  const [equipeId,     setEquipeId]     = useState<number | null>(null);
  const [isSocio,      setIsSocio]      = useState(false);
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
        setIsSocio(isAdmin ? true : (r.data?.isSocio ?? false));
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

  const ABAS_SOCIO: Array<{ id: AbaSocio; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'matriz',        label: 'Matriz de Perfis',  icon: <Shield    size={15} /> },
    { id: 'profissionais', label: 'Profissionais',     icon: <Users2    size={15} /> },
    { id: 'auditoria',    label: 'Logs de Auditoria', icon: <Activity  size={15} />, badge: auditTotal },
  ];

  const ABAS = isAdmin ? ABAS_ADMIN : ABAS_SOCIO;

  if (loading) {
    return (
      <PageContainer>
        <BotaoVoltar className="mb-6" />
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-indigo-500" />
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
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <Shield size={20} className="text-indigo-700" />
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
            <span className="text-xs text-gray-500 font-medium">Equipe:</span>
            <select
              value={equipeId ?? ''}
              onChange={e => carregarEquipe(Number(e.target.value))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:border-indigo-400 shadow-sm"
            >
              {todasEquipes.map(eq => (
                <option key={eq.id} value={eq.id}>
                  {eq.nome}{eq.empresaNome ? ` — ${eq.empresaNome}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 mb-6 overflow-x-auto">
        {ABAS.map(a => (
          <button key={a.id} onClick={() => setAba(a.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex-1 justify-center
              ${aba === a.id
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'}`}>
            {a.icon}
            {a.label}
            {'badge' in a && a.badge != null && a.badge > 0 && (
              <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full ml-1">
                {a.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {isAdmin && aba === 'globais'       && <TabPermissoesGlobais />}
      {aba === 'profissionais'             && <TabProfissionais equipeId={equipeId ?? 0} isSocio={isSocio} isAdmin={isAdmin} />}
      {aba === 'auditoria'                 && equipeId && <TabAuditoria equipeId={equipeId} />}
      {!isAdmin && aba === 'matriz'        && equipeId && <TabMatriz equipeId={equipeId} />}
    </PageContainer>
  );
}

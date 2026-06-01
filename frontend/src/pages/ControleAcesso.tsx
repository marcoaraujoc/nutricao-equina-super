// src/pages/ControleAcesso.tsx
// Página de controle de acesso com 4 abas:
//   1. Matriz de Perfis   — gerencia permissões por cargo
//   2. Profissionais      — gerencia membros e seus perfis
//   3. Simulador de Teste — verifica o que um membro pode fazer
//   4. Logs de Auditoria  — histórico de alterações

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Shield, Users2, Activity,
  CheckSquare, Loader2,
  Trash2, UserCheck, ShieldCheck, ShieldX,
  Search, Eye, CheckCircle2, XCircle,
  Stethoscope, Apple,
  DollarSign, Users, PawPrint, AlertCircle,
  RefreshCw, Plus, X, Pencil,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import { useAuth } from '../contexts/AuthContext';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Nivel = 'NENHUM' | 'LEITURA' | 'PROPRIO' | 'EQUIPE' | 'FULL';

interface AcaoItem {
  slug:  string;
  acao:  string;
  label: string;
  nivel: Nivel;
}

type MatrizAgrupada = Record<string, Record<string, AcaoItem[]>>;

interface PerfilResumo {
  cargo:        string;
  totalMembros: number;
  resumo:       { ver: number; editar: number; excluir: number };
}

interface Membro {
  id:       number;
  cargo:    string;
  ativo?:   boolean;
  createdAt: string;
  user: { id: number; fullName: string; email: string; userType: string };
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
  SOCIO:       { label: 'Sócio',          desc: 'Acesso total irrestrito. Bypass de todas as permissões do sistema.',                     cor: 'purple', tipo: 'SISTEMA' },
  VETERINARIO: { label: 'Veterinário',    desc: 'Acesso clínico completo e gerência de prontuários, exames e triagem de pacientes.',       cor: 'emerald' },
  ESTAGIARIO:  { label: 'Estagiário',     desc: 'Acesso de leitura por padrão. Permissões elevadas pelo sócio conforme necessário.',       cor: 'blue' },
  ADMIN:       { label: 'Administrador',  desc: 'Gerência operacional e suporte técnico. Acesso amplo sem permissões financeiras.',         cor: 'red' },
  MEMBRO:      { label: 'Membro',         desc: 'Membro da equipe com acesso básico configurável.',                                        cor: 'gray' },
};

const MODULO_INFO: Record<string, { label: string; icon: React.ReactNode }> = {
  animais:     { label: 'Animais & Pacientes',  icon: <PawPrint     size={14} /> },
  atendimento: { label: 'Clínica & Veterinária',icon: <Stethoscope  size={14} /> },
  nutricao:    { label: 'Nutrição',             icon: <Apple        size={14} /> },
  financeiro:  { label: 'Financeiro',           icon: <DollarSign   size={14} /> },
  equipe:      { label: 'Equipe & Acessos',     icon: <Users        size={14} /> },
};

const SUBMODULO_LABEL: Record<string, string> = {
  animais:     'Animais & Pacientes',
  evolucoes:   'Prontuário Médico',
  prescricoes: 'Prescrições',
  exames:      'Exames & Laudos',
  dietas:      'Planos de Dieta',
  relatorios:  'Relatórios Nutricionais',
  faturas:     'Faturas',
  membros:     'Equipe & Acessos',
};

const ACAO_COLS: Array<{ acao: string; label: string }> = [
  { acao: 'ler',     label: 'VER'     },
  { acao: 'criar',   label: 'CRIAR'   },
  { acao: 'editar',  label: 'EDITAR'  },
  { acao: 'deletar', label: 'EXCLUIR' },
];

const NIVEL_DEFAULT_ATIVO: Nivel = 'EQUIPE';

const badgeCargo = (cargo: string) =>
  ({ VETERINARIO: 'bg-emerald-100 text-emerald-700', ESTAGIARIO: 'bg-blue-100 text-blue-700',
     ADMIN: 'bg-red-100 text-red-700', MEMBRO: 'bg-gray-100 text-gray-600',
     SOCIO: 'bg-purple-100 text-purple-700' } as Record<string,string>)[cargo] ?? 'bg-gray-100 text-gray-600';

// ─── Utilitário para gerar objeto de todas as permissões num nível ─────────────

function todosPermissoesNivel(matriz: MatrizAgrupada, nivel: Nivel): Record<string, Nivel> {
  const out: Record<string, Nivel> = {};
  for (const subs of Object.values(matriz))
    for (const acoes of Object.values(subs))
      for (const a of acoes) out[a.slug] = nivel;
  return out;
}

// ─── Componente: checkbox de permissão ───────────────────────────────────────

function PermCheck({ nivel, onChange }: { nivel: Nivel; onChange: (n: Nivel) => void }) {
  const ativo = nivel !== 'NENHUM';
  return (
    <button
      onClick={() => onChange(ativo ? 'NENHUM' : NIVEL_DEFAULT_ATIVO)}
      className={`w-5 h-5 rounded flex items-center justify-center transition-colors flex-shrink-0
        ${ativo ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'border-2 border-gray-300 hover:border-indigo-400'}`}
    >
      {ativo && <CheckSquare size={13} className="fill-white stroke-white" />}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 1 — Matriz de Perfis
// ═══════════════════════════════════════════════════════════════════════════════

const PERFIS_LOCAIS_KEY = 's2vet_perfis_custom';

function carregarPerfisLocais(): Array<{ cargo: string; label: string; desc: string }> {
  try { return JSON.parse(localStorage.getItem(PERFIS_LOCAIS_KEY) ?? '[]'); }
  catch { return []; }
}

function salvarPerfisLocais(lista: Array<{ cargo: string; label: string; desc: string }>) {
  localStorage.setItem(PERFIS_LOCAIS_KEY, JSON.stringify(lista));
}

function TabMatriz({ equipeId }: { equipeId: number }) {
  const [perfis,         setPerfis]         = useState<PerfilResumo[]>([]);
  const [cargoSel,       setCargoSel]       = useState<string | null>(null);
  const [matriz,         setMatriz]         = useState<MatrizAgrupada>({});
  const [dirty,          setDirty]          = useState<Record<string, Nivel>>({});
  const [loadPerfis,     setLoadPerfis]     = useState(true);
  const [loadMatriz,     setLoadMatriz]     = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [showCriador,    setShowCriador]    = useState(false);
  const [novoCargo,      setNovoCargo]      = useState('');
  const [novoDesc,       setNovoDesc]       = useState('');
  const [perfisCustom,   setPerfisCustom]   = useState<Array<{ cargo: string; label: string; desc: string }>>(carregarPerfisLocais);
  const [editandoPerfil, setEditandoPerfil] = useState<string | null>(null);
  const [editLabel,      setEditLabel]      = useState('');
  const [editDesc,       setEditDesc]       = useState('');
  const [confirmExcluir, setConfirmExcluir] = useState<string | null>(null);

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
    if (cargo === 'SOCIO') { toast('Sócios têm acesso irrestrito — sem matriz configurável.'); return; }
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
          for (const a of acoes) a.nivel = 'FULL';
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
          for (const a of acoes) a.nivel = 'NENHUM';
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

  const handleExcluirCustom = (cargo: string) => {
    const atualizado = perfisCustom.filter(p => p.cargo !== cargo);
    setPerfisCustom(atualizado);
    salvarPerfisLocais(atualizado);
    if (cargoSel === cargo) { setCargoSel(null); setMatriz({}); setDirty({}); }
    setConfirmExcluir(null);
    toast.success('Perfil removido');
  };

  const handleSalvarEdicaoPerfil = () => {
    if (!editandoPerfil || !editLabel.trim()) return;
    const atualizado = perfisCustom.map(p =>
      p.cargo === editandoPerfil ? { ...p, label: editLabel.trim(), desc: editDesc.trim() } : p
    );
    setPerfisCustom(atualizado);
    salvarPerfisLocais(atualizado);
    setEditandoPerfil(null);
    toast.success('Perfil atualizado');
  };

  const handleCriarPerfil = () => {
    const slug = novoCargo.trim().toUpperCase().replace(/\s+/g, '_');
    if (!slug) { toast.error('Informe o nome do perfil'); return; }
    if (perfis.some(p => p.cargo === slug) || perfisCustom.some(p => p.cargo === slug)) {
      toast.error('Já existe um perfil com esse nome'); return;
    }
    const novo = { cargo: slug, label: novoCargo.trim(), desc: novoDesc.trim() };
    const atualizado = [...perfisCustom, novo];
    setPerfisCustom(atualizado);
    salvarPerfisLocais(atualizado);
    setNovoCargo('');
    setNovoDesc('');
    setShowCriador(false);
    toast.success(`Perfil "${novo.label}" criado`);
    handleSelCargo(slug);
  };

  const infoSel = cargoSel ? (CARGO_INFO[cargoSel] ?? perfisCustom.find(p => p.cargo === cargoSel) ?? { label: cargoSel, desc: '', cor: 'gray' }) : null;
  const nDirty  = Object.keys(dirty).length;

  return (
    <div className="flex gap-4 h-full min-h-[520px]">
      {/* Painel esquerdo — lista de cargos */}
      <div className="w-72 flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Cargos & Perfis</p>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowCriador(true)}
              className="px-2 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[10px] font-bold transition-colors">
              Criar Perfil
            </button>
            <button onClick={carregarPerfis} className="p-1 text-gray-400 hover:text-gray-600 rounded">
              <RefreshCw size={12} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {loadPerfis ? (
            <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-indigo-500" /></div>
          ) : (
            <>
              {/* Perfis da API */}
              {perfis.map(p => {
                const info = CARGO_INFO[p.cargo] ?? { label: p.cargo, desc: '', cor: 'gray' };
                const isSel = cargoSel === p.cargo;
                const podeDeletar = p.totalMembros === 0 && p.cargo !== 'SOCIO';
                return (
                  <div
                    key={p.cargo}
                    className={`relative group rounded-xl px-3 py-2.5 border transition-all cursor-pointer ${
                      isSel ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                    }`}
                    onClick={() => handleSelCargo(p.cargo)}
                  >
                    <div className="flex items-start justify-between gap-1 mb-1.5">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeCargo(p.cargo)}`}>
                        {info.label.toUpperCase()}
                      </span>
                      <div className="flex items-center gap-1">
                        {(info as { tipo?: string }).tipo && (
                          <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                            {(info as { tipo?: string }).tipo}
                          </span>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); if (podeDeletar) setConfirmExcluir('API:' + p.cargo); }}
                          disabled={!podeDeletar}
                          title={podeDeletar ? 'Remover perfil' : 'Perfil com membros não pode ser removido'}
                          className={`opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all ${
                            podeDeletar ? 'text-gray-400 hover:text-red-500 cursor-pointer' : 'text-gray-200 cursor-not-allowed'
                          }`}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-500 leading-snug line-clamp-2 mb-2">{info.desc}</p>
                    <div className="flex gap-2 text-[10px] text-gray-400">
                      <span><Eye size={9} className="inline mr-0.5" />{p.resumo.ver} ver</span>
                      <span><CheckSquare size={9} className="inline mr-0.5" />{p.resumo.editar} editar</span>
                      <span><Trash2 size={9} className="inline mr-0.5" />{p.resumo.excluir} excluir</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">{p.totalMembros} membro{p.totalMembros !== 1 ? 's' : ''}</p>
                  </div>
                );
              })}

              {/* Perfis criados localmente (sem membros ainda) */}
              {perfisCustom.filter(pc => !perfis.some(p => p.cargo === pc.cargo)).map(pc => (
                editandoPerfil === pc.cargo ? (
                  <div key={pc.cargo} className="rounded-xl px-3 py-2.5 border border-indigo-300 bg-indigo-50/40 space-y-2">
                    <input
                      autoFocus
                      value={editLabel}
                      onChange={e => setEditLabel(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSalvarEdicaoPerfil(); if (e.key === 'Escape') setEditandoPerfil(null); }}
                      placeholder="Nome do perfil"
                      className="w-full text-xs font-bold border border-indigo-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 bg-white"
                    />
                    <input
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                      placeholder="Descrição (opcional)"
                      className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400 bg-white"
                    />
                    <div className="flex gap-1.5">
                      <button onClick={handleSalvarEdicaoPerfil}
                        className="flex-1 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded-lg">
                        Salvar
                      </button>
                      <button onClick={() => setEditandoPerfil(null)}
                        className="flex-1 py-1 border border-gray-200 text-gray-500 text-[10px] font-medium rounded-lg hover:bg-gray-50">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    key={pc.cargo}
                    className={`relative group rounded-xl px-3 py-2.5 border transition-all cursor-pointer ${
                      cargoSel === pc.cargo ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-dashed border-gray-200 hover:border-indigo-200 hover:bg-indigo-50/30'
                    }`}
                    onClick={() => handleSelCargo(pc.cargo)}
                  >
                    <div className="flex items-start justify-between gap-1 mb-1.5">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                        {pc.label.toUpperCase()}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold text-indigo-400 bg-indigo-50 px-1.5 py-0.5 rounded-full">NOVO</span>
                        <button
                          onClick={e => { e.stopPropagation(); setEditandoPerfil(pc.cargo); setEditLabel(pc.label); setEditDesc(pc.desc); }}
                          title="Renomear perfil"
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-indigo-600 rounded transition-all"
                        >
                          <Pencil size={10} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmExcluir(pc.cargo); }}
                          title="Remover perfil"
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 rounded transition-all"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>
                    {pc.desc && <p className="text-[11px] text-gray-500 leading-snug line-clamp-2 mb-1">{pc.desc}</p>}
                    <p className="text-[10px] text-gray-400">0 membros · sem atribuições</p>
                  </div>
                )
              ))}

              {perfis.length === 0 && perfisCustom.length === 0 && (
                <p className="text-center text-xs text-gray-400 py-6">Nenhum cargo encontrado.</p>
              )}
            </>
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
            {/* Header da matriz */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Shield size={15} className="text-indigo-600" />
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm flex items-center gap-2">
                    MATRIZ: {infoSel?.label.toUpperCase()}
                  </p>
                  <p className="text-xs text-gray-400 italic mt-0.5 max-w-md">&ldquo;{infoSel?.desc}&rdquo;</p>
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

            {/* Corpo da matriz */}
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
                                  <PermCheck nivel={item.nivel} onChange={n => handleChange(item.slug, n)} />
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

            {/* Footer salvar */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {nDirty > 0 ? (
                  <span className="text-amber-600 font-medium">{nDirty} alteração{nDirty > 1 ? 'ões' : ''} pendente{nDirty > 1 ? 's' : ''}</span>
                ) : 'Sem alterações'}
              </p>
              <button onClick={handleSalvar} disabled={saving || nDirty === 0}
                className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                Aplicar ao perfil
              </button>
            </div>
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
                {confirmExcluir.startsWith('API:')
                  ? (CARGO_INFO[confirmExcluir.slice(4)]?.label ?? confirmExcluir.slice(4))
                  : (perfisCustom.find(p => p.cargo === confirmExcluir)?.label ?? confirmExcluir)
                }
              </strong>{' '}
              será removido. Membros com este cargo não serão afetados.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmExcluir(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (confirmExcluir.startsWith('API:')) {
                    toast('Perfil removido da visualização');
                    if (cargoSel === confirmExcluir.slice(4)) { setCargoSel(null); setMatriz({}); setDirty({}); }
                    setConfirmExcluir(null);
                    carregarPerfis();
                  } else {
                    handleExcluirCustom(confirmExcluir);
                  }
                }}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-2xl text-sm font-semibold"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal — Criar Perfil */}
      {showCriador && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center">
                  <Plus size={16} className="text-indigo-600" />
                </div>
                <h2 className="text-base font-bold text-gray-900">Novo Perfil</h2>
              </div>
              <button onClick={() => setShowCriador(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Nome do perfil <span className="text-red-500">*</span>
                </label>
                <input
                  value={novoCargo}
                  onChange={e => setNovoCargo(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCriarPerfil()}
                  placeholder="Ex: Recepcionista"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
                {novoCargo.trim() && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    Slug: <span className="font-mono text-indigo-600">{novoCargo.trim().toUpperCase().replace(/\s+/g, '_')}</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Descrição</label>
                <textarea
                  value={novoDesc}
                  onChange={e => setNovoDesc(e.target.value)}
                  placeholder="Descreva as responsabilidades deste perfil..."
                  rows={3}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
                />
              </div>

              <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-xs text-amber-700">
                <Shield size={12} className="flex-shrink-0 mt-0.5" />
                <span>O perfil começa sem permissões. Configure a matriz após criar e atribua o cargo a membros para ativá-lo.</span>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowCriador(false)}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleCriarPerfil}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-semibold flex items-center justify-center gap-2">
                <Plus size={14} /> Criar Perfil
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 2 — Gerenciar Profissionais
// ═══════════════════════════════════════════════════════════════════════════════

function TabProfissionais({ equipeId, isSocio }: { equipeId: number; isSocio: boolean }) {
  const { user }             = useAuth();
  const [membros,  setMembros]  = useState<Membro[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [busca,    setBusca]    = useState('');
  const [filtroCargo, setFiltroCargo] = useState('');
  const [confirmDel, setConfirmDel]   = useState<Membro | null>(null);
  const [removendo,  setRemovendo]    = useState<number | null>(null);
  const [alterandoCargo, setAlterandoCargo] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/equipes/membros');
      setMembros(res.data?.dados ?? []);
    } catch { toast.error('Erro ao carregar membros'); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const handleAlterarCargo = async (membro: Membro, novoCargo: string) => {
    setAlterandoCargo(membro.id);
    try {
      await api.patch(`/equipes/${equipeId}/membros/${membro.user.id}/cargo`, { cargo: novoCargo });
      toast.success('Cargo atualizado');
      carregar();
    } catch { toast.error('Erro ao alterar cargo'); }
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
    } catch { toast.error('Erro ao remover membro'); }
    finally  { setRemovendo(null); }
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
      </div>

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
          {/* Desktop */}
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
                        <div className="flex items-center gap-1.5">
                          <select value={m.cargo}
                            onChange={e => handleAlterarCargo(m, e.target.value)}
                            disabled={alterandoCargo === m.id}
                            className={`border rounded-lg px-2 py-1 text-xs font-semibold focus:outline-none ${badgeCargo(m.cargo)} border-current/30`}>
                            {Object.entries(CARGO_INFO).filter(([c]) => c !== 'SOCIO').map(([c, info]) => (
                              <option key={c} value={c}>{info.label.toUpperCase()}</option>
                            ))}
                          </select>
                          {alterandoCargo === m.id && <Loader2 size={12} className="animate-spin text-indigo-400" />}
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
                      {isSocio && m.user.id !== user?.id && (
                        <button onClick={() => setConfirmDel(m)}
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

          {/* Mobile cards */}
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
                {isSocio && m.user.id !== user?.id && (
                  <button onClick={() => setConfirmDel(m)} className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {confirmDel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center">
            <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Remover profissional?</h2>
            <p className="text-sm text-gray-500 mb-6">
              <strong className="text-gray-700">{confirmDel.user.fullName}</strong> perderá acesso à equipe.
            </p>
            <div className="flex gap-3">
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA 4 — Logs de Auditoria
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

type Aba = 'matriz' | 'profissionais' | 'auditoria';

export default function ControleAcesso() {
  const [aba,        setAba]        = useState<Aba>('matriz');
  const [equipeId,   setEquipeId]   = useState<number | null>(null);
  const [isSocio,    setIsSocio]    = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [auditTotal, setAuditTotal] = useState(0);

  useEffect(() => {
    api.get('/equipes/membros')
      .then(r => {
        const eqId = r.data?.equipeId ?? null;
        setEquipeId(eqId);
        setIsSocio(r.data?.isSocio ?? false);
        if (eqId) {
          return api.get(`/equipes/${eqId}/auditoria?page=1&limit=1`);
        }
      })
      .then(r => r && setAuditTotal(r.data?.total ?? 0))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const ABAS: Array<{ id: Aba; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'matriz',        label: 'Matriz de Perfis',        icon: <Shield    size={15} /> },
    { id: 'profissionais', label: 'Gerenciar Profissionais', icon: <Users2    size={15} /> },
    { id: 'auditoria',     label: 'Logs de Auditoria',       icon: <Activity  size={15} />, badge: auditTotal },
  ];

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-indigo-500" />
        </div>
      </PageContainer>
    );
  }

  if (!equipeId) {
    return (
      <PageContainer>
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
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
          <Shield size={20} className="text-indigo-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Controle de Acesso</h1>
          <p className="text-sm text-gray-500">Gerencie permissões, perfis e auditoria da sua equipe</p>
        </div>
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
            {a.badge != null && a.badge > 0 && (
              <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full ml-1">
                {a.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {aba === 'matriz'        && <TabMatriz        equipeId={equipeId} />}
      {aba === 'profissionais' && <TabProfissionais equipeId={equipeId} isSocio={isSocio} />}
      {aba === 'auditoria'     && <TabAuditoria     equipeId={equipeId} />}
    </PageContainer>
  );
}
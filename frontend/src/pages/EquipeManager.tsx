// src/pages/EquipeManager.tsx
// Gerenciamento de empresas, equipes e convites

import { useState, useEffect } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Plus, Mail, Trash2, Building2,
  Users, ChevronDown, ChevronUp, Check, X,
} from 'lucide-react';
import BotaoVoltar from '../components/BotaoVoltar';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Membro {
  id: number; cargo: string; cargoLabel: string;
  userId: number; nome: string; email: string; crmv?: string | null;
}

interface ConvitePendente {
  id: number; email: string; cargo: string; createdAt: string;
}

interface Equipe {
  id: number; nome: string;
  membros?: Membro[]; convitesPendentes?: ConvitePendente[];
}

interface Empresa {
  id: number; nome: string; cnpj?: string | null; telefone?: string | null;
  equipes: Equipe[];
}

const CARGOS = [
  { value: 'VETERINARIO_SENIOR',  label: 'Veterinário Sênior'  },
  { value: 'VETERINARIO_PLENO',   label: 'Veterinário Pleno'   },
  { value: 'VETERINARIO_JUNIOR',  label: 'Veterinário Júnior'  },
  { value: 'ESTAGIARIO',          label: 'Estagiário'          },
  { value: 'PARCEIRO',            label: 'Parceiro'             },
];

// ─── Sub-componente: Painel de equipe expandida ───────────────────────────────

function EquipePanel({ equipe, onConvidar, onRemoverMembro }: {
  equipe: Equipe;
  onConvidar: (equipeId: number, email: string, cargo: string) => Promise<void>;
  onRemoverMembro: (membroId: number) => Promise<void>;
}) {
  const [expandida, setExpandida] = useState(false);
  const [membros,   setMembros]   = useState<Membro[]>([]);
  const [convites,  setConvites]  = useState<ConvitePendente[]>([]);
  const [loadingM,  setLoadingM]  = useState(false);

  // Form convite
  const [email,  setEmail]  = useState('');
  const [cargo,  setCargo]  = useState('VETERINARIO_PLENO');
  const [sending,setSending]= useState(false);

  const carregarMembros = async () => {
    setLoadingM(true);
    try {
      const res = await api.get(`/equipes/${equipe.id}/membros`);
      setMembros(res.data.dados.membros    ?? []);
      setConvites(res.data.dados.convitesPendentes ?? []);
    } catch { toast.error('Erro ao carregar membros'); }
    finally  { setLoadingM(false); }
  };

  const handleExpand = () => {
    if (!expandida) carregarMembros();
    setExpandida(e => !e);
  };

  const handleConvidar = async () => {
    if (!email.trim()) { toast.error('Informe um e-mail'); return; }
    setSending(true);
    try {
      await onConvidar(equipe.id, email.trim(), cargo);
      setEmail('');
      carregarMembros();
    } finally { setSending(false); }
  };

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden">
      {/* Header da equipe */}
      <button
        onClick={handleExpand}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors">
        <div className="flex items-center gap-2">
          <Users size={15} className="text-emerald-600" />
          <span className="font-semibold text-gray-800 text-sm">{equipe.nome}</span>
        </div>
        {expandida ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>

      {expandida && (
        <div className="p-4 space-y-4">
          {loadingM ? (
            <p className="text-xs text-gray-400 text-center py-4">Carregando...</p>
          ) : (
            <>
              {/* Lista de membros */}
              {membros.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Membros</p>
                  <div className="space-y-2">
                    {membros.map(m => (
                      <div key={m.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{m.nome}</p>
                          <p className="text-xs text-gray-400">{m.email} · {m.cargoLabel}{m.crmv ? ` · CRMV ${m.crmv}` : ''}</p>
                        </div>
                        <button onClick={() => onRemoverMembro(m.id)}
                          className="text-gray-300 hover:text-red-500 p-1 rounded transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Convites pendentes */}
              {convites.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Convites pendentes</p>
                  <div className="space-y-1">
                    {convites.map(c => (
                      <div key={c.id} className="flex items-center gap-2 text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                        <Mail size={11} className="text-amber-500" />
                        <span>{c.email}</span>
                        <span className="text-gray-300">·</span>
                        <span>{CARGOS.find(x => x.value === c.cargo)?.label ?? c.cargo}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Form de convite */}
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-emerald-700">Convidar novo membro</p>
                <input value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="E-mail do convidado"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500" />
                <div className="flex gap-2">
                  <select value={cargo} onChange={e => setCargo(e.target.value)}
                    className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500">
                    {CARGOS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <button onClick={handleConvidar} disabled={sending}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white text-sm font-semibold rounded-xl transition-colors">
                    {sending ? 'Enviando...' : <><Mail size={13} /> Convidar</>}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EquipeManager() {
  const [empresas,      setEmpresas]      = useState<Empresa[]>([]);
  const [loading,       setLoading]       = useState(true);

  // Form empresa
  const [showEmpForm,   setShowEmpForm]   = useState(false);
  const [empNome,       setEmpNome]       = useState('');
  const [empCnpj,       setEmpCnpj]       = useState('');
  const [empTel,        setEmpTel]        = useState('');
  const [savingEmp,     setSavingEmp]     = useState(false);

  // Form equipe
  const [showEqForm,    setShowEqForm]    = useState<number | null>(null); // empresaId
  const [eqNome,        setEqNome]        = useState('');
  const [savingEq,      setSavingEq]      = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await api.get('/equipes/empresas');
      setEmpresas(res.data.dados ?? []);
    } catch { toast.error('Erro ao carregar empresas'); }
    finally  { setLoading(false); }
  };

  useEffect(() => { carregar(); }, []);

  const handleCriarEmpresa = async () => {
    if (!empNome.trim()) { toast.error('Nome da empresa é obrigatório'); return; }
    setSavingEmp(true);
    try {
      await api.post('/equipes/empresas', { nome: empNome.trim(), cnpj: empCnpj || undefined, telefone: empTel || undefined });
      toast.success('Empresa criada!');
      setEmpNome(''); setEmpCnpj(''); setEmpTel(''); setShowEmpForm(false);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao criar empresa';
      toast.error(msg);
    } finally { setSavingEmp(false); }
  };

  const handleCriarEquipe = async (empresaId: number) => {
    if (!eqNome.trim()) { toast.error('Nome da equipe é obrigatório'); return; }
    setSavingEq(true);
    try {
      await api.post('/equipes', { nome: eqNome.trim(), empresaId });
      toast.success('Equipe criada!');
      setEqNome(''); setShowEqForm(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao criar equipe';
      toast.error(msg);
    } finally { setSavingEq(false); }
  };

  const handleConvidar = async (equipeId: number, email: string, cargo: string) => {
    try {
      await api.post('/equipes/convites', { equipeId, email, cargo });
      toast.success(`Convite enviado para ${email}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao enviar convite';
      toast.error(msg);
      throw err;
    }
  };

  const handleRemoverMembro = async (membroId: number) => {
    try {
      await api.delete(`/equipes/membros/${membroId}`);
      toast.success('Membro removido');
    } catch { toast.error('Erro ao remover membro'); throw new Error(); }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-3xl mx-auto px-4">

        <BotaoVoltar className="mb-4 mt-6" />

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Minha Equipe</h1>
            <p className="text-sm text-gray-500 mt-0.5">Gerencie empresas, equipes e convites</p>
          </div>
          <button onClick={() => setShowEmpForm(f => !f)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl transition-colors">
            <Plus size={15} /> Nova empresa
          </button>
        </div>

        {/* Form nova empresa */}
        {showEmpForm && (
          <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5 mb-4 space-y-3">
            <p className="font-semibold text-gray-800 text-sm">Nova empresa</p>
            <input value={empNome} onChange={e => setEmpNome(e.target.value)}
              placeholder="Nome da empresa *"
              className="w-full text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-500" />
            <div className="grid grid-cols-2 gap-3">
              <input value={empCnpj} onChange={e => setEmpCnpj(e.target.value)}
                placeholder="CNPJ (opcional)"
                className="text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-500" />
              <input value={empTel} onChange={e => setEmpTel(e.target.value)}
                placeholder="Telefone (opcional)"
                className="text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-500" />
            </div>
            <div className="flex gap-2">
              <button onClick={handleCriarEmpresa} disabled={savingEmp}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white text-sm font-semibold rounded-xl transition-colors">
                <Check size={14} /> {savingEmp ? 'Salvando...' : 'Criar empresa'}
              </button>
              <button onClick={() => setShowEmpForm(false)}
                className="px-4 py-2 border border-gray-200 text-gray-500 text-sm rounded-xl hover:bg-gray-50">
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-center py-12 text-gray-400 text-sm">Carregando...</p>
        ) : empresas.length === 0 ? (
          <div className="text-center py-16">
            <Building2 size={40} className="text-gray-200 mx-auto mb-4" />
            <p className="text-gray-400 text-sm">Nenhuma empresa cadastrada ainda.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {empresas.map(emp => (
              <div key={emp.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

                {/* Header empresa */}
                <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                      <Building2 size={18} className="text-emerald-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{emp.nome}</p>
                      {emp.cnpj    && <p className="text-xs text-gray-400">CNPJ: {emp.cnpj}</p>}
                      {emp.telefone && <p className="text-xs text-gray-400">{emp.telefone}</p>}
                    </div>
                  </div>
                  <button onClick={() => setShowEqForm(showEqForm === emp.id ? null : emp.id)}
                    className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-semibold rounded-xl hover:border-emerald-400 hover:text-emerald-700 transition-colors">
                    <Plus size={12} /> Equipe
                  </button>
                </div>

                {/* Form nova equipe */}
                {showEqForm === emp.id && (
                  <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex gap-2">
                    <input value={eqNome} onChange={e => setEqNome(e.target.value)}
                      placeholder="Nome da equipe..."
                      className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500" />
                    <button onClick={() => handleCriarEquipe(emp.id)} disabled={savingEq}
                      className="px-3 py-2 bg-emerald-700 text-white text-sm font-semibold rounded-xl hover:bg-emerald-800 disabled:bg-gray-300 transition-colors">
                      {savingEq ? '...' : <Check size={14} />}
                    </button>
                    <button onClick={() => setShowEqForm(null)}
                      className="px-3 py-2 border border-gray-200 text-gray-400 rounded-xl hover:bg-gray-100">
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* Equipes */}
                <div className="p-4 space-y-3">
                  {emp.equipes.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-3">Nenhuma equipe. Crie a primeira acima.</p>
                  ) : emp.equipes.map(eq => (
                    <EquipePanel key={eq.id} equipe={eq}
                      onConvidar={handleConvidar} onRemoverMembro={handleRemoverMembro} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
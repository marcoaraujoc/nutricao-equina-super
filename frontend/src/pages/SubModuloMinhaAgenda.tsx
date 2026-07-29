// src/pages/SubModuloMinhaAgenda.tsx
// Aba "Minha Agenda" do módulo Atendimento — atendimentos do dia

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, CheckCircle2, Pencil, Loader2, X, Clock, Users, Ban, ShieldCheck, Stethoscope } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import ModalJustificativa from '../components/ModalJustificativa';
import InlineError from '../components/InlineError';

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoAgendamento = 'CONSULTA' | 'VACINA' | 'RETORNO' | 'EXAME' | 'PROCEDIMENTO';
// TRANSFERIDO = reagendado para outra data (o horário antigo foi liberado)
type StatusAgendamento = 'AGENDADO' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'FINALIZADO' | 'CANCELADO' | 'ATRASADA' | 'TRANSFERIDO';

interface Agendamento {
  id:          number;
  tipo:        TipoAgendamento;
  titulo:      string;
  dataHora:    string;
  status:      StatusAgendamento;
  observacao:  string | null;
  veterinario: { id: number; fullName: string } | null;
  animal: {
    id:      number;
    nome:    string;
    especie: { nome: string } | null;
    user:    { id: number; fullName: string } | null;
  };
}

interface VetMembro {
  userId:   number;
  fullName: string;
  cargo:    string;
}

interface Props {
  onSelecionarAnimal: (animalId: number) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TIPOS: Record<TipoAgendamento, { label: string; cls: string }> = {
  CONSULTA:     { label: 'Consulta',     cls: 'bg-blue-100 text-blue-700' },
  VACINA:       { label: 'Vacina',       cls: 'bg-teal-100 text-teal-700' },
  RETORNO:      { label: 'Retorno',      cls: 'bg-amber-100 text-amber-700' },
  EXAME:        { label: 'Exame',        cls: 'bg-purple-100 text-purple-700' },
  PROCEDIMENTO: { label: 'Procedimento', cls: 'bg-emerald-100 text-emerald-700' },
};

const TIPOS_LIST: TipoAgendamento[] = ['CONSULTA', 'VACINA', 'RETORNO', 'EXAME', 'PROCEDIMENTO'];

// Mesmas cores/rótulos da tela /agendamentos
const STATUS_CLS: Record<StatusAgendamento, string> = {
  AGENDADO:     'bg-amber-100 text-amber-700',
  EM_ANDAMENTO: 'bg-blue-100 text-blue-700',
  CONCLUIDO:    'bg-green-100 text-green-700',
  FINALIZADO:   'bg-green-100 text-green-700',
  CANCELADO:    'bg-red-100 text-red-700',
  ATRASADA:     'bg-orange-100 text-orange-700',
  TRANSFERIDO:  'bg-violet-100 text-violet-700',
};

const STATUS_LABEL: Record<StatusAgendamento, string> = {
  AGENDADO:     'AGENDADO',
  EM_ANDAMENTO: 'EM ANDAMENTO',
  CONCLUIDO:    'CONCLUÍDO',
  FINALIZADO:   'FINALIZADO',
  CANCELADO:    'CANCELADO',
  ATRASADA:     'ATRASADA',
  TRANSFERIDO:  'TRANSFERIDO',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatHora(dataHora: string): string {
  const d = new Date(dataHora);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dataHoje(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── SubModuloMinhaAgenda ─────────────────────────────────────────────────────

export default function SubModuloMinhaAgenda({ onSelecionarAnimal }: Props) {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeEditar = isGestor || podeExecutar('atendimento.agendamentos.editar');

  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [vets,         setVets]         = useState<VetMembro[]>([]);

  // editar agendamento
  const [editando,   setEditando]   = useState<Agendamento | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [editTitulo, setEditTitulo] = useState('');
  const [editTipo,   setEditTipo]   = useState<TipoAgendamento>('CONSULTA');
  const [editData,   setEditData]   = useState('');
  const [editHora,   setEditHora]   = useState('');
  const [editObs,    setEditObs]    = useState('');

  // cancelar com confirmação
  const [cancelandoId, setCancelandoId] = useState<number | null>(null);

  // trocar profissional
  const [trocandoVet,   setTrocandoVet]   = useState<Agendamento | null>(null);
  const [trocandoVetId, setTrocandoVetId] = useState('');
  const [savingTroca,   setSavingTroca]   = useState(false);

  // filtro por profissional (apenas GESTOR vê o seletor)
  const [filtroVetId, setFiltroVetId]     = useState('');

  const hoje = dataHoje();
  const { user } = useAuth();
  const navigate = useNavigate();

  // ── Carrega vets e agenda ───────────────────────────────────────────────────

  const fetchVets = useCallback(async () => {
    try {
      const res = await api.get('/equipes/membros');
      if (!res.data) return;
      const membros = (res.data.dados ?? []) as Array<{ cargo: string; user: { id: number; fullName: string; userType: string } }>;
      setVets(membros
        .filter(m => m.user.userType === 'VETERINARIO' || m.cargo === 'GESTOR')
        .map(m => ({ userId: m.user.id, fullName: m.user.fullName, cargo: m.cargo }))
      );
    } catch { /* silencioso */ }
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/clinica/agendamentos?data=${hoje}`);
      const todos: Agendamento[] = res.data?.dados ?? [];
      // Todos os agendamentos do dia, incluindo CONCLUIDO e CANCELADO (este aparece
      // esmaecido, com o motivo) — mesma visão da tela /agendamentos.
      setAgendamentos(todos);
    } catch {
      setErroInline('Erro ao carregar agenda do dia');
    } finally {
      setLoading(false);
    }
  }, [hoje]);

  useEffect(() => {
    if (loadingPerms) return;
    carregar();
    fetchVets();
  }, [carregar, fetchVets, loadingPerms]);

  // ── Iniciar atendimento ────────────────────────────────────────────────────

  const handleIniciarAtendimento = (ag: Agendamento) => {
    if (!ag.animal?.id) { setErroInline('Animal não identificado no agendamento'); return; }
    navigate(`/clinica/evolucao/${ag.animal.id}?agendamentoId=${ag.id}`);
  };

  // ── Concluir ───────────────────────────────────────────────────────────────

  const handleConcluir = async (id: number) => {
    try {
      await api.patch(`/clinica/agendamentos/${id}/status`, { status: 'CONCLUIDO' });
      toast.success('Atendimento concluído');
      setAgendamentos(prev => prev.map(a => a.id === id ? { ...a, status: 'CONCLUIDO' as StatusAgendamento } : a));
    } catch {
      setErroInline('Erro ao concluir atendimento');
    }
  };

  // ── Cancelar ───────────────────────────────────────────────────────────────

  const handleCancelar = async (id: number, motivo: string) => {
    try {
      await api.patch(`/clinica/agendamentos/${id}/status`, { status: 'CANCELADO', motivo });
      toast.success('Agendamento cancelado');
      setCancelandoId(null);
      setAgendamentos(prev => prev.map(a => a.id === id
        ? { ...a, status: 'CANCELADO' as StatusAgendamento, observacao: motivo }
        : a));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao cancelar agendamento');
    }
  };

  // ── Editar ─────────────────────────────────────────────────────────────────

  const abrirEditar = (ag: Agendamento) => {
    setEditando(ag);
    setEditTitulo(ag.titulo);
    setEditTipo(ag.tipo);
    const d = new Date(ag.dataHora);
    setEditData(d.toISOString().split('T')[0]);
    setEditHora(
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    );
    setEditObs(ag.observacao ?? '');
  };

  const handleSalvar = async () => {
    if (!editando) return;
    if (!editTitulo.trim()) { setErroInline('Título é obrigatório'); return; }
    if (!editData || !editHora) { setErroInline('Data e hora são obrigatórias'); return; }
    setSaving(true);
    try {
      await api.patch(`/clinica/agendamentos/${editando.id}`, {
        titulo:   editTitulo,
        tipo:     editTipo,
        dataHora: new Date(`${editData}T${editHora}:00`).toISOString(),
        observacao: editObs || null,
      });
      toast.success('Agendamento atualizado');
      setEditando(null);
      carregar();
    } catch {
      setErroInline('Erro ao atualizar agendamento');
    } finally {
      setSaving(false);
    }
  };

  // ── Trocar profissional ────────────────────────────────────────────────────

  const abrirTrocarVet = (ag: Agendamento) => {
    setTrocandoVet(ag);
    setTrocandoVetId(ag.veterinario ? String(ag.veterinario.id) : '');
  };

  const handleTrocarVet = async () => {
    if (!trocandoVet || !trocandoVetId) { setErroInline('Selecione um profissional'); return; }
    if (trocandoVetId === String(trocandoVet.veterinario?.id)) {
      setErroInline('O profissional selecionado já é o responsável');
      return;
    }
    setSavingTroca(true);
    try {
      await api.patch(`/clinica/agendamentos/${trocandoVet.id}`, { veterinarioId: Number(trocandoVetId) });
      const novoVet = vets.find(v => String(v.userId) === trocandoVetId);
      toast.success(`Transferido para ${novoVet?.fullName ?? 'novo profissional'}`);
      setTrocandoVet(null);
      carregar();
    } catch {
      setErroInline('Erro ao trocar profissional');
    } finally {
      setSavingTroca(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.agendamentos.ler')) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <ShieldCheck size={36} className="mb-3 opacity-30" />
        <p className="text-sm">Sem permissão para visualizar agendamentos.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={22} className="animate-spin text-emerald-600" />
      </div>
    );
  }

  // GESTOR: vê toda a equipe (com filtro opcional por profissional)
  // VET/ESTAGIÁRIO: vê apenas os próprios agendamentos
  const agendamentosFiltrados = isGestor
    ? (filtroVetId
        ? agendamentos.filter(ag => ag.veterinario?.id === Number(filtroVetId))
        : agendamentos)
    : agendamentos.filter(ag => ag.veterinario?.id === user?.id);

  return (
    <>
      <InlineError message={erroInline} className="mb-4" />

      {/* ── Filtro por profissional (GESTOR) ──────────────────────────────── */}
      {isGestor && vets.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-50">
          <Users size={14} className="text-gray-400 flex-shrink-0" />
          <select
            value={filtroVetId}
            onChange={e => setFiltroVetId(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500 flex-1 max-w-xs"
          >
            <option value="">Todos os profissionais</option>
            {vets.map(v => (
              <option key={v.userId} value={v.userId}>{v.fullName}</option>
            ))}
          </select>
        </div>
      )}

      {agendamentosFiltrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <Calendar size={38} className="mb-3" />
          <p className="text-sm text-gray-400 font-medium">
            {filtroVetId ? 'Nenhum atendimento para este profissional' : 'Nenhum atendimento para hoje'}
          </p>
          <p className="text-xs text-gray-300 mt-1">Os agendamentos ativos do dia aparecem aqui.</p>
        </div>
      ) : (<>
      {/* ── Desktop table ─────────────────────────────────────────────────── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Animal</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Procedimento</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <span className="flex items-center justify-center gap-1"><Clock size={11} /> Horário</span>
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {agendamentosFiltrados.map(ag => {
              // ATRASADA é variante de AGENDADO (ainda não ocorreu) — mesmas ações.
              const isAgendado    = ag.status === 'AGENDADO' || ag.status === 'ATRASADA';
              const isConcluido   = ag.status === 'CONCLUIDO';
              const isTransferido = ag.status === 'TRANSFERIDO';
              const isCancelado   = ag.status === 'CANCELADO' || isTransferido;
              const isEmAndamento = ag.status === 'EM_ANDAMENTO';
              return (
                <tr key={ag.id} className={`hover:bg-gray-50 transition-colors ${isConcluido || isCancelado ? 'opacity-60' : ''}`}>

                  <td className="px-4 py-3">
                    <button onClick={() => onSelecionarAnimal(ag.animal.id)} className="text-left group">
                      <p className="font-semibold text-emerald-700 group-hover:underline text-sm">{ag.animal.nome}</p>
                      {ag.animal.especie && <p className="text-xs text-gray-400">{ag.animal.especie.nome}</p>}
                      {ag.animal.user    && <p className="text-xs text-gray-400">{ag.animal.user.fullName}</p>}
                    </button>
                  </td>

                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${TIPOS[ag.tipo].cls}`}>
                      {TIPOS[ag.tipo].label}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <p className="text-sm text-gray-800">{ag.titulo}</p>
                    {ag.observacao && (
                      <p className={`text-xs mt-0.5 line-clamp-1 ${
                        isTransferido ? 'text-violet-600 italic' : isCancelado ? 'text-red-500 italic' : 'text-gray-400'
                      }`}>
                        {isTransferido ? ag.observacao : isCancelado ? `Motivo: ${ag.observacao}` : ag.observacao}
                      </p>
                    )}
                    {ag.veterinario && (
                      <p className="text-xs text-gray-400 mt-0.5">{ag.veterinario.fullName}</p>
                    )}
                  </td>

                  <td className="px-4 py-3 text-center">
                    <span className="font-mono font-semibold text-gray-800 text-sm">{formatHora(ag.dataHora)}</span>
                  </td>

                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_CLS[ag.status]}`}>
                      {STATUS_LABEL[ag.status]}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      {isAgendado && (
                        <button onClick={() => handleIniciarAtendimento(ag)} title="Iniciar atendimento"
                          className="p-1.5 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-lg transition-colors">
                          <Stethoscope size={13} />
                        </button>
                      )}
                      {isEmAndamento && (
                        <button onClick={() => handleIniciarAtendimento(ag)} title="Continuar atendimento"
                          className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors">
                          <Stethoscope size={13} />
                        </button>
                      )}
                      {isAgendado && podeEditar && (
                        <button onClick={() => abrirEditar(ag)} title="Alterar"
                          className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                          <Pencil size={13} />
                        </button>
                      )}
                      {isAgendado && podeEditar && (
                        <button onClick={() => handleConcluir(ag.id)} title="Concluir"
                          className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors">
                          <CheckCircle2 size={13} />
                        </button>
                      )}
                      {isAgendado && isGestor && vets.length > 0 && (
                        <button onClick={() => abrirTrocarVet(ag)} title="Trocar profissional"
                          className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
                          <Users size={13} />
                        </button>
                      )}
                      {isAgendado && podeEditar && (
                        <button onClick={() => setCancelandoId(ag.id)} title="Cancelar"
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Ban size={13} />
                        </button>
                      )}
                    </div>
                  </td>

                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ──────────────────────────────────────────────────── */}
      <div className="md:hidden divide-y divide-gray-50">
        {agendamentosFiltrados.map(ag => {
          // ATRASADA é variante de AGENDADO (ainda não ocorreu) — mesmas ações.
          const isAgendado    = ag.status === 'AGENDADO' || ag.status === 'ATRASADA';
          const isConcluido   = ag.status === 'CONCLUIDO';
          const isTransferido = ag.status === 'TRANSFERIDO';
          const isCancelado   = ag.status === 'CANCELADO' || isTransferido;
          const isEmAndamento = ag.status === 'EM_ANDAMENTO';
          return (
            <div key={ag.id} className={`px-4 py-3 ${isConcluido || isCancelado ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <button onClick={() => onSelecionarAnimal(ag.animal.id)}
                    className="font-semibold text-emerald-700 hover:underline text-sm text-left">
                    {ag.animal.nome}
                  </button>
                  {ag.animal.especie && (
                    <span className="text-xs text-gray-400 ml-1">· {ag.animal.especie.nome}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${TIPOS[ag.tipo].cls}`}>
                    {TIPOS[ag.tipo].label}
                  </span>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_CLS[ag.status]}`}>
                    {STATUS_LABEL[ag.status]}
                  </span>
                </div>
              </div>

              <p className="text-sm text-gray-700 mt-1">{ag.titulo}</p>
              {ag.veterinario && (
                <p className="text-xs text-gray-400 mt-0.5">{ag.veterinario.fullName}</p>
              )}
              {isCancelado && ag.observacao && (
                <p className={`text-xs mt-0.5 italic ${isTransferido ? 'text-violet-600' : 'text-red-500'}`}>
                  {isTransferido ? ag.observacao : `Motivo: ${ag.observacao}`}
                </p>
              )}

              <div className="flex items-center justify-between mt-2">
                <span className="font-mono text-sm font-semibold text-gray-800">{formatHora(ag.dataHora)}</span>
                {isEmAndamento && (
                  <button onClick={() => handleIniciarAtendimento(ag)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors">
                    <Stethoscope size={11} /> Continuar
                  </button>
                )}
                {isAgendado && (
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <button onClick={() => handleIniciarAtendimento(ag)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors">
                      <Stethoscope size={11} /> Iniciar
                    </button>
                    {podeEditar && <>
                    <button onClick={() => abrirEditar(ag)}
                      className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-emerald-600 rounded-lg text-xs hover:bg-emerald-50 transition-colors">
                      <Pencil size={11} /> Alterar
                    </button>
                    <button onClick={() => handleConcluir(ag.id)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-emerald-700 text-white rounded-lg text-xs hover:bg-emerald-800 transition-colors">
                      <CheckCircle2 size={11} /> Concluir
                    </button>
                    {vets.length > 0 && (
                      <button onClick={() => abrirTrocarVet(ag)}
                        className="flex items-center gap-1 px-2.5 py-1 border border-blue-200 text-blue-600 rounded-lg text-xs hover:bg-blue-50 transition-colors">
                        <Users size={11} /> Trocar
                      </button>
                    )}
                    <button onClick={() => setCancelandoId(ag.id)}
                      className="flex items-center gap-1 px-2.5 py-1 border border-red-200 text-red-600 rounded-lg text-xs hover:bg-red-50 transition-colors">
                      <Ban size={11} /> Cancelar
                    </button>
                    </>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </>)}

      {/* ── Modal cancelar (justificativa obrigatória) ───────────────────── */}
      <ModalJustificativa
        aberto={cancelandoId !== null}
        titulo="Cancelar agendamento?"
        descricao={(() => {
          const ag = agendamentos.find(a => a.id === cancelandoId);
          return ag ? `${ag.titulo}${ag.animal?.nome ? ` — ${ag.animal.nome}` : ''}` : undefined;
        })()}
        acaoLabel="Cancelar agendamento"
        onConfirmar={(motivo) => { if (cancelandoId !== null) handleCancelar(cancelandoId, motivo); }}
        onFechar={() => setCancelandoId(null)}
      />

      {/* ── Modal editar ──────────────────────────────────────────────────── */}
      {editando && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100">

            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Alterar agendamento</h3>
              <button onClick={() => setEditando(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">ANIMAL</label>
                <p className="text-sm font-semibold text-gray-800">{editando.animal.nome}</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">TIPO</label>
                <select value={editTipo} onChange={e => setEditTipo(e.target.value as TipoAgendamento)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
                  {TIPOS_LIST.map(t => (
                    <option key={t} value={t}>{TIPOS[t].label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">TÍTULO / PROCEDIMENTO *</label>
                <input type="text" value={editTitulo} onChange={e => setEditTitulo(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">DATA</label>
                  <input type="date" value={editData} onChange={e => setEditData(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">HORÁRIO</label>
                  <input type="time" value={editHora} onChange={e => setEditHora(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">OBSERVAÇÃO</label>
                <textarea value={editObs} onChange={e => setEditObs(e.target.value)} rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setEditando(null)}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleSalvar} disabled={saving}
                className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5">
                {saving && <Loader2 size={13} className="animate-spin" />}
                Salvar
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Modal trocar profissional ──────────────────────────────────────── */}
      {trocandoVet && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm border border-gray-100">

            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-blue-600" />
                <h3 className="font-bold text-gray-900">Trocar profissional</h3>
              </div>
              <button onClick={() => setTrocandoVet(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">ANIMAL</label>
                <p className="text-sm font-semibold text-gray-800">{trocandoVet.animal.nome}</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">HORÁRIO</label>
                <p className="text-sm text-gray-700">{formatHora(trocandoVet.dataHora)} · {trocandoVet.titulo}</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">PROFISSIONAL ATUAL</label>
                <p className="text-sm text-gray-700">{trocandoVet.veterinario?.fullName ?? 'Não atribuído'}</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">NOVO PROFISSIONAL *</label>
                <select value={trocandoVetId} onChange={e => setTrocandoVetId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="">Selecione...</option>
                  {vets.map(v => (
                    <option key={v.userId} value={v.userId}>{v.fullName}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setTrocandoVet(null)}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleTrocarVet} disabled={savingTroca || !trocandoVetId}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5">
                {savingTroca && <Loader2 size={13} className="animate-spin" />}
                Transferir
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}

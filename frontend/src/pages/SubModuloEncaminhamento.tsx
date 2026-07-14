// src/pages/SubModuloEncaminhamento.tsx
// Encaminhamentos clínicos — destino interno (prestador da equipe, ex: quiroprata,
// ferrador) ou externo (texto livre). Encaminhar para prestador da equipe libera o
// acesso dele a ESTE animal (DesignacaoPrestador); concluir/cancelar encerra o acesso.

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import {
  Share2, Loader2, Check, Ban,
  UserCheck, ExternalLink, ShieldCheck, AlertTriangle, FileText,
  ChevronLeft, ChevronRight, MessageCircle, Mail,
} from 'lucide-react';
import api from '../services/api';
import { abrirWhatsApp, abrirEmail } from '../utils/compartilhar';
import { usePermissoes } from '../hooks/usePermissoes';
import ModalJustificativa from '../components/ModalJustificativa';

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusEnc   = 'PENDENTE' | 'CONCLUIDO' | 'CANCELADO';
type Urgencia    = 'NORMAL' | 'ALTA' | 'URGENTE';
type DestinoTipo = 'EQUIPE' | 'EXTERNO';

interface Prestador {
  userId:      number;
  fullName:    string;
  email:       string;
  phone:       string | null;
  tipoServico: string | null;
  jaDesignado: boolean;
}

interface Encaminhamento {
  id:                 number;
  especialidade:      string;
  motivo:             string;
  veterinarioDestino: string | null;
  clinicaDestino:     string | null;
  urgencia:           Urgencia;
  status:             StatusEnc;
  dataEncaminhamento: string;
  observacao:         string | null;
  prestadorId:        number | null;
  prestador:          { id: number; fullName: string } | null;
  veterinario:        { id: number; fullName: string } | null;
}

interface Props {
  animalId:           number;
  evolucaoId?:        number;
  atendimentoNumero?: string;
  onSalvo?:           () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<StatusEnc, { label: string; cls: string }> = {
  PENDENTE:  { label: 'Pendente',  cls: 'bg-amber-100 text-amber-700' },
  CONCLUIDO: { label: 'Concluído', cls: 'bg-emerald-100 text-emerald-700' },
  CANCELADO: { label: 'Cancelado', cls: 'bg-gray-100 text-gray-500' },
};

const URGENCIA_BADGE: Record<Urgencia, { label: string; cls: string }> = {
  NORMAL:  { label: 'Normal',  cls: 'bg-gray-100 text-gray-500' },
  ALTA:    { label: 'Alta',    cls: 'bg-amber-100 text-amber-700' },
  URGENTE: { label: 'Urgente', cls: 'bg-red-100 text-red-700' },
};

const formatData = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// ─── Item da lista ────────────────────────────────────────────────────────────

function EncaminhamentoItem({ enc, podeEditar, onStatus }: {
  enc:         Encaminhamento;
  podeEditar:  boolean;
  onStatus:    (id: number, status: StatusEnc) => void;
}) {
  const status   = STATUS_BADGE[enc.status] ?? STATUS_BADGE.PENDENTE;
  const urgencia = URGENCIA_BADGE[enc.urgencia] ?? URGENCIA_BADGE.NORMAL;
  const interno  = !!enc.prestador;

  const destino = interno
    ? enc.prestador!.fullName
    : [enc.veterinarioDestino, enc.clinicaDestino].filter(Boolean).join(' — ') || 'Não informado';

  const textoCompart = [
    '*Encaminhamento*',
    `Especialidade: ${enc.especialidade}`,
    `Destino: ${destino}${interno ? ' (prestador da equipe)' : ' (externo)'}`,
    enc.urgencia !== 'NORMAL' ? `Urgência: ${urgencia.label}` : '',
    `Data: ${formatData(enc.dataEncaminhamento)}`,
    enc.veterinario ? `Responsável: ${enc.veterinario.fullName}` : '',
    enc.motivo ? `\nMotivo: ${enc.motivo}` : '',
    enc.observacao ? `Obs: ${enc.observacao}` : '',
  ].filter(Boolean).join('\n');

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm font-semibold text-gray-900 truncate">{enc.especialidade}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {enc.urgencia !== 'NORMAL' && (
            <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${urgencia.cls}`}>{urgencia.label}</span>
          )}
          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${status.cls}`}>{status.label}</span>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-gray-500">
        {interno
          ? <UserCheck size={12} className="text-emerald-600 flex-shrink-0" />
          : <ExternalLink size={12} className="text-gray-400 flex-shrink-0" />}
        <span className="truncate">{destino}</span>
        <span className="text-[10px] text-gray-400 flex-shrink-0">{interno ? '· prestador' : '· externo'}</span>
      </p>

      {enc.motivo && <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{enc.motivo}</p>}

      {interno && enc.status === 'PENDENTE' && (
        <p className="flex items-center gap-1 mt-1 text-[11px] text-emerald-700">
          <ShieldCheck size={12} className="flex-shrink-0" /> Prestador com acesso a este paciente
        </p>
      )}

      <p className="text-[11px] text-gray-400 mt-0.5">
        {formatData(enc.dataEncaminhamento)}{enc.veterinario ? ` • ${enc.veterinario.fullName}` : ''}
      </p>

      <div className="flex flex-wrap gap-2 mt-2">
        <button onClick={() => abrirWhatsApp(textoCompart)}
          className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-green-600 rounded-lg text-xs hover:bg-green-50 transition-colors">
          <MessageCircle size={11} /> WhatsApp
        </button>
        <button onClick={() => abrirEmail(`Encaminhamento - ${enc.especialidade}`, textoCompart)}
          className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-blue-500 rounded-lg text-xs hover:bg-blue-50 transition-colors">
          <Mail size={11} /> E-mail
        </button>
        {enc.status === 'PENDENTE' && podeEditar && (
          <button onClick={() => onStatus(enc.id, 'CANCELADO')}
            className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors">
            <Ban size={11} /> Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Formulário de novo encaminhamento ────────────────────────────────────────

function FormNovoEncaminhamento({ animalId, evolucaoId, onCriado, onFechar }: {
  animalId:    number;
  evolucaoId?: number;
  onCriado:    () => void;
  onFechar:    () => void;
}) {
  const [prestadores,         setPrestadores]         = useState<Prestador[]>([]);
  const [servicosDisponiveis, setServicosDisponiveis] = useState<string[]>([]);
  const [loadingPrest,        setLoadingPrest]        = useState(true);
  const [destinoTipo,         setDestinoTipo]         = useState<DestinoTipo>('EQUIPE');
  const [filtroServico,       setFiltroServico]       = useState('');
  const [prestadorSel,        setPrestadorSel]        = useState<Prestador | null>(null);
  const [especialidade,  setEspecialidade]  = useState('');
  const [motivo,         setMotivo]         = useState('');
  const [urgencia,       setUrgencia]       = useState<Urgencia>('NORMAL');
  const [observacao,     setObservacao]     = useState('');
  const [vetDestino,     setVetDestino]     = useState('');
  const [clinicaDestino, setClinicaDestino] = useState('');
  const [salvando,       setSalvando]       = useState(false);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setLoadingPrest(true);
      try {
        const res = await api.get(`/clinica/encaminhamentos/prestadores/${animalId}`);
        if (cancelado) return;
        if (!res.data) { setPrestadores([]); setServicosDisponiveis([]); return; } // GET 403 → null
        setPrestadores(res.data.dados ?? []);
        setServicosDisponiveis(res.data.servicosDisponiveis ?? []);
      } catch { if (!cancelado) { setPrestadores([]); setServicosDisponiveis([]); } }
      finally { if (!cancelado) setLoadingPrest(false); }
    })();
    return () => { cancelado = true; };
  }, [animalId]);

  const servicos = servicosDisponiveis; // vem do backend, já sem 'clínico'

  const prestadoresFiltrados = filtroServico
    ? prestadores.filter(p => p.tipoServico === filtroServico)
    : [];

  // Um único prestador disponível → pré-seleciona
  useEffect(() => {
    if (!loadingPrest && destinoTipo === 'EQUIPE' && prestadoresFiltrados.length === 1 && !prestadorSel) {
      selecionarPrestador(prestadoresFiltrados[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingPrest, destinoTipo, filtroServico]);

  const selecionarPrestador = (p: Prestador) => {
    setPrestadorSel(p);
    if (p.tipoServico) setEspecialidade(p.tipoServico);
  };

  const handleSalvar = async () => {
    if (!evolucaoId)           { toast.error('Inicie uma evolução antes de criar um encaminhamento.'); return; }
    if (!motivo.trim())        { toast.error('Informe o motivo do encaminhamento'); return; }
    if (!especialidade.trim()) { toast.error('Informe a especialidade'); return; }
    if (destinoTipo === 'EQUIPE' && !prestadorSel) {
      toast.error('Selecione o prestador da equipe'); return;
    }

    setSalvando(true);
    try {
      await api.post('/clinica/encaminhamentos', {
        animalId,
        evolucaoId,
        especialidade:      especialidade.trim(),
        motivo:             motivo.trim(),
        urgencia,
        observacao:         observacao.trim() || undefined,
        prestadorId:        destinoTipo === 'EQUIPE' ? prestadorSel?.userId : undefined,
        veterinarioDestino: destinoTipo === 'EXTERNO' ? vetDestino.trim() || undefined : undefined,
        clinicaDestino:     destinoTipo === 'EXTERNO' ? clinicaDestino.trim() || undefined : undefined,
      });
      toast.success(destinoTipo === 'EQUIPE'
        ? `Encaminhado para ${prestadorSel?.fullName} — acesso ao paciente liberado`
        : 'Encaminhamento registrado');
      onCriado();
    } catch (err) {
      const e = err as { isPermissionError?: boolean };
      if (!e.isPermissionError) toast.error('Erro ao criar encaminhamento');
    } finally { setSalvando(false); }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">

      <div className="p-5 space-y-4">

      {/* Tipo de destino */}
      <div className="flex gap-2">
        {([
          { key: 'EQUIPE',  label: 'Prestador da equipe', icon: <UserCheck size={13} /> },
          { key: 'EXTERNO', label: 'Profissional externo', icon: <ExternalLink size={13} /> },
        ] as { key: DestinoTipo; label: string; icon: React.ReactNode }[]).map(opt => (
          <button key={opt.key} onClick={() => { setDestinoTipo(opt.key); setPrestadorSel(null); setEspecialidade(''); setFiltroServico(''); }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
              destinoTipo === opt.key
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300'
            }`}>
            {opt.icon}{opt.label}
          </button>
        ))}
      </div>

      {destinoTipo === 'EQUIPE' ? (
        <div className="space-y-3">
          {/* Seletor de especialidade — lista só aparece após selecionar */}
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Especialidade</label>
            <select value={filtroServico}
              onChange={e => { setFiltroServico(e.target.value); setPrestadorSel(null); }}
              className={`w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-600 ${!filtroServico ? 'text-gray-400' : 'text-gray-900'}`}>
              <option value="">— Selecionar —</option>
              {servicos.map(s => <option key={s} value={s} className="text-gray-900">{s}</option>)}
            </select>
          </div>

          {/* Lista de prestadores — só aparece após selecionar especialidade */}
          {filtroServico && (
            loadingPrest ? (
              <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-emerald-600" /></div>
            ) : prestadoresFiltrados.length === 0 ? (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  Nenhum prestador de {filtroServico} na equipe deste paciente.
                  Inclua o fornecedor pela aba Equipe do Controle de Acesso e tente novamente.
                </span>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {prestadoresFiltrados.map(p => (
                  <button key={p.userId} onClick={() => selecionarPrestador(p)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                      prestadorSel?.userId === p.userId
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-gray-200 bg-white hover:border-emerald-300'
                    }`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.fullName}</p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {p.tipoServico ?? 'Especialidade não informada'}
                        {p.phone ? ` · ${p.phone}` : ''}
                      </p>
                    </div>
                    {p.jaDesignado && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium flex-shrink-0">
                        já tem acesso
                      </span>
                    )}
                    {prestadorSel?.userId === p.userId && (
                      <Check size={15} className="text-emerald-600 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )
          )}

          {prestadorSel && !prestadorSel.jaDesignado && (
            <div className="flex items-start gap-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
              <ShieldCheck size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                Ao salvar, <strong>{prestadorSel.fullName}</strong> passa a acessar somente este paciente.
                O acesso é encerrado quando o encaminhamento for concluído ou cancelado.
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Especialidade *</label>
            {servicos.length > 0 ? (
              <select value={especialidade} onChange={e => setEspecialidade(e.target.value)}
                className={`w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-600 ${!especialidade ? 'text-gray-400' : 'text-gray-900'}`}>
                <option value="">— Selecionar —</option>
                {servicos.map(s => <option key={s} value={s} className="text-gray-900">{s}</option>)}
              </select>
            ) : (
              <input type="text" value={especialidade} onChange={e => setEspecialidade(e.target.value)}
                placeholder="Ex: Quiropraxia, Oftalmologia..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600" />
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Profissional</label>
              <input type="text" value={vetDestino} onChange={e => setVetDestino(e.target.value)}
                placeholder="Nome do profissional"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Clínica</label>
              <input type="text" value={clinicaDestino} onChange={e => setClinicaDestino(e.target.value)}
                placeholder="Nome da clínica"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600" />
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Motivo *</label>
        <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
          placeholder="Descreva o motivo do encaminhamento..."
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600 resize-none" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Urgência</label>
          <select value={urgencia} onChange={e => setUrgencia(e.target.value as Urgencia)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600">
            <option value="NORMAL">Normal</option>
            <option value="ALTA">Alta</option>
            <option value="URGENTE">Urgente</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Observação</label>
          <input type="text" value={observacao} onChange={e => setObservacao(e.target.value)}
            placeholder="Opcional"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600" />
        </div>
      </div>

        </div>

      <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
        <button onClick={onFechar}
          className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 rounded-2xl transition-colors">
          Cancelar
        </button>
        <button onClick={handleSalvar} disabled={salvando}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
          {salvando ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
          Encaminhar
        </button>
      </div>

    </div>
  );
}

// ─── SubModuloEncaminhamento ──────────────────────────────────────────────────

export default function SubModuloEncaminhamento({ animalId, evolucaoId, atendimentoNumero, onSalvo }: Props) {
  const { user } = useAuth();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();

  const podeCriar   = isGestor || podeExecutar('atendimento.encaminhamentos.criar');
  const podeEditar  = isGestor || podeExecutar('atendimento.encaminhamentos.editar');
  // FORNECEDOR só cancela/edita encaminhamentos que ele próprio criou
  const isFornecedor = user?.userType === 'FORNECEDOR';

  const [encaminhamentos, setEncaminhamentos] = useState<Encaminhamento[]>([]);
  const [loading,          setLoading]         = useState(true);
  const [formKey,          setFormKey]         = useState(0);
  const [cancelandoId,     setCancelandoId]    = useState<number | null>(null);
  const [page,             setPage]            = useState(1);

  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/clinica/encaminhamentos/animal/${animalId}`);
      if (!res.data) { setEncaminhamentos([]); return; } // GET 403 → null
      setEncaminhamentos(res.data.dados ?? []);
    } catch { setEncaminhamentos([]); }
    finally { setLoading(false); }
  }, [animalId]);

  useEffect(() => {
    if (loadingPerms) return;
    carregar();
  }, [carregar, loadingPerms]);

  useEffect(() => { setPage(1); }, [animalId]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleStatus = async (id: number, status: StatusEnc, motivo?: string) => {
    if (!podeEditar) { semPermissao('alterar encaminhamentos'); return; }
    // Cancelamento exige justificativa — abre o modal e retorna aqui com o motivo
    if (status === 'CANCELADO' && !motivo) { setCancelandoId(id); return; }
    try {
      await api.patch(`/clinica/encaminhamentos/${id}/status`, { status, ...(motivo ? { motivo } : {}) });
      const enc = encaminhamentos.find(e => e.id === id);
      if (status === 'CONCLUIDO') {
        toast.success(enc?.prestador
          ? 'Encaminhamento concluído — acesso do prestador encerrado'
          : 'Encaminhamento concluído');
      } else {
        toast(enc?.prestador
          ? 'Encaminhamento cancelado — acesso do prestador encerrado'
          : 'Encaminhamento cancelado', { icon: '🔒' });
      }
      carregar();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) toast.error(e.response?.data?.error ?? 'Erro ao atualizar encaminhamento');
    } finally {
      setCancelandoId(null);
    }
  };


  // ── Guard ───────────────────────────────────────────────────────────────────

  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.encaminhamentos.ler')) {
    return (
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500">Você não tem permissão para visualizar encaminhamentos.</p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!evolucaoId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <FileText size={32} className="mb-3 text-gray-200" />
        <p className="font-medium text-sm text-gray-500">Evolução necessária</p>
        <p className="text-xs mt-1 text-center max-w-xs">
          Inicie uma evolução na aba Evolução para registrar encaminhamentos neste atendimento.
        </p>
      </div>
    );
  }

  const LIMIT_ENC = 10;
  const totalPags = Math.max(1, Math.ceil(encaminhamentos.length / LIMIT_ENC));
  const pageAtual = Math.min(page, totalPags);
  const pageItems = encaminhamentos.slice((pageAtual - 1) * LIMIT_ENC, pageAtual * LIMIT_ENC);

  return (
    <div className="p-4 space-y-4">


      {podeCriar && (
        <FormNovoEncaminhamento
          key={formKey}
          animalId={animalId}
          evolucaoId={evolucaoId}
          onCriado={() => { setFormKey(k => k + 1); carregar(); onSalvo?.(); }}
          onFechar={() => setFormKey(k => k + 1)}
        />
      )}

      <div className="-mx-4 px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico de Encaminhamentos</p>
        <span className="text-xs text-gray-400">{encaminhamentos.length} registro{encaminhamentos.length !== 1 ? 's' : ''}</span>
      </div>

      {loading || loadingPerms ? (
        <div className="flex justify-center py-12">
          <Loader2 size={20} className="animate-spin text-emerald-600" />
        </div>
      ) : encaminhamentos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-200">
          <Share2 size={36} className="mb-3" />
          <p className="text-sm font-medium text-gray-300">Nenhum encaminhamento</p>
          {podeCriar && (
            <p className="text-xs text-gray-300 mt-1">
              Encaminhe o paciente a um prestador da equipe ou profissional externo.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {pageItems.map(enc => {
              const eAutor = enc.veterinario?.id === (user?.id ?? 0);
              return (
                <EncaminhamentoItem
                  key={enc.id}
                  enc={enc}
                  podeEditar={podeEditar && (!isFornecedor || eAutor)}
                  onStatus={handleStatus}
                />
              );
            })}
          </div>
          {totalPags > 1 && (
            <div className="flex items-center justify-between px-1 py-3 border-t border-gray-50 mt-2">
              <span className="text-xs text-gray-400">{encaminhamentos.length} registro{encaminhamentos.length !== 1 ? 's' : ''}</span>
              <div className="flex items-center gap-3">
                <button disabled={pageAtual === 1} onClick={() => setPage(p => p - 1)}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-gray-500">{pageAtual} / {totalPags}</span>
                <button disabled={pageAtual >= totalPags} onClick={() => setPage(p => p + 1)}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <ModalJustificativa
        aberto={cancelandoId !== null}
        titulo="Cancelar encaminhamento?"
        descricao={(() => {
          const enc = encaminhamentos.find(e => e.id === cancelandoId);
          if (!enc) return undefined;
          const destino = enc.prestador?.fullName ?? enc.veterinarioDestino ?? enc.clinicaDestino ?? 'externo';
          return `${enc.especialidade ?? 'Encaminhamento'} — ${destino}${enc.prestador ? ' (o acesso do prestador será encerrado)' : ''}`;
        })()}
        acaoLabel="Cancelar encaminhamento"
        onConfirmar={(motivo) => { if (cancelandoId !== null) handleStatus(cancelandoId, 'CANCELADO', motivo); }}
        onFechar={() => setCancelandoId(null)}
      />
    </div>
  );
}

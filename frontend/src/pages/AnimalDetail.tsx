// src/pages/AnimalDetail.tsx
// Tela do animal — header com dados resumidos, Histórico unificado (evoluções,
// vacinas, exames, prescrições, encaminhamentos) e painel de Agendamentos.

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Search, ChevronDown, Loader2, CalendarClock,
  Clock, User as UserIcon, Plus, X, Check, Trash2, Sparkles,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Solicitacao {
  status:       string;
  vetUserId:    number;
  veterinario?: { fullName: string; email: string } | null;
}

interface AnimalData {
  id:                number;
  nome:              string;
  peso:              number;
  sexo:              string;
  photoUrl?:         string | null;
  dataNascimento?:   string | null;
  idadeAnos?:        number | null;
  categoriaAnimal?:  string | null;
  tipoExercicio?:    string | null;
  baia?:             string | null;
  local?:            string | null;
  veterinarioNome?:  string | null;
  raca?:             { nome: string } | null;
  especie?:          { nome: string } | null;
  user?:             { fullName: string; email: string } | null;
  solicitacoes?:     Solicitacao[];
}

type OrigemEvento = 'EVOLUCAO' | 'VACINA' | 'EXAME' | 'ENCAMINHAMENTO' | 'PRESCRICAO';

interface EventoHistorico {
  id:          string;
  origem:      OrigemEvento;
  data:        string;
  titulo:      string;
  badge:       string;
  status:      string | null;
  responsavel: string | null;
  resumo:      string;
}

type TipoAgendamento = 'CONSULTA' | 'VACINA' | 'RETORNO' | 'EXAME' | 'PROCEDIMENTO';

interface Agendamento {
  id:          number;
  tipo:        TipoAgendamento;
  titulo:      string;
  dataHora:    string;
  observacao:  string | null;
  status:      string;
  veterinario: { id: number; fullName: string } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BADGE_ORIGEM: Record<OrigemEvento, string> = {
  EVOLUCAO:       'bg-emerald-100 text-emerald-700',
  VACINA:         'bg-teal-100 text-teal-700',
  EXAME:          'bg-purple-100 text-purple-700',
  ENCAMINHAMENTO: 'bg-orange-100 text-orange-700',
  PRESCRICAO:     'bg-blue-100 text-blue-700',
};

const BADGE_TIPO_AG: Record<TipoAgendamento, string> = {
  VACINA:       'bg-amber-100 text-amber-700',
  CONSULTA:     'bg-blue-100 text-blue-700',
  RETORNO:      'bg-teal-100 text-teal-700',
  EXAME:        'bg-purple-100 text-purple-700',
  PROCEDIMENTO: 'bg-emerald-100 text-emerald-700',
};

const TIPOS_AGENDAMENTO: TipoAgendamento[] = ['CONSULTA', 'VACINA', 'RETORNO', 'EXAME', 'PROCEDIMENTO'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mesAbrev = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();

const diaDoMes = (iso: string) => new Date(iso).getDate();

const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const calcularIdade = (dataNascimento?: string | null, idadeAnos?: number | null): string => {
  if (dataNascimento) {
    const nasc = new Date(dataNascimento);
    const hoje = new Date();
    let anos = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) anos--;
    if (anos >= 1) return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
    const meses = Math.max(0, (hoje.getFullYear() - nasc.getFullYear()) * 12 + hoje.getMonth() - nasc.getMonth());
    return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  }
  if (idadeAnos) return `${idadeAnos} ${idadeAnos === 1 ? 'ano' : 'anos'}`;
  return '—';
};

// ─── Header — dados do animal ─────────────────────────────────────────────────

function CampoHeader({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] uppercase text-gray-400 tracking-widest font-semibold">{label}</span>
      <span className="block text-sm font-bold text-gray-900 truncate mt-0.5" title={valor}>{valor}</span>
    </div>
  );
}

function HeaderAnimal({ animal }: { animal: AnimalData }) {
  const solAceita = animal.solicitacoes?.find(s => s.status === 'ACEITO');
  const vetNome   = solAceita?.veterinario?.fullName ?? animal.veterinarioNome ?? '—';

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
      <div className="flex gap-4 sm:gap-6">
        <div className="w-20 h-20 sm:w-28 sm:h-24 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
          {animal.photoUrl
            ? <img src={animal.photoUrl} alt={animal.nome} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-2xl text-gray-300">🐾</div>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3 pb-3 border-b border-gray-50">
            <CampoHeader label="Nome"    valor={animal.nome} />
            <CampoHeader label="Espécie" valor={animal.especie?.nome ?? '—'} />
            <CampoHeader label="Raça"    valor={animal.raca?.nome ?? '—'} />
            <CampoHeader label="Idade"   valor={calcularIdade(animal.dataNascimento, animal.idadeAnos)} />
            <CampoHeader label="Peso"    valor={animal.peso ? `${animal.peso} kg` : '—'} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3 pt-3">
            <CampoHeader label="Baia"             valor={animal.baia ?? '—'} />
            <CampoHeader label="Local"            valor={animal.local ?? '—'} />
            <CampoHeader label="Tipo de Trabalho" valor={animal.tipoExercicio ?? '—'} />
            <CampoHeader label="Proprietário"     valor={animal.user?.fullName ?? '—'} />
            <CampoHeader label="Vet. Responsável" valor={vetNome} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Histórico ────────────────────────────────────────────────────────────────

function ItemHistorico({ ev }: { ev: EventoHistorico }) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="border border-gray-100 rounded-2xl bg-white shadow-sm">
      <button onClick={() => setAberto(v => !v)} className="w-full flex items-start gap-3 sm:gap-4 p-3 sm:p-4 text-left">
        <div className="flex flex-col items-center justify-center w-12 h-14 border border-gray-200 rounded-xl flex-shrink-0">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{mesAbrev(ev.data)}</span>
          <span className="text-lg font-bold text-gray-900 leading-none mt-0.5">{diaDoMes(ev.data)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-gray-900">{ev.titulo}</span>
            <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${BADGE_ORIGEM[ev.origem]}`}>
              {ev.badge}
            </span>
            {ev.responsavel && (
              <span className="text-[10px] text-gray-400 font-mono uppercase">por: {ev.responsavel}</span>
            )}
          </div>
          <p className={`text-xs text-gray-500 mt-1 ${aberto ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
            {ev.resumo || '—'}
          </p>
          {aberto && ev.status && (
            <p className="text-[10px] text-gray-400 mt-2">
              Status: <span className="font-semibold text-gray-500">{ev.status}</span>
              {' · '}{new Date(ev.data).toLocaleDateString('pt-BR')}
            </p>
          )}
        </div>
        <span className="p-1.5 border border-gray-200 rounded-full text-gray-400 flex-shrink-0 mt-1">
          <ChevronDown size={14} className={`transition-transform ${aberto ? 'rotate-180' : ''}`} />
        </span>
      </button>
    </div>
  );
}

// ─── Agendamentos ─────────────────────────────────────────────────────────────

function CardAgendamento({ ag, podeGerenciar, onConcluir, onExcluir }: {
  ag:            Agendamento;
  podeGerenciar: boolean;
  onConcluir:    (id: number) => void;
  onExcluir:     (id: number) => void;
}) {
  return (
    <div className="border border-gray-200 rounded-2xl p-3 bg-white">
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center justify-center w-11 h-12 border border-gray-200 rounded-xl flex-shrink-0">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{mesAbrev(ag.dataHora)}</span>
          <span className="text-base font-bold text-gray-900 leading-none mt-0.5">{diaDoMes(ag.dataHora)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <span className={`inline-block text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${BADGE_TIPO_AG[ag.tipo] ?? 'bg-gray-100 text-gray-500'}`}>
            {ag.tipo}
          </span>
          <p className="text-xs font-bold text-gray-900 mt-1.5 leading-snug">{ag.titulo}</p>
          <div className="flex items-center gap-1 mt-1.5 text-[11px] text-gray-400">
            <Clock size={10} /> {horaDe(ag.dataHora)}
          </div>
          {ag.veterinario && (
            <div className="flex items-center gap-1 mt-0.5 text-[11px] text-gray-500 font-medium">
              <UserIcon size={10} /> Vet: {ag.veterinario.fullName}
            </div>
          )}
        </div>
        {podeGerenciar && (
          <div className="flex flex-col gap-0.5 flex-shrink-0">
            <button onClick={() => onConcluir(ag.id)} title="Concluir"
              className="p-1 text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
              <Check size={12} />
            </button>
            <button onClick={() => onExcluir(ag.id)} title="Excluir"
              className="p-1 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ModalNovoAgendamento({ animalId, onCriado, onFechar }: {
  animalId: number;
  onCriado: () => void;
  onFechar: () => void;
}) {
  const [tipo,       setTipo]       = useState<TipoAgendamento>('CONSULTA');
  const [titulo,     setTitulo]     = useState('');
  const [data,       setData]       = useState('');
  const [hora,       setHora]       = useState('09:00');
  const [observacao, setObservacao] = useState('');
  const [salvando,   setSalvando]   = useState(false);

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500';

  const handleSalvar = async () => {
    if (!titulo.trim()) { toast.error('Informe a descrição do agendamento'); return; }
    if (!data)          { toast.error('Informe a data'); return; }
    setSalvando(true);
    try {
      await api.post('/clinica/agendamentos', {
        animalId, tipo,
        titulo:     titulo.trim(),
        dataHora:   `${data}T${hora || '09:00'}:00`,
        observacao: observacao.trim() || undefined,
      });
      toast.success('Agendamento criado');
      onCriado();
    } catch (err) {
      const e = err as { isPermissionError?: boolean };
      if (!e.isPermissionError) toast.error('Erro ao criar agendamento');
    } finally { setSalvando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md max-h-[92vh] flex flex-col border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900">Novo Agendamento</h3>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tipo *</label>
            <select value={tipo} onChange={e => setTipo(e.target.value as TipoAgendamento)} className={inputCls}>
              {TIPOS_AGENDAMENTO.map(t => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Descrição *</label>
            <textarea value={titulo} onChange={e => setTitulo(e.target.value)} rows={3}
              placeholder="Ex: Aplicação da dose anual da vacina..."
              className={`${inputCls} resize-none`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Data *</label>
              <input type="date" value={data} onChange={e => setData(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hora</label>
              <input type="time" value={hora} onChange={e => setHora(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Observação</label>
            <input type="text" value={observacao} onChange={e => setObservacao(e.target.value)}
              placeholder="Opcional" className={inputCls} />
          </div>
        </div>
        <div className="flex gap-3 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onFechar} disabled={salvando}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSalvar} disabled={salvando}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
            {salvando && <Loader2 size={13} className="animate-spin" />}
            Agendar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

const AnimalDetail = () => {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const podeGerenciarAgenda =
    (user?.role ?? '').toUpperCase() === 'ADMIN' ||
    ['VETERINARIO', 'ESTAGIARIO'].includes((user?.userType ?? '').toUpperCase());

  const [animal,       setAnimal]       = useState<AnimalData | null>(null);
  const [historico,    setHistorico]    = useState<EventoHistorico[]>([]);
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [busca,        setBusca]        = useState('');
  const [showNovoAg,   setShowNovoAg]   = useState(false);

  const carregarAgendamentos = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.get(`/clinica/agendamentos/animal/${id}?futuros=1`);
      if (!res.data) return; // GET 403 → null
      setAgendamentos(res.data.dados ?? []);
    } catch { /* silencioso */ }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get(`/animais/${id}`).then(res => {
        if (res.data) setAnimal(res.data.dados ?? res.data);
      }).catch(() => {}),
      api.get(`/clinica/historico/animal/${id}`).then(res => {
        if (res.data) setHistorico(res.data.dados ?? []);
      }).catch(() => {}),
      carregarAgendamentos(),
    ]).finally(() => setLoading(false));
  }, [id, carregarAgendamentos]);

  const handleConcluirAg = async (agId: number) => {
    try {
      await api.patch(`/clinica/agendamentos/${agId}/status`, { status: 'CONCLUIDO' });
      toast.success('Agendamento concluído');
      carregarAgendamentos();
    } catch (err) {
      const e = err as { isPermissionError?: boolean };
      if (!e.isPermissionError) toast.error('Erro ao concluir agendamento');
    }
  };

  const handleExcluirAg = async (agId: number) => {
    try {
      await api.delete(`/clinica/agendamentos/${agId}`);
      toast.success('Agendamento excluído');
      carregarAgendamentos();
    } catch (err) {
      const e = err as { isPermissionError?: boolean };
      if (!e.isPermissionError) toast.error('Erro ao excluir agendamento');
    }
  };

  const historicoFiltrado = busca.trim()
    ? historico.filter(ev => {
        const q = busca.toLowerCase();
        return ev.titulo.toLowerCase().includes(q)
          || ev.resumo.toLowerCase().includes(q)
          || ev.badge.toLowerCase().includes(q)
          || (ev.responsavel ?? '').toLowerCase().includes(q);
      })
    : historico;

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!animal) return (
    <div className="text-center py-20 text-red-500">Animal não encontrado</div>
  );

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-6 space-y-4">

      <div className="flex items-center justify-between">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium">
          <ArrowLeft size={18} />
          <span className="text-sm">Voltar</span>
        </button>

        {podeGerenciarAgenda && (
          <button
            onClick={() => navigate(`/agendamentos?auto=1&animalId=${animal.id}`)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors"
          >
            <Sparkles size={15} />
            Agende com IA
          </button>
        )}
      </div>

      {/* Header — dados do animal */}
      <HeaderAnimal animal={animal} />

      {/* Histórico + Agendamentos — items-stretch mantém os dois cards na mesma altura */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch">

        {/* Histórico */}
        <div className="flex-1 min-w-0 w-full bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-gray-50">
            <div className="flex items-center gap-2">
              <span className="w-1 h-5 bg-emerald-500 rounded-full" />
              <h2 className="font-bold text-gray-900">Histórico</h2>
            </div>
            <div className="relative w-full sm:w-72">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar no histórico do animal..."
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-full text-sm text-gray-900 focus:outline-none focus:border-emerald-500 bg-gray-50/50" />
            </div>
          </div>

          <div className="p-3 sm:p-4 space-y-2.5">
            {historicoFiltrado.length === 0 ? (
              <p className="text-center text-sm text-gray-300 py-12">
                {historico.length === 0 ? 'Nenhum registro no histórico ainda' : 'Nenhum resultado para a busca'}
              </p>
            ) : historicoFiltrado.map(ev => <ItemHistorico key={ev.id} ev={ev} />)}
          </div>
        </div>

        {/* Agendamentos */}
        <div className="w-full lg:w-80 flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col">
          <div className="flex items-center justify-between px-4 py-4 border-b border-gray-50 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center">
                <CalendarClock size={15} className="text-emerald-600" />
              </div>
              <h2 className="font-bold text-gray-900 text-sm">Agendamentos</h2>
            </div>
            {podeGerenciarAgenda && (
              <button onClick={() => setShowNovoAg(true)} title="Novo agendamento"
                className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors">
                <Plus size={16} />
              </button>
            )}
          </div>
          {/* flex-1 + min-h-0: a lista ocupa a altura do card (igual ao Histórico) com scroll interno */}
          <div className="p-3 space-y-2.5 flex-1 min-h-0 max-h-[60vh] lg:max-h-none overflow-y-auto">
            {agendamentos.length === 0 ? (
              <p className="text-center text-sm text-gray-300 py-10">Nenhum agendamento futuro</p>
            ) : agendamentos.map(ag => (
              <CardAgendamento key={ag.id} ag={ag}
                podeGerenciar={podeGerenciarAgenda}
                onConcluir={handleConcluirAg}
                onExcluir={handleExcluirAg} />
            ))}
          </div>
        </div>
      </div>

      {showNovoAg && animal && (
        <ModalNovoAgendamento
          animalId={animal.id}
          onCriado={() => { setShowNovoAg(false); carregarAgendamentos(); }}
          onFechar={() => setShowNovoAg(false)}
        />
      )}
    </div>
  );
};

export default AnimalDetail;

// src/pages/Agendamentos.tsx
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useEmpresa } from '../contexts/EmpresaContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { isSubespecialidadeValida } from '../utils/subespecialidades';
import {
  CalendarClock, ChevronLeft, ChevronRight, Check,
  X, Clock, User as UserIcon, RefreshCw, Search,
  ChevronDown, ChevronUp, AlertTriangle, Loader2, Calendar,
  Phone, Stethoscope, Filter, Users, Mic, MicOff, Wand2, Sparkles,
  CheckCircle2, AlertCircle, UserCheck, CalendarDays,
} from 'lucide-react';
import InlineError from '../components/InlineError';

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoAgendamento   = 'CONSULTA' | 'VACINA' | 'RETORNO' | 'EXAME' | 'PROCEDIMENTO';
type StatusAgendamento = 'AGENDADO' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'FINALIZADO' | 'CANCELADO' | 'ATRASADA';
type DiaStatus         = 'LIVRE' | 'PARCIAL' | 'OCUPADO';
type ViewMode          = 'MES' | 'SEMANA';

interface AgendamentoGlobal {
  id:          number;
  numero:      number | null;
  tipo:        TipoAgendamento;
  titulo:      string;
  dataHora:    string;
  observacao:  string | null;
  status:      StatusAgendamento;
  veterinario: { id: number; fullName: string } | null;
  criadoPor:   { id: number; fullName: string } | null;
  animal: {
    id:      number;
    nome:    string;
    especie: { nome: string } | null;
    user:    { id: number; fullName: string } | null;
  } | null;
}

interface AnimalOption {
  id:      number;
  nome:    string;
  especie: { nome: string } | null;
  user:    { id: number; fullName: string; email: string; phone?: string; cpf?: string } | null;
  // Localização atual do animal (LocalizacaoAnimal) — filtra por onde o vet atende
  localizacaoId: number | null;
}

interface BookingInfo {
  vetId:   number;
  vetName: string;
  hora:    string;
}

interface BookingForm {
  animalId:         string;
  proprietarioNome: string;
  telefone:         string;
  cpf:              string;
}

interface VetMembro {
  userId:        number;
  fullName:      string;
  cargo:         string;
  especialidades: string[];
  // Expediente próprio do profissional (null = herda o da empresa)
  diasTrab:   number[] | null;
  horaIni:    string | null;
  horaFim:    string | null;
  // Locais onde o profissional atende (localizacaoId + dias) — filtra os animais
  locais:     { localizacaoId: number; dias: number[] | null }[];
}

type VozEtapa = 'IDLE' | 'GRAVANDO' | 'PROCESSANDO' | 'DISPONIVEL' | 'INDISPONIVEL' | 'ERRO';

interface InterpretacaoResultado {
  sucesso:     boolean;
  disponivel?: boolean;
  dataHora?:   string;
  data?:       string;
  hora?:       string;
  animalId?:   number | null;
  animal?: {
    id:      number;
    nome:    string;
    especie?: string | null;
    proprietario?: { fullName: string; email?: string; phone?: string } | null;
  } | null;
  vetId?: number | null;
  vet?:   { id: number; fullName: string; email?: string; phone?: string } | null;
  confianca?: number;
  resumo?:    string;
  conflito?:               { hora: string; animalNome?: string } | null;
  horariosLivres?:         string[];
  mensagem?:               string;
  animalNomeNaoEncontrado?: string | null;
  vetNomeNaoEncontrado?:    string | null;
}


// ─── Constantes ───────────────────────────────────────────────────────────────

const TIPOS: { value: TipoAgendamento; label: string; cor: string }[] = [
  { value: 'CONSULTA',     label: 'Consulta',     cor: 'bg-emerald-100 text-emerald-700' },
  { value: 'VACINA',       label: 'Vacina',       cor: 'bg-teal-100 text-teal-700'       },
  { value: 'RETORNO',      label: 'Retorno',      cor: 'bg-green-100 text-green-700'     },
  { value: 'EXAME',        label: 'Exame',        cor: 'bg-cyan-100 text-cyan-700'       },
  { value: 'PROCEDIMENTO', label: 'Procedimento', cor: 'bg-emerald-50 text-emerald-600'  },
];

const HORARIOS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

const MESES_PT      = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_PT       = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const DIAS_FULL_PT  = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

const MOTIVOS_CANCELAMENTO = [
  'Imprevisto do proprietário','Animal indisponível',
  'Profissional indisponível','Reagendamento para outra data','Outro motivo',
];

const DOT_COR: Record<DiaStatus, string> = {
  LIVRE:   'bg-emerald-500',
  PARCIAL: 'bg-amber-400',
  OCUPADO: 'bg-red-500',
};
const DOT_LABEL: Record<DiaStatus, string> = {
  LIVRE:   'Livre',
  PARCIAL: 'Parcial',
  OCUPADO: 'Sem vagas',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, '0'); }
function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function formatarHora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function formatarDataHora(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function formatarDateInput(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function labelDia(dateStr: string) {
  const [a, m, d] = dateStr.split('-').map(Number);
  return `${DIAS_FULL_PT[new Date(a, m-1, d).getDay()]}, ${pad(d)}/${pad(m)}/${a}`;
}
function corTipo(tipo: TipoAgendamento) { return TIPOS.find(t => t.value === tipo)?.cor ?? 'bg-gray-100 text-gray-700'; }
function labelTipo(tipo: TipoAgendamento) { return TIPOS.find(t => t.value === tipo)?.label ?? tipo; }

const STATUS_COR: Record<StatusAgendamento, string> = {
  AGENDADO:     'bg-amber-100 text-amber-700',
  EM_ANDAMENTO: 'bg-blue-100 text-blue-700',
  CONCLUIDO:    'bg-green-100 text-green-700',
  FINALIZADO:   'bg-green-100 text-green-700',
  CANCELADO:    'bg-red-100 text-red-700',
  ATRASADA:     'bg-orange-100 text-orange-700',
};
const STATUS_LABEL: Record<StatusAgendamento, string> = {
  AGENDADO:     'AGENDADO',
  EM_ANDAMENTO: 'EM ANDAMENTO',
  CONCLUIDO:    'CONCLUÍDO',
  FINALIZADO:   'FINALIZADO',
  CANCELADO:    'CANCELADO',
  ATRASADA:     'ATRASADA',
};
function formatarDataPT(dateStr: string) {
  const [a, m, d] = dateStr.split('-').map(Number);
  return `${d} de ${MESES_PT[m-1]} de ${a}`;
}
function dataRelativa(dateStr: string): string {
  const [a, m, d] = dateStr.split('-').map(Number);
  const data = new Date(a, m - 1, d);
  const agora = new Date();
  const hojeD = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const diff  = Math.round((data.getTime() - hojeD.getTime()) / 86400000);
  if (diff === 0)  return 'hoje';
  if (diff === 1)  return 'amanhã';
  if (diff === -1) return 'ontem';
  if (diff > 1 && diff < 7) return `na ${DIAS_FULL_PT[data.getDay()].toLowerCase()}`;
  return `em ${pad(d)}/${pad(m)}`;
}

// ─── Calendário Interativo ────────────────────────────────────────────────────

interface CalendarioProps {
  selectedDate: string;
  onChange:     (date: string) => void;
  statusPorDia: Map<string, DiaStatus>;
}

function CalendarioInterativo({ selectedDate, onChange, statusPorDia }: CalendarioProps) {
  const [ano, mes] = selectedDate.split('-').map(Number);
  const [viewAno, setViewAno]   = useState(ano);
  const [viewMes, setViewMes]   = useState(mes - 1);
  const [viewMode, setViewMode] = useState<ViewMode>('MES');

  const dataHoje = hoje();

  function diasDoMes(a: number, m: number): Date[] {
    const days: Date[] = [];
    const primeiro = new Date(a, m, 1);
    const startPad = primeiro.getDay();
    for (let i = startPad; i > 0; i--) days.push(new Date(a, m, 1-i));
    const ultimo = new Date(a, m+1, 0).getDate();
    for (let i = 1; i <= ultimo; i++) days.push(new Date(a, m, i));
    const total = days.length <= 35 ? 35 : 42;
    let next = 1;
    while (days.length < total) days.push(new Date(a, m+1, next++));
    return days;
  }

  function navMes(delta: number) {
    let m = viewMes + delta, a = viewAno;
    if (m < 0)  { m = 11; a--; }
    if (m > 11) { m = 0;  a++; }
    setViewMes(m); setViewAno(a);
  }

  function getWeekDays(dateStr: string): Date[] {
    const [a, m, d] = dateStr.split('-').map(Number);
    const cur = new Date(a, m-1, d);
    const dow = cur.getDay();
    return Array.from({ length: 7 }, (_, i) => new Date(a, m-1, d - dow + i));
  }

  function navSemana(delta: number) {
    const [a, m, d] = selectedDate.split('-').map(Number);
    const cur = new Date(a, m-1, d);
    cur.setDate(cur.getDate() + delta * 7);
    onChange(`${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`);
  }

  function weekLabel(days: Date[]): string {
    const f = days[0], l = days[6];
    if (f.getMonth() === l.getMonth() && f.getFullYear() === l.getFullYear()) {
      return `${f.getDate()} – ${l.getDate()} de ${MESES_PT[f.getMonth()]} ${f.getFullYear()}`;
    }
    return `${f.getDate()} ${MESES_PT[f.getMonth()].slice(0,3)} – ${l.getDate()} ${MESES_PT[l.getMonth()].slice(0,3)} ${l.getFullYear()}`;
  }

  const dias     = diasDoMes(viewAno, viewMes);
  const weekDays = getWeekDays(selectedDate);
  const navPrev  = () => viewMode === 'MES' ? navMes(-1) : navSemana(-1);
  const navNext  = () => viewMode === 'MES' ? navMes(1)  : navSemana(1);
  const header   = viewMode === 'MES' ? `${MESES_PT[viewMes]} ${viewAno}` : weekLabel(weekDays);

  function dayBtn(dStr: string, label: React.ReactNode, isFaded = false) {
    const isSelected = dStr === selectedDate;
    const isToday    = dStr === dataHoje;
    const status     = statusPorDia.get(dStr) ?? null;
    return { dStr, isSelected, isToday, status, isFaded };
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Header verde */}
      <div className="bg-emerald-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <button onClick={navPrev} className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-300 transition-colors">
            <ChevronLeft size={14} />
          </button>
          <span className="text-sm font-bold text-white">{header}</span>
          <button onClick={navNext} className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-300 transition-colors">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="p-3">
        {/* Legenda de dots — só quando há dados */}
        {statusPorDia.size > 0 && (
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            {(['LIVRE','PARCIAL','OCUPADO'] as DiaStatus[]).map(s => (
              <span key={s} className="flex items-center gap-1 text-[10px] font-semibold text-gray-500">
                <span className={`w-2 h-2 rounded-full inline-block ${DOT_COR[s]}`} /> {DOT_LABEL[s]}
              </span>
            ))}
          </div>
        )}

        {/* Cabeçalho dias da semana */}
        <div className="grid grid-cols-7 mb-1">
          {DIAS_PT.map(d => (
            <div key={d} className="text-center text-[9px] font-bold text-gray-400 uppercase py-1">{d}</div>
          ))}
        </div>

        {/* Vista MÊS */}
        {viewMode === 'MES' && (
          <div className="grid grid-cols-7 gap-0.5">
            {dias.map((dia, idx) => {
              const dStr     = `${dia.getFullYear()}-${pad(dia.getMonth()+1)}-${pad(dia.getDate())}`;
              const isCur    = dia.getMonth() === viewMes;
              const { isSelected, isToday, status } = dayBtn(dStr, dia.getDate(), !isCur);
              return (
                <button
                  key={idx}
                  onClick={() => isCur && onChange(dStr)}
                  className={[
                    'relative flex flex-col items-center justify-center h-9 rounded-xl text-xs font-semibold transition-all',
                    !isCur ? 'text-gray-200 cursor-default' : 'cursor-pointer',
                    isSelected && isCur  ? 'bg-emerald-600 text-white shadow-sm' : '',
                    !isSelected && isCur && isToday ? 'ring-2 ring-emerald-400 text-emerald-700' : '',
                    !isSelected && isCur && !isToday ? 'text-gray-700 hover:bg-gray-100' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {dia.getDate()}
                  {status && isCur && !isSelected && (
                    <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${DOT_COR[status]}`} />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Vista SEMANA */}
        {viewMode === 'SEMANA' && (
          <div className="grid grid-cols-7 gap-0.5">
            {weekDays.map((dia, idx) => {
              const dStr = `${dia.getFullYear()}-${pad(dia.getMonth()+1)}-${pad(dia.getDate())}`;
              const { isSelected, isToday, status } = dayBtn(dStr, dia.getDate());
              return (
                <button
                  key={idx}
                  onClick={() => onChange(dStr)}
                  className={[
                    'relative flex flex-col items-center justify-center h-12 rounded-xl text-xs font-semibold transition-all cursor-pointer',
                    isSelected ? 'bg-emerald-600 text-white shadow-sm' : '',
                    !isSelected && isToday ? 'ring-2 ring-emerald-400 text-emerald-700' : '',
                    !isSelected && !isToday ? 'text-gray-700 hover:bg-gray-100' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <span className="text-[9px] opacity-60">{MESES_PT[dia.getMonth()].slice(0,3)}</span>
                  <span>{dia.getDate()}</span>
                  {status && !isSelected && (
                    <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${DOT_COR[status]}`} />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Toggle Mês / Semana */}
        <div className="flex mt-3 gap-1 bg-gray-100 rounded-xl p-1">
          {(['MES', 'SEMANA'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-all ${
                viewMode === mode ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {mode === 'MES' ? 'Mês' : 'Semana'}
            </button>
          ))}
        </div>

        <button
          onClick={() => onChange(dataHoje)}
          className="mt-2 w-full text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 py-1.5 rounded-xl transition-colors"
        >
          Ir para Hoje
        </button>
      </div>
    </div>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function Agendamentos() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const { user }                                    = useAuth();
  const { contextoAtivo }                           = useEmpresa();
  const meuUserId                                   = user?.id ?? null;
  // Só o gestor agenda/opera para OUTRO profissional; os demais só para si mesmos.
  const podeAgendarParaOutro                        = isGestor;
  const location                                    = useLocation();
  const navigate                                    = useNavigate();
  const nomeEquipe                                  = contextoAtivo?.label ?? 'sua equipe';
  const podeCriarAgendamento                        = podeExecutar('atendimento.agendamentos.criar');
  const podeEditarAgendamento                       = podeExecutar('atendimento.agendamentos.editar');
  const podeDeletarAgendamento                      = podeExecutar('atendimento.agendamentos.deletar');
  const podeGerenciar                               = podeCriarAgendamento || podeEditarAgendamento || podeDeletarAgendamento;

  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline]             = useState<string | null>(null);

  // ── Animal / Proprietário ────────────────────────────────────────────────────
  const [animais, setAnimais]                   = useState<AnimalOption[]>([]);
  const [loadingAnimais, setLoadingAnimais]     = useState(false);
  const [selectedAnimalId, setSelectedAnimalId] = useState('');
  const [selectedProprId, setSelectedProprId]   = useState('');

  const selectedAnimal = animais.find(a => String(a.id) === selectedAnimalId) ?? null;

  // Lista única de proprietários derivada dos animais
  const proprietarios = useMemo(() => {
    const seen = new Set<number>();
    const list: NonNullable<AnimalOption['user']>[] = [];
    animais.forEach(a => {
      if (a.user && !seen.has(a.user.id)) { seen.add(a.user.id); list.push(a.user); }
    });
    return list;
  }, [animais]);

  // Contato exibido: do animal ou do proprietário selecionado
  const contatoInfo = selectedAnimal?.user
    ?? proprietarios.find(p => String(p.id) === selectedProprId)
    ?? null;

  // ── Vets ────────────────────────────────────────────────────────────────────
  const [vets, setVets]               = useState<VetMembro[]>([]);
  const [filtroVetId, setFiltroVetId] = useState('');
  const [filtroTipo, setFiltroTipo]   = useState('');
  const [openSlotVetId, setOpenSlotVetId] = useState<number | null>(null);

  // ── Calendar + agendamentos ─────────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const p = new URLSearchParams(location.search);
    return p.get('date') ?? hoje();
  });

  // ── Filtro de animais por LOCAL + DIA de atendimento do profissional ──────────
  // Traz só os animais localizados onde o veterinário atende no dia selecionado.
  // Dia da semana (0=Dom…6=Sáb) do dia selecionado — meio-dia evita desvio de fuso.
  const diaSemanaSelecionado = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return new Date(y, m - 1, d, 12).getDay();
  }, [selectedDate]);
  // Profissional-alvo: o filtrado na visão da agenda; senão o próprio usuário logado.
  const vetAlvoId = filtroVetId ? Number(filtroVetId) : meuUserId;
  // Localizações onde o profissional-alvo atende no dia. null = sem restrição
  // (ex.: gestor/sem locais configurados) → não filtra os animais.
  const locaisPermitidos = useMemo<Set<number> | null>(() => {
    const vet = vets.find(v => v.userId === vetAlvoId);
    if (!vet || vet.locais.length === 0) return null;
    const set = new Set<number>();
    for (const l of vet.locais) {
      // Local sem dias definidos = atende todos os dias ali
      if (!l.dias || l.dias.length === 0 || l.dias.includes(diaSemanaSelecionado)) {
        set.add(l.localizacaoId);
      }
    }
    return set;
  }, [vets, vetAlvoId, diaSemanaSelecionado]);
  // Animais no local/dia de atendimento (base para os seletores de animal)
  const animaisNoLocal = useMemo(
    () => locaisPermitidos
      ? animais.filter(a => a.localizacaoId != null && locaisPermitidos.has(a.localizacaoId))
      : animais,
    [animais, locaisPermitidos],
  );
  // Filtra ainda pelo proprietário selecionado (barra superior)
  const animaisFiltradosBar = useMemo(
    () => selectedProprId ? animaisNoLocal.filter(a => String(a.user?.id) === selectedProprId) : animaisNoLocal,
    [animaisNoLocal, selectedProprId],
  );
  const [agendamentos, setAgendamentos] = useState<AgendamentoGlobal[]>([]);
  const [loading, setLoading]           = useState(false);
  const [busca, setBusca]               = useState('');
  const [agendamentosMes, setAgendamentosMes] = useState<AgendamentoGlobal[]>([]);
  const [mesCarregado, setMesCarregado] = useState('');
  // Ocupação GLOBAL do profissional no dia (todas as empresas) — para descontar os slots
  // em que ele já está agendado em QUALQUER empresa. Map<vetUserId, Set<'HH:MM'>>.
  const [ocupacaoGlobal, setOcupacaoGlobal] = useState<Map<number, Set<string>>>(new Map());

  // ── Modais ──────────────────────────────────────────────────────────────────
  const [booking, setBooking]             = useState<BookingInfo | null>(null);
  const [comboQuery, setComboQuery]       = useState('');
  const [comboOpen, setComboOpen]         = useState(false);
  const comboRef                          = useRef<HTMLDivElement>(null);
  const [bookingForm, setBookingForm]     = useState<BookingForm>({ animalId: '', proprietarioNome: '', telefone: '', cpf: '' });
  const [salvando, setSalvando]           = useState(false);
  const [reagendando, setReagendando]     = useState<AgendamentoGlobal | null>(null);
  const [novaDataHora, setNovaDataHora]   = useState('');
  const [salvandoReag, setSalvandoReag]   = useState(false);
  const [cancelando, setCancelando]       = useState<number | null>(null);
  // Confirmação de conflito: animal já possui agendamento — o vet precisa dar ciência antes de prosseguir
  const [conflitoConfirm, setConflitoConfirm] = useState<{
    animalNome: string; quando: string; hora: string; vetNome: string; onConfirm: () => void;
    // Fecha também o painel de origem (ex.: modal "Novo Agendamento") ao cancelar,
    // para o usuário voltar à tela de agendamentos em vez de ficar preso no formulário.
    onCancel?: () => void;
  } | null>(null);

  // ── Modal Voz/IA ────────────────────────────────────────────────────────────
  // ── Trocar profissional / Transferir dia ────────────────────────────────────
  const [trocandoVetAg,   setTrocandoVetAg]   = useState<AgendamentoGlobal | null>(null);
  const [trocandoVetIdAg, setTrocandoVetIdAg] = useState('');
  const [savingTrocaAg,   setSavingTrocaAg]   = useState(false);
  const [transferindoDia, setTransferindoDia] = useState(false);
  const [transDeVetId,    setTransDeVetId]    = useState('');
  const [transParaVetId,  setTransParaVetId]  = useState('');
  const [savingTransf,    setSavingTransf]    = useState(false);

  const [escolhaTipo, setEscolhaTipo]         = useState<BookingInfo | null>(null);
  const [vozAberto, setVozAberto]             = useState(false);
  const [vozContexto, setVozContexto]         = useState<BookingInfo | null>(null);
  const [vozEtapa, setVozEtapa]               = useState<VozEtapa>('IDLE');
  const [vozTranscricao, setVozTranscricao]   = useState('');
  const [vozTextoManual, setVozTextoManual]   = useState('');
  const [vozResultado, setVozResultado]       = useState<InterpretacaoResultado | null>(null);
  const [vozSlotConflito, setVozSlotConflito] = useState<{
    existingHora: string; vetNome: string; animalNome: string; novaHora: string; novaDataHora: string;
  } | null>(null);
  const recognitionRef                        = useRef<any>(null);

  // ── Dropdown de slots ────────────────────────────────────────────────────────
  const [slotPos, setSlotPos]   = useState<{ top: number; left: number } | null>(null);
  const slotCloseRef            = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openSlotMenu(vetId: number, el: HTMLElement) {
    if (slotCloseRef.current) clearTimeout(slotCloseRef.current);
    const rect = el.getBoundingClientRect();
    setSlotPos({ top: rect.top, left: rect.left });
    setOpenSlotVetId(vetId);
  }
  function scheduleCloseSlot() {
    slotCloseRef.current = setTimeout(() => { setOpenSlotVetId(null); setSlotPos(null); }, 80);
  }
  function cancelCloseSlot() {
    if (slotCloseRef.current) clearTimeout(slotCloseRef.current);
  }

  // Auto-abre voz quando ?auto=1; pré-seleciona animal quando ?animalId=X; salta para ?date=X
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const auto     = params.get('auto') === '1';
    const animalQP = params.get('animalId');
    const dateQP   = params.get('date');
    if (auto) {
      setVozAberto(true); setVozEtapa('IDLE');
      setVozTranscricao(''); setVozTextoManual(''); setVozResultado(null); setVozSlotConflito(null);
    }
    if (animalQP) setSelectedAnimalId(animalQP);
    if (dateQP)   setSelectedDate(dateQP);
    if (auto || animalQP || dateQP) navigate('/agendamentos', { replace: true });
  }, [location.search]);

  // ── statusPorDia — bolinhas só com profissional selecionado ─────────────────
  // Verde = livre (0 agend.), Amarelo = parcial, Vermelho = sem vagas
  const statusPorDia = useMemo<Map<string, DiaStatus>>(() => {
    if (!filtroVetId) return new Map();
    const vetId = Number(filtroVetId);
    const contagem = new Map<string, number>();
    agendamentosMes.forEach(ag => {
      if (ag.status === 'CANCELADO' || ag.veterinario?.id !== vetId) return;
      const d = ag.dataHora.slice(0, 10);
      contagem.set(d, (contagem.get(d) ?? 0) + 1);
    });
    const [anoS, mesS] = selectedDate.split('-');
    const mesN = Number(mesS);
    const result = new Map<string, DiaStatus>();
    const diasNoMes = new Date(Number(anoS), mesN, 0).getDate();
    for (let d = 1; d <= diasNoMes; d++) {
      const dStr  = `${anoS}-${pad(mesN)}-${pad(d)}`;
      const count = contagem.get(dStr) ?? 0;
      if (count === 0)              result.set(dStr, 'LIVRE');
      else if (count < HORARIOS.length) result.set(dStr, 'PARCIAL');
      else                          result.set(dStr, 'OCUPADO');
    }
    return result;
  }, [agendamentosMes, filtroVetId, selectedDate]);

  // ── Fetches ─────────────────────────────────────────────────────────────────
  const fetchAnimais = useCallback(async () => {
    setLoadingAnimais(true);
    try {
      const res = await api.get('/animais');
      if (!res.data) return;
      const brutos = (res.data.dados ?? res.data) as Array<AnimalOption & { localizacao?: { id: number } | null }>;
      setAnimais(brutos.map(a => ({ ...a, localizacaoId: a.localizacao?.id ?? a.localizacaoId ?? null })));
    } catch { /* silencioso */ }
    finally { setLoadingAnimais(false); }
  }, []);

  const fetchVets = useCallback(async () => {
    try {
      const res = await api.get('/equipes/membros');
      if (!res.data) return;
      const membros = (res.data.dados ?? []) as Array<{
        cargo: string;
        diasTrabalho?: string | null;
        horaInicioTrabalho?: string | null;
        horaFimTrabalho?: string | null;
        locaisTrabalho?: Array<{ localizacaoId: number; diasTrabalho: string | null }> | null;
        user: {
          id: number; fullName: string; userType: string;
          vetPerfil?: { subespecialidades?: { nome: string }[] } | null;
          fornecedorPerfil?: { tipoServico?: string | null } | null;
          especialidades?: { especialidade?: { nome?: string | null } | null }[] | null;
        };
      }>;
      setVets(membros
        // Veterinários, gestores E fornecedores (prestadores) — o fornecedor também
        // agenda e ocupa horários (debita da cota do dia).
        .filter(m => m.user.userType === 'VETERINARIO' || m.cargo === 'GESTOR' || m.cargo === 'FORNECEDOR')
        .map(m => {
          let especialidades: string[];
          if (m.cargo === 'FORNECEDOR') {
            // Fornecedor: especialidade vem do tipo de serviço do cadastro
            especialidades = (m.user.fornecedorPerfil?.tipoServico ?? '')
              .split(',').map(s => s.trim()).filter(Boolean);
            if (especialidades.length === 0) especialidades = ['Prestador'];
          } else {
            // Fonte única: catálogo de especialidades (UsuarioEspecialidade). Fallback para
            // o vocabulário legado (VetSubespecialidade) em vets sem catálogo migrado.
            const doCatalogo = (m.user.especialidades ?? [])
              .map(e => e.especialidade?.nome?.trim())
              .filter((n): n is string => !!n);
            const legado = (m.user.vetPerfil?.subespecialidades ?? [])
              .map(s => s.nome?.trim())
              .filter((n): n is string => !!n && isSubespecialidadeValida(n));
            const esp = doCatalogo.length > 0 ? doCatalogo : legado;
            especialidades = esp.length > 0 ? esp : ['Clínica Geral'];
          }
          return {
            userId: m.user.id,
            fullName: m.user.fullName,
            cargo: m.cargo,
            especialidades,
            diasTrab: m.diasTrabalho
              ? String(m.diasTrabalho).split(',').map(Number).filter(n => n >= 0 && n <= 6)
              : null,
            horaIni: m.horaInicioTrabalho ?? null,
            horaFim: m.horaFimTrabalho ?? null,
            locais: (m.locaisTrabalho ?? []).map(l => ({
              localizacaoId: l.localizacaoId,
              dias: l.diasTrabalho
                ? String(l.diasTrabalho).split(',').map(Number).filter(n => n >= 0 && n <= 6)
                : null,
            })),
          };
        })
      );
    } catch { /* silencioso */ }
  }, []);

  const fetchAgendamentos = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await api.get('/clinica/agendamentos', { params: { data: date } });
      if (!res.data) { setAgendamentos([]); return; }
      setAgendamentos(res.data.dados ?? []);
    } catch { setErroInline('Erro ao carregar agendamentos'); }
    finally { setLoading(false); }
  }, []);

  // Ocupação global dos profissionais visíveis no dia (todas as empresas). Só devolve
  // { veterinarioId, dataHora } — usado para marcar como ocupado o horário em que o
  // profissional já está agendado em outra empresa (evita duplo agendamento).
  const fetchOcupacaoGlobal = useCallback(async (date: string, vetIds: number[]) => {
    if (vetIds.length === 0) { setOcupacaoGlobal(new Map()); return; }
    try {
      const res = await api.get('/clinica/agendamentos/ocupacao', { params: { data: date, vetIds: vetIds.join(',') } });
      if (!res.data) { setOcupacaoGlobal(new Map()); return; }
      const map = new Map<number, Set<string>>();
      for (const o of (res.data.dados ?? []) as { veterinarioId: number | null; dataHora: string }[]) {
        if (o.veterinarioId == null) continue;
        if (!map.has(o.veterinarioId)) map.set(o.veterinarioId, new Set());
        map.get(o.veterinarioId)!.add(formatarHora(o.dataHora));
      }
      setOcupacaoGlobal(map);
    } catch { /* silencioso — cai no fallback do contexto ativo */ }
  }, []);

  const fetchMes = useCallback(async (mesAno: string) => {
    if (mesAno === mesCarregado) return;
    try {
      const res = await api.get('/clinica/agendamentos', { params: { mesAno } });
      if (!res.data) return;
      setAgendamentosMes(res.data.dados ?? []);
      setMesCarregado(mesAno);
    } catch { /* silencioso */ }
  }, [mesCarregado]);

  useEffect(() => {
    if (loadingPerms) return;
    fetchAnimais(); fetchVets();
  }, [loadingPerms]);

  useEffect(() => {
    if (loadingPerms) return;
    fetchAgendamentos(selectedDate);
    fetchMes(selectedDate.slice(0, 7));
  }, [selectedDate, loadingPerms]);

  // Recarrega a ocupação global sempre que o dia ou a lista de profissionais mudar.
  useEffect(() => {
    if (loadingPerms) return;
    fetchOcupacaoGlobal(selectedDate, vets.map(v => v.userId));
  }, [selectedDate, vets, loadingPerms, fetchOcupacaoGlobal]);

  // Fecha combo ao clicar fora
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) setComboOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  // ── Expediente de atendimento (configurável em Configurações) ────────────────
  const [expediente, setExpediente] = useState<{ dias: number[] | null; horaInicio: string | null; horaFim: string | null }>({
    dias: null, horaInicio: null, horaFim: null,
  });
  useEffect(() => {
    api.get('/equipes/horario-atendimento')
      .then(res => {
        const d = res.data?.dados;
        if (!d) return;
        setExpediente({
          dias: d.diasAtendimento ? String(d.diasAtendimento).split(',').map(Number).filter((n: number) => n >= 0 && n <= 6) : null,
          horaInicio: d.horaInicioAtendimento ?? null,
          horaFim:    d.horaFimAtendimento ?? null,
        });
      })
      .catch(() => {});
  }, []);

  // Expediente EFETIVO do profissional na equipe = INTERSEÇÃO do expediente pessoal
  // dele com o expediente da equipe/empresa (a equipe é o limitador).
  // Ex.: equipe 08:00–20:00 + profissional 16:00–23:00 → 16:00–20:00.
  // Dias: interseção; horas: início = o mais TARDE, fim = o mais CEDO.
  // dias = null → todos os dias; dias = [] → nenhum dia.
  const expedienteDoVet = (vetId: number) => {
    const v = vets.find(x => x.userId === vetId);
    const cIni = expediente.horaInicio, cFim = expediente.horaFim, cDias = expediente.dias;
    const vIni = v?.horaIni ?? null, vFim = v?.horaFim ?? null, vDias = v?.diasTrab ?? null;

    // Início = o mais tarde entre profissional e equipe; fim = o mais cedo (HH:MM compara como string)
    const horaInicio = (vIni && cIni) ? (vIni > cIni ? vIni : cIni) : (vIni ?? cIni);
    const horaFim    = (vFim && cFim) ? (vFim < cFim ? vFim : cFim) : (vFim ?? cFim);

    // Dias: interseção. null (qualquer lado) = sem restrição naquele lado.
    let dias: number[] | null;
    if (cDias && vDias) dias = vDias.filter(d => cDias.includes(d));
    else                dias = vDias ?? cDias;

    return { dias, horaInicio, horaFim };
  };

  // Horários liberados para uma data conforme o expediente do PROFISSIONAL (dias + faixa).
  const horariosDoDia = (vetId: number, dateStr: string): string[] => {
    const exp = expedienteDoVet(vetId);
    const wd = new Date(`${dateStr}T00:00:00`).getDay();
    // dias null = todos; array (mesmo vazio) = só os listados (vazio → nenhum dia)
    if (exp.dias && !exp.dias.includes(wd)) return [];
    const hi = exp.horaInicio ? parseInt(exp.horaInicio.slice(0, 2), 10) : 0;
    const hf = exp.horaFim    ? parseInt(exp.horaFim.slice(0, 2), 10)    : 24;
    return HORARIOS.filter(h => { const hour = parseInt(h.slice(0, 2), 10); return hour >= hi && hour < hf; });
  };

  // Rótulos do expediente por profissional (coluna "Período"/"Dias").
  // Cada lado é independente: início ausente = 00:00, fim ausente = 24:00.
  // (Antes, se só um dos dois estava definido, caía no default "00:00 — 24:00".)
  const labelPeriodoVet = (vetId: number): string => {
    const exp = expedienteDoVet(vetId);
    const ini = exp.horaInicio ? exp.horaInicio.slice(0, 5) : '00:00';
    const fim = exp.horaFim    ? exp.horaFim.slice(0, 5)    : '24:00';
    return `${ini} — ${fim}`;
  };
  const labelDiasVet = (vetId: number): string => {
    const exp = expedienteDoVet(vetId);
    if (exp.dias === null) return 'Todos os dias';   // sem restrição
    if (exp.dias.length === 0) return 'Nenhum';       // interseção vazia
    return exp.dias.slice().sort((a, b) => a - b).map(d => DIAS_PT[d]).join(', ');
  };

  // ── Slots ────────────────────────────────────────────────────────────────────
  function slotsOcupados(vetId: number): Set<string> {
    // Ocupado = agendamentos do contexto ativo + ocupação GLOBAL do profissional
    // (mesmo horário agendado em outra empresa também bloqueia o slot).
    const local  = agendamentos.filter(ag => ag.veterinario?.id === vetId && ag.status !== 'CANCELADO').map(ag => formatarHora(ag.dataHora));
    const global = ocupacaoGlobal.get(vetId);
    return new Set(global ? [...local, ...global] : local);
  }
  function slotsLivres(vetId: number): string[] {
    const ocp   = slotsOcupados(vetId);
    const base  = horariosDoDia(vetId, selectedDate);
    const eHoje = selectedDate === hoje();
    const agora = eHoje ? new Date() : null;
    return base.filter(h => {
      if (ocp.has(h)) return false;
      if (agora) {
        const [hh, mm] = h.split(':').map(Number);
        return hh * 60 + mm > agora.getHours() * 60 + agora.getMinutes();
      }
      return true;
    });
  }

  // ── Filtros locais ───────────────────────────────────────────────────────────
  const listaFiltrada = useMemo(() => agendamentos.filter(ag => {
    if (filtroVetId && ag.veterinario?.id !== Number(filtroVetId)) return false;
    if (filtroTipo  && ag.tipo !== filtroTipo) return false;
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    return (
      ag.animal?.nome.toLowerCase().includes(q) ||
      ag.titulo.toLowerCase().includes(q) ||
      ag.veterinario?.fullName.toLowerCase().includes(q) ||
      ag.animal?.user?.fullName.toLowerCase().includes(q)
    );
  }), [agendamentos, filtroVetId, filtroTipo, busca]);

  const vetsFiltrados = useMemo(
    () => filtroVetId ? vets.filter(v => String(v.userId) === filtroVetId) : vets,
    [vets, filtroVetId]
  );
  const animaisCombo = animaisNoLocal.filter(a => !comboQuery || a.nome.toLowerCase().includes(comboQuery.toLowerCase()));

  // ── Conflict check ────────────────────────────────────────────────────────────
  // Verifica se o animal já tem QUALQUER agendamento no dia selecionado (qualquer vet, qualquer hora)
  function findConflictAnimal(animalId: number): AgendamentoGlobal | null {
    return agendamentos.find(ag =>
      ag.animal?.id === animalId &&
      ag.status !== 'CANCELADO'
    ) ?? null;
  }

  function findConflict(animalId: number, vetId: number): AgendamentoGlobal | null {
    return agendamentos.find(ag =>
      ag.animal?.id === animalId &&
      ag.veterinario?.id === vetId &&
      ag.status !== 'CANCELADO'
    ) ?? null;
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────
  // Extrai a mensagem de erro do backend (campo `error`) para exibir ao usuário.
  const msgErroAgenda = (err: unknown, fallback: string): string =>
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;

  async function criarAgendamentoDireto(animalId: number, animalNome: string, vetId: number, hora: string) {
    setSalvando(true);
    try {
      await api.post('/clinica/agendamentos', {
        animalId, tipo: 'CONSULTA', titulo: `Consulta - ${animalNome}`,
        dataHora: new Date(`${selectedDate}T${hora}`).toISOString(), veterinarioId: vetId,
      });
      toast.success(`Consulta agendada às ${hora}`);
      fetchAgendamentos(selectedDate);
      setMesCarregado('');
    } catch (err) { setErroInline(msgErroAgenda(err, 'Erro ao criar agendamento')); }
    finally { setSalvando(false); }
  }

  async function handleSlotClick(vetId: number, vetName: string, hora: string) {
    setOpenSlotVetId(null);
    // Só o gestor agenda para outro profissional; os demais só para a própria coluna.
    if (!podeAgendarParaOutro && meuUserId != null && vetId !== meuUserId) {
      setErroInline('Você só pode agendar para você mesmo. Agendar para outro profissional é exclusivo do gestor.');
      return;
    }
    if (selectedAnimalId && selectedAnimal) {
      const conflito = findConflictAnimal(Number(selectedAnimalId));
      if (conflito) {
        // Não bloqueia, mas exige ciência do vet: abre modal de confirmação antes de agendar
        setConflitoConfirm({
          animalNome: selectedAnimal.nome,
          quando:     dataRelativa(selectedDate),
          hora:       formatarHora(conflito.dataHora),
          vetNome:    conflito.veterinario?.fullName ?? vetName,
          onConfirm:  () => criarAgendamentoDireto(Number(selectedAnimalId), selectedAnimal.nome, vetId, hora),
        });
        return;
      }
      criarAgendamentoDireto(Number(selectedAnimalId), selectedAnimal.nome, vetId, hora);
    } else {
      setBooking({ vetId, vetName, hora });
      setBookingForm({ animalId: '', proprietarioNome: '', telefone: '', cpf: '' });
      setComboQuery(''); setComboOpen(false);
    }
  }

  function handleEscolhaManual() {
    if (!escolhaTipo) return;
    setEscolhaTipo(null);
    setBooking({ ...escolhaTipo });
    setBookingForm({ animalId: '', proprietarioNome: '', telefone: '', cpf: '' });
    setComboQuery(''); setComboOpen(false);
  }

  function handleEscolhaVoz() {
    if (!escolhaTipo) return;
    setVozContexto({ ...escolhaTipo });
    setEscolhaTipo(null);
    setVozAberto(true); setVozEtapa('IDLE');
    setVozTranscricao(''); setVozTextoManual(''); setVozResultado(null);
  }

  function resetVoz() {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
    setVozAberto(false); setVozContexto(null); setVozEtapa('IDLE');
    setVozTranscricao(''); setVozTextoManual(''); setVozResultado(null); setVozSlotConflito(null);
  }

  function iniciarGravacao() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setVozEtapa('ERRO'); return; }
    const rec = new SR();
    rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (ev: any) => {
      let t = '';
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      setVozTranscricao(t);
    };
    rec.onerror = () => setVozEtapa('ERRO');
    rec.start(); recognitionRef.current = rec;
    setVozEtapa('GRAVANDO'); setVozTranscricao('');
  }

  function pararGravacao() {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
    setVozEtapa('PROCESSANDO');
    setTimeout(() => processarVoz(), 200);
  }

  async function processarVoz(textoOverride?: string) {
    const texto = textoOverride ?? vozTranscricao ?? vozTextoManual;
    if (!texto.trim()) { setVozEtapa('ERRO'); return; }
    setVozEtapa('PROCESSANDO');
    try {
      const res = await api.post('/clinica/agendamentos/interpretar', { texto, dataReferencia: selectedDate, vetHint: vozContexto?.vetId, horaHint: vozContexto?.hora });
      const resultado: InterpretacaoResultado = res.data?.dados ?? res.data;

      // Respeita o expediente do PROFISSIONAL (dias + faixa de horas) — mesmo critério da
      // grade de horários. O backend do voz usa uma faixa fixa; aqui recortamos ao expediente.
      if (resultado && resultado.vetId && resultado.data) {
        const permitidos = new Set(horariosDoDia(resultado.vetId, resultado.data));
        if (permitidos.size === 0) {
          resultado.disponivel = false;      // profissional não atende nesse dia
          resultado.horariosLivres = [];
        } else {
          if (resultado.horariosLivres) {
            resultado.horariosLivres = resultado.horariosLivres.filter(h => permitidos.has(h));
          }
          if (resultado.hora && !permitidos.has(resultado.hora)) {
            resultado.disponivel = false;    // horário fora do expediente do profissional
          }
        }
      }

      setVozResultado(resultado);
      setVozEtapa(resultado?.disponivel ? 'DISPONIVEL' : 'INDISPONIVEL');
    } catch { setVozEtapa('ERRO'); }
  }

  async function confirmarVoz() {
    if (!vozResultado) return;

    const animalId   = vozResultado.animalId ?? (selectedAnimalId ? Number(selectedAnimalId) : null);
    const vetId      = vozResultado.vetId    ?? vozContexto?.vetId ?? null;
    const dataHora   = vozResultado.dataHora
      ?? (vozContexto ? new Date(`${selectedDate}T${vozContexto.hora}`).toISOString() : null);
    const animalNome = vozResultado.animal?.nome ?? selectedAnimal?.nome ?? 'Animal';

    if (!animalId) { setErroInline('Animal não identificado pela IA'); return; }
    if (!dataHora) { setErroInline('Data/hora não identificada'); return; }

    setSalvando(true);
    try {
      await api.post('/clinica/agendamentos', {
        animalId, tipo: 'CONSULTA',
        titulo: `Consulta - ${animalNome}`,
        dataHora,
        veterinarioId: vetId,
      });
      toast.success('Agendamento confirmado!');
      resetVoz(); fetchAgendamentos(selectedDate); setMesCarregado('');
    } catch (err) { setErroInline(msgErroAgenda(err, 'Erro ao confirmar agendamento')); }
    finally { setSalvando(false); }
  }

  async function executarConfirmarBooking() {
    if (!booking) return;
    const animal = animais.find(a => String(a.id) === bookingForm.animalId);
    setSalvando(true);
    try {
      await api.post('/clinica/agendamentos', {
        animalId: Number(bookingForm.animalId), tipo: 'CONSULTA',
        titulo: `Consulta - ${animal?.nome ?? 'Paciente'}`,
        dataHora: new Date(`${selectedDate}T${booking.hora}`).toISOString(),
        veterinarioId: booking.vetId,
      });
      toast.success(`Consulta agendada às ${booking.hora} com ${booking.vetName}`);
      setBooking(null); fetchAgendamentos(selectedDate); setMesCarregado('');
    } catch (err) { setErroInline(msgErroAgenda(err, 'Erro ao criar agendamento')); }
    finally { setSalvando(false); }
  }

  async function handleConfirmarBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!booking) return;
    if (!bookingForm.animalId) { setErroInline('Selecione um animal'); return; }
    const conflito = findConflictAnimal(Number(bookingForm.animalId));
    if (conflito) {
      const nomeAnimal = animais.find(a => String(a.id) === bookingForm.animalId)?.nome ?? 'este animal';
      // Não bloqueia, mas exige ciência do vet: abre modal de confirmação antes de agendar
      setConflitoConfirm({
        animalNome: nomeAnimal,
        quando:     dataRelativa(selectedDate),
        hora:       formatarHora(conflito.dataHora),
        vetNome:    conflito.veterinario?.fullName ?? booking.vetName,
        onConfirm:  () => executarConfirmarBooking(),
        onCancel:   () => setBooking(null),
      });
      return;
    }
    executarConfirmarBooking();
  }

  async function handleStatus(id: number, novoStatus: string, motivo?: string) {
    try {
      await api.patch(`/clinica/agendamentos/${id}/status`, { status: novoStatus, motivo });
      toast.success(novoStatus === 'CONCLUIDO' ? 'Confirmado' : 'Cancelado');
      setCancelando(null);
      setAgendamentos(prev => prev.map(a =>
        a.id === id
          ? { ...a, status: novoStatus as StatusAgendamento, observacao: novoStatus === 'CANCELADO' && motivo ? motivo : a.observacao }
          : a
      ));
    } catch { setErroInline('Erro ao atualizar'); }
  }

  function handleIniciarAtendimento(ag: AgendamentoGlobal) {
    if (!ag.animal?.id) { setErroInline('Animal não identificado no agendamento'); return; }
    navigate(`/clinica/evolucao/${ag.animal.id}?agendamentoId=${ag.id}`);
  }

  async function handleTrocarVetAg() {
    if (!trocandoVetAg || !trocandoVetIdAg) { setErroInline('Selecione um profissional'); return; }
    if (trocandoVetIdAg === String(trocandoVetAg.veterinario?.id)) {
      setErroInline('O profissional já é o responsável por este agendamento');
      return;
    }
    setSavingTrocaAg(true);
    try {
      await api.patch(`/clinica/agendamentos/${trocandoVetAg.id}`, { veterinarioId: Number(trocandoVetIdAg) });
      const novoVet = vets.find(v => String(v.userId) === trocandoVetIdAg);
      toast.success(`Transferido para ${novoVet?.fullName ?? 'novo profissional'}`);
      setTrocandoVetAg(null);
      fetchAgendamentos(selectedDate);
      setMesCarregado('');
    } catch (err) { setErroInline(msgErroAgenda(err, 'Erro ao trocar profissional')); }
    finally { setSavingTrocaAg(false); }
  }

  async function handleTransferirDia() {
    if (!transDeVetId || !transParaVetId) { setErroInline('Selecione os profissionais'); return; }
    if (transDeVetId === transParaVetId) { setErroInline('Origem e destino devem ser diferentes'); return; }
    setSavingTransf(true);
    try {
      const res = await api.patch('/clinica/agendamentos/transferir-dia', {
        data: selectedDate, deVetId: Number(transDeVetId), paraVetId: Number(transParaVetId),
      });
      const transferidos = res.data?.dados?.transferidos ?? 0;
      const bloqueados: { animalNome: string | null; hora: string }[] = res.data?.dados?.bloqueados ?? [];
      if (transferidos > 0) toast.success(`${transferidos} agendamento(s) transferido(s)`);
      if (bloqueados.length > 0) {
        // Profissional de destino já ocupado nesses horários — não foram movidos
        setErroInline(
          `${bloqueados.length} agendamento(s) NÃO transferido(s) — profissional de destino já ocupado: ` +
          bloqueados.map(b => `${b.animalNome ?? 'paciente'} às ${formatarHora(b.hora)}`).join(', '),
        );
      }
      if (transferidos === 0 && bloqueados.length === 0) toast('Nenhum agendamento para transferir neste dia', { icon: 'ℹ️' });
      setTransferindoDia(false);
      fetchAgendamentos(selectedDate);
      setMesCarregado('');
    } catch (err) { setErroInline(msgErroAgenda(err, 'Erro ao transferir agenda do dia')); }
    finally { setSavingTransf(false); }
  }

  // Expediente do vet do agendamento sendo reagendado — dia/horário de trabalho
  // próprios (herdado da empresa quando o vet não tem expediente configurado é
  // resolvido no backend; aqui só valida quando o vet TEM expediente próprio,
  // para dar feedback imediato sem duplicar a lógica de herança).
  const expedienteReagendando = reagendando
    ? vets.find(v => v.userId === reagendando.veterinario?.id)
    : undefined;

  function foraDoExpediente(dataHoraLocal: string, vet: VetMembro | undefined): string | null {
    if (!vet || (!vet.diasTrab && !vet.horaIni)) return null; // sem expediente próprio configurado
    const d = new Date(dataHoraLocal);
    if (isNaN(d.getTime())) return null;
    if (vet.diasTrab && vet.diasTrab.length > 0 && !vet.diasTrab.includes(d.getDay())) {
      return `${vet.fullName} não atende neste dia da semana.`;
    }
    if (vet.horaIni && vet.horaFim) {
      const hhmm = dataHoraLocal.slice(11, 16);
      if (hhmm < vet.horaIni || hhmm >= vet.horaFim) {
        return `${vet.fullName} atende das ${vet.horaIni} às ${vet.horaFim}.`;
      }
    }
    return null;
  }

  async function handleReagendar(e: React.FormEvent) {
    e.preventDefault();
    if (!reagendando || !novaDataHora) { setErroInline('Informe a nova data/hora'); return; }
    if (novaDataHora === formatarDateInput(reagendando.dataHora)) { setErroInline('A nova data deve ser diferente da atual'); return; }
    const avisoExpediente = foraDoExpediente(novaDataHora, expedienteReagendando);
    if (avisoExpediente) { setErroInline(avisoExpediente); return; }
    setSalvandoReag(true);
    try {
      const novaData = new Date(novaDataHora);
      const novaDataStr = novaData.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      await api.patch(`/clinica/agendamentos/${reagendando.id}/status`, {
        status: 'CANCELADO',
        motivo: `Reagendado para ${novaDataStr}`,
      });
      await api.post('/clinica/agendamentos', {
        animalId: reagendando.animal?.id, tipo: reagendando.tipo, titulo: reagendando.titulo,
        dataHora: novaData.toISOString(), observacao: reagendando.observacao ?? undefined,
        veterinarioId: reagendando.veterinario?.id,
      });
      toast.success('Reagendado');
      setReagendando(null); fetchAgendamentos(selectedDate); setMesCarregado('');
    } catch (err) { setErroInline(msgErroAgenda(err, 'Erro ao reagendar')); }
    finally { setSalvandoReag(false); }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <PageContainer maxWidth="7xl">

      <BotaoVoltar className="mb-6" />

      <InlineError message={erroInline} className="mb-4" />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
          <CalendarClock size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Portal de Agendamento</h1>
          <p className="text-sm text-gray-500">Agenda Veterinária · Gestão de consultas e atendimentos</p>
        </div>
      </div>

      {/* ── Barra bidirecional Animal ↔ Proprietário ─────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-5">
        <div className="flex flex-col md:flex-row md:items-end gap-4">

          {/* Agende por Voz */}
          {podeGerenciar && (
            <button
              onClick={() => {
                setVozAberto(true); setVozEtapa('IDLE');
                setVozTranscricao(''); setVozTextoManual(''); setVozResultado(null); setVozSlotConflito(null);
              }}
              className="flex items-center justify-center gap-2 px-5 h-10 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap flex-shrink-0"
            >
              <Sparkles size={14} />
              Agende por Voz
            </button>
          )}

          {/* Animal — filtra por proprietário selecionado */}
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
              <UserIcon size={10} /> Animal / Paciente
            </label>
            {loadingAnimais ? (
              <div className="h-10 flex items-center gap-2 pl-3 text-sm text-gray-400">
                <Loader2 size={14} className="animate-spin" /> Carregando...
              </div>
            ) : (
              <div className="relative">
                <Search size={12} className="absolute left-3 top-2.5 text-gray-400 pointer-events-none" />
                <select
                  value={selectedAnimalId}
                  onChange={e => {
                    const val = e.target.value;
                    setSelectedAnimalId(val);
                    if (val) {
                      const a = animais.find(x => String(x.id) === val);
                      if (a?.user) setSelectedProprId(String(a.user.id));
                    }
                  }}
                  className="w-full pl-8 pr-7 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 text-gray-800 font-semibold outline-none cursor-pointer appearance-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                >
                  <option value="">Todos os animais</option>
                  {animaisFiltradosBar.map(a => (
                    <option key={a.id} value={a.id}>{a.nome}{a.especie?.nome ? ` (${a.especie.nome})` : ''}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Proprietário — filtra animais e auto-seleciona quando único */}
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
              <UserIcon size={10} /> Proprietário / Tutor
            </label>
            {loadingAnimais ? (
              <div className="h-10 flex items-center px-3 border border-gray-100 rounded-xl bg-gray-50">
                <span className="text-sm text-gray-400">—</span>
              </div>
            ) : (
              <div className="relative">
                <select
                  value={selectedProprId}
                  onChange={e => {
                    const val = e.target.value;
                    setSelectedProprId(val);
                    if (val) {
                      const deles = animais.filter(a => String(a.user?.id) === val);
                      if (deles.length === 1) {
                        setSelectedAnimalId(String(deles[0].id));
                      } else if (selectedAnimalId) {
                        const cur = animais.find(a => String(a.id) === selectedAnimalId);
                        if (cur?.user && String(cur.user.id) !== val) setSelectedAnimalId('');
                      }
                    } else {
                      setSelectedAnimalId('');
                    }
                  }}
                  className="w-full pl-3 pr-7 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 text-gray-800 font-semibold outline-none cursor-pointer appearance-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                >
                  <option value="">Todos os proprietários</option>
                  {proprietarios.map(p => (
                    <option key={p.id} value={p.id}>{p.fullName}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Contato */}
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
              <Phone size={10} /> Contato
            </label>
            <div className="h-10 flex items-center px-3 border border-gray-100 rounded-xl bg-gray-50">
              {contatoInfo?.email ? (
                <span className="text-sm text-gray-600 truncate">{contatoInfo.email}</span>
              ) : (
                <span className="text-sm text-gray-400 italic">
                  {selectedAnimalId || selectedProprId ? '—' : 'Selecione um animal ou proprietário'}
                </span>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Layout: Calendário + Painel direito ─────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-5 mb-5">

        {/* Calendário — largura compacta fixa */}
        <div className="lg:w-72 flex-shrink-0">
          <CalendarioInterativo
            selectedDate={selectedDate}
            onChange={date => { setSelectedDate(date); if (date.slice(0,7) !== mesCarregado) setMesCarregado(''); }}
            statusPorDia={statusPorDia}
          />
        </div>

        {/* Painel direito: Filtros + Profissionais */}
        <div className="flex-1 flex flex-col gap-4">

          {/* Filtros — sem campo Status */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter size={13} className="text-gray-500" />
              <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">Filtros e Atribuição de Profissional</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Profissional */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-500">Profissional</label>
                <div className="relative">
                  <select value={filtroVetId} onChange={e => setFiltroVetId(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-xl pl-3 pr-7 py-2 bg-gray-50 text-gray-700 font-semibold outline-none cursor-pointer appearance-none">
                    <option value="">Todos</option>
                    {vets.map(v => <option key={v.userId} value={v.userId}>{v.fullName}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
              {/* Tipo */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-500">Tipo de Atendimento</label>
                <div className="relative">
                  <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-xl pl-3 pr-7 py-2 bg-gray-50 text-gray-700 font-semibold outline-none cursor-pointer appearance-none">
                    <option value="">Todas as categorias</option>
                    {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          {/* Profissionais de Plantão — Especialidade na 1ª coluna */}
          <div className="bg-white rounded-2xl border border-gray-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Stethoscope size={14} className="text-gray-500" />
                <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">
                  Expediente Ativo · {labelDia(selectedDate)}
                </p>
              </div>
              <span className="text-[10px] font-bold text-gray-400">{vetsFiltrados.length} profissional(is)</span>
            </div>

            {vetsFiltrados.length === 0 ? (
              <div className="py-10 text-center">
                <Users size={28} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-400">Nenhum profissional na equipe</p>
              </div>
            ) : (
              <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto max-h-[280px] overflow-y-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      <th className="py-2.5 px-4">Especialidade</th>
                      <th className="py-2.5 px-4">Profissional</th>
                      <th className="py-2.5 px-4">Período</th>
                      <th className="py-2.5 px-4">Dias</th>
                      <th className="py-2.5 px-4">Horários Disponíveis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {vetsFiltrados.map(vet => {
                      const livres = slotsLivres(vet.userId);
                      const isOpen = openSlotVetId === vet.userId;
                      return (
                        <tr key={vet.userId} className="hover:bg-gray-50/50 transition-colors">
                          {/* Especialidade */}
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1">
                              {vet.especialidades.map(esp => (
                                <span key={esp} className="text-[10px] font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full whitespace-nowrap">
                                  {esp}
                                </span>
                              ))}
                            </div>
                          </td>
                          {/* Profissional */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 uppercase flex-shrink-0">
                                {vet.fullName.slice(0, 2)}
                              </div>
                              <div>
                                <p className="text-xs font-bold text-gray-900">{vet.fullName}</p>
                                <p className="text-[10px] text-gray-400">{vet.cargo}</p>
                              </div>
                            </div>
                          </td>
                          {/* Período */}
                          <td className="py-3 px-4">
                            <span className="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap">
                              <Clock size={11} className="text-gray-400" /> {labelPeriodoVet(vet.userId)}
                            </span>
                          </td>
                          {/* Dias */}
                          <td className="py-3 px-4 text-xs text-gray-600 whitespace-nowrap">{labelDiasVet(vet.userId)}</td>
                          {/* Horários */}
                          <td className="py-3 px-4">
                            {podeGerenciar ? (
                              <div
                                className="inline-block"
                                onMouseEnter={e => livres.length > 0 && openSlotMenu(vet.userId, e.currentTarget)}
                                onMouseLeave={scheduleCloseSlot}
                              >
                                <button
                                  disabled={livres.length === 0}
                                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all border ${
                                    livres.length > 0
                                      ? 'bg-green-50 hover:bg-green-100 text-green-700 border-green-200'
                                      : 'bg-red-50 text-red-500 border-red-200 cursor-not-allowed'
                                  }`}
                                >
                                  {livres.length} {livres.length === 1 ? 'Livre' : 'Livres'}
                                  {livres.length > 0 && (isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                                </button>
                                {isOpen && livres.length > 0 && slotPos && (
                                  <div
                                    style={{ position: 'fixed', top: slotPos.top, left: slotPos.left, transform: 'translateY(calc(-100% - 6px))', zIndex: 9999 }}
                                    onMouseEnter={cancelCloseSlot}
                                    onMouseLeave={scheduleCloseSlot}
                                    className="bg-white border border-gray-200 rounded-2xl shadow-xl p-2.5 min-w-[200px]"
                                  >
                                    <p className="text-[9px] font-bold text-gray-400 uppercase px-1 pb-1.5">Clique para agendar</p>
                                    <div className="grid grid-cols-3 gap-1">
                                      {livres.map(hora => (
                                        <button key={hora} onClick={() => handleSlotClick(vet.userId, vet.fullName, hora)}
                                          className="px-2 py-1.5 text-[11px] font-bold bg-green-50 hover:bg-green-100 text-green-700 rounded-xl transition-colors border border-green-200">
                                          {hora}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-500">{livres.length} livres</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-gray-50 max-h-[340px] overflow-y-auto">
                {vetsFiltrados.map(vet => {
                  const livres = slotsLivres(vet.userId);
                  const isOpen = openSlotVetId === vet.userId;
                  return (
                    <div key={vet.userId} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 uppercase flex-shrink-0">
                            {vet.fullName.slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-900 truncate">{vet.fullName}</p>
                            <p className="text-[10px] text-gray-400 truncate">{vet.cargo} - {vet.especialidades.join(', ')}</p>
                          </div>
                        </div>
                        {/* Qtd de horários livres — toque abre a janela com os horários */}
                        {podeGerenciar ? (
                          <div
                            className="inline-block flex-shrink-0"
                            onMouseEnter={e => livres.length > 0 && openSlotMenu(vet.userId, e.currentTarget)}
                            onMouseLeave={scheduleCloseSlot}
                          >
                            <button
                              disabled={livres.length === 0}
                              onClick={e => {
                                if (livres.length === 0) return;
                                if (isOpen) { setOpenSlotVetId(null); setSlotPos(null); }
                                else openSlotMenu(vet.userId, e.currentTarget);
                              }}
                              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all border ${
                                livres.length > 0
                                  ? 'bg-green-50 hover:bg-green-100 text-green-700 border-green-200'
                                  : 'bg-red-50 text-red-500 border-red-200 cursor-not-allowed'
                              }`}
                            >
                              {livres.length} {livres.length === 1 ? 'Livre' : 'Livres'}
                              {livres.length > 0 && (isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                            </button>
                            {isOpen && livres.length > 0 && slotPos && (
                              <div
                                style={{ position: 'fixed', top: slotPos.top, left: 16, right: 16, transform: 'translateY(calc(-100% - 6px))', zIndex: 9999 }}
                                onMouseEnter={cancelCloseSlot}
                                onMouseLeave={scheduleCloseSlot}
                                className="bg-white border border-gray-200 rounded-2xl shadow-xl p-2.5"
                              >
                                <p className="text-[9px] font-bold text-gray-400 uppercase px-1 pb-1.5">Toque para agendar</p>
                                <div className="grid grid-cols-4 gap-1">
                                  {livres.map(hora => (
                                    <button key={hora} onClick={() => handleSlotClick(vet.userId, vet.fullName, hora)}
                                      className="px-2 py-1.5 text-[11px] font-bold bg-green-50 hover:bg-green-100 text-green-700 rounded-xl transition-colors border border-green-200">
                                      {hora}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500 flex-shrink-0">{livres.length} livres</span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 flex items-center gap-1">
                        <Clock size={11} className="text-gray-400" /> {labelPeriodoVet(vet.userId)} · {labelDiasVet(vet.userId)}
                      </p>
                    </div>
                  );
                })}
              </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Lista de Agendamentos ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-gray-500" />
            <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">
              Agendamentos do Dia · {labelDia(selectedDate)}
            </p>
            {loading && <Loader2 size={13} className="text-emerald-600 animate-spin" />}
          </div>
          <div className="flex items-center gap-2">
            {podeAgendarParaOutro && vets.length > 1 && (
              <button
                onClick={() => { setTransferindoDia(true); setTransDeVetId(filtroVetId); setTransParaVetId(''); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-semibold transition-colors border border-blue-200 whitespace-nowrap"
              >
                <CalendarDays size={12} /> Transferir dia inteiro
              </button>
            )}
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-2 text-gray-400" />
              <input type="text" placeholder="Buscar..." value={busca} onChange={e => setBusca(e.target.value)}
                className="pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 w-44" />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 size={28} className="text-emerald-600 animate-spin" /></div>
        ) : listaFiltrada.length === 0 ? (
          <div className="py-12 text-center">
            <CalendarClock size={32} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-500">Nenhum agendamento para esta data</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {podeGerenciar ? 'Clique em um horário disponível acima.' : 'Selecione outra data no calendário.'}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-100">
              {listaFiltrada.map(ag => {
                // ATRASADA é uma variante de AGENDADO (ainda não ocorreu) — mesmas ações disponíveis.
                const isAgendado    = ag.status === 'AGENDADO' || ag.status === 'ATRASADA';
                const isConcluido   = ag.status === 'CONCLUIDO';
                const isCancelado   = ag.status === 'CANCELADO';
                const isEmAndamento = ag.status === 'EM_ANDAMENTO';
                const podeContinuar = isEmAndamento && podeGerenciar;
                return (
                  <div
                    key={ag.id}
                    onClick={podeContinuar ? () => handleIniciarAtendimento(ag) : undefined}
                    className={`p-4 flex flex-col gap-3 ${isCancelado ? 'opacity-60' : ''} ${podeContinuar ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${corTipo(ag.tipo)}`}>{labelTipo(ag.tipo)}</span>
                        {isCancelado ? (
                          <span className="relative group cursor-default">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">CANCELADO</span>
                            {ag.observacao && (
                              <span className="absolute bottom-full left-0 mb-1 px-2 py-1 bg-gray-800 text-white text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 max-w-[200px] truncate">
                                {ag.observacao}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COR[ag.status]}`}>{STATUS_LABEL[ag.status]}</span>
                        )}
                      </div>
                      <span className="text-xs font-bold font-mono text-gray-500">{formatarHora(ag.dataHora)}</span>
                    </div>
                    <div>
                      {ag.animal
                        ? <p className="font-bold text-sm text-gray-900">{ag.animal.nome}{ag.animal.especie && <span className="font-normal text-gray-500"> · {ag.animal.especie.nome}</span>}</p>
                        : <p className="font-bold text-sm text-gray-900">{labelTipo(ag.tipo)}</p>}
                      {ag.animal?.user && <p className="text-xs text-gray-400">Tutor: {ag.animal.user.fullName}</p>}
                      {ag.veterinario && <p className="text-xs text-gray-400">Vet: {ag.veterinario.fullName}</p>}
                      {ag.criadoPor && ag.criadoPor.id !== ag.veterinario?.id && (
                        <p className="text-xs text-gray-400">Agendado por: {ag.criadoPor.fullName}</p>
                      )}
                      {isCancelado && ag.observacao && (
                        <p className="text-xs text-red-500 mt-0.5 italic">Motivo: {ag.observacao}</p>
                      )}
                    </div>
                    {podeGerenciar && !isCancelado && (
                      <div className="flex items-center gap-2 flex-wrap border-t border-gray-100 pt-2">
                        {isAgendado && (
                          <button onClick={() => handleIniciarAtendimento(ag)} className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-semibold">
                            <Stethoscope size={11} /> Iniciar
                          </button>
                        )}
                        {isAgendado && (
                          <button onClick={() => { setReagendando(ag); setNovaDataHora(formatarDateInput(ag.dataHora)); }} className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-semibold">
                            <RefreshCw size={11} /> Reagendar
                          </button>
                        )}
                        {isAgendado && vets.length > 0 && podeAgendarParaOutro && (
                          <button onClick={() => { setTrocandoVetAg(ag); setTrocandoVetIdAg(ag.veterinario ? String(ag.veterinario.id) : ''); }} className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-semibold">
                            <UserCheck size={11} /> Trocar prof.
                          </button>
                        )}
                        {isAgendado && (
                          <button onClick={() => setCancelando(ag.id)} className="flex items-center gap-1 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl text-xs font-semibold">
                            <X size={11} /> Cancelar
                          </button>
                        )}
                      </div>
                    )}
                    {cancelando === ag.id && (
                      <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex flex-col gap-2">
                        <p className="text-xs font-semibold text-red-800">Motivo do cancelamento:</p>
                        <div className="relative">
                          <select onChange={e => e.target.value && handleStatus(ag.id, 'CANCELADO', e.target.value)} defaultValue=""
                            className="w-full text-xs border border-red-200 rounded-xl py-2 pl-3 pr-7 bg-white text-red-800 font-semibold outline-none cursor-pointer appearance-none">
                            <option value="" disabled>Selecione...</option>
                            {MOTIVOS_CANCELAMENTO.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                          <ChevronDown size={11} className="absolute right-2.5 top-2.5 text-red-400 pointer-events-none" />
                        </div>
                        <button onClick={() => setCancelando(null)} className="text-xs text-gray-500 self-end">Desistir</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    <th className="py-3 px-4">Horário</th>
                    <th className="py-3 px-4">Animal / Paciente</th>
                    <th className="py-3 px-4">Tipo</th>
                    <th className="py-3 px-4">Veterinário</th>
                    <th className="py-3 px-4">Status</th>
                    {podeGerenciar && <th className="py-3 px-4 text-center">Ações</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {listaFiltrada.map(ag => {
                    // ATRASADA é uma variante de AGENDADO (ainda não ocorreu) — mesmas ações disponíveis.
                const isAgendado    = ag.status === 'AGENDADO' || ag.status === 'ATRASADA';
                    const isConcluido   = ag.status === 'CONCLUIDO';
                    const isCancelado   = ag.status === 'CANCELADO';
                    const isEmAndamento = ag.status === 'EM_ANDAMENTO';
                    const podeContinuar = isEmAndamento && podeGerenciar;
                    return (
                      <tr
                        key={ag.id}
                        onClick={podeContinuar ? () => handleIniciarAtendimento(ag) : undefined}
                        className={`hover:bg-gray-50/50 transition-colors ${isCancelado ? 'opacity-60' : ''} ${podeContinuar ? 'cursor-pointer' : ''}`}
                      >
                        <td className="py-3.5 px-4">
                          <span className="flex items-center gap-1.5 font-bold font-mono text-emerald-700">
                            <Clock size={13} /> {formatarHora(ag.dataHora)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <p className="font-bold text-gray-900">{ag.animal?.nome ?? '—'}</p>
                          {ag.animal?.especie && <p className="text-xs text-gray-400">{ag.animal.especie.nome}</p>}
                          {ag.animal?.user && <p className="text-xs text-gray-400">Tutor: {ag.animal.user.fullName}</p>}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-block ${corTipo(ag.tipo)}`}>{labelTipo(ag.tipo)}</span>
                        </td>
                        <td className="py-3.5 px-4">
                          {ag.veterinario
                            ? <span className="flex items-center gap-1.5 text-xs text-gray-700"><UserIcon size={12} className="text-gray-400" />{ag.veterinario.fullName}</span>
                            : <span className="text-xs text-gray-400">Não atribuído</span>}
                          {ag.criadoPor && ag.criadoPor.id !== ag.veterinario?.id && (
                            <p className="text-[11px] text-gray-400 mt-0.5">Agendado por: {ag.criadoPor.fullName}</p>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {isCancelado ? (
                            <div className="relative group inline-block cursor-default">
                              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">CANCELADO</span>
                              {ag.observacao && (
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 bg-gray-800 text-white text-[10px] rounded-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 max-w-[220px] leading-snug">
                                  <span className="block font-semibold text-gray-300 mb-0.5">Motivo</span>
                                  {ag.observacao}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${STATUS_COR[ag.status]}`}>{STATUS_LABEL[ag.status]}</span>
                          )}
                        </td>
                        {podeGerenciar && (
                          <td className="py-3.5 px-4">
                            <div className="flex items-center justify-center gap-1.5">
                              {isAgendado && (
                                <button onClick={() => handleIniciarAtendimento(ag)} title="Iniciar atendimento"
                                  className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl transition-colors">
                                  <Stethoscope size={13} />
                                </button>
                              )}
                              {isAgendado && (
                                <button onClick={() => { setReagendando(ag); setNovaDataHora(formatarDateInput(ag.dataHora)); }} title="Reagendar"
                                  className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl transition-colors">
                                  <RefreshCw size={13} />
                                </button>
                              )}
                              {isAgendado && vets.length > 0 && podeAgendarParaOutro && (
                                <button onClick={() => { setTrocandoVetAg(ag); setTrocandoVetIdAg(ag.veterinario ? String(ag.veterinario.id) : ''); }} title="Trocar profissional"
                                  className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl transition-colors">
                                  <UserCheck size={13} />
                                </button>
                              )}
                              {isAgendado && (
                                <button onClick={() => setCancelando(ag.id)} title="Cancelar"
                                  className="p-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl transition-colors">
                                  <X size={13} />
                                </button>
                              )}
                            </div>
                            {cancelando === ag.id && (
                              <div className="mt-2 bg-red-50 border border-red-100 rounded-xl p-2 flex items-center gap-2">
                                <AlertTriangle size={11} className="text-red-500 flex-shrink-0" />
                                <div className="relative flex-1">
                                  <select onChange={e => e.target.value && handleStatus(ag.id, 'CANCELADO', e.target.value)} defaultValue=""
                                    className="w-full text-[10px] border border-red-200 rounded-lg py-1 pl-2 pr-5 bg-white text-red-800 font-semibold outline-none cursor-pointer appearance-none">
                                    <option value="" disabled>Motivo...</option>
                                    {MOTIVOS_CANCELAMENTO.map(m => <option key={m} value={m}>{m}</option>)}
                                  </select>
                                  <ChevronDown size={9} className="absolute right-1.5 top-2 text-red-400 pointer-events-none" />
                                </div>
                                <button onClick={() => setCancelando(null)}><X size={11} className="text-gray-400" /></button>
                              </div>
                            )}
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
      </div>

      {/* ── Modal: Confirmar Horário ──────────────────────────────────────────── */}
      {booking && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 px-6 pt-5 pb-6 relative">
              <button onClick={() => setBooking(null)}
                className="absolute top-4 right-4 p-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors">
                <X size={16} />
              </button>
              <p className="text-[10px] font-bold text-emerald-200 uppercase tracking-widest mb-1">Novo Agendamento Clínico</p>
              <h3 className="text-lg font-bold text-white mb-4">Confirmar Horário de Consulta</h3>
              <div className="bg-white/15 rounded-2xl px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold text-emerald-200">Médico Veterinário</p>
                  <p className="text-sm font-bold text-white">{booking.vetName}</p>
                  <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 bg-white/20 text-emerald-100 rounded-full">Clínica Geral</span>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] font-semibold text-emerald-200">Dia &amp; Hora</p>
                  <p className="text-2xl font-bold text-white">{booking.hora}</p>
                  <p className="text-[11px] text-emerald-200 mt-0.5">{formatarDataPT(selectedDate)}</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleConfirmarBooking} className="px-6 py-5 flex flex-col gap-5">
              {/* Animal */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 flex-shrink-0" />
                  <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">Identificação do Paciente</p>
                </div>
                <label className="text-xs font-bold text-gray-600 mb-1.5 block">Selecione o Animal <span className="text-red-500">*</span></label>
                <div ref={comboRef} className="relative">
                  <Search size={13} className="absolute left-3 top-3 text-gray-400 pointer-events-none z-10" />
                  <input type="text" placeholder="Buscar animal..." value={comboQuery} autoComplete="off"
                    onChange={e => {
                      setComboQuery(e.target.value); setComboOpen(true);
                      if (bookingForm.animalId) setBookingForm({ animalId: '', proprietarioNome: '', telefone: '', cpf: '' });
                    }}
                    onFocus={() => setComboOpen(true)}
                    className={`w-full pl-8 pr-9 py-2.5 text-sm border rounded-xl bg-gray-50 text-gray-800 font-semibold outline-none transition-all ${bookingForm.animalId ? 'border-emerald-400 ring-2 ring-emerald-500/20' : 'border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20'}`}
                  />
                  {bookingForm.animalId
                    ? <Check size={14} className="absolute right-3 top-3 text-emerald-600 pointer-events-none" />
                    : <ChevronDown size={13} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />}
                  {comboOpen && animaisCombo.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl z-20 max-h-48 overflow-y-auto">
                      {animaisCombo.slice(0, 40).map(a => (
                        <button key={a.id} type="button"
                          onMouseDown={e => {
                            e.preventDefault();
                            setComboQuery(a.nome + (a.especie?.nome ? ` (${a.especie.nome})` : ''));
                            setComboOpen(false);
                            setBookingForm({ animalId: String(a.id), proprietarioNome: a.user?.fullName ?? '', telefone: a.user?.phone ?? '', cpf: a.user?.cpf ?? '' });
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-b border-gray-50 last:border-0 ${String(a.id) === bookingForm.animalId ? 'bg-emerald-50 text-emerald-800' : 'hover:bg-gray-50 text-gray-800'}`}
                        >
                          <span className="font-semibold">{a.nome}</span>
                          {a.especie?.nome && <span className="text-xs text-gray-400 ml-1.5">({a.especie.nome})</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {comboOpen && comboQuery.length > 0 && animaisCombo.length === 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl z-20 px-4 py-3 text-sm text-gray-400 text-center">Nenhum animal encontrado</div>
                  )}
                </div>
              </div>

              {/* Proprietário */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                  <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">Informações do Proprietário</p>
                </div>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-xs font-bold text-gray-600 mb-1.5 block">Nome do Proprietário</label>
                    <div className="relative">
                      <UserIcon size={13} className="absolute left-3 top-2.5 text-gray-400" />
                      <input type="text" placeholder="Nome completo" value={bookingForm.proprietarioNome}
                        onChange={e => setBookingForm(f => ({ ...f, proprietarioNome: e.target.value }))}
                        className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-gray-600 mb-1.5 block">Telefone / WhatsApp</label>
                      <div className="relative">
                        <Phone size={13} className="absolute left-3 top-2.5 text-gray-400" />
                        <input type="text" placeholder="(00) 00000-0000" value={bookingForm.telefone}
                          onChange={e => setBookingForm(f => ({ ...f, telefone: e.target.value }))}
                          className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-gray-600 mb-1.5 block">CPF do Titular</label>
                      <input type="text" placeholder="000.000.000-00" value={bookingForm.cpf}
                        onChange={e => setBookingForm(f => ({ ...f, cpf: e.target.value }))}
                        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setBooking(null)}
                  className="px-5 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm font-semibold rounded-xl transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={salvando}
                  className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-colors">
                  {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Confirmar Agendamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Reagendar ─────────────────────────────────────────────────── */}
      {reagendando && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="bg-emerald-700 px-6 py-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-emerald-200 uppercase tracking-widest">Reagendar</p>
                <h3 className="text-lg font-bold text-white flex items-center gap-2"><RefreshCw size={16} /> Nova Data e Horário</h3>
              </div>
              <button onClick={() => setReagendando(null)} className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
              <p className="text-xs font-bold text-gray-400 uppercase mb-1">Agendamento atual</p>
              <p className="text-sm font-bold text-gray-900">{reagendando.titulo}</p>
              <p className="text-xs text-gray-500">{reagendando.animal?.nome} · {formatarDataHora(reagendando.dataHora)}</p>
            </div>
            <form onSubmit={handleReagendar} className="p-6 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-700">Nova Data e Hora <span className="text-red-500">*</span></label>
                <input type="datetime-local" value={novaDataHora} onChange={e => setNovaDataHora(e.target.value)}
                  className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50 text-gray-800 font-semibold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                {expedienteReagendando && (expedienteReagendando.diasTrab || expedienteReagendando.horaIni) && (
                  <p className="text-[11px] text-gray-400">
                    Expediente de {expedienteReagendando.fullName}:{' '}
                    {expedienteReagendando.diasTrab && expedienteReagendando.diasTrab.length > 0
                      ? expedienteReagendando.diasTrab.map(d => ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d]).join(', ')
                      : 'todos os dias'}
                    {expedienteReagendando.horaIni && expedienteReagendando.horaFim
                      ? ` · ${expedienteReagendando.horaIni}–${expedienteReagendando.horaFim}`
                      : ''}
                  </p>
                )}
                {novaDataHora && foraDoExpediente(novaDataHora, expedienteReagendando) && (
                  <p className="text-[11px] text-red-500 font-medium">{foraDoExpediente(novaDataHora, expedienteReagendando)}</p>
                )}
              </div>
              <div className="bg-emerald-50 rounded-xl p-3 text-xs text-emerald-700">O horário anterior será liberado e um novo agendamento será criado.</div>
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setReagendando(null)}
                  className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm font-semibold rounded-xl transition-colors">Fechar</button>
                <button type="submit" disabled={salvandoReag || !!(novaDataHora && foraDoExpediente(novaDataHora, expedienteReagendando))}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-colors">
                  {salvandoReag ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal Voz / IA ────────────────────────────────────────────────────── */}
      {vozAberto && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-emerald-100 uppercase tracking-widest">Agendamento com IA</p>
                <h3 className="text-lg font-bold text-white flex items-center gap-2"><Sparkles size={16} /> Assistente de Agenda</h3>
              </div>
              <button onClick={resetVoz} className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"><X size={18} /></button>
            </div>

            {vozContexto && (
              <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2 text-xs text-emerald-700">
                <Clock size={13} />
                <span className="font-semibold">{vozContexto.hora}</span> com <span className="font-semibold">{vozContexto.vetName}</span>
                <span className="text-emerald-500 ml-1">· {selectedDate}</span>
              </div>
            )}

            <div className="p-6">
              {vozEtapa === 'IDLE' && (
                <div className="flex flex-col items-center gap-5">
                  <p className="text-sm text-gray-600 text-center">
                    Diga o nome do animal, data e horário desejado.<br />
                    <span className="text-xs text-gray-400">Ex: "Quero agendar o Trovão para sexta às 10h"</span>
                  </p>
                  <button onClick={iniciarGravacao}
                    className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 flex items-center justify-center shadow-lg transition-all">
                    <Mic size={32} className="text-white" />
                  </button>
                  <p className="text-xs text-gray-400">Clique para falar</p>
                  <div className="w-full border-t border-gray-100 pt-4">
                    <p className="text-xs font-semibold text-gray-500 mb-2">Ou digite sua solicitação:</p>
                    <textarea rows={2} value={vozTextoManual} onChange={e => setVozTextoManual(e.target.value)}
                      placeholder="Ex: Quero agendar o Trovão para amanhã às 14h com Dr. Carlos"
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50 text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none" />
                    <button onClick={() => processarVoz(vozTextoManual)} disabled={!vozTextoManual.trim()}
                      className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-colors">
                      <Wand2 size={15} /> Interpretar com IA
                    </button>
                  </div>
                </div>
              )}

              {vozEtapa === 'GRAVANDO' && (
                <div className="flex flex-col items-center gap-5">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-red-500 flex items-center justify-center shadow-lg animate-pulse"><MicOff size={32} className="text-white" /></div>
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-400 animate-ping" />
                  </div>
                  <p className="text-sm font-bold text-red-600">Gravando...</p>
                  {vozTranscricao && <p className="text-xs text-gray-500 text-center bg-gray-50 rounded-xl px-4 py-3 max-h-24 overflow-y-auto">{vozTranscricao}</p>}
                  <button onClick={pararGravacao}
                    className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition-colors">
                    <MicOff size={15} /> Parar e Interpretar
                  </button>
                </div>
              )}

              {vozEtapa === 'PROCESSANDO' && (
                <div className="flex flex-col items-center gap-5 py-4">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                    <Loader2 size={28} className="text-emerald-600 animate-spin" />
                  </div>
                  <p className="text-sm text-gray-600">A IA está analisando sua solicitação...</p>
                  {vozTranscricao && <p className="text-xs text-gray-400 text-center italic">"{vozTranscricao}"</p>}
                </div>
              )}

              {vozEtapa === 'DISPONIVEL' && vozResultado && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 text-emerald-700 font-bold">
                    <CheckCircle2 size={18} className="text-emerald-600" /> Horário disponível!
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col gap-2">
                    {vozResultado.animal && <div className="flex justify-between text-sm"><span className="text-gray-500">Animal</span><span className="font-bold text-gray-800">{vozResultado.animal.nome}</span></div>}
                    {vozResultado.vet    && <div className="flex justify-between text-sm"><span className="text-gray-500">Profissional</span><span className="font-bold text-gray-800">{vozResultado.vet.fullName}</span></div>}
                    {vozResultado.data   && <div className="flex justify-between text-sm"><span className="text-gray-500">Data</span><span className="font-bold text-gray-800">{vozResultado.data}</span></div>}
                    {vozResultado.hora   && <div className="flex justify-between text-sm"><span className="text-gray-500">Horário</span><span className="font-bold text-gray-800">{vozResultado.hora}</span></div>}
                  </div>
                  {vozResultado.resumo && <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2 italic">"{vozResultado.resumo}"</p>}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setVozEtapa('IDLE')}
                      className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm font-semibold rounded-xl transition-colors">Regravar</button>
                    <button onClick={confirmarVoz} disabled={salvando}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-colors">
                      {salvando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Confirmar
                    </button>
                  </div>
                </div>
              )}

              {vozEtapa === 'INDISPONIVEL' && vozResultado && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 text-amber-700 font-bold">
                    <AlertCircle size={18} className="text-amber-500" />
                    {vozResultado.animalNomeNaoEncontrado
                      ? `Paciente não é da equipe ${nomeEquipe}`
                      : vozResultado.vetNomeNaoEncontrado
                        ? `Especialista não faz parte da equipe ${nomeEquipe}`
                        : 'Horário ocupado'
                    }
                  </div>
                  {vozResultado.conflito && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
                      <p className="font-semibold leading-snug">
                        {vozResultado.conflito.animalNome ?? vozResultado.animal?.nome ?? 'O animal'} já tem um agendamento para {dataRelativa(vozResultado.data ?? selectedDate)} às {vozResultado.conflito.hora} com {vozResultado.vet?.fullName ?? 'este profissional'}.
                      </p>
                    </div>
                  )}
                  {!vozResultado.conflito && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-sm text-amber-800">
                      {vozResultado.animalNomeNaoEncontrado ? (
                        <p>
                          <span className="font-bold">{vozResultado.animalNomeNaoEncontrado}</span> não está sendo atendido pela equipe <span className="font-bold">{nomeEquipe}</span>. Adicione-o no cadastro de pacientes.
                        </p>
                      ) : vozResultado.vetNomeNaoEncontrado ? (
                        <p>
                          O especialista <span className="font-bold">{vozResultado.vetNomeNaoEncontrado}</span> não faz parte da equipe <span className="font-bold">{nomeEquipe}</span>. Se necessário, adicione-o em cadastro.
                        </p>
                      ) : (
                        <p>{vozResultado.mensagem ?? 'Horário indisponível.'}</p>
                      )}
                    </div>
                  )}
                  {/* Modal interno de confirmação de segundo slot */}
                  {vozSlotConflito && (
                    <div className="bg-white border-2 border-amber-300 rounded-2xl p-4 flex flex-col gap-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-gray-700">
                          <span className="font-bold">{vozSlotConflito.animalNome}</span> já tem um agendamento nesse dia às <span className="font-bold">{vozSlotConflito.existingHora}</span> com <span className="font-bold">{vozSlotConflito.vetNome}</span>. Deseja criar outro agendamento às <span className="font-bold">{vozSlotConflito.novaHora}</span>?
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setVozSlotConflito(null)}
                          className="flex-1 py-2 border border-gray-200 hover:bg-gray-50 text-gray-600 text-xs font-semibold rounded-xl transition-colors">
                          Não, voltar
                        </button>
                        <button
                          onClick={() => {
                            setVozResultado(r => r ? { ...r, hora: vozSlotConflito.novaHora, disponivel: true, dataHora: vozSlotConflito.novaDataHora } : r);
                            setVozSlotConflito(null);
                            setVozEtapa('DISPONIVEL');
                          }}
                          className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors">
                          Sim, agendar às {vozSlotConflito.novaHora}
                        </button>
                      </div>
                    </div>
                  )}
                  {!vozSlotConflito && vozResultado.horariosLivres && vozResultado.horariosLivres.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-gray-500 mb-2">Escolha outro horário com o mesmo profissional:</p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {vozResultado.horariosLivres.map(h => (
                          <button key={h}
                            onClick={() => {
                              if (vozResultado.conflito) {
                                // Animal já tem outro agendamento com esse vet no dia — pede confirmação
                                setVozSlotConflito({
                                  existingHora: vozResultado.conflito!.hora,
                                  vetNome:      vozResultado.vet?.fullName ?? 'este profissional',
                                  animalNome:   vozResultado.conflito?.animalNome ?? vozResultado.animal?.nome ?? 'o animal',
                                  novaHora:     h,
                                  novaDataHora: `${vozResultado.data ?? selectedDate}T${h}:00`,
                                });
                              } else {
                                setVozResultado(r => r ? { ...r, hora: h, disponivel: true, dataHora: `${vozResultado.data ?? selectedDate}T${h}:00` } : r);
                                setVozEtapa('DISPONIVEL');
                              }
                            }}
                            className="py-1.5 text-[11px] font-bold bg-green-50 hover:bg-green-100 text-green-700 rounded-xl border border-green-200 transition-colors">
                            {h}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setVozEtapa('IDLE')}
                      className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm font-semibold rounded-xl transition-colors">Tentar novamente</button>
                    <button onClick={() => { const ctx = vozContexto; resetVoz(); if (ctx) { setBooking({ ...ctx }); setBookingForm({ animalId: '', proprietarioNome: '', telefone: '', cpf: '' }); setComboQuery(''); setComboOpen(false); } }}
                      className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-800 text-white text-sm font-bold rounded-xl transition-colors">Agendar Manual</button>
                  </div>
                </div>
              )}

              {vozEtapa === 'ERRO' && (
                <div className="flex flex-col items-center gap-4 py-2">
                  <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                    <AlertCircle size={26} className="text-red-500" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-red-700">Não foi possível interpretar</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {typeof window !== 'undefined' && !((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
                        ? 'Seu navegador não suporta gravação de voz. Use o campo de texto.'
                        : 'Tente novamente ou use o formulário manual.'}
                    </p>
                  </div>
                  <div className="flex gap-2 w-full">
                    <button onClick={() => setVozEtapa('IDLE')}
                      className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm font-semibold rounded-xl transition-colors">Tentar novamente</button>
                    <button onClick={() => { const ctx = vozContexto; resetVoz(); if (ctx) setEscolhaTipo(ctx); }}
                      className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-800 text-white text-sm font-bold rounded-xl transition-colors">Voltar</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Ciência de agendamento existente ──────────────────────────── */}
      {conflitoConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 bg-amber-50 border-b border-amber-100">
              <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
              <h3 className="font-bold text-amber-800">Agendamento já existente</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                <span className="font-bold">{conflitoConfirm.animalNome}</span> já tem um agendamento {conflitoConfirm.quando} às{' '}
                <span className="font-bold">{conflitoConfirm.hora}</span> com{' '}
                <span className="font-bold">{conflitoConfirm.vetNome}</span>.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => { const onCancel = conflitoConfirm.onCancel; setConflitoConfirm(null); onCancel?.(); }}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={() => { const acao = conflitoConfirm.onConfirm; setConflitoConfirm(null); acao(); }}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5">
                <Check size={14} />
                Agendar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Trocar profissional (agendamento individual) ─────────────── */}
      {trocandoVetAg && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm border border-gray-100">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <UserCheck size={16} className="text-blue-600" />
                <h3 className="font-bold text-gray-900">Trocar profissional</h3>
              </div>
              <button onClick={() => setTrocandoVetAg(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">ANIMAL</label>
                <p className="text-sm font-semibold text-gray-800">{trocandoVetAg.animal?.nome ?? '—'}</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">HORÁRIO</label>
                <p className="text-sm text-gray-700">{formatarHora(trocandoVetAg.dataHora)} · {trocandoVetAg.titulo}</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">PROFISSIONAL ATUAL</label>
                <p className="text-sm text-gray-700">{trocandoVetAg.veterinario?.fullName ?? 'Não atribuído'}</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">NOVO PROFISSIONAL *</label>
                <div className="relative">
                  <select value={trocandoVetIdAg} onChange={e => setTrocandoVetIdAg(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 appearance-none">
                    <option value="">Selecione...</option>
                    {vets.map(v => <option key={v.userId} value={v.userId}>{v.fullName}</option>)}
                  </select>
                  <ChevronDown size={12} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setTrocandoVetAg(null)}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleTrocarVetAg} disabled={savingTrocaAg || !trocandoVetIdAg}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5">
                {savingTrocaAg && <Loader2 size={13} className="animate-spin" />}
                Transferir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Transferir toda a agenda do dia ───────────────────────────── */}
      {transferindoDia && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm border border-gray-100">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <CalendarDays size={16} className="text-blue-600" />
                <h3 className="font-bold text-gray-900">Transferir agenda do dia</h3>
              </div>
              <button onClick={() => setTransferindoDia(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-gray-500">
                Transfere todos os agendamentos <span className="font-semibold text-amber-700">AGENDADO</span> do dia <span className="font-semibold">{labelDia(selectedDate)}</span> de um profissional para outro.
              </p>
              <div>
                <label className="block text-xs text-gray-500 mb-1">DE (profissional atual) *</label>
                <div className="relative">
                  <select value={transDeVetId} onChange={e => setTransDeVetId(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 appearance-none">
                    <option value="">Selecione...</option>
                    {vets.map(v => <option key={v.userId} value={v.userId}>{v.fullName}</option>)}
                  </select>
                  <ChevronDown size={12} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">PARA (novo profissional) *</label>
                <div className="relative">
                  <select value={transParaVetId} onChange={e => setTransParaVetId(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 appearance-none">
                    <option value="">Selecione...</option>
                    {vets.filter(v => String(v.userId) !== transDeVetId).map(v => (
                      <option key={v.userId} value={v.userId}>{v.fullName}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setTransferindoDia(false)}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleTransferirDia} disabled={savingTransf || !transDeVetId || !transParaVetId}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5">
                {savingTransf && <Loader2 size={13} className="animate-spin" />}
                Transferir tudo
              </button>
            </div>
          </div>
        </div>
      )}

    </PageContainer>
  );
}

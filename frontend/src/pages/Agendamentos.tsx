// src/pages/Agendamentos.tsx
import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useEmpresa } from '../contexts/EmpresaContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { isSubespecialidadeValida } from '../utils/subespecialidades';
import { agendamentoAntecipado, dataHoraNoPassado } from '../utils/dateUtils';
import {
  CalendarClock, ChevronLeft, ChevronRight, Check,
  X, Clock, User as UserIcon, RefreshCw, Search,
  ChevronDown, ChevronUp, AlertTriangle, Loader2, Calendar,
  Phone, Stethoscope, Filter, Users, Mic, MicOff, Wand2, Sparkles,
  CheckCircle2, AlertCircle, UserCheck, CalendarDays, MapPin, Ban,
} from 'lucide-react';
import InlineError from '../components/InlineError';
import ModalJustificativa from '../components/ModalJustificativa';

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoAgendamento   = 'CONSULTA' | 'VACINA' | 'RETORNO' | 'EXAME' | 'PROCEDIMENTO';
// REAGENDADO: o horário some da grade e a observação guarda para quando o atendimento
// foi movido (diferente de CANCELADO, que é desistência).
// TRANSFERIDO é o nome ANTIGO do mesmo estado — mantido só para os registros já
// gravados; nada novo nasce com ele.
// CANCELADO_AUTOMATICAMENTE: mesmo efeito de CANCELADO (libera a grade), mas é o
// SISTEMA que desiste — gravado só pela rotina noturna de fechamento do dia, nunca por
// um clique humano (o backend recusa). Ver AgendamentoController#STATUS_SOMENTE_SISTEMA.
type StatusAgendamento = 'AGENDADO' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'FINALIZADO' | 'CANCELADO' | 'CANCELADO_AUTOMATICAMENTE' | 'ATRASADA' | 'REAGENDADO' | 'TRANSFERIDO';
type DiaStatus         = 'LIVRE' | 'PARCIAL' | 'OCUPADO';
/**
 * Recorte da lista do dia:
 *  'ABERTOS' (padrão) → AGENDADO + EM_ANDAMENTO + ATRASADA
 *  'TODOS'            → tudo
 *  StatusAgendamento  → um status específico (concluído, cancelado, reagendado…)
 */
type FiltroStatus      = 'ABERTOS' | 'TODOS' | StatusAgendamento;
type ViewMode          = 'MES' | 'SEMANA';

interface AgendamentoGlobal {
  id:          number;
  numero:      number | null;
  tipo:        TipoAgendamento;
  titulo:      string;
  dataHora:    string;
  observacao:  string | null;
  status:      StatusAgendamento;
  /** Minutos que o atendimento ocupa. null = agendamento antigo (tratado como 60). */
  duracaoMin:  number | null;
  especialidade: { id: number; nome: string } | null;
  veterinario: { id: number; fullName: string } | null;
  criadoPor:   { id: number; fullName: string } | null;
  animal: {
    id:      number;
    nome:    string;
    especie: { nome: string } | null;
    // ONDE o animal está — do catálogo (`localizacao`) ou do campo textual legado
    local:       string | null;
    localizacao: { id: number; nome: string } | null;
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
  localizacaoNome: string | null;
}

/**
 * Onde o animal está. A agenda mostra o LOCAL no lugar da espécie: quem vai atender
 * precisa saber para onde ir, e "Equino" não diz nada numa clínica de equinos.
 * Catálogo (`localizacao.nome`) → campo textual legado (`local`) → null.
 */
function localDoAnimal(
  a: { local?: string | null; localizacao?: { nome: string } | null } | null | undefined,
): string | null {
  return a?.localizacao?.nome?.trim() || a?.local?.trim() || null;
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

/** Especialidade do catálogo com o tempo de consulta que o profissional pratica. */
interface EspecialidadeVet {
  id:       number;
  nome:     string;
  tempoMin: number;
}

interface VetMembro {
  userId:        number;
  fullName:      string;
  cargo:         string;
  especialidades: string[];
  /** Do catálogo, com tempo por especialidade (card "Locais de trabalho").
   *  Vazio = profissional sem tempo configurado → grade de 1h (comportamento antigo). */
  especialidadesCat: EspecialidadeVet[];
  // Expediente próprio do profissional (null = herda o da empresa)
  diasTrab:   number[] | null;
  horaIni:    string | null;
  horaFim:    string | null;
  // Locais onde o profissional atende. Cada local tem dias, horário e as
  // especialidades (com tempo) exercidas ALI — é a base de uma linha da tabela.
  locais: LocalAtendimento[];
}

interface LocalAtendimento {
  localizacaoId:  number;
  localizacaoNome: string;
  dias:    number[] | null;
  horaIni: string | null;
  horaFim: string | null;
  especialidades: EspecialidadeVet[];
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

// Espelha STATUS_LIVRES do AgendamentoController: não ocupam mais a grade.
const STATUS_LIVRES: StatusAgendamento[] = ['CANCELADO', 'CANCELADO_AUTOMATICAMENTE', 'REAGENDADO', 'TRANSFERIDO'];
// "Foi remarcado" cobre o nome NOVO e o LEGADO. Importa para a observação: no
// reagendamento ela diz "Reagendado para dd/mm às HH:MM"; no cancelamento é o motivo.
const foiReagendado = (s: StatusAgendamento) => s === 'REAGENDADO' || s === 'TRANSFERIDO';
// Padrão da lista do dia: só o atendimento que ainda vai acontecer.
// ⚠️ ATRASADA ENTRA aqui, e não é exceção arbitrária: para esta tela ela É um agendado
// — `isAgendado` (nas duas listagens) vale para AGENDADO **e** ATRASADA, e é ele que
// libera Iniciar, Reagendar, Transferir e Cancelar. Escondê-la sumia com a linha
// INTEIRA e com todos esses botões, justamente no atendimento que passou da hora e é o
// que mais precisa de ação. Só a chegada do cron mudaria o status e o registro
// desapareceria da agenda sem ninguém ter feito nada.
const STATUS_ABERTOS: StatusAgendamento[] = ['AGENDADO', 'EM_ANDAMENTO', 'ATRASADA'];

// Opções do seletor além de "Em aberto" e "Todos": os status que JÁ SAÍRAM da agenda
// operacional e só são consultados quando alguém procura por eles.
// TRANSFERIDO não entra na lista — é o nome legado de REAGENDADO, e a opção
// "Reagendado" já casa com os dois (ver `statusCasaFiltro`).
const STATUS_FILTRAVEIS: StatusAgendamento[] = ['CONCLUIDO', 'FINALIZADO', 'CANCELADO', 'CANCELADO_AUTOMATICAMENTE', 'REAGENDADO'];

/** O agendamento entra na lista com o filtro escolhido? */
function statusCasaFiltro(status: StatusAgendamento, filtro: FiltroStatus): boolean {
  if (filtro === 'TODOS')   return true;
  if (filtro === 'ABERTOS') return STATUS_ABERTOS.includes(status);
  // "Reagendado" precisa trazer também o legado TRANSFERIDO: é o MESMO estado, e quem
  // filtra por ele espera ver os dois — senão os registros antigos ficam inalcançáveis.
  if (filtro === 'REAGENDADO') return foiReagendado(status);
  return status === filtro;
}

const HORARIOS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

// Duração usada quando não há especialidade/tempo configurado — é a grade de 1h
// que a agenda sempre teve, então nada muda para quem não configurar tempos.
const PASSO_PADRAO_MIN = 60;

const hhmmParaMin = (h: string): number => {
  const [hh, mm] = h.split(':').map(Number);
  return (hh || 0) * 60 + (mm || 0);
};
const minParaHHMM = (m: number): string =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Slots do dia de `passo` em `passo` minutos dentro da faixa do expediente.
 * O atendimento INTEIRO precisa caber (m + passo <= fim) — oferecer um horário que
 * termina depois do expediente só levaria a um 409 do backend na hora de salvar.
 */
function gerarSlots(horaIni: string | null, horaFim: string | null, passoMin: number): string[] {
  const passo = passoMin > 0 ? passoMin : PASSO_PADRAO_MIN;
  const ini   = horaIni ? hhmmParaMin(horaIni) : 0;
  const fim   = horaFim ? hhmmParaMin(horaFim) : 24 * 60;
  const out: string[] = [];
  for (let m = ini; m + passo <= fim; m += passo) out.push(minParaHHMM(m));
  return out;
}

const MESES_PT      = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_PT       = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const DIAS_FULL_PT  = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

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
  // Tom mais claro que CANCELADO de propósito: mesma família (é um cancelamento), mas
  // visualmente distinguível de "a clínica desmarcou" — foi o SISTEMA que encerrou.
  CANCELADO_AUTOMATICAMENTE: 'bg-red-50 text-red-400',
  ATRASADA:     'bg-orange-100 text-orange-700',
  REAGENDADO:   'bg-violet-100 text-violet-700',
  TRANSFERIDO:  'bg-violet-100 text-violet-700',   // legado
};
const STATUS_LABEL: Record<StatusAgendamento, string> = {
  AGENDADO:     'AGENDADO',
  EM_ANDAMENTO: 'EM ANDAMENTO',
  CONCLUIDO:    'CONCLUÍDO',
  FINALIZADO:   'FINALIZADO',
  CANCELADO:    'CANCELADO',
  CANCELADO_AUTOMATICAMENTE: 'CANCELADO AUTOMATICAMENTE',
  ATRASADA:     'ATRASADA',
  REAGENDADO:   'REAGENDADO',
  TRANSFERIDO:  'REAGENDADO',   // legado: mesmo estado, nome antigo
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
  /** Data mínima selecionável (YYYY-MM-DD). Dias anteriores ficam desabilitados —
   *  usado no reagendamento, que não pode cair num dia que já passou. */
  minDate?:     string;
  /** Esconde o atalho "Ir para Hoje". No reagendamento ele não faz sentido: o alvo é
   *  uma data FUTURA, e o atalho só devolve o usuário ao dia em que ele já está. Também
   *  retirado do calendário principal de `/agendamentos` a pedido (2026-08-14). */
  semAtalhoHoje?: boolean;
}

function CalendarioInterativo({ selectedDate, onChange, statusPorDia, minDate, semAtalhoHoje = false }: CalendarioProps) {
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

  // Comparação lexicográfica funciona no formato YYYY-MM-DD
  const bloqueado = (dStr: string) => !!minDate && dStr < minDate;

  function dayBtn(dStr: string, isFaded = false) {
    const isSelected = dStr === selectedDate;
    const isToday    = dStr === dataHoje;
    const status     = statusPorDia.get(dStr) ?? null;
    return { dStr, isSelected, isToday, status, isFaded, isBloqueado: bloqueado(dStr) };
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
              const { isSelected, isToday, status, isBloqueado } = dayBtn(dStr, !isCur);
              const clicavel = isCur && !isBloqueado;
              return (
                <button
                  key={idx}
                  disabled={!clicavel}
                  title={isBloqueado ? 'Dia já passou' : undefined}
                  onClick={() => clicavel && onChange(dStr)}
                  className={[
                    'relative flex flex-col items-center justify-center h-9 rounded-xl text-xs font-semibold transition-all',
                    !isCur ? 'text-gray-200 cursor-default' : '',
                    isCur && isBloqueado ? 'text-gray-300 line-through cursor-not-allowed' : '',
                    clicavel ? 'cursor-pointer' : '',
                    isSelected && clicavel  ? 'bg-emerald-600 text-white shadow-sm' : '',
                    !isSelected && clicavel && isToday ? 'ring-2 ring-emerald-400 text-emerald-700' : '',
                    !isSelected && clicavel && !isToday ? 'text-gray-700 hover:bg-gray-100' : '',
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
              const { isSelected, isToday, status, isBloqueado } = dayBtn(dStr);
              return (
                <button
                  key={idx}
                  disabled={isBloqueado}
                  title={isBloqueado ? 'Dia já passou' : undefined}
                  onClick={() => !isBloqueado && onChange(dStr)}
                  className={[
                    'relative flex flex-col items-center justify-center h-12 rounded-xl text-xs font-semibold transition-all',
                    isBloqueado ? 'text-gray-300 line-through cursor-not-allowed' : 'cursor-pointer',
                    isSelected && !isBloqueado ? 'bg-emerald-600 text-white shadow-sm' : '',
                    !isSelected && !isBloqueado && isToday ? 'ring-2 ring-emerald-400 text-emerald-700' : '',
                    !isSelected && !isBloqueado && !isToday ? 'text-gray-700 hover:bg-gray-100' : '',
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

        {!semAtalhoHoje && (
          <button
            onClick={() => onChange(dataHoje)}
            className="mt-2 w-full text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 py-1.5 rounded-xl transition-colors"
          >
            Ir para Hoje
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────

interface AgendamentosProps {
  /**
   * Aba "Minha Agenda" do Atendimento (`/clinica/agenda`). É ESTA MESMA TELA: renderiza
   * só o card "Agendamentos do Dia" (sem cabeçalho de página, sem a barra
   * Animal↔Proprietário, sem o calendário grande fixo e sem o Expediente Ativo), com os
   * MESMOS layout, ações e modais — inclusive o reagendamento com calendário e grade.
   * O título "Agendamentos do Dia" vira botão nesse modo e abre um mini calendário
   * (mesmo `CalendarioInterativo`, em popover) para trocar de data sem precisar do
   * calendário grande, que só existe na tela cheia.
   *
   * ⚠️ Existe para NÃO duplicar a agenda em dois arquivos. A divergência entre as duas
   * telas foi a origem de uma série de "sumiu o botão X" — ver CLAUDE.md 28-g.
   * A única diferença de comportamento é o ESCOPO: o profissional vê apenas a agenda
   * dele; o gestor continua vendo a equipe, com o filtro por profissional.
   */
  modoMinhaAgenda?: boolean;
  /** Clique no nome do paciente (só faz sentido dentro do shell de Atendimento). */
  onSelecionarAnimal?: (animalId: number) => void;
}

// Wrappers do modo aba × modo página — em escopo de MÓDULO de propósito: precisam ser
// referências ESTÁVEIS entre renders (ver comentário onde `Wrapper` é escolhido).
function FragmentoWrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
function PageWrapper({ children }: { children: React.ReactNode }) {
  return <PageContainer maxWidth="7xl">{children}</PageContainer>;
}

export default function Agendamentos({ modoMinhaAgenda = false, onSelecionarAnimal }: AgendamentosProps = {}) {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const { user }                                    = useAuth();
  const { contextoAtivo }                           = useEmpresa();
  const meuUserId                                   = user?.id ?? null;
  // Agendar/operar a agenda de OUTRO profissional é decidido pelo CONTROLE DE ACESSO,
  // não pelo cargo: EQUIPE/FULL em `atendimento.agendamentos.criar` agenda para
  // qualquer um; PROPRIO só para si. Antes era `isGestor`, e o estagiário com "criar"
  // concedido não conseguia agendar nada — a grade só tem coluna de quem atende, então
  // toda coluna era "de outro". Mesma regra do backend (podeAgendarParaOutro).
  // REGRA BASAL: só o GESTOR agenda/opera na agenda de OUTRO profissional. Os demais
  // — com qualquer nível concedido no Controle de Acesso — só na própria coluna.
  // O Controle de Acesso decide SE a pessoa agenda; esta regra decide PARA QUEM.
  const podeAgendarParaOutro                        = isGestor;
  const location                                    = useLocation();
  const navigate                                    = useNavigate();
  const nomeEquipe                                  = contextoAtivo?.label ?? 'sua equipe';
  const podeCriarAgendamento                        = podeExecutar('atendimento.agendamentos.criar');
  const podeEditarAgendamento                       = podeExecutar('atendimento.agendamentos.editar');
  const podeDeletarAgendamento                      = podeExecutar('atendimento.agendamentos.deletar');
  const podeGerenciar                               = podeCriarAgendamento || podeEditarAgendamento || podeDeletarAgendamento;
  /**
   * AUTORIA na agenda (CLAUDE.md 28-c) — espelho de `podeOperarAgendamento` do backend.
   * O atendimento é de quem o conduz: iniciar, reagendar, concluir e cancelar valem
   * sobre a PRÓPRIA agenda (ou a que a pessoa criou). Para pegar o de outro existe o
   * botão ASSUMIR ao lado — e só depois disso as demais ações aparecem.
   * Agendamento sem profissional definido entra aqui: não é de ninguém, e travá-lo
   * deixaria a linha sem nenhuma ação possível fora do gestor.
   */
  const ehMinhaAgenda = (ag: AgendamentoGlobal) =>
    isGestor
    || !ag.veterinario?.id
    || ag.veterinario.id === meuUserId
    || ag.criadoPor?.id === meuUserId;

  /**
   * Ação da linha (iniciar / reagendar / transferir / assumir / cancelar).
   *
   * Gate = `podeGerenciar` (criar OU alterar OU excluir) + autoria. É o MESMO que já
   * governava Iniciar/Reagendar/Cancelar desde sempre; Assumir e Transferir é que
   * destoavam exigindo `alterar` isolado — por isso sumiam sozinhos.
   *
   * ⚠️ NÃO trocar por `podeEditarAgendamento`: foi tentado em 2026-08-04 e sumiu com
   * TODAS as ações da tela. As rotas de fato exigem `atendimento.agendamentos.editar`,
   * mas fechar o gate no front antes de a matriz estar coerente só deixa o usuário sem
   * saída — e sem mensagem. Quem barra é o backend, e o 403 agora chega com o texto
   * certo (o interceptor de `api.ts` preserva a mensagem), dizendo qual permissão falta.
   */
  const podeOperarLinha = (ag: AgendamentoGlobal) =>
    podeGerenciar && ehMinhaAgenda(ag);

  /**
   * INICIAR é mais estreito que as demais ações da linha: só aparece para quem
   * VAI EXECUTAR o atendimento — o profissional atribuído (ou, sem ninguém
   * atribuído, qualquer um com a ação liberada, já que aí não há de quem seria).
   * ⚠️ Diferente de `ehMinhaAgenda`, NÃO inclui o bypass do gestor nem do criador:
   * gestor que não é o executor e quem apenas AGENDOU para outro profissional não
   * são quem vai atender — o caminho deles é ASSUMIR primeiro (`podeAssumir`,
   * sempre disponível), e só depois disso Iniciar aparece.
   */
  const podeIniciarAtendimento = (ag: AgendamentoGlobal) =>
    podeGerenciar && (!ag.veterinario?.id || ag.veterinario.id === meuUserId);

  // Transferir o atendimento para OUTRO profissional é ação EXCLUSIVA DO GESTOR
  // (2026-08-04). Não é permissão da matriz e não se configura: passar o paciente para
  // a agenda de terceiro é decisão de quem coordena a equipe. Quem não é gestor tem o
  // ASSUMIR como caminho — puxa para si, em vez de empurrar para outro.
  const podeTransferir = (ag: AgendamentoGlobal) => isGestor && podeOperarLinha(ag);
  // Assumir (puxar para si) é o caminho de quem NÃO é gestor para pegar um
  // atendimento de outro — segue o Controle de Acesso, sem filtro de cargo.
  //
  // A janela inclui EM_ANDAMENTO, igual ao assumir da EVOLUÇÃO: antes o botão vivia
  // atrás de `isAgendado` (só AGENDADO/ATRASADA), então bastava o outro profissional
  // clicar em "Iniciar" para o atendimento ficar preso a ele — justamente o caso em que
  // assumir importa (o colega começou e precisou sair). O status entrou PARA DENTRO do
  // predicado para não haver duas regras: a listagem mobile e a desktop usam esta.
  // ⚠️ Agendamento SEM profissional entra: `!!ag.veterinario?.id` excluía o "Não
  // atribuído", que é justamente onde assumir faz mais sentido — não há de quem tomar,
  // a pessoa só passa a responder por ele. O backend já aceitava (`Number(null)` nunca
  // bate com o id de ninguém, então não cai no "já é seu").
  // A única exclusão é o que JÁ É MEU: para esse o caminho é editar/iniciar, não assumir.
  const STATUS_ASSUMIVEIS: StatusAgendamento[] = ['AGENDADO', 'ATRASADA', 'EM_ANDAMENTO'];
  const podeAssumir = (ag: AgendamentoGlobal) =>
    podeGerenciar
    && STATUS_ASSUMIVEIS.includes(ag.status)
    && ag.veterinario?.id !== meuUserId;

  // Erro de ação exibido inline (substitui o toast de erro)
  // Erro fica NA SUPERFÍCIE onde a ação foi disparada — no topo da página (colado no
  // botão Voltar) o usuário não vê o retorno do que acabou de clicar.
  // erroInline = carga da página; erroGrade = grade de horários/agendamento novo;
  // erroLista = ações da lista do dia; erroModal = o modal que estiver aberto.
  const [erroInline, setErroInline]             = useState<string | null>(null);
  const [erroGrade,  setErroGrade]              = useState<string | null>(null);
  const [erroLista,  setErroLista]              = useState<string | null>(null);
  const [erroModal,  setErroModal]              = useState<string | null>(null);

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
  // Filtro por especialidade: restringe os profissionais listados E fixa a
  // especialidade de cada um, para a grade sair no tempo daquela especialidade.
  const [filtroEspId, setFiltroEspId] = useState('');
  const [filtroLocalId, setFiltroLocalId] = useState('');
  const [filtroTurno, setFiltroTurno] = useState<'' | 'MANHA' | 'TARDE' | 'NOITE'>('');
  // Lista do dia: nasce mostrando só o que ainda vai acontecer (STATUS_ABERTOS).
  // "Todos os status" traz de volta cancelado, reagendado, concluído e finalizado.
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('ABERTOS');

  // Chave da linha com o menu de horários aberto. É por LINHA (vet+local+especialidade),
  // não por profissional: o mesmo vet aparece em várias linhas.
  const [openSlotKey, setOpenSlotKey] = useState<string | null>(null);

  // ── Calendar + agendamentos ─────────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const p = new URLSearchParams(location.search);
    return p.get('date') ?? hoje();
  });

  // Mini calendário do cabeçalho "Agendamentos do Dia" — só em `modoMinhaAgenda`
  // (a tela cheia já mostra o CalendarioInterativo fixo ao lado). `position: fixed`
  // porque o cabeçalho vive dentro de um container `overflow-hidden` (cantos
  // arredondados) que cortaria um popover absoluto.
  const [miniCalAberto, setMiniCalAberto] = useState(false);
  const [miniCalPos, setMiniCalPos] = useState<{ top: number; left: number } | null>(null);
  const miniCalBtnRef = useRef<HTMLButtonElement>(null);
  const miniCalPopRef = useRef<HTMLDivElement>(null);
  function toggleMiniCal() {
    if (miniCalAberto) { setMiniCalAberto(false); return; }
    const rect = miniCalBtnRef.current?.getBoundingClientRect();
    if (rect) setMiniCalPos({ top: rect.bottom + 6, left: rect.left });
    setMiniCalAberto(true);
  }
  useEffect(() => {
    if (!miniCalAberto) return;
    const fn = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (miniCalPopRef.current?.contains(alvo)) return;
      if (miniCalBtnRef.current?.contains(alvo)) return;
      setMiniCalAberto(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [miniCalAberto]);
  // Reposiciona se o popover estourar a borda direita da tela (mesma correção do
  // popover de horários — ver useLayoutEffect de `slotPopoverRef` acima).
  useLayoutEffect(() => {
    if (!miniCalAberto || !miniCalPopRef.current) return;
    const el = miniCalPopRef.current;
    const margem = 8;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - margem) {
      el.style.left = `${Math.max(margem, window.innerWidth - rect.width - margem)}px`;
    }
  }, [miniCalAberto]);

  // Seleção de animal NÃO é restrita por local/dia de trabalho do profissional — o
  // combo mostra todos os animais da empresa, e quem escolhe é o usuário.
  const animaisDisponiveis = animais;
  // Filtra pelo proprietário selecionado (barra superior)
  const animaisFiltradosBar = useMemo(
    () => selectedProprId ? animaisDisponiveis.filter(a => String(a.user?.id) === selectedProprId) : animaisDisponiveis,
    [animaisDisponiveis, selectedProprId],
  );
  const [agendamentos, setAgendamentos] = useState<AgendamentoGlobal[]>([]);
  const [loading, setLoading]           = useState(false);
  const [busca, setBusca]               = useState('');
  const [agendamentosMes, setAgendamentosMes] = useState<AgendamentoGlobal[]>([]);
  const [mesCarregado, setMesCarregado] = useState('');
  // Ocupação GLOBAL do profissional no dia (todas as empresas) — para descontar os
  // slots em que ele já está agendado em QUALQUER empresa. Guardado como INTERVALO
  // (início + duração): com tempo por especialidade, uma consulta de 60min ocupa
  // também os slots de 30min que caem dentro dela.
  const [ocupacaoGlobal, setOcupacaoGlobal] =
    useState<Map<number, Array<{ iniMin: number; fimMin: number }>>>(new Map());
  // Especialidade escolhida por profissional — define o passo da grade dele.
  const [espSelPorVet, setEspSelPorVet] = useState<Map<number, number>>(new Map());

  // ── Modais ──────────────────────────────────────────────────────────────────
  const [booking, setBooking]             = useState<BookingInfo | null>(null);
  const [comboQuery, setComboQuery]       = useState('');
  const [comboOpen, setComboOpen]         = useState(false);
  const comboRef                          = useRef<HTMLDivElement>(null);
  const [bookingForm, setBookingForm]     = useState<BookingForm>({ animalId: '', proprietarioNome: '', telefone: '', cpf: '' });
  const [salvando, setSalvando]           = useState(false);
  const [reagendando, setReagendando]     = useState<AgendamentoGlobal | null>(null);
  // Reagendamento: dia e horário escolhidos na MESMA agenda da tela principal
  // (calendário + grade de horários livres), em vez de um datetime-local solto.
  const [reagData, setReagData]           = useState('');   // YYYY-MM-DD
  const [reagHora, setReagHora]           = useState('');   // HH:MM
  const [reagOcupados, setReagOcupados]   = useState<Array<{ iniMin: number; fimMin: number }>>([]);
  const [reagLoading, setReagLoading]     = useState(false);
  const [salvandoReag, setSalvandoReag]   = useState(false);
  // Justificativa do usuário quando o reagendamento nasce da decisão de cancelamento
  // (vira parte do `motivo` do PATCH final) — null quando é o botão "Reagendar" direto,
  // que não passa por essa etapa e mantém só o texto informativo automático.
  const [reagMotivoUsuario, setReagMotivoUsuario] = useState<string | null>(null);
  // O modal do reagendamento ROLA (calendário + grade de horários). Só posicionar o
  // erro depois do botão não basta: ele nasce no fim do formulário, que pode estar
  // logo abaixo da dobra. Este ref traz o erro para a vista quando ele aparece.
  const erroReagRef                       = useRef<HTMLDivElement>(null);
  // Cancelamento — mesmo com o atendimento já EM_ANDAMENTO, cancelar precisa ser
  // possível. Antes da justificativa, uma escolha: cancelar em definitivo ou
  // remarcar a consulta. As duas exigem justificativa (`ModalJustificativa`) e vão
  // para a auditoria — remarcar leva direto para a tela de reagendamento, já com a
  // justificativa em mãos, em vez de fechar tudo e obrigar o usuário a clicar de novo.
  const [decisaoCancelamento, setDecisaoCancelamento]         = useState<AgendamentoGlobal | null>(null);
  const [justificandoCancelamento, setJustificandoCancelamento] =
    useState<{ ag: AgendamentoGlobal; tipo: 'DEFINITIVO' | 'REMARCAR' } | null>(null);
  const [salvandoCancelamento, setSalvandoCancelamento]       = useState(false);
  const [erroCancelamento, setErroCancelamento]               = useState<string | null>(null);
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

  const [, setEscolhaTipo]                    = useState<BookingInfo | null>(null);
  const [vozAberto, setVozAberto]             = useState(false);
  const [vozContexto, setVozContexto]         = useState<BookingInfo | null>(null);
  const [vozEtapa, setVozEtapa]               = useState<VozEtapa>('IDLE');
  // Motivo real do 'ERRO' — sem isso a tela sempre mostrava o mesmo texto genérico
  // ("Não foi possível interpretar"), fosse microfone bloqueado, silêncio, sem rede
  // com o serviço de reconhecimento, ou falha no backend/IA. `null` = usa o fallback.
  const [vozErroMsg, setVozErroMsg]           = useState<string | null>(null);
  const [vozTranscricao, setVozTranscricao]   = useState('');
  const [vozTextoManual, setVozTextoManual]   = useState('');
  const [vozResultado, setVozResultado]       = useState<InterpretacaoResultado | null>(null);
  const [vozSlotConflito, setVozSlotConflito] = useState<{
    existingHora: string; vetNome: string; animalNome: string; novaHora: string; novaDataHora: string;
  } | null>(null);
  const recognitionRef                        = useRef<any>(null);

  // ── Dropdown de slots ────────────────────────────────────────────────────────
  // Abre/fecha por CLIQUE, não por hover: o popover é `position: fixed` (pode ficar
  // longe, na tela, do botão que o abriu) e o caminho do mouse até ele passa por uma
  // zona "morta" entre os dois — com hover+timer isso soltava mouseleave/mouseenter
  // repetidos ao tentar alcançar um horário, e o navegador reage a essas trocas de
  // :hover ajustando o scroll da lista sozinho (oscilando pra cima e pra baixo).
  // Clique elimina a ambiguidade: só fecha por clique-fora ou clique de novo no botão.
  const [slotPos, setSlotPos]   = useState<{ top: number; left: number } | null>(null);
  // Duas refs, não uma: a tabela desktop (`hidden md:block`) e os cards mobile
  // (`md:hidden`) SEMPRE existem os dois no DOM ao mesmo tempo — só o CSS esconde um
  // dos dois por breakpoint. Com UMA ref só, a linha da versão escondida sobrescrevia
  // a da visível (mesma `linha.key`, ambas com `isOpen` true), e o clique-fora
  // considerava o clique no popover VISÍVEL como "fora" do popover (que a ref
  // apontava, errado, para a cópia escondida) — fechava antes do clique no horário
  // registrar.
  const slotWrapDesktopRef      = useRef<HTMLDivElement | null>(null);
  const slotWrapMobileRef       = useRef<HTMLDivElement | null>(null);
  // Popover do DESKTOP (a coluna "Horários Disponíveis" é a última da tabela, perto
  // da borda direita) — mede o próprio tamanho depois de renderizado e se reposiciona
  // se estourar a tela. Sem isso ele nascia cortado à direita e a página inteira
  // ganhava scroll horizontal, dando a sensação de "tela se mexendo sozinha" ao tentar
  // alcançar um horário perto da borda. O popover do mobile já nasce com left/right
  // fixos (16px de cada lado) e não precisa disso.
  const slotPopoverRef          = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!openSlotKey || !slotPopoverRef.current) return;
    const el = slotPopoverRef.current;
    const rect = el.getBoundingClientRect();
    const margem = 8;
    // Só o eixo X: o `translateY` do CSS não afeta a leitura de `rect.left`, então o
    // valor medido aqui é o mesmo que `style.left` — corrigir é seguro. Em Y o
    // `getBoundingClientRect()` já vem PÓS-transform e mexer em `style.top` direto
    // brigaria com o `translateY(calc(-100% - 6px))` que empurra o popover pra cima
    // do botão; o caso vertical não foi observado no bug relatado, então não mexe.
    if (rect.right > window.innerWidth - margem) {
      el.style.left = `${Math.max(margem, window.innerWidth - rect.width - margem)}px`;
    }
  }, [openSlotKey]);

  // Preserva o scroll interno da grade "Expediente Ativo" — escolher um horário
  // recalcula `linhasAtendimento` (reabastece agendamentos/ocupação), e o container
  // perdia o scrollTop nesse recálculo, jogando o profissional escolhido para fora
  // da tela. `onScroll` grava a posição a cada rolagem; o efeito abaixo a reaplica
  // depois de todo re-render da lista.
  const expedienteDesktopRef  = useRef<HTMLDivElement>(null);
  const expedienteMobileRef   = useRef<HTMLDivElement>(null);
  const expedienteScrollTop   = useRef({ desktop: 0, mobile: 0 });

  function toggleSlotMenu(key: string, el: HTMLElement) {
    if (openSlotKey === key) { setOpenSlotKey(null); setSlotPos(null); return; }
    const rect = el.getBoundingClientRect();
    setSlotPos({ top: rect.top, left: rect.left });
    setOpenSlotKey(key);
  }
  function closeSlotMenu() {
    setOpenSlotKey(null);
    setSlotPos(null);
  }
  // Fecha o popover de horários ao clicar fora dele (mesmo padrão do combo de animal).
  // "Fora" = fora das DUAS refs — só uma delas tem nó de verdade (a outra ref fica
  // null, pois só a linha realmente aberta recebe `ref={...}` naquele breakpoint).
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      const alvo = e.target as Node;
      const dentroDesktop = slotWrapDesktopRef.current?.contains(alvo) ?? false;
      const dentroMobile  = slotWrapMobileRef.current?.contains(alvo) ?? false;
      if (!dentroDesktop && !dentroMobile) closeSlotMenu();
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

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
      if (STATUS_LIVRES.includes(ag.status) || ag.veterinario?.id !== vetId) return;
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
      const brutos = (res.data.dados ?? res.data) as Array<
        AnimalOption & { localizacao?: { id: number; nome: string } | null; local?: string | null }
      >;
      setAnimais(brutos.map(a => ({
        ...a,
        localizacaoId:   a.localizacao?.id ?? a.localizacaoId ?? null,
        localizacaoNome: localDoAnimal(a),
      })));
    } catch { /* silencioso */ }
    finally { setLoadingAnimais(false); }
  }, []);

  const fetchVets = useCallback(async () => {
    try {
      // Catálogo id→nome buscado junto: o nome da especialidade configurada no local
      // pode não existir no vínculo UsuarioEspecialidade do membro (ex.: fornecedor),
      // e "Especialidade #4" na tela não ajuda ninguém.
      const [res, resCat] = await Promise.all([
        api.get('/equipes/membros'),
        api.get('/especialidades').catch(() => null),
      ]);
      if (!res.data) return;
      const catalogo: Record<number, string> = {};
      for (const e of (resCat?.data?.dados ?? []) as Array<{ id: number; nome: string }>) {
        catalogo[e.id] = e.nome;
      }
      const membros = (res.data.dados ?? []) as Array<{
        cargo: string;
        diasTrabalho?: string | null;
        horaInicioTrabalho?: string | null;
        horaFimTrabalho?: string | null;
        locaisTrabalho?: Array<{
          localizacaoId: number;
          localizacaoNome?: string | null;
          diasTrabalho: string | null;
          horaInicioTrabalho?: string | null;
          horaFimTrabalho?: string | null;
          especialidadeIds?: number[];
          temposConsulta?: Record<string, number>;
        }> | null;
        user: {
          id: number; fullName: string; userType: string; ativo?: boolean;
          vetPerfil?: { subespecialidades?: { nome: string }[] } | null;
          fornecedorPerfil?: { tipoServico?: string | null } | null;
          especialidades?: { especialidadeId?: number; especialidade?: { id?: number; nome?: string | null } | null }[] | null;
        };
      }>;
      setVets(membros
        // A grade lista os PROFISSIONAIS da equipe — cada um com a sua coluna. Sem
        // filtro por cargo: o estagiário (e enfermeiro, secretaria...) precisa da
        // coluna dele para conseguir marcar na PRÓPRIA agenda, já que ninguém além
        // do gestor agenda na agenda de outro (regra basal). Só o cliente fica fora.
        // O CARGO desta empresa é quem manda, nunca o `userType` do login.
        // `user.ativo` já vem do backend como a conjunção ativo-global × ativo-na-
        // empresa (ver lib/profissionalPerfil.js) — profissional inativo não entra
        // na grade, ele não deve receber novo agendamento.
        .filter(m => m.cargo !== 'PROPRIETARIO' && m.user?.userType !== 'ADMIN' && m.user?.ativo !== false)
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
          // Nome do catálogo — vem do vínculo UsuarioEspecialidade do próprio membro
          const nomePorEsp = new Map<number, string>();
          for (const e of m.user.especialidades ?? []) {
            const id   = e.especialidade?.id ?? e.especialidadeId;
            const nome = e.especialidade?.nome?.trim();
            if (Number.isInteger(id) && nome) nomePorEsp.set(Number(id), nome);
          }
          // Especialidades CADASTRADAS do profissional (UsuarioEspecialidade) — o padrão
          // "sem nenhuma, assume Clínica Médica" (e a especialidade que o gestor informa
          // no Cadastro Pessoal) só é gravado AQUI, não dentro de cada MembroLocalTrabalho.
          // Serve de PADRÃO para quem não tem local nenhum, ou tem local sem especialidade
          // própria configurada — sem isto a Agenda mostrava "Sem especialidade" para quem
          // de fato tem uma.
          const idsIdentidade = [...nomePorEsp.keys()];
          // Tempo por especialidade vem dos LOCAIS. Profissional que atende a mesma
          // especialidade em mais de um local usa o MENOR tempo (cabe em qualquer um).
          // Especialidade do local SEM tempo próprio entra com 0 e é resolvida na hora
          // de montar a grade pelo padrão da empresa (passoDe) — nunca some da agenda.
          const tempoPorEsp = new Map<number, number>();
          for (const l of m.locaisTrabalho ?? []) {
            for (const id of l.especialidadeIds ?? []) {
              if (Number.isInteger(id) && !tempoPorEsp.has(id)) tempoPorEsp.set(id, 0);
            }
            for (const [idStr, min] of Object.entries(l.temposConsulta ?? {})) {
              const id = Number(idStr);
              const t  = Number(min);
              if (!Number.isInteger(id) || !(t > 0)) continue;
              const atual = tempoPorEsp.get(id);
              if (atual === undefined || atual === 0 || t < atual) tempoPorEsp.set(id, t);
            }
          }
          // Sem NENHUM local com especialidade própria (inclusive quem não tem local
          // nenhum): cai no padrão do profissional.
          if (tempoPorEsp.size === 0) {
            for (const id of idsIdentidade) tempoPorEsp.set(id, 0);
          }
          const especialidadesCat: EspecialidadeVet[] = [...tempoPorEsp.entries()]
            .map(([id, tempoMin]) => ({
              id,
              nome: nomePorEsp.get(id) ?? catalogo[id] ?? `Especialidade #${id}`,
              tempoMin,
            }))
            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

          return {
            userId: m.user.id,
            fullName: m.user.fullName,
            cargo: m.cargo,
            especialidades,
            especialidadesCat,
            diasTrab: m.diasTrabalho
              ? String(m.diasTrabalho).split(',').map(Number).filter(n => n >= 0 && n <= 6)
              : null,
            horaIni: m.horaInicioTrabalho ?? null,
            horaFim: m.horaFimTrabalho ?? null,
            locais: (m.locaisTrabalho ?? []).map(l => {
              const idsLocal = [...new Set([
                ...(l.especialidadeIds ?? []).map(Number),
                ...Object.keys(l.temposConsulta ?? {}).map(Number),
              ])].filter(Number.isInteger);
              // Local sem especialidade própria herda o padrão do profissional (mesmo
              // fallback de `especialidadesCat` acima) — nunca fica sem especialidade
              // só porque este local específico não teve nenhuma marcada.
              const idsEfetivos = idsLocal.length > 0 ? idsLocal : idsIdentidade;
              return {
                localizacaoId:   l.localizacaoId,
                localizacaoNome: l.localizacaoNome ?? 'Local não informado',
                dias: l.diasTrabalho
                  ? String(l.diasTrabalho).split(',').map(Number).filter(n => n >= 0 && n <= 6)
                  : null,
                horaIni: l.horaInicioTrabalho ?? null,
                horaFim: l.horaFimTrabalho    ?? null,
                // Especialidades DESTE local, com o tempo praticado aqui. Sem tempo
                // próprio → 0 = herda o padrão da empresa na montagem da grade.
                especialidades: idsEfetivos
                  .map(id => ({
                    id,
                    nome: nomePorEsp.get(id) ?? catalogo[id] ?? `Especialidade #${id}`,
                    tempoMin: Number(l.temposConsulta?.[String(id)]) > 0
                      ? Number(l.temposConsulta?.[String(id)]) : 0,
                  }))
                  .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
              };
            }),
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
      const map = new Map<number, Array<{ iniMin: number; fimMin: number }>>();
      for (const o of (res.data.dados ?? []) as
           { veterinarioId: number | null; dataHora: string; duracaoMin: number | null }[]) {
        if (o.veterinarioId == null) continue;
        const ini = hhmmParaMin(formatarHora(o.dataHora));
        if (!map.has(o.veterinarioId)) map.set(o.veterinarioId, []);
        map.get(o.veterinarioId)!.push({ iniMin: ini, fimMin: ini + (o.duracaoMin ?? PASSO_PADRAO_MIN) });
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
  // Tempo de consulta padrão da empresa (Configurações) — vale para a especialidade
  // que o profissional não configurou no local de trabalho.
  const [tempoPadraoEmpresa, setTempoPadraoEmpresa] = useState(PASSO_PADRAO_MIN);
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
        if (Number(d.tempoConsultaPadrao) > 0) setTempoPadraoEmpresa(Number(d.tempoConsultaPadrao));
      })
      .catch(() => {});
  }, []);

  // Passo efetivo: tempo próprio da especialidade ou, na falta dele, o padrão da empresa.
  const passoDe = (tempoMin?: number | null): number =>
    Number(tempoMin) > 0 ? Number(tempoMin) : tempoPadraoEmpresa;

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

  // Especialidades que o profissional exerce no DIA selecionado — vêm das linhas de
  // local cujo expediente cobre esse dia. É o que faz "clínico seg/qua/sex e
  // dermatologista ter/qui na mesma Hípica" valer na grade: numa terça o padrão passa
  // a ser Dermatologia, sem o usuário precisar trocar o chip.
  const espsDoDia = (vetId: number): EspecialidadeVet[] => {
    const v = vets.find(x => x.userId === vetId);
    if (!v) return [];
    const wd = new Date(`${selectedDate}T00:00:00`).getDay();
    const out = new Map<number, EspecialidadeVet>();
    for (const local of v.locais) {
      const exp = expedienteDoLocal(local);
      if (exp.dias && !exp.dias.includes(wd)) continue;
      for (const e of local.especialidades) if (!out.has(e.id)) out.set(e.id, e);
    }
    return [...out.values()];
  };

  // Especialidade ativa do profissional na grade. Sem escolha explícita, usa a primeira
  // que ele exerce NO DIA selecionado (e só então a primeira do catálogo); sem catálogo
  // configurado, null (grade de 1h).
  const espDoVet = (vetId: number): EspecialidadeVet | null => {
    const v = vets.find(x => x.userId === vetId);
    const cat = v?.especialidadesCat ?? [];
    if (cat.length === 0) return null;
    // Filtro global vence a escolha por linha: filtrando por Ortopedia, todas as
    // grades saem no tempo de Ortopedia.
    if (filtroEspId) {
      const doFiltro = cat.find(e => e.id === Number(filtroEspId));
      if (doFiltro) return doFiltro;
    }
    const escolhido = espSelPorVet.get(vetId);
    const doChip = cat.find(e => e.id === escolhido);
    if (doChip) return doChip;
    // O tempo continua saindo do catálogo (MENOR entre os locais) — é o mesmo critério
    // de AgendamentoController.tempoConsultaDoProfissional. Aqui o dia escolhe QUAL
    // especialidade, não quanto ela dura.
    const doDia = espsDoDia(vetId)[0];
    return (doDia && cat.find(e => e.id === doDia.id)) ?? cat[0];
  };

  // Passo da grade = tempo de consulta da especialidade selecionada (ou o padrão da empresa).
  const passoDoVet = (vetId: number): number => passoDe(espDoVet(vetId)?.tempoMin);

  // Horários liberados para uma data conforme o expediente do PROFISSIONAL (dias + faixa)
  // e o tempo de consulta da especialidade selecionada.
  const horariosDoDia = (vetId: number, dateStr: string): string[] => {
    const exp = expedienteDoVet(vetId);
    const wd = new Date(`${dateStr}T00:00:00`).getDay();
    // dias null = todos; array (mesmo vazio) = só os listados (vazio → nenhum dia)
    if (exp.dias && !exp.dias.includes(wd)) return [];
    return gerarSlots(exp.horaInicio, exp.horaFim, passoDoVet(vetId));
  };

  // ── Slots ────────────────────────────────────────────────────────────────────
  // Ocupado = agendamentos do contexto ativo + ocupação GLOBAL do profissional
  // (o mesmo horário agendado em outra empresa também bloqueia).
  // Cada um vira um INTERVALO [início, fim) em minutos: com tempo por especialidade
  // um atendimento de 60min tem de bloquear também os slots de 30min dentro dele.
  function ocupacoesDoVet(vetId: number): Array<{ iniMin: number; fimMin: number }> {
    const out: Array<{ iniMin: number; fimMin: number }> = [];
    for (const ag of agendamentos) {
      if (ag.veterinario?.id !== vetId || STATUS_LIVRES.includes(ag.status)) continue;
      const ini = hhmmParaMin(formatarHora(ag.dataHora));
      out.push({ iniMin: ini, fimMin: ini + (ag.duracaoMin ?? PASSO_PADRAO_MIN) });
    }
    for (const g of ocupacaoGlobal.get(vetId) ?? []) out.push(g);
    return out;
  }


  // ── Filtros locais ───────────────────────────────────────────────────────────
  const listaFiltrada = useMemo(() => agendamentos.filter(ag => {
    // Aba "Minha Agenda": o profissional vê SÓ a agenda dele. O gestor continua vendo
    // a equipe inteira (com o filtro por profissional logo abaixo) — é a única
    // diferença de comportamento entre `/clinica/agenda` e `/agendamentos`.
    if (modoMinhaAgenda && !isGestor && ag.veterinario?.id !== meuUserId) return false;
    // Por padrão a lista mostra só o que ainda vai acontecer (STATUS_ABERTOS).
    // Concluído, finalizado, cancelado e reagendado poluem a agenda operacional —
    // quem precisa deles escolhe no seletor de status.
    if (!statusCasaFiltro(ag.status, filtroStatus)) return false;
    if (filtroVetId && ag.veterinario?.id !== Number(filtroVetId)) return false;
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    return (
      ag.animal?.nome.toLowerCase().includes(q) ||
      ag.titulo.toLowerCase().includes(q) ||
      ag.veterinario?.fullName.toLowerCase().includes(q) ||
      ag.animal?.user?.fullName.toLowerCase().includes(q)
    );
  }), [agendamentos, filtroVetId, busca, filtroStatus, modoMinhaAgenda, isGestor, meuUserId]);

  // Especialidades oferecidas pela equipe — união do catálogo de todos os profissionais
  const especialidadesDisponiveis = useMemo(() => {
    const m = new Map<number, string>();
    for (const v of vets) for (const e of v.especialidadesCat) m.set(e.id, e.nome);
    return [...m.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [vets]);

  const vetsFiltrados = useMemo(() => {
    let lista = filtroVetId ? vets.filter(v => String(v.userId) === filtroVetId) : vets;
    if (filtroEspId) {
      const id = Number(filtroEspId);
      lista = lista.filter(v => v.especialidadesCat.some(e => e.id === id));
    }
    return lista;
  }, [vets, filtroVetId, filtroEspId]);

  // Locais oferecidos pela equipe — alimenta o filtro de local
  const locaisDisponiveis = useMemo(() => {
    const m = new Map<number, string>();
    for (const v of vets) for (const l of v.locais) m.set(l.localizacaoId, l.localizacaoNome);
    return [...m.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [vets]);

  // Faixa de horário do filtro de período do dia
  const faixaHorarioFiltro = useMemo(() => {
    const TURNOS: Record<string, [number, number]> = {
      MANHA: [0, 12 * 60],
      TARDE: [12 * 60, 18 * 60],
      NOITE: [18 * 60, 24 * 60],
    };
    const [de, ate] = filtroTurno ? TURNOS[filtroTurno] : [0, 24 * 60];
    return { de, ate };
  }, [filtroTurno]);

  // Expediente efetivo de UM LOCAL: interseção do horário/dias do local com o da
  // empresa (a empresa é sempre o limitador).
  const expedienteDoLocal = (local: LocalAtendimento) => {
    const cIni = expediente.horaInicio, cFim = expediente.horaFim, cDias = expediente.dias;
    const horaInicio = (local.horaIni && cIni) ? (local.horaIni > cIni ? local.horaIni : cIni) : (local.horaIni ?? cIni);
    const horaFim    = (local.horaFim && cFim) ? (local.horaFim < cFim ? local.horaFim : cFim) : (local.horaFim ?? cFim);
    let dias: number[] | null;
    if (cDias && local.dias) dias = local.dias.filter(d => cDias.includes(d));
    else                     dias = local.dias ?? cDias;
    return { dias, horaInicio, horaFim };
  };

  /**
   * Uma linha por PROFISSIONAL × LOCAL × ESPECIALIDADE para a data selecionada.
   * Só entra a linha cujo local atende no dia escolhido E que tenha grade
   * (expediente que produza horários) — clicar numa quinta não pode listar quem
   * não trabalha na quinta.
   */
  const linhasAtendimento = useMemo(() => {
    const wd = new Date(`${selectedDate}T00:00:00`).getDay();
    const agora = selectedDate === hoje() ? new Date() : null;
    const agoraMin = agora ? agora.getHours() * 60 + agora.getMinutes() : null;
    const espFiltro = filtroEspId ? Number(filtroEspId) : null;
    const localFiltro = filtroLocalId ? Number(filtroLocalId) : null;

    const linhas: Array<{
      key: string;
      vet: VetMembro;
      localNome: string;
      esp: EspecialidadeVet | null;
      dias: number[] | null;
      horaInicio: string | null;
      horaFim: string | null;
      livres: string[];
    }> = [];

    // `turno` = índice da linha de local no cadastro. O MESMO local aparece mais de uma
    // vez quando o profissional exerce especialidades diferentes ali em dias diferentes
    // (clínico seg/qua/sex, dermatologista ter/qui) — sem ele, duas linhas do mesmo
    // local com a mesma especialidade colidiriam na key do React.
    const montar = (
      vet: VetMembro, localId: number | null, localNome: string,
      exp: { dias: number[] | null; horaInicio: string | null; horaFim: string | null },
      esp: EspecialidadeVet | null, turno = 0,
    ) => {
      if (exp.dias && !exp.dias.includes(wd)) return;          // não é dia de trabalho
      const passo = passoDe(esp?.tempoMin);
      const grade = gerarSlots(exp.horaInicio, exp.horaFim, passo);
      if (grade.length === 0) return;                           // sem agenda nesse dia

      const ocupados = ocupacoesDoVet(vet.userId);
      const livres = grade.filter(h => {
        const ini = hhmmParaMin(h), fim = ini + passo;
        if (ini < faixaHorarioFiltro.de || ini >= faixaHorarioFiltro.ate) return false;
        if (ocupados.some(o => o.iniMin < fim && ini < o.fimMin)) return false;
        if (agoraMin !== null && ini <= agoraMin) return false;
        return true;
      });

      // Sem horário livre a linha não entra: a agenda lista só quem pode receber
      // agendamento agora. Profissional lotado some do "Expediente Ativo".
      if (livres.length === 0) return;

      linhas.push({
        key: `${vet.userId}-${localId ?? 0}-${turno}-${esp?.id ?? 0}`,
        vet, localNome, esp,
        dias: exp.dias, horaInicio: exp.horaInicio, horaFim: exp.horaFim,
        livres,
      });
    };

    for (const vet of vetsFiltrados) {
      if (vet.locais.length === 0) {
        // Profissional sem local cadastrado herda o expediente da empresa — continua
        // aparecendo (senão sumiria da agenda sem explicação).
        if (localFiltro) continue;
        const exp = expedienteDoVet(vet.userId);
        const esps = espFiltro
          ? vet.especialidadesCat.filter(e => e.id === espFiltro)
          : vet.especialidadesCat;
        if (esps.length === 0) montar(vet, null, '—', exp, null);
        else for (const esp of esps) montar(vet, null, '—', exp, esp);
        continue;
      }

      vet.locais.forEach((local, turno) => {
        if (localFiltro && local.localizacaoId !== localFiltro) return;
        const exp = expedienteDoLocal(local);
        const esps = espFiltro
          ? local.especialidades.filter(e => e.id === espFiltro)
          : local.especialidades;
        if (esps.length === 0) {
          // Local sem especialidade configurada: só entra quando não há filtro de
          // especialidade (não há o que casar).
          if (!espFiltro) montar(vet, local.localizacaoId, local.localizacaoNome, exp, null, turno);
        } else {
          for (const esp of esps) montar(vet, local.localizacaoId, local.localizacaoNome, exp, esp, turno);
        }
      });
    }

    return linhas.sort((a, b) =>
      a.vet.fullName.localeCompare(b.vet.fullName, 'pt-BR')
      || a.localNome.localeCompare(b.localNome, 'pt-BR')
      || (a.esp?.nome ?? '').localeCompare(b.esp?.nome ?? '', 'pt-BR'));
  }, [vetsFiltrados, selectedDate, filtroEspId, filtroLocalId, faixaHorarioFiltro,
      agendamentos, ocupacaoGlobal, expediente, vets, tempoPadraoEmpresa]);

  // Reaplica o scroll salvo depois que a lista recalcula (ex.: ao agendar um
  // horário, `agendamentos` muda e `linhasAtendimento` é recriada) — sem isso o
  // container voltava para o topo e o profissional escolhido saía da tela.
  // `openSlotKey` também entra: abrir o popover de horários insere um elemento novo
  // (`position: fixed`, mas ainda filho de dentro do container) e o "scroll anchoring"
  // do navegador reajusta o scrollTop sozinho ao ver o DOM mudar — mesmo o popover não
  // ocupando espaço visual ali. Reaplicar aqui corrige o salto assim que ele acontece.
  useLayoutEffect(() => {
    if (expedienteDesktopRef.current) expedienteDesktopRef.current.scrollTop = expedienteScrollTop.current.desktop;
    if (expedienteMobileRef.current)  expedienteMobileRef.current.scrollTop  = expedienteScrollTop.current.mobile;
  }, [linhasAtendimento, openSlotKey]);

  // Rótulo "Seg, Qua · 08:00–12:00" — dias e horário na MESMA coluna
  const labelDiasHorario = (l: { dias: number[] | null; horaInicio: string | null; horaFim: string | null }): string => {
    const dias = l.dias === null ? 'Todos os dias'
      : l.dias.length === 0 ? 'Nenhum dia'
      : l.dias.slice().sort((a, b) => a - b).map(d => DIAS_PT[d]).join(', ');
    const ini = l.horaInicio ? l.horaInicio.slice(0, 5) : '00:00';
    const fim = l.horaFim    ? l.horaFim.slice(0, 5)    : '24:00';
    return `${dias} · ${ini}–${fim}`;
  };
  // Rótulo que o combo escreve no campo ao escolher um animal. Precisa ser UM SÓ lugar:
  // é o mesmo texto que o filtro abaixo tem de reconhecer.
  const rotuloAnimalCombo = (a: { nome: string; localizacaoNome?: string | null }) =>
    a.nome + (a.localizacaoNome ? ` (${a.localizacaoNome})` : '');

  /** Abre a lista do combo de animal; com um já escolhido, seleciona o texto para
   *  que digitar por cima troque o paciente em vez de concatenar no rótulo. */
  const abrirComboAnimal = (el: HTMLInputElement) => {
    setComboOpen(true);
    if (bookingForm.animalId) el.select();
  };

  const animalSelecionadoCombo = animaisDisponiveis.find(a => String(a.id) === bookingForm.animalId) ?? null;
  // ⚠️ Depois de escolher, `comboQuery` guarda o RÓTULO ("Mel (Haras H.P.)"), que NÃO
  // casa com `a.nome` ("Mel"). Filtrar por ele zerava a lista: reabrir o combo mostrava
  // "Nenhum animal encontrado" e o usuário ficava PRESO à primeira escolha, sem jeito de
  // corrigir um animal errado. Enquanto o texto for o rótulo do já selecionado, ele não
  // é busca — é a exibição da escolha —, então a lista inteira continua disponível.
  const queryEhRotuloSelecionado =
    !!animalSelecionadoCombo && comboQuery === rotuloAnimalCombo(animalSelecionadoCombo);
  const animaisCombo = animaisDisponiveis.filter(a =>
    !comboQuery || queryEhRotuloSelecionado || a.nome.toLowerCase().includes(comboQuery.toLowerCase()));

  // ── Conflict check ────────────────────────────────────────────────────────────
  // Verifica se o animal já tem QUALQUER agendamento no dia selecionado (qualquer vet, qualquer hora)
  function findConflictAnimal(animalId: number): AgendamentoGlobal | null {
    return agendamentos.find(ag =>
      ag.animal?.id === animalId &&
      !STATUS_LIVRES.includes(ag.status)
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
        // Define a duração do atendimento no backend (tempo de consulta da especialidade)
        especialidadeId: espDoVet(vetId)?.id ?? undefined,
      });
      toast.success(`Consulta agendada às ${hora}`);
      fetchAgendamentos(selectedDate);
      setMesCarregado('');
    } catch (err) { setErroGrade(msgErroAgenda(err, 'Erro ao criar agendamento')); }
    finally { setSalvando(false); }
  }

  async function handleSlotClick(vetId: number, vetName: string, hora: string, espId?: number | null) {
    setOpenSlotKey(null);
    setErroGrade(null);
    // A linha clicada manda na duração: é ela que sabe a especialidade e o local.
    if (espId) setEspSelPorVet(prev => { const m = new Map(prev); m.set(vetId, espId); return m; });
    // Só o gestor agenda para outro profissional; os demais só para a própria coluna.
    if (!podeAgendarParaOutro && meuUserId != null && vetId !== meuUserId) {
      setErroGrade('Não é permitido o agendamento para outro profissional');
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

  function resetVoz() {
    setErroModal(null);
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
    setVozAberto(false); setVozContexto(null); setVozEtapa('IDLE');
    setVozTranscricao(''); setVozTextoManual(''); setVozResultado(null); setVozSlotConflito(null);
    setVozErroMsg(null);
  }

  // Código de erro do SpeechRecognition (`ev.error`) → mensagem que diz o que
  // realmente aconteceu. Antes qualquer motivo (mic bloqueado, sem fala, sem rede
  // com o serviço de reconhecimento) caía na mesma frase genérica de "tente de novo".
  function msgErroReconhecimentoVoz(codigo?: string): string {
    switch (codigo) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'Permissão de microfone negada. Libere o acesso ao microfone nas configurações do navegador e tente novamente.';
      case 'no-speech':
        return 'Nenhuma fala foi detectada. Fale mais próximo do microfone e tente novamente.';
      case 'audio-capture':
        return 'Nenhum microfone foi encontrado neste dispositivo.';
      case 'network':
        return 'Sem conexão com o serviço de reconhecimento de voz. Verifique sua internet e tente novamente.';
      case 'aborted':
        return 'Gravação interrompida. Tente novamente.';
      default:
        return 'Tente novamente ou use o formulário manual.';
    }
  }

  function iniciarGravacao() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setVozErroMsg('Seu navegador não suporta gravação de voz. Use o campo de texto.'); setVozEtapa('ERRO'); return; }
    const rec = new SR();
    rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (ev: any) => {
      let t = '';
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      setVozTranscricao(t);
    };
    rec.onerror = (ev: any) => { setVozErroMsg(msgErroReconhecimentoVoz(ev?.error)); setVozEtapa('ERRO'); };
    rec.start(); recognitionRef.current = rec;
    setVozErroMsg(null);
    setVozEtapa('GRAVANDO'); setVozTranscricao('');
  }

  function pararGravacao() {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
    setVozEtapa('PROCESSANDO');
    setTimeout(() => processarVoz(), 200);
  }

  async function processarVoz(textoOverride?: string) {
    const texto = textoOverride ?? vozTranscricao ?? vozTextoManual;
    if (!texto.trim()) {
      setVozErroMsg('Não foi possível captar nenhuma fala. Tente novamente ou digite o pedido.');
      setVozEtapa('ERRO');
      return;
    }
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
    } catch (err) {
      // Antes o catch era mudo (`catch { setVozEtapa('ERRO'); }`): 403 de permissão,
      // 500 do backend/IA e falha de rede caíam todos na mesma frase genérica, sem
      // pista nenhuma do que de fato falhou.
      setVozErroMsg(msgErroAgenda(err, 'Não foi possível interpretar a solicitação. Tente novamente ou use o formulário manual.'));
      setVozEtapa('ERRO');
    }
  }

  async function confirmarVoz() {
    if (!vozResultado) return;

    const animalId   = vozResultado.animalId ?? (selectedAnimalId ? Number(selectedAnimalId) : null);
    const vetId      = vozResultado.vetId    ?? vozContexto?.vetId ?? null;
    const dataHora   = vozResultado.dataHora
      ?? (vozContexto ? new Date(`${selectedDate}T${vozContexto.hora}`).toISOString() : null);
    const animalNome = vozResultado.animal?.nome ?? selectedAnimal?.nome ?? 'Animal';

    if (!animalId) { setErroModal('Animal não identificado pela IA'); return; }
    if (!dataHora) { setErroModal('Data/hora não identificada'); return; }

    setSalvando(true);
    try {
      await api.post('/clinica/agendamentos', {
        animalId, tipo: 'CONSULTA',
        titulo: `Consulta - ${animalNome}`,
        dataHora,
        veterinarioId: vetId,
        especialidadeId: vetId ? (espDoVet(vetId)?.id ?? undefined) : undefined,
      });
      toast.success('Agendamento confirmado!');
      resetVoz(); fetchAgendamentos(selectedDate); setMesCarregado('');
    } catch (err) { setErroModal(msgErroAgenda(err, 'Erro ao confirmar agendamento')); }
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
        especialidadeId: espDoVet(booking.vetId)?.id ?? undefined,
      });
      toast.success(`Consulta agendada às ${booking.hora} com ${booking.vetName}`);
      setBooking(null); fetchAgendamentos(selectedDate); setMesCarregado('');
    } catch (err) { setErroGrade(msgErroAgenda(err, 'Erro ao criar agendamento')); }
    finally { setSalvando(false); }
  }

  async function handleConfirmarBooking(e: React.FormEvent) {
    e.preventDefault();
    setErroGrade(null);
    if (!booking) return;
    if (!bookingForm.animalId) { setErroGrade('Selecione um animal'); return; }
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

  // Abre a escolha "cancelar em definitivo × remarcar" — o Cancelar da linha chama
  // isto, nunca a justificativa direto: mesmo com o atendimento já EM_ANDAMENTO,
  // cancelar tem que continuar possível, e a decisão vem ANTES do motivo.
  function abrirDecisaoCancelamento(ag: AgendamentoGlobal) {
    setErroLista(null);
    setDecisaoCancelamento(ag);
  }

  function escolherTipoCancelamento(tipo: 'DEFINITIVO' | 'REMARCAR') {
    if (!decisaoCancelamento) return;
    setErroCancelamento(null);
    setJustificandoCancelamento({ ag: decisaoCancelamento, tipo });
    setDecisaoCancelamento(null);
  }

  // Confirma a justificativa (`ModalJustificativa` já a exige e ela vai para a
  // auditoria em ambos os casos). DEFINITIVO cancela na hora; REMARCAR guarda a
  // justificativa e abre a MESMA tela de reagendamento (calendário + grade), que a
  // usa no PATCH final — sem essa etapa a justificativa do "por quê" se perderia.
  async function confirmarCancelamento(motivo: string) {
    if (!justificandoCancelamento) return;
    const { ag, tipo } = justificandoCancelamento;
    if (tipo === 'REMARCAR') {
      setJustificandoCancelamento(null);
      abrirReagendamento(ag, motivo);
      return;
    }
    setSalvandoCancelamento(true);
    setErroCancelamento(null);
    try {
      await api.patch(`/clinica/agendamentos/${ag.id}/status`, { status: 'CANCELADO', motivo });
      toast.success('Cancelado');
      setAgendamentos(prev => prev.map(a =>
        a.id === ag.id ? { ...a, status: 'CANCELADO' as StatusAgendamento, observacao: motivo } : a));
      setJustificandoCancelamento(null);
    } catch (err) {
      setErroCancelamento(msgErroAgenda(err, 'Erro ao cancelar'));
    } finally {
      setSalvandoCancelamento(false);
    }
  }

  async function handleIniciarAtendimento(ag: AgendamentoGlobal) {
    if (!ag.animal?.id) { setErroLista('Animal não identificado no agendamento'); return; }
    // Só quem VAI EXECUTAR inicia — nem gestor nem quem só agendou para outro
    // profissional. O caminho para os dois é ASSUMIR primeiro (botão ao lado).
    if (!podeIniciarAtendimento(ag)) {
      setErroLista('Este atendimento é de outro profissional. Assuma o agendamento antes de iniciá-lo.');
      return;
    }
    // ADIANTAR é permitido — o paciente chegou antes, o profissional vagou.
    // Marca EM_ANDAMENTO ANTES de navegar: o status tem de refletir o início na
    // agenda imediatamente. Antes, ele só mudava quando a evolução era criada lá
    // adiante — quem voltasse para a agenda via o atendimento ainda como AGENDADO.
    if (ag.status === 'AGENDADO' || ag.status === 'ATRASADA') {
      try {
        await api.patch(`/clinica/agendamentos/${ag.id}/status`, { status: 'EM_ANDAMENTO' });
        setAgendamentos(prev => prev.map(a =>
          a.id === ag.id ? { ...a, status: 'EM_ANDAMENTO' as StatusAgendamento } : a));
      } catch {
        // Não bloqueia o atendimento: a criação da evolução também marca EM_ANDAMENTO.
      }
    }
    navigate(`/clinica/evolucao/${ag.animal.id}?agendamentoId=${ag.id}`);
  }

  async function handleTrocarVetAg() {
    setErroModal(null);
    if (!trocandoVetAg || !trocandoVetIdAg) { setErroModal('Selecione um profissional'); return; }
    if (trocandoVetIdAg === String(trocandoVetAg.veterinario?.id)) {
      setErroModal('O profissional já é o responsável por este agendamento');
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
    } catch (err) { setErroModal(msgErroAgenda(err, 'Erro ao trocar profissional')); }
    finally { setSavingTrocaAg(false); }
  }

  // Assumir para si o atendimento de outro veterinário da equipe. O profissional que
  // estava com ele é avisado por e-mail e WhatsApp (notificação do backend). Não há
  // mais bloqueio por expediente — fora do horário configurado, o backend deixa
  // assumir (atendimento emergencial) e devolve `foraExpediente: true`, avisando
  // TAMBÉM os gestores da empresa por e-mail/WhatsApp; aqui só ecoa isso num toast.
  const [assumindoId, setAssumindoId] = useState<number | null>(null);
  async function handleAssumir(ag: AgendamentoGlobal) {
    setErroLista(null);
    setAssumindoId(ag.id);
    try {
      const res = await api.patch(`/clinica/agendamentos/${ag.id}/assumir`);
      if (res.data?.foraExpediente) {
        toast(`Atendimento de ${ag.animal?.nome ?? 'paciente'} assumido fora do seu expediente — os gestores foram avisados.`, { icon: '⚠️', duration: 6000 });
      } else {
        toast.success(`Atendimento de ${ag.animal?.nome ?? 'paciente'} assumido`);
      }
      fetchAgendamentos(selectedDate);
      setMesCarregado('');
    } catch (err) { setErroLista(msgErroAgenda(err, 'Erro ao assumir o atendimento')); }
    finally { setAssumindoId(null); }
  }

  async function handleTransferirDia() {
    setErroModal(null);
    if (!transDeVetId || !transParaVetId) { setErroModal('Selecione os profissionais'); return; }
    if (transDeVetId === transParaVetId) { setErroModal('Origem e destino devem ser diferentes'); return; }
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
        setErroModal(
          `${bloqueados.length} agendamento(s) NÃO transferido(s) — profissional de destino já ocupado: ` +
          bloqueados.map(b => `${b.animalNome ?? 'paciente'} às ${formatarHora(b.hora)}`).join(', '),
        );
      }
      if (transferidos === 0 && bloqueados.length === 0) toast('Nenhum agendamento para transferir neste dia', { icon: 'ℹ️' });
      setTransferindoDia(false);
      fetchAgendamentos(selectedDate);
      setMesCarregado('');
    } catch (err) { setErroModal(msgErroAgenda(err, 'Erro ao transferir agenda do dia')); }
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

  // Erro do reagendamento: rola até ele. `block: 'nearest'` não mexe na tela quando
  // já está visível — só corrige o caso de ele nascer fora da dobra do modal.
  useEffect(() => {
    if (!erroModal || !reagendando) return;
    erroReagRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [erroModal, reagendando]);

  // Abre o modal de reagendamento já na agenda: dia do agendamento (ou hoje, se ele
  // já passou — não se reagenda para trás) e nenhum horário pré-selecionado.
  // `motivoUsuario` só vem da decisão de cancelamento ("Remarcar a consulta") — o
  // botão "Reagendar" direto não passa por essa etapa e não tem justificativa própria.
  function abrirReagendamento(ag: AgendamentoGlobal, motivoUsuario?: string) {
    setErroModal(null);
    const diaAtual = formatarDateInput(ag.dataHora).slice(0, 10);
    setReagendando(ag);
    setReagData(diaAtual < hoje() ? hoje() : diaAtual);
    setReagHora('');
    setReagOcupados([]);
    setReagMotivoUsuario(motivoUsuario ?? null);
  }

  // Ocupação do profissional no dia ESCOLHIDO (não no dia da tela): agenda do contexto
  // + ocupação global (outras empresas). O próprio agendamento sendo movido é
  // descontado — o horário dele será liberado.
  useEffect(() => {
    if (!reagendando || !reagData) return;
    const vetId = reagendando.veterinario?.id;
    if (!vetId) { setReagOcupados([]); return; }
    let cancelado = false;
    (async () => {
      setReagLoading(true);
      try {
        const [resDia, resOcup] = await Promise.all([
          api.get('/clinica/agendamentos', { params: { data: reagData } }),
          api.get('/clinica/agendamentos/ocupacao', { params: { data: reagData, vetIds: String(vetId) } }),
        ]);
        if (cancelado) return;
        const intervalos: Array<{ iniMin: number; fimMin: number }> = [];
        for (const ag of (resDia.data?.dados ?? []) as AgendamentoGlobal[]) {
          if (ag.id === reagendando.id) continue;
          if (ag.veterinario?.id !== vetId || STATUS_LIVRES.includes(ag.status)) continue;
          const ini = hhmmParaMin(formatarHora(ag.dataHora));
          intervalos.push({ iniMin: ini, fimMin: ini + (ag.duracaoMin ?? PASSO_PADRAO_MIN) });
        }
        for (const o of (resOcup.data?.dados ?? []) as
             Array<{ id?: number; dataHora: string; duracaoMin: number | null }>) {
          if (o.id === reagendando.id) continue;
          const ini = hhmmParaMin(formatarHora(o.dataHora));
          intervalos.push({ iniMin: ini, fimMin: ini + (o.duracaoMin ?? PASSO_PADRAO_MIN) });
        }
        setReagOcupados(intervalos);
      } catch { if (!cancelado) setReagOcupados([]); }
      finally { if (!cancelado) setReagLoading(false); }
    })();
    return () => { cancelado = true; };
  }, [reagendando, reagData]);

  // Grade do dia escolhido para o profissional do agendamento, já sem os horários
  // ocupados e sem os que ficaram para trás quando o dia é hoje.
  const slotsReagendamento = useMemo(() => {
    if (!reagendando || !reagData) return [];
    const vetId = reagendando.veterinario?.id;
    if (!vetId) return [];
    const passo   = passoDoVet(vetId);
    const agora   = new Date();
    const agoraMin = reagData === hoje() ? agora.getHours() * 60 + agora.getMinutes() : null;
    return horariosDoDia(vetId, reagData).filter(h => {
      const ini = hhmmParaMin(h), fim = ini + passo;
      if (agoraMin !== null && ini <= agoraMin) return false;      // horário já passou
      return !reagOcupados.some(o => o.iniMin < fim && ini < o.fimMin);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reagendando, reagData, reagOcupados, vets, expediente, tempoPadraoEmpresa, espSelPorVet, filtroEspId]);

  const novaDataHora = reagData && reagHora ? `${reagData}T${reagHora}` : '';

  async function handleReagendar(e: React.FormEvent) {
    e.preventDefault();
    setErroModal(null);
    if (!reagendando || !novaDataHora) { setErroModal('Escolha o dia e o horário'); return; }
    if (novaDataHora === formatarDateInput(reagendando.dataHora)) { setErroModal('A nova data deve ser diferente da atual'); return; }
    // Adiantar pode (para mais cedo, inclusive para daqui a pouco); para trás do
    // relógio, não. Mesma tolerância de 1 min do backend (DATA_PASSADA).
    if (dataHoraNoPassado(novaDataHora)) {
      setErroModal('Não é possível reagendar para um horário que já passou.'); return;
    }
    const avisoExpediente = foraDoExpediente(novaDataHora, expedienteReagendando);
    if (avisoExpediente) { setErroModal(avisoExpediente); return; }
    setSalvandoReag(true);
    // O cancelamento vem ANTES da criação de propósito: liberar o horário antigo é o
    // que permite reagendar para uma faixa que encosta nele. Se a criação falhar
    // (horário ocupado, fora do expediente, data passada…), o status original é
    // restaurado — senão o paciente ficaria sem agendamento nenhum.
    let cancelado = false;
    try {
      const novaData = new Date(novaDataHora);
      const novaDataStr = novaData.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const novaHoraStr = novaData.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      // TRANSFERIDO (e não CANCELADO): o atendimento não foi desmarcado, mudou de
      // data. O horário antigo é liberado e a observação registra para quando foi.
      // Vindo da decisão de cancelamento ("Remarcar a consulta"), a justificativa do
      // usuário entra JUNTO — reagendar também vai para a auditoria com o motivo,
      // não só com o texto informativo automático.
      const motivoInformativo = `Reagendado para ${novaDataStr} às ${novaHoraStr}`;
      await api.patch(`/clinica/agendamentos/${reagendando.id}/status`, {
        status: 'REAGENDADO',
        motivo: reagMotivoUsuario ? `${reagMotivoUsuario} — ${motivoInformativo}` : motivoInformativo,
      });
      cancelado = true;
      await api.post('/clinica/agendamentos', {
        animalId: reagendando.animal?.id, tipo: reagendando.tipo, titulo: reagendando.titulo,
        dataHora: novaData.toISOString(), observacao: reagendando.observacao ?? undefined,
        veterinarioId: reagendando.veterinario?.id,
        // Reagendar mantém a especialidade (e portanto a duração) do original
        especialidadeId: reagendando.especialidade?.id ?? undefined,
      });
      toast.success('Reagendado');
      setReagendando(null); setReagMotivoUsuario(null); fetchAgendamentos(selectedDate); setMesCarregado('');
    } catch (err) {
      if (cancelado) {
        await api.patch(`/clinica/agendamentos/${reagendando.id}/status`, {
          status: reagendando.status || 'AGENDADO',
          motivo: 'Reagendamento não concluído — horário original mantido',
        }).catch(() => { /* nada a fazer: o erro original é o que interessa */ });
      }
      setErroModal(msgErroAgenda(err, 'Erro ao reagendar'));
    }
    finally { setSalvandoReag(false); }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  // No modo aba (`/clinica/agenda`) o shell do Atendimento já dá container e cabeçalho:
  // aqui vai só o conteúdo, num fragmento.
  // ⚠️ `Wrapper` tem que ser uma referência ESTÁVEL entre renders — `FragmentoWrapper`/
  // `PageWrapper` vivem em escopo de MÓDULO (fora do componente) por isso. Definir a
  // função aqui dentro (mesmo com a mesma lógica) cria uma IDENTIDADE NOVA a cada
  // render; o React não reconhece "mesmo componente, output igual" e desmonta +
  // remonta a árvore inteira, inclusive modais abertos. Se isso cai bem no meio de um
  // clique (entre mousedown e mouseup), o botão original é destruído e o clique não
  // vira `click` nenhum — sintoma: qualquer botão da tela parecia precisar de DOIS
  // cliques, porque o primeiro sempre corria o risco de esbarrar num re-render.
  const Wrapper = modoMinhaAgenda ? FragmentoWrapper : PageWrapper;

  return (
    <Wrapper>

      {!modoMinhaAgenda && <BotaoVoltar className="mb-6" />}

      <InlineError message={erroInline} className="mb-4" />

      {/* Header — só na página inteira; na aba, o shell já titula a seção */}
      {!modoMinhaAgenda && (
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
          <CalendarClock size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Portal de Agendamento</h1>
          <p className="text-sm text-gray-500">Agenda Veterinária · Gestão de consultas e atendimentos</p>
        </div>
      </div>
      )}

      {/* Fora do modo aba: barra de seleção, calendário, filtros e Expediente Ativo.
          A aba Minha Agenda mostra SÓ o card Agendamentos do Dia. */}
      {!modoMinhaAgenda && (<>
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
                    <option key={a.id} value={a.id}>{a.nome}{a.localizacaoNome ? ` (${a.localizacaoNome})` : ''}</option>
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
            semAtalhoHoje
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
              {/* Especialidade — filtra os profissionais e define o tempo da grade */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-500">Especialidade</label>
                <div className="relative">
                  <select value={filtroEspId} onChange={e => setFiltroEspId(e.target.value)}
                    disabled={especialidadesDisponiveis.length === 0}
                    className="w-full text-xs border border-gray-200 rounded-xl pl-3 pr-7 py-2 bg-gray-50 text-gray-700 font-semibold outline-none cursor-pointer appearance-none disabled:opacity-50 disabled:cursor-not-allowed">
                    <option value="">
                      {especialidadesDisponiveis.length === 0 ? 'Nenhuma configurada' : 'Todas'}
                    </option>
                    {especialidadesDisponiveis.map(e => (
                      <option key={e.id} value={e.id}>{e.nome}</option>
                    ))}
                  </select>
                  <ChevronDown size={11} className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
              {/* Local de trabalho */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-500">Local de trabalho</label>
                <div className="relative">
                  <select value={filtroLocalId} onChange={e => setFiltroLocalId(e.target.value)}
                    disabled={locaisDisponiveis.length === 0}
                    className="w-full text-xs border border-gray-200 rounded-xl pl-3 pr-7 py-2 bg-gray-50 text-gray-700 font-semibold outline-none cursor-pointer appearance-none disabled:opacity-50 disabled:cursor-not-allowed">
                    <option value="">
                      {locaisDisponiveis.length === 0 ? 'Nenhum cadastrado' : 'Todos'}
                    </option>
                    {locaisDisponiveis.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
              {/* Período do dia */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-gray-500">Período do dia</label>
                <div className="relative">
                  <select value={filtroTurno}
                    onChange={e => setFiltroTurno(e.target.value as '' | 'MANHA' | 'TARDE' | 'NOITE')}
                    className="w-full text-xs border border-gray-200 rounded-xl pl-3 pr-7 py-2 bg-gray-50 text-gray-700 font-semibold outline-none cursor-pointer appearance-none">
                    <option value="">Dia inteiro</option>
                    <option value="MANHA">Manhã (até 12:00)</option>
                    <option value="TARDE">Tarde (12:00 – 18:00)</option>
                    <option value="NOITE">Noite (a partir das 18:00)</option>
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
              <span className="text-[10px] font-bold text-gray-400">
                {linhasAtendimento.length} {linhasAtendimento.length === 1 ? 'atendimento' : 'atendimentos'}
              </span>
            </div>

            {/* Erro da grade: o slot clicado está logo abaixo desta linha */}
            <InlineError message={booking ? null : erroGrade} className="mx-4 mt-3" />

            {linhasAtendimento.length === 0 ? (
              <div className="py-10 text-center">
                <Users size={28} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-400">Nenhum horário livre neste dia</p>
                <p className="text-xs text-gray-300 mt-1">
                  Só aparece quem atende em {labelDia(selectedDate)} e ainda tem horário disponível.
                </p>
              </div>
            ) : (
              <>
              {/* Desktop table — uma linha por profissional × local × especialidade */}
              <div ref={expedienteDesktopRef}
                onScroll={e => { expedienteScrollTop.current.desktop = e.currentTarget.scrollTop; }}
                style={{ overflowAnchor: 'none' }}
                className="hidden md:block overflow-x-auto max-h-[280px] overflow-y-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      <th className="py-2.5 px-4">Profissional</th>
                      <th className="py-2.5 px-4">Local de trabalho</th>
                      <th className="py-2.5 px-4">Especialidade</th>
                      <th className="py-2.5 px-4">Dias e horário</th>
                      <th className="py-2.5 px-4">Horários Disponíveis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {linhasAtendimento.map(linha => {
                      const { vet, livres } = linha;
                      const isOpen = openSlotKey === linha.key;
                      return (
                        <tr key={linha.key} className="hover:bg-gray-50/50 transition-colors">
                          {/* Profissional */}
                          <td className="py-3 px-4">
                            <p className="text-xs font-bold text-gray-900 whitespace-nowrap">{vet.fullName}</p>
                          </td>
                          {/* Local de trabalho */}
                          <td className="py-3 px-4">
                            <span className="flex items-center gap-1 text-xs text-gray-600">
                              <MapPin size={11} className="text-gray-400 flex-shrink-0" />
                              {linha.localNome}
                            </span>
                          </td>
                          {/* Especialidade */}
                          <td className="py-3 px-4">
                            {linha.esp ? (
                              <span className="text-[10px] font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full whitespace-nowrap">
                                {linha.esp.nome} · {passoDe(linha.esp.tempoMin)}min
                              </span>
                            ) : (
                              <span className="text-[10px] text-gray-400">Sem especialidade</span>
                            )}
                          </td>
                          {/* Dias e horário — coluna única */}
                          <td className="py-3 px-4">
                            <span className="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap">
                              <Clock size={11} className="text-gray-400" /> {labelDiasHorario(linha)}
                            </span>
                          </td>
                          {/* Horários */}
                          <td className="py-3 px-4">
                            {podeGerenciar ? (
                              <div
                                className="inline-block"
                                ref={isOpen ? slotWrapDesktopRef : undefined}
                              >
                                <button
                                  onClick={e => toggleSlotMenu(linha.key, e.currentTarget)}
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all border bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
                                >
                                  {livres.length} {livres.length === 1 ? 'Livre' : 'Livres'}
                                  {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                </button>
                                {isOpen && slotPos && (
                                  <div
                                    ref={slotPopoverRef}
                                    style={{ position: 'fixed', top: slotPos.top, left: slotPos.left, transform: 'translateY(calc(-100% - 6px))', zIndex: 9999 }}
                                    className="bg-white border border-gray-200 rounded-2xl shadow-xl p-2.5 min-w-[200px]"
                                  >
                                    <p className="text-[9px] font-bold text-gray-400 uppercase px-1 pb-1.5">Clique para agendar</p>
                                    <div className="grid grid-cols-3 gap-1">
                                      {livres.map(hora => (
                                        <button key={hora} onClick={() => handleSlotClick(vet.userId, vet.fullName, hora, linha.esp?.id ?? null)}
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

              {/* Mobile cards — mesma linha, empilhada */}
              <div ref={expedienteMobileRef}
                onScroll={e => { expedienteScrollTop.current.mobile = e.currentTarget.scrollTop; }}
                style={{ overflowAnchor: 'none' }}
                className="md:hidden divide-y divide-gray-50 max-h-[340px] overflow-y-auto">
                {linhasAtendimento.map(linha => {
                  const { vet, livres } = linha;
                  const isOpen = openSlotKey === linha.key;
                  return (
                    <div key={linha.key} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-gray-900 truncate">{vet.fullName}</p>
                        </div>
                        {podeGerenciar ? (
                          <div
                            className="inline-block flex-shrink-0"
                            ref={isOpen ? slotWrapMobileRef : undefined}
                          >
                            <button
                              onClick={e => toggleSlotMenu(linha.key, e.currentTarget)}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all border bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
                            >
                              {livres.length} {livres.length === 1 ? 'Livre' : 'Livres'}
                              {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                            {isOpen && slotPos && (
                              <div
                                style={{ position: 'fixed', top: slotPos.top, left: 16, right: 16, transform: 'translateY(calc(-100% - 6px))', zIndex: 9999 }}
                                className="bg-white border border-gray-200 rounded-2xl shadow-xl p-2.5"
                              >
                                <p className="text-[9px] font-bold text-gray-400 uppercase px-1 pb-1.5">Toque para agendar</p>
                                <div className="grid grid-cols-4 gap-1">
                                  {livres.map(hora => (
                                    <button key={hora} onClick={() => handleSlotClick(vet.userId, vet.fullName, hora, linha.esp?.id ?? null)}
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
                      <p className="text-[11px] text-gray-500 flex items-center gap-1 truncate">
                        <MapPin size={11} className="text-gray-400 flex-shrink-0" /> {linha.localNome}
                        {linha.esp && <span className="text-emerald-700 font-semibold">· {linha.esp.nome} · {passoDe(linha.esp.tempoMin)}min</span>}
                      </p>
                      <p className="text-[11px] text-gray-400 flex items-center gap-1">
                        <Clock size={11} className="text-gray-400" /> {labelDiasHorario(linha)}
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

      </>)}

      {/* ── Lista de Agendamentos ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-gray-500" />
            {modoMinhaAgenda ? (
              <button
                ref={miniCalBtnRef}
                type="button"
                onClick={toggleMiniCal}
                className="flex items-center gap-1 text-[10px] font-bold text-gray-600 uppercase tracking-wider hover:text-emerald-700 transition-colors"
              >
                Agendamentos do Dia · {labelDia(selectedDate)}
                <ChevronDown size={11} className={`transition-transform ${miniCalAberto ? 'rotate-180' : ''}`} />
              </button>
            ) : (
              <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">
                Agendamentos do Dia · {labelDia(selectedDate)}
              </p>
            )}
            {loading && <Loader2 size={13} className="text-emerald-600 animate-spin" />}
          </div>
          {modoMinhaAgenda && miniCalAberto && miniCalPos && (
            <div
              ref={miniCalPopRef}
              style={{ position: 'fixed', top: miniCalPos.top, left: miniCalPos.left, zIndex: 9999 }}
              className="w-72"
            >
              <CalendarioInterativo
                selectedDate={selectedDate}
                onChange={date => {
                  setSelectedDate(date);
                  if (date.slice(0, 7) !== mesCarregado) setMesCarregado('');
                  setMiniCalAberto(false);
                }}
                statusPorDia={statusPorDia}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* Transferir a agenda de um dia inteiro é o MESMO ato do "Transferir" da
                linha — passar atendimento para outro profissional — e segue a mesma
                regra: só o GESTOR. Deixar um dos dois aberto criaria duas regras para
                a mesma coisa. */}
            {isGestor && podeGerenciar && vets.length > 1 && (
              <button
                onClick={() => {
                  setTransferindoDia(true);
                  // Origem: a que está filtrada na tela; sem filtro, a própria agenda.
                  setTransDeVetId(filtroVetId || String(meuUserId ?? ''));
                  setTransParaVetId('');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-semibold transition-colors border border-blue-200 whitespace-nowrap"
              >
                <CalendarDays size={12} /> Transferir dia inteiro
              </button>
            )}
            {/* Filtro de status — mora AQUI, e não no bloco "Filtros" acima, porque só
                recorta ESTA lista; aquele bloco governa a grade do Expediente Ativo. */}
            <div className="relative">
              {/* `font-sans` explícito — o botão "Transferir dia inteiro" ao lado usa a
                  fonte da aplicação por herança normal; o <select>, mesmo com
                  `appearance-none`, ainda pode cair na fonte padrão do SO em alguns
                  navegadores/mobile. Fixar `font-sans` garante a mesma tipografia. */}
              <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value as FiltroStatus)}
                className="text-xs border border-gray-200 rounded-xl pl-3 pr-7 py-1.5 bg-gray-50 text-gray-700 font-semibold outline-none cursor-pointer appearance-none font-sans">
                <option value="ABERTOS">Em aberto</option>
                <option value="TODOS">Todos os status</option>
                <optgroup label="Somente">
                  {STATUS_FILTRAVEIS.map(s => (
                    // STATUS_LABEL é CAIXA ALTA (serve aos badges da lista); no seletor
                    // isso destoaria das outras opções, então cai para "Concluído".
                    <option key={s} value={s}>
                      {STATUS_LABEL[s].charAt(0) + STATUS_LABEL[s].slice(1).toLowerCase()}
                    </option>
                  ))}
                </optgroup>
              </select>
              <ChevronDown size={11} className="absolute right-2.5 top-2 text-gray-400 pointer-events-none" />
            </div>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-2 text-gray-400" />
              <input type="text" placeholder="Buscar..." value={busca} onChange={e => setBusca(e.target.value)}
                className="pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 w-44" />
            </div>
          </div>
        </div>

        <InlineError message={erroLista} className="mx-4 mt-3" />

        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 size={28} className="text-emerald-600 animate-spin" /></div>
        ) : listaFiltrada.length === 0 ? (
          <div className="py-12 text-center">
            <CalendarClock size={32} className="text-gray-300 mx-auto mb-2" />
            {/* O dia PODE ter agendamentos e ainda assim a lista vir vazia — todos
                cancelados/reagendados/concluídos, escondidos pelo filtro padrão.
                Dizer "nenhum agendamento" aí seria mentira, e o usuário não teria
                pista de que existe um filtro ativo. */}
            {agendamentos.length > 0 && filtroStatus !== 'TODOS' ? (
              <>
                <p className="text-sm font-semibold text-gray-500">
                  {filtroStatus === 'ABERTOS'
                    ? 'Nenhum agendamento em aberto nesta data'
                    : 'Nenhum agendamento com esse status nesta data'}
                </p>
                <button onClick={() => setFiltroStatus('TODOS')}
                  className="mt-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline">
                  Ver todos os status ({agendamentos.length})
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-gray-500">Nenhum agendamento para esta data</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {podeGerenciar ? 'Clique em um horário disponível acima.' : 'Selecione outra data no calendário.'}
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-100">
              {listaFiltrada.map(ag => {
                // ATRASADA é uma variante de AGENDADO (ainda não ocorreu) — mesmas ações disponíveis.
                const isAgendado    = ag.status === 'AGENDADO' || ag.status === 'ATRASADA';
                const isCancelado   = STATUS_LIVRES.includes(ag.status);
                const isEmAndamento = ag.status === 'EM_ANDAMENTO';
                const podeContinuar = isEmAndamento && podeIniciarAtendimento(ag);
                // Antes da hora marcada não se inicia o atendimento — reagende.
                const antecipado    = agendamentoAntecipado(ag.dataHora);
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
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COR[ag.status]}`}>{STATUS_LABEL[ag.status]}</span>
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
                        ? (
                          // Dentro do shell de Atendimento o nome seleciona o paciente
                          <p className="font-bold text-sm text-gray-900">
                            {onSelecionarAnimal ? (
                              <button type="button" onClick={() => onSelecionarAnimal(ag.animal!.id)}
                                className="text-emerald-700 hover:underline">
                                {ag.animal.nome}
                              </button>
                            ) : ag.animal.nome}
                            {localDoAnimal(ag.animal) && <span className="font-normal text-gray-500"> · {localDoAnimal(ag.animal)}</span>}
                          </p>
                        )
                        : <p className="font-bold text-sm text-gray-900">{labelTipo(ag.tipo)}</p>}
                      {ag.animal?.user && <p className="text-xs text-gray-400">Tutor: {ag.animal.user.fullName}</p>}
                      {ag.veterinario && <p className="text-xs text-gray-400">Vet: {ag.veterinario.fullName}</p>}
                      {ag.criadoPor && ag.criadoPor.id !== ag.veterinario?.id && (
                        <p className="text-xs text-gray-400">Agendado por: {ag.criadoPor.fullName}</p>
                      )}
                      {isCancelado && ag.observacao && (
                        <p className={`text-xs mt-0.5 italic ${foiReagendado(ag.status) ? 'text-violet-600' : 'text-red-500'}`}>
                          {foiReagendado(ag.status) ? ag.observacao : `Motivo: ${ag.observacao}`}
                        </p>
                      )}
                    </div>
                    {podeGerenciar && !isCancelado && (
                      <div onClick={e => e.stopPropagation()} className="flex items-center gap-2 flex-wrap border-t border-gray-100 pt-2">
                        {/* Adiantar pode: o título só INFORMA que o horário ainda não chegou */}
                        {isAgendado && podeIniciarAtendimento(ag) && (
                          <button onClick={() => handleIniciarAtendimento(ag)}
                            title={antecipado ? `Marcado para ${formatarHora(ag.dataHora)} — iniciar agora adianta o atendimento` : 'Iniciar atendimento'}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-semibold">
                            <Stethoscope size={11} /> Iniciar
                          </button>
                        )}
                        {isAgendado && podeOperarLinha(ag) && (
                          <button onClick={() => abrirReagendamento(ag)} className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-semibold">
                            <RefreshCw size={11} /> Reagendar
                          </button>
                        )}
                        {isAgendado && vets.length > 0 && podeTransferir(ag) && (
                          <button onClick={() => { setTrocandoVetAg(ag); setTrocandoVetIdAg(ag.veterinario ? String(ag.veterinario.id) : ''); }} className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-semibold">
                            <UserCheck size={11} /> Transferir
                          </button>
                        )}
                        {podeAssumir(ag) && (
                          <button onClick={() => handleAssumir(ag)} disabled={assumindoId === ag.id}
                            title={ag.veterinario?.fullName ? `Assumir o atendimento de ${ag.veterinario.fullName}` : 'Assumir este atendimento (sem profissional definido)'}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-teal-50 hover:bg-teal-100 disabled:opacity-60 text-teal-700 rounded-xl text-xs font-semibold">
                            {assumindoId === ag.id ? <Loader2 size={11} className="animate-spin" /> : <UserCheck size={11} />}
                            Assumir
                          </button>
                        )}
                        {/* Cancelar continua disponível com o atendimento EM_ANDAMENTO — só
                            fica indisponível quando já está livre (cancelado/reagendado). */}
                        {(isAgendado || isEmAndamento) && podeOperarLinha(ag) && (
                          <button onClick={() => abrirDecisaoCancelamento(ag)} className="flex items-center gap-1 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl text-xs font-semibold">
                            <Ban size={11} /> Cancelar
                          </button>
                        )}
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
                    const isCancelado   = STATUS_LIVRES.includes(ag.status);
                    const isEmAndamento = ag.status === 'EM_ANDAMENTO';
                    const podeContinuar = isEmAndamento && podeIniciarAtendimento(ag);
                    // Antes da hora marcada não se inicia o atendimento — reagende.
                    const antecipado    = agendamentoAntecipado(ag.dataHora);
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
                          {/* No shell de Atendimento o nome do paciente SELECIONA o
                              animal (era o comportamento da aba Minha Agenda). Fora
                              dele não há para onde levar: fica como texto. */}
                          {onSelecionarAnimal && ag.animal?.id ? (
                            <button type="button" onClick={() => onSelecionarAnimal(ag.animal!.id)}
                              className="font-bold text-emerald-700 hover:underline text-left">
                              {ag.animal.nome}
                            </button>
                          ) : (
                            <p className="font-bold text-gray-900">{ag.animal?.nome ?? '—'}</p>
                          )}
                          {localDoAnimal(ag.animal) && (
                            <p className="flex items-center gap-1 text-xs text-gray-400">
                              <MapPin size={10} className="flex-shrink-0" /> {localDoAnimal(ag.animal)}
                            </p>
                          )}
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
                              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${STATUS_COR[ag.status]}`}>{STATUS_LABEL[ag.status]}</span>
                              {/* Transferido: a nova data/hora fica VISÍVEL (é a informação
                                  útil da linha); cancelado mantém o motivo no tooltip. */}
                              {foiReagendado(ag.status) && ag.observacao && (
                                <p className="text-[10px] text-violet-600 italic mt-1 whitespace-nowrap">{ag.observacao}</p>
                              )}
                              {!foiReagendado(ag.status) && ag.observacao && (
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
                            {/* A LINHA tem onClick próprio (continuar o atendimento em
                                andamento). Sem parar a propagação aqui, clicar em
                                Assumir também navegaria para a evolução e tiraria o
                                usuário da agenda no meio da ação. */}
                            <div onClick={e => e.stopPropagation()} className="flex items-center justify-center gap-1.5">
                              {/* Adiantar pode: o título só INFORMA que o horário ainda não chegou */}
                              {isAgendado && podeIniciarAtendimento(ag) && (
                                <button onClick={() => handleIniciarAtendimento(ag)}
                                  title={antecipado ? `Marcado para ${formatarHora(ag.dataHora)} — iniciar agora adianta o atendimento` : 'Iniciar atendimento'}
                                  className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl transition-colors">
                                  <Stethoscope size={13} />
                                </button>
                              )}
                              {isAgendado && podeOperarLinha(ag) && (
                                <button onClick={() => abrirReagendamento(ag)} title="Reagendar"
                                  className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl transition-colors">
                                  <RefreshCw size={13} />
                                </button>
                              )}
                              {podeAssumir(ag) && (
                                <button onClick={() => handleAssumir(ag)} disabled={assumindoId === ag.id}
                                  title={ag.veterinario?.fullName ? `Assumir o atendimento de ${ag.veterinario.fullName}` : 'Assumir este atendimento (sem profissional definido)'}
                                  className="p-1.5 bg-teal-50 hover:bg-teal-100 disabled:opacity-60 text-teal-700 rounded-xl transition-colors">
                                  {assumindoId === ag.id ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />}
                                </button>
                              )}
                              {isAgendado && vets.length > 0 && podeTransferir(ag) && (
                                <button onClick={() => { setTrocandoVetAg(ag); setTrocandoVetIdAg(ag.veterinario ? String(ag.veterinario.id) : ''); }} title="Transferir para outro profissional"
                                  className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl transition-colors">
                                  <UserCheck size={13} />
                                </button>
                              )}
                              {/* Cancelar continua disponível com o atendimento EM_ANDAMENTO —
                                  só fica indisponível quando já está livre. */}
                              {(isAgendado || isEmAndamento) && podeOperarLinha(ag) && (
                                <button onClick={() => abrirDecisaoCancelamento(ag)} title="Cancelar"
                                  className="p-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl transition-colors">
                                  <Ban size={13} />
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
      </div>

      {/* ── Modal: Confirmar Horário ──────────────────────────────────────────── */}
      {booking && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 px-6 pt-5 pb-6 relative">
              <button onClick={() => { setBooking(null); setErroGrade(null); }}
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
              <InlineError message={erroGrade} />
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
                    // `onClick` ALÉM de `onFocus`, e não no lugar dele: ao escolher uma
                    // opção o `onMouseDown` chama `preventDefault()`, então o foco NUNCA
                    // sai do input — e `focus` não dispara duas vezes no mesmo campo.
                    // Só com `onFocus`, clicar no campo depois de escolher não reabria a
                    // lista, e o paciente errado ficava travado. `onFocus` continua
                    // cobrindo a chegada por Tab.
                    onFocus={e => abrirComboAnimal(e.currentTarget)}
                    onClick={e => abrirComboAnimal(e.currentTarget)}
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
                            setComboQuery(rotuloAnimalCombo(a));
                            setComboOpen(false);
                            setBookingForm({ animalId: String(a.id), proprietarioNome: a.user?.fullName ?? '', telefone: a.user?.phone ?? '', cpf: a.user?.cpf ?? '' });
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-b border-gray-50 last:border-0 ${String(a.id) === bookingForm.animalId ? 'bg-emerald-50 text-emerald-800' : 'hover:bg-gray-50 text-gray-800'}`}
                        >
                          <span className="font-semibold">{a.nome}</span>
                          {a.localizacaoNome && <span className="text-xs text-gray-400 ml-1.5">({a.localizacaoNome})</span>}
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
                <button type="button" onClick={() => { setBooking(null); setErroGrade(null); }}
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

      {/* ── Modal: escolha do cancelamento (definitivo × remarcar) ──────────────
          Etapa ANTES da justificativa — mesmo com o atendimento EM_ANDAMENTO, o
          Cancelar da linha chega aqui primeiro, nunca direto no motivo. */}
      {decisaoCancelamento && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="bg-red-600 px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ban size={15} className="text-white/90" />
                <p className="font-bold text-sm text-white">Cancelar atendimento?</p>
              </div>
              <button onClick={() => setDecisaoCancelamento(null)} className="text-white/60 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-600">
                {decisaoCancelamento.animal?.nome ?? labelTipo(decisaoCancelamento.tipo)} · {formatarHora(decisaoCancelamento.dataHora)}
                {decisaoCancelamento.veterinario?.fullName && <> · {decisaoCancelamento.veterinario.fullName}</>}
              </p>
              <button onClick={() => escolherTipoCancelamento('REMARCAR')}
                className="w-full flex items-center gap-3 p-3.5 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 rounded-xl text-left transition-colors">
                <RefreshCw size={16} className="text-emerald-700 flex-shrink-0" />
                <span>
                  <span className="block text-sm font-semibold text-emerald-800">Remarcar a consulta</span>
                  <span className="block text-xs text-emerald-700/80">Libera este horário e leva direto para escolher o novo dia e horário.</span>
                </span>
              </button>
              <button onClick={() => escolherTipoCancelamento('DEFINITIVO')}
                className="w-full flex items-center gap-3 p-3.5 border border-red-200 bg-red-50 hover:bg-red-100 rounded-xl text-left transition-colors">
                <Ban size={16} className="text-red-700 flex-shrink-0" />
                <span>
                  <span className="block text-sm font-semibold text-red-800">Cancelar em definitivo</span>
                  <span className="block text-xs text-red-700/80">Não fica agendado — para reagendar depois, é preciso marcar de novo.</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: justificativa do cancelamento/remarcação ──────────────────────
          Comum aos dois caminhos: ambos exigem motivo e vão para a auditoria
          (ModalJustificativa já grava isso — CLAUDE.md armadilha 33). */}
      <ModalJustificativa
        aberto={!!justificandoCancelamento}
        titulo={justificandoCancelamento?.tipo === 'REMARCAR' ? 'Remarcar consulta' : 'Cancelar em definitivo'}
        descricao={justificandoCancelamento
          ? `${justificandoCancelamento.ag.animal?.nome ?? labelTipo(justificandoCancelamento.ag.tipo)} · ${formatarHora(justificandoCancelamento.ag.dataHora)}`
          : undefined}
        acaoLabel={justificandoCancelamento?.tipo === 'REMARCAR' ? 'Continuar para o reagendamento' : 'Cancelar atendimento'}
        placeholder="Descreva o motivo (obrigatório)..."
        processando={salvandoCancelamento}
        erro={erroCancelamento}
        onConfirmar={confirmarCancelamento}
        onFechar={() => { setJustificandoCancelamento(null); setErroCancelamento(null); }}
      />

      {/* ── Modal: Reagendar ─────────────────────────────────────────────────── */}
      {reagendando && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md max-h-[92vh] overflow-y-auto">
            <div className="bg-emerald-700 px-6 py-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-emerald-200 uppercase tracking-widest">Reagendar</p>
                <h3 className="text-lg font-bold text-white flex items-center gap-2"><RefreshCw size={16} /> Nova Data e Horário</h3>
              </div>
              <button onClick={() => { setReagendando(null); setReagMotivoUsuario(null); setErroModal(null); }} className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"><X size={18} /></button>
            </div>
            {/* Identificação em UMA linha: o nome do animal já está no título
                ("Consulta - Mel"), então repeti-lo embaixo era eco. */}
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
              <p className="text-xs font-bold text-gray-400 uppercase mb-1">Agendamento atual</p>
              <p className="text-sm font-bold text-gray-900">
                {reagendando.titulo} - {formatarDataHora(reagendando.dataHora)}
              </p>
            </div>
            <form onSubmit={handleReagendar} className="p-6 flex flex-col gap-4">
              {/* Mesma agenda da tela principal: escolhe-se o DIA no calendário e o
                  horário na grade de livres do profissional. Dias que já passaram
                  ficam desabilitados. */}
              <div className="flex flex-col gap-1.5">
                <CalendarioInterativo
                  selectedDate={reagData || hoje()}
                  onChange={d => { setReagData(d); setReagHora(''); }}
                  statusPorDia={new Map()}
                  minDate={hoje()}
                  semAtalhoHoje
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-700">
                  Horário disponível <span className="text-red-500">*</span>
                  {reagendando.veterinario?.fullName && (
                    <span className="ml-1 font-medium text-gray-400">
                      · {reagendando.veterinario.fullName}
                    </span>
                  )}
                </label>
                {reagLoading ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400 py-3">
                    <Loader2 size={12} className="animate-spin" /> Buscando horários…
                  </div>
                ) : slotsReagendamento.length === 0 ? (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                    Nenhum horário livre neste dia
                    {reagendando.veterinario?.fullName ? ` para ${reagendando.veterinario.fullName}` : ''}.
                    Escolha outro dia no calendário.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5 max-h-44 overflow-y-auto pr-1">
                    {slotsReagendamento.map(h => (
                      <button
                        key={h} type="button"
                        onClick={() => setReagHora(h)}
                        className={`py-2 rounded-xl text-xs font-bold border transition-colors ${
                          reagHora === h
                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                            : 'bg-white border-gray-200 text-gray-700 hover:border-emerald-300 hover:bg-emerald-50'
                        }`}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                )}
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
              </div>

              {novaDataHora && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Novo horário</p>
                  <p className="text-sm font-bold text-gray-900">
                    {reagData.split('-').reverse().join('/')} às {reagHora}
                  </p>
                </div>
              )}
              <div className="bg-emerald-50 rounded-xl p-3 text-xs text-emerald-700">O horário anterior será liberado e um novo agendamento será criado.</div>
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => { setReagendando(null); setReagMotivoUsuario(null); setErroModal(null); }}
                  className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm font-semibold rounded-xl transition-colors">Fechar</button>
                <button type="submit" disabled={salvandoReag || !novaDataHora || !!foraDoExpediente(novaDataHora, expedienteReagendando)}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-colors">
                  {salvandoReag ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Confirmar
                </button>
              </div>
              {/* Erro ABAIXO do botão que o disparou. No topo do formulário ele ficava
                  atrás do calendário e da grade de horários — o modal rola, e quem
                  clica em "Confirmar" no rodapé não via nada acontecer. */}
              <div ref={erroReagRef}>
                <InlineError message={erroModal} />
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
              <InlineError message={erroModal} className="mb-4" />
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
                      {vozErroMsg ?? 'Tente novamente ou use o formulário manual.'}
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
              <button onClick={() => { setTrocandoVetAg(null); setErroModal(null); }} className="p-1 text-gray-400 hover:text-gray-600">
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
              <button onClick={() => { setTrocandoVetAg(null); setErroModal(null); }}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleTrocarVetAg} disabled={savingTrocaAg || !trocandoVetIdAg}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5">
                {savingTrocaAg && <Loader2 size={13} className="animate-spin" />}
                Transferir
              </button>
            </div>
            {/* Erro ABAIXO do botao que o disparou (mesmo padrao do reagendamento) */}
            <div className="px-5 pb-4"><InlineError message={erroModal} /></div>
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
              <button onClick={() => { setTransferindoDia(false); setErroModal(null); }} className="p-1 text-gray-400 hover:text-gray-600">
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
                  {/* O profissional só transfere a PRÓPRIA agenda — origem travada nele */}
                  <select value={transDeVetId} onChange={e => setTransDeVetId(e.target.value)}
                    disabled={!podeAgendarParaOutro}
                    className={`w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 appearance-none ${
                      podeAgendarParaOutro ? '' : 'bg-gray-50 text-gray-500 cursor-not-allowed'
                    }`}>
                    <option value="">Selecione...</option>
                    {(podeAgendarParaOutro ? vets : vets.filter(v => v.userId === meuUserId))
                      .map(v => <option key={v.userId} value={v.userId}>{v.fullName}</option>)}
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
              <button onClick={() => { setTransferindoDia(false); setErroModal(null); }}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleTransferirDia} disabled={savingTransf || !transDeVetId || !transParaVetId}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5">
                {savingTransf && <Loader2 size={13} className="animate-spin" />}
                Transferir tudo
              </button>
            </div>
            {/* Erro ABAIXO do botao que o disparou (mesmo padrao do reagendamento) */}
            <div className="px-5 pb-4"><InlineError message={erroModal} /></div>
          </div>
        </div>
      )}

    </Wrapper>
  );
}

// frontend/src/pages/ExecucaoPrescricao.tsx

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, ClipboardList, Loader2, Search, User,
  Eye, Printer, X, Link, ChevronLeft, ChevronRight, Calendar,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import toast from 'react-hot-toast';
import api from '../services/api';
import { imprimirPrescricao } from '../utils/PrescricaoPrint';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ItemExecucao {
  id: number;
  tipo: 'MEDICAMENTO' | 'PROCEDIMENTO';
  medicamento: string;
  dosagem: string | null;
  unidade: string | null;
  via: string;
  frequencia: string;
  horaInicio: string | null;
  horariosGerados: string[] | null;
  duracaoDias: number;
  observacao: string | null;
  dataInicio: string;
  diaAtual: number;
}

interface GrupoExecucao {
  id: number;
  numero: number;
  numeroFormatado: string;
  status: string;
  finalizadoEm: string | null;
  finalizadoPor: { id: number; fullName: string } | null;
  executadoPor:  { id: number; fullName: string } | null;
  veterinario:   { id: number; fullName: string };
  animal: {
    id: number;
    nome: string;
    photoUrl: string | null;
    peso: number | null;
    baia: string | null;
    especie: { nome: string } | null;
    raca:    { nome: string } | null;
  };
  itens: ItemExecucao[];
}

type DiaStatus = 'LIVRE' | 'PARCIAL' | 'OCUPADO';
type ViewMode  = 'MES' | 'SEMANA';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const POSOLOGIAS: Record<string, string> = {
  '1xDia': '1x/dia', '12em12h': '12 em 12H', '8em8h': '8 em 8H',
  '6em6h': '6 em 6H', '4em4h': '4 em 4H', '1em1h': '1 em 1H',
  'continuo': 'Contínuo', 'agora': 'Dose única', 'seNecessario': 'Se necessário',
  'SOS': 'SOS', '1x2dias': '1x/2 dias', '1x3dias': '1x/3 dias',
  '1xSemana': '1x/semana', '1x21dias': '1x/21 dias',
  '1x30dias': '1x/30 dias', '1x90dias': '1x/90 dias',
};

const INTERVALO_HORAS: Record<string, number> = {
  '1xDia': 24, '12em12h': 12, '8em8h': 8, '6em6h': 6, '4em4h': 4, '1em1h': 1,
};

function calcSlots(item: ItemExecucao): string[] {
  if (Array.isArray(item.horariosGerados) && item.horariosGerados.length > 0)
    return item.horariosGerados as string[];
  if (!item.horaInicio) return item.frequencia === 'agora' ? ['Dose única'] : [];
  const intervalo = INTERVALO_HORAS[item.frequencia];
  if (!intervalo) return [item.horaInicio];
  const [h, m] = item.horaInicio.split(':').map(Number);
  const slots: string[] = [];
  for (let i = 0; i < 24 / intervalo; i++) {
    const totalMin = h * 60 + m + i * intervalo * 60;
    const hh = Math.floor(totalMin / 60) % 24;
    const mm = totalMin % 60;
    slots.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  }
  return slots;
}

// Retorna o índice do slot "ativo agora" (último slot cujo horário já passou)
function getActiveSlotIdx(slots: string[]): number {
  if (!slots.length || slots[0] === 'Dose única') return 0;
  const now   = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let active = -1;
  for (let i = 0; i < slots.length; i++) {
    const [hh, mm] = slots[i].split(':').map(Number);
    if (hh * 60 + mm <= nowMin) active = i;
  }
  return active;
}

function labelBaia(especieNome: string | null | undefined): 'Baia' | 'Leito' | null {
  if (!especieNome) return null;
  const n = especieNome.toLowerCase();
  if (n.includes('equino') || n.includes('cavalo')) return 'Baia';
  if (n.includes('canino') || n.includes('felino') || n.includes('gato') ||
      n.includes('cachorro') || n.includes('cão')  || n.includes('cao')) return 'Leito';
  return null;
}

// ─── localStorage — rastreamento de slots executados ─────────────────────────

type ExecMap = Record<string, number[]>; // "itemId" → [slotIdx, ...]

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const execKey = (grupoId: number) => `s2vet_exec_${grupoId}_${localToday()}`;

function getExecMap(grupoId: number): ExecMap {
  try { return JSON.parse(localStorage.getItem(execKey(grupoId)) ?? '{}'); }
  catch { return {}; }
}

function saveExecMap(grupoId: number, map: ExecMap) {
  localStorage.setItem(execKey(grupoId), JSON.stringify(map));
}

const doneTodayKey = (grupoId: number) => `s2vet_done_${grupoId}_${localToday()}`;
function markDoneToday(grupoId: number) { localStorage.setItem(doneTodayKey(grupoId), '1'); }
function isDoneToday(grupoId: number): boolean { return localStorage.getItem(doneTodayKey(grupoId)) === '1'; }

function isSlotDone(map: ExecMap, itemId: number, slotIdx: number): boolean {
  return (map[String(itemId)] ?? []).includes(slotIdx);
}

function toggleSlot(grupoId: number, map: ExecMap, itemId: number, slotIdx: number): ExecMap {
  const updated  = { ...map };
  const arr      = [...(updated[String(itemId)] ?? [])];
  const pos      = arr.indexOf(slotIdx);
  if (pos >= 0) arr.splice(pos, 1); else arr.push(slotIdx);
  updated[String(itemId)] = arr;
  saveExecMap(grupoId, updated);
  return updated;
}

// ─── Calendário Interativo ────────────────────────────────────────────────────

const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_PT  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function pad(n: number) { return String(n).padStart(2, '0'); }

interface CalendarioProps {
  selectedDate: string;
  onChange:     (date: string) => void;
  statusPorDia: Map<string, DiaStatus>;
}

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

function CalendarioInterativo({ selectedDate, onChange, statusPorDia }: CalendarioProps) {
  const [ano, mes] = selectedDate.split('-').map(Number);
  const [viewAno, setViewAno]   = useState(ano);
  const [viewMes, setViewMes]   = useState(mes - 1);
  const [viewMode, setViewMode] = useState<ViewMode>('MES');

  const dataHoje = localToday();

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
              const dStr  = `${dia.getFullYear()}-${pad(dia.getMonth()+1)}-${pad(dia.getDate())}`;
              const isCur = dia.getMonth() === viewMes;
              const isSelected = dStr === selectedDate;
              const isToday    = dStr === dataHoje;
              const status     = statusPorDia.get(dStr) ?? null;
              return (
                <button
                  key={idx}
                  onClick={() => isCur && onChange(dStr)}
                  className={[
                    'relative flex flex-col items-center justify-center h-9 rounded-xl text-xs font-semibold transition-all',
                    !isCur ? 'text-gray-200 cursor-default' : 'cursor-pointer',
                    isSelected && isCur ? 'bg-emerald-600 text-white shadow-sm' : '',
                    !isSelected && isCur ? 'text-gray-700 hover:bg-gray-100' : '',
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
              const isSelected = dStr === selectedDate;
              const isToday    = dStr === dataHoje;
              const status     = statusPorDia.get(dStr) ?? null;
              return (
                <button
                  key={idx}
                  onClick={() => onChange(dStr)}
                  className={[
                    'relative flex flex-col items-center justify-center h-12 rounded-xl text-xs font-semibold transition-all cursor-pointer',
                    isSelected ? 'bg-emerald-600 text-white shadow-sm' : '',
                    !isSelected ? 'text-gray-700 hover:bg-gray-100' : '',
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

// ─── AnimalAvatar ─────────────────────────────────────────────────────────────

function AnimalAvatar({ animal, size = 'md' }: {
  animal: GrupoExecucao['animal'];
  size?: 'sm' | 'md' | 'lg';
}) {
  const cls = size === 'lg' ? 'w-14 h-14 text-xl rounded-xl'
            : size === 'sm' ? 'w-9 h-9 text-sm rounded-lg'
            : 'w-11 h-11 text-base rounded-xl';
  return animal.photoUrl ? (
    <img src={animal.photoUrl} alt={animal.nome}
      className={`${cls} object-cover flex-shrink-0`} />
  ) : (
    <div className={`${cls} bg-emerald-100 flex items-center justify-center flex-shrink-0`}>
      <span className="text-emerald-700 font-bold">{animal.nome[0]?.toUpperCase()}</span>
    </div>
  );
}

// ─── ModalExecucao ────────────────────────────────────────────────────────────

interface AlertaEstoque {
  medicamento: string;
  unidade: string;
  qtdNecessaria: number;
  qtdDisponivel: number;
}

function ModalExecucao({
  grupo, onClose, soVisualizacao = false,
}: {
  grupo: GrupoExecucao;
  onClose: () => void;
  soVisualizacao?: boolean;
}) {
  const [execMap,      setExecMap]      = useState<ExecMap>(() => getExecMap(grupo.id));
  const [salvando,     setSalvando]     = useState(false);
  const [erroEstoque,  setErroEstoque]  = useState<AlertaEstoque[]>([]);

  // Itens dentro da janela de tratamento de hoje
  const itensDoDia = grupo.itens.filter(
    i => i.diaAtual >= 1 && i.diaAtual <= i.duracaoDias,
  );

  const itensComInfo = itensDoDia.map(item => {
    const slots      = calcSlots(item);
    const activeIdx  = getActiveSlotIdx(slots);
    const activeDone = activeIdx >= 0 && isSlotDone(execMap, item.id, activeIdx);
    return { item, slots, activeIdx, activeDone };
  });

  const marcados    = itensComInfo.filter(x => x.activeDone).length;
  const totalItens  = itensComInfo.length;
  const todosFeitos = totalItens > 0 && marcados === totalItens;

  // Último dia = todos os itens têm diaAtual >= duracaoDias
  const isUltimoDia = itensComInfo.length > 0 &&
    itensComInfo.every(({ item }) => item.diaAtual >= item.duracaoDias);

  const diaAtualLabel = itensComInfo[0]?.item.diaAtual ?? 1;

  const handleToggle = (item: ItemExecucao, activeIdx: number) => {
    if (activeIdx < 0) return;
    if (isSlotDone(execMap, item.id, activeIdx)) return;
    setErroEstoque([]);
    setExecMap(prev => toggleSlot(grupo.id, prev, item.id, activeIdx));
  };

  const handleFinalizar = async () => {
    setSalvando(true);
    try {
      // Persiste slots ativos em localStorage
      let m = { ...execMap };
      for (const { item, activeIdx } of itensComInfo) {
        if (activeIdx >= 0 && !isSlotDone(m, item.id, activeIdx)) {
          const arr = [...(m[String(item.id)] ?? [])];
          arr.push(activeIdx);
          m[String(item.id)] = arr;
        }
      }
      saveExecMap(grupo.id, m);
      setExecMap(m);

      // Sempre chama o backend: debita estoque do dia + lança na fatura.
      // isUltimoDia = true → grupo transita para EXECUTADO e sai da fila.
      await api.post(`/clinica/prescricoes/grupos/${grupo.id}/executar`, { isUltimoDia });
      toast.success(
        isUltimoDia
          ? 'Tratamento concluído — prescrição finalizada'
          : `Dia ${diaAtualLabel} executado — estoque debitado e fatura lançada`,
      );
      markDoneToday(grupo.id);
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string; erro?: string; alertas?: AlertaEstoque[] } } };
      if (e?.response?.status === 409 && e?.response?.data?.erro === 'ESTOQUE_INSUFICIENTE') {
        setErroEstoque(e.response.data?.alertas ?? []);
      } else {
        toast.error(e?.response?.data?.error ?? 'Erro ao finalizar');
      }
    } finally {
      setSalvando(false);
    }
  };

  const { animal } = grupo;
  const especieInfo = [animal.especie?.nome, animal.raca?.nome].filter(Boolean).join(' • ');

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh]">

        {/* Cabeçalho */}
        <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b border-gray-100 flex-shrink-0">
          <AnimalAvatar animal={animal} size="lg" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-base leading-tight">{animal.nome}</p>
            <p className="text-xs text-gray-500">{especieInfo}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="font-mono text-sm font-bold text-emerald-600">
              #{grupo.numeroFormatado}
            </span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-4 px-4 py-2 text-xs text-gray-500 border-b border-gray-50 flex-shrink-0">
          <span className="flex items-center gap-1">
            <User size={11} /> {grupo.veterinario.fullName}
          </span>
          <span>
            📅 Finalizado:{' '}
            {grupo.finalizadoEm
              ? new Date(grupo.finalizadoEm).toLocaleDateString('pt-BR')
              : '—'}
          </span>
        </div>

        {/* Itens */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            Itens do Dia ({totalItens})
          </p>

          {itensComInfo.length === 0 && (
            <p className="text-center py-8 text-sm text-gray-400">
              Nenhum item ativo para hoje.
            </p>
          )}

          {itensComInfo.map(({ item, slots, activeIdx, activeDone }) => (
            <div key={item.id}
              className={`rounded-xl border transition-colors ${
                activeDone ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-100'
              }`}>
              <div className="flex items-start gap-2.5 p-3">

                {/* Conteúdo */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      item.tipo === 'MEDICAMENTO'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      <Link size={8} />
                      {item.tipo === 'MEDICAMENTO' ? 'Med' : 'Proc'}
                    </span>
                    <p className={`text-sm font-semibold leading-tight ${
                      activeDone ? 'text-gray-400' : 'text-gray-800'
                    }`}>
                      {item.medicamento}
                    </p>
                  </div>

                  <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">
                    {item.dosagem
                      ? `${item.dosagem}${item.unidade ? ' ' + item.unidade : ''} • `
                      : ''}
                    {item.via} • {POSOLOGIAS[item.frequencia] ?? item.frequencia}
                    {item.duracaoDias > 0 ? ` • ${item.duracaoDias} dia(s)` : ''}
                  </p>

                  {/* Slots de horário */}
                  {slots.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {slots.map((slot, idx) => {
                        const done   = isSlotDone(execMap, item.id, idx);
                        const active = idx === activeIdx;
                        const past   = activeIdx >= 0 && idx < activeIdx;
                        return (
                          <span key={slot} className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-medium border transition-all ${
                            done
                              ? 'bg-emerald-500 text-white border-emerald-500'
                              : active
                              ? 'bg-teal-600 text-white border-teal-600 shadow-sm ring-2 ring-teal-200'
                              : past
                              ? 'bg-gray-100 text-gray-400 border-gray-200'
                              : 'bg-white text-gray-400 border-gray-200'
                          }`}>
                            {slot}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <p className="text-[10px] text-gray-400 mt-1">
                    Dia {String(item.diaAtual).padStart(2, '0')}/{String(item.duracaoDias).padStart(2, '0')}
                  </p>
                </div>

                {/* Badge / botão por item */}
                {soVisualizacao ? (
                  <span className="flex-shrink-0 mt-0.5 px-3 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-400 cursor-not-allowed whitespace-nowrap">
                    Somente leitura
                  </span>
                ) : (
                  <button
                    onClick={() => handleToggle(item, activeIdx)}
                    disabled={activeIdx < 0 || activeDone}
                    className={`flex-shrink-0 mt-0.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                      activeDone
                        ? 'bg-emerald-500 text-white cursor-default'
                        : activeIdx < 0
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-white border border-gray-300 text-gray-600 hover:border-teal-500 hover:text-teal-600'
                    }`}>
                    {activeDone ? 'Executado' : activeIdx < 0 ? 'Aguardando' : 'Executar'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Erro de estoque */}
        {erroEstoque.length > 0 && (
          <div className="mx-4 mb-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 space-y-1">
            <p className="font-semibold">Estoque insuficiente para executar:</p>
            {erroEstoque.map((a, i) => (
              <p key={i}>
                • {a.medicamento}: disponível {a.qtdDisponivel.toFixed(1)}{a.unidade ? ` ${a.unidade}` : ''} / necessário {a.qtdNecessaria.toFixed(1)}{a.unidade ? ` ${a.unidade}` : ''}
              </p>
            ))}
          </div>
        )}

        {/* Rodapé */}
        <div className="px-4 pt-2 pb-4 border-t border-gray-100 flex-shrink-0">
          {soVisualizacao ? (
            <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-amber-50 border border-amber-200 text-amber-700">
              <Calendar size={14} />
              Execução disponível apenas para hoje
            </div>
          ) : (
            <>
              <button
                onClick={handleFinalizar}
                disabled={salvando || !todosFeitos}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  todosFeitos
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}>
                {salvando
                  ? <Loader2 size={14} className="animate-spin" />
                  : <CheckCircle2 size={14} />}
                {isUltimoDia ? 'Finalizar Tratamento' : 'Finalizar Dia'}
              </button>
              <p className="text-center text-[10px] text-gray-400 mt-1">
                {marcados}/{totalItens} itens marcados
                {!isUltimoDia && totalItens > 0 && (
                  <span className="ml-1 text-gray-300">
                    · Dia {diaAtualLabel}/{itensComInfo[0]?.item.duracaoDias ?? '—'}
                  </span>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Linha da lista ───────────────────────────────────────────────────────────

function LinhaGrupo({
  g,
  onExecutar,
  onVer,
  onImprimir,
  podeExecutarAcao,
  podeImprimir,
  soVisualizacao,
}: {
  g: GrupoExecucao;
  onExecutar: () => void;
  onVer: () => void;
  onImprimir: () => void;
  podeExecutarAcao: boolean;
  podeImprimir: boolean;
  soVisualizacao: boolean;
}) {
  const navigate    = useNavigate();
  const { animal }  = g;
  const lbaia       = labelBaia(animal.especie?.nome);
  const especieRaca = [animal.especie?.nome, animal.raca?.nome].filter(Boolean).join(' • ');
  const pesoStr     = animal.peso ? `, ${animal.peso}kg` : '';
  const infoAnimal  = `${especieRaca}${pesoStr}`;

  return (
    <div className="bg-white border border-gray-200 rounded-xl flex items-center gap-3 px-3 py-2.5 shadow-sm hover:border-emerald-200 transition-colors">

      <AnimalAvatar animal={animal} size="md" />

      {/* Nome + espécie + baia */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm leading-tight">{animal.nome}</p>
        <p className="text-xs text-gray-500 truncate">{infoAnimal}</p>
        {animal.baia && lbaia && (
          <span className="inline-block mt-0.5 px-2 py-0.5 bg-cyan-50 border border-cyan-200 text-cyan-700 text-[10px] font-bold rounded-full">
            {lbaia} {animal.baia}
          </span>
        )}
      </div>

      {/* Nº Prescrição — link para a prescrição original */}
      <div className="flex-shrink-0 text-center px-3 border-l border-r border-gray-100 hidden sm:block">
        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Nº Prescrição</p>
        <button
          onClick={() => navigate(`/clinica/prescricao/${g.animal.id}`)}
          className="font-mono font-bold text-emerald-600 text-sm hover:text-emerald-800 hover:underline transition-colors"
          title="Ir para a prescrição original"
        >
          #{g.numeroFormatado}
        </button>
      </div>

      {/* Vet + Executor */}
      <div className="flex-shrink-0 text-xs px-3 border-r border-gray-100 hidden md:block min-w-[140px]">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Veterinário Responsável</p>
        <p className="text-gray-700 font-medium truncate">{g.veterinario.fullName}</p>
        {g.executadoPor && (
          <>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide mt-1">Executor</p>
            <p className="text-gray-700 font-medium truncate">{g.executadoPor.fullName}</p>
          </>
        )}
      </div>

      {/* Nº prescrição mobile — link */}
      <button
        onClick={() => navigate(`/clinica/prescricao/${g.animal.id}`)}
        className="font-mono font-bold text-emerald-600 text-xs sm:hidden flex-shrink-0 hover:underline"
      >
        #{g.numeroFormatado}
      </button>

      {/* Ações */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {podeExecutarAcao && !soVisualizacao && (
          <button
            onClick={onExecutar}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors">
            Executar
          </button>
        )}
        <button onClick={onVer}
          className="p-1.5 text-gray-400 hover:text-emerald-600 rounded-lg hover:bg-gray-50 transition-colors">
          <Eye size={14} />
        </button>
        {podeImprimir && (
          <button
            onClick={onImprimir}
            title="Imprimir prescrição"
            className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
            <Printer size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ExecucaoPrescricao() {
  const { user }                               = useAuth();
  const { podeExecutar, isGestor, loading: loadingPerm } = usePermissoes();
  const podeExecutarAcao = isGestor || podeExecutar('enfermagem.prescricao.executar');
  const podeImprimir     = isGestor || podeExecutar('enfermagem.prescricao.imprimir');
  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [grupos,   setGrupos]   = useState<GrupoExecucao[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [busca,    setBusca]    = useState('');
  const [modal,    setModal]    = useState<GrupoExecucao | null>(null);
  const [dataSel,  setDataSel]  = useState(localToday());

  const isHoje = dataSel === localToday();

  const formatDataSel = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const now = new Date();
  const horaAtual = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/clinica/prescricoes/grupos/execucao', { params: { data: dataSel } });
      setGrupos(res.data.dados ?? []);
    } catch {
      toast.error('Erro ao carregar prescrições');
    } finally {
      setLoading(false);
    }
  }, [dataSel]);

  useEffect(() => { if (!loadingPerm) carregar(); }, [carregar, loadingPerm]);

  // Filtro local — o backend já filtra busca mas permite filtrar sem ir ao servidor
  const filtrados = grupos
    .filter(g => !isHoje || !isDoneToday(g.id))
    .filter(busca.trim() ? (g => {
        const q = busca.toLowerCase();
        return (
          g.animal.nome.toLowerCase().includes(q) ||
          (g.animal.baia ?? '').toLowerCase().includes(q) ||
          g.numeroFormatado.includes(q) ||
          g.veterinario.fullName.toLowerCase().includes(q)
        );
      }) : () => true);

  if (loadingPerm) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!podeExecutar('enfermagem.prescricao.ler')) return null;

  return (
    <PageContainer maxWidth="7xl">
      <div className="space-y-5">

        <BotaoVoltar className="mb-6" />

        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <ClipboardList size={20} className="text-emerald-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Execução de Prescrições</h1>
                <span className="text-xs font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Plantão Ativo</span>
              </div>
              <p className="text-sm text-gray-500">Administração de medicamentos e procedimentos do turno.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-medium text-gray-700">{user?.fullName ?? '—'}</span>
            <span className="text-gray-400">• {horaAtual}</span>
          </div>
        </div>

        {/* Layout: Calendário + Conteúdo */}
        <div className="flex flex-col lg:flex-row gap-5">

          {/* Calendário — largura compacta fixa */}
          <div className="lg:w-72 flex-shrink-0">
            <CalendarioInterativo
              selectedDate={dataSel}
              onChange={setDataSel}
              statusPorDia={new Map()}
            />
          </div>

          {/* Painel de prescrições */}
          <div className="flex-1 flex flex-col gap-4">

            {/* Banner somente visualização */}
            {!isHoje && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
                <Calendar size={13} className="flex-shrink-0" />
                <span>
                  Visualizando prescrições de <strong>{formatDataSel(dataSel)}</strong> — execução disponível apenas para hoje.
                </span>
              </div>
            )}

            {/* Busca */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar por Nome, Baia, Prescrição ou Veterinário"
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm"
              />
            </div>

            {/* Lista */}
            {loading ? (
              <div className="flex justify-center py-24">
                <Loader2 size={24} className="animate-spin text-emerald-600" />
              </div>
            ) : filtrados.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-3">
                <CheckCircle2 size={40} />
                <p className="text-sm">
                  {grupos.length === 0
                    ? `Nenhuma prescrição para ${isHoje ? 'hoje' : formatDataSel(dataSel)}`
                    : 'Nenhum resultado para a busca'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtrados.map(g => (
                  <LinhaGrupo
                    key={g.id}
                    g={g}
                    onExecutar={() => podeExecutarAcao ? setModal(g) : semPermissao('executar prescrição')}
                    onVer={() => setModal(g)}
                    onImprimir={() => podeImprimir ? imprimirPrescricao(g) : semPermissao('imprimir prescrição')}
                    podeExecutarAcao={podeExecutarAcao}
                    podeImprimir={podeImprimir}
                    soVisualizacao={!isHoje}
                  />
                ))}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Modal de execução */}
      {modal && (
        <ModalExecucao
          grupo={modal}
          onClose={() => { setModal(null); carregar(); }}
          soVisualizacao={!isHoje}
        />
      )}
    </PageContainer>
  );
}

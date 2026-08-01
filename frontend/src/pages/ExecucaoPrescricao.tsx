// frontend/src/pages/ExecucaoPrescricao.tsx

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, ClipboardList, Loader2, Search,
  Eye, Printer, ChevronLeft, ChevronRight, Calendar,
  User, X, Link, Ban, Syringe, Pill,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import ModalJustificativa from '../components/ModalJustificativa';
import toast from 'react-hot-toast';
import api from '../services/api';
import { imprimirPrescricao, type PrintGrupoPrescricao, type PrintItemPrescricao } from '../utils/PrescricaoPrint';
import { formatDate } from '../utils/dateUtils';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import InlineError from '../components/InlineError';

// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface ItemExecucao {
  id:              number;
  tipo:            'MEDICAMENTO' | 'PROCEDIMENTO';
  medicamento:     string;
  dosagem:         string | null;
  unidade:         string | null;
  via:             string;
  frequencia:      string;
  horaInicio:      string | null;
  horariosGerados: string[] | null;
  duracaoDias:     number;
  observacao:      string | null;
  dataInicio:      string;
  diaAtual:        number;
  executadoEm?:    string | null; // última execução do item (atualizado a cada dia)
}

export interface GrupoExecucao {
  id:              number;
  numero:          number;
  numeroFormatado: string;
  status:          string;
  motivoCancelamento?: string | null;
  finalizadoEm:    string | null;
  finalizadoPor:   { id: number; fullName: string } | null;
  executadoPor:    { id: number; fullName: string } | null;
  veterinario:     { id: number; fullName: string };
  animal: {
    id:       number;
    nome:     string;
    photoUrl: string | null;
    peso:     number | null;
    baia:     string | null;
    especie:  { nome: string } | null;
    raca:     { nome: string } | null;
  };
  itens: ItemExecucao[];
}

export type ExecMap = Record<string, number[]>;

// Vacina FINALIZADA aguardando aplicação no plantão (vem de /clinica/vacinas/para-execucao)
export interface VacinaExecucao {
  id:              number;
  nome:            string;
  fabricante:      string | null;
  lote:            string | null;
  dose:            string | null;
  via:             string | null;
  quantidade:      number | null;
  numero:          number | null;
  tipoAtendimento: string | null;
  dataAplicacao:   string;
  dataReforco:     string | null;
  observacao:      string | null;
  animal:          GrupoExecucao['animal'];
  veterinario:     { id: number; fullName: string } | null;
}

interface AlertaEstoque {
  medicamento:   string;
  unidade:       string;
  qtdNecessaria: number;
  qtdDisponivel: number;
}

// ─── Shared Helpers ───────────────────────────────────────────────────────────

export const POSOLOGIAS: Record<string, string> = {
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

export function calcSlots(item: ItemExecucao): string[] {
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

export function getActiveSlotIdx(slots: string[]): number {
  if (!slots.length || slots[0] === 'Dose única') return 0;
  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let active   = -1;
  for (let i = 0; i < slots.length; i++) {
    const [hh, mm] = slots[i].split(':').map(Number);
    if (hh * 60 + mm <= nowMin) active = i;
  }
  return active;
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const execKey      = (grupoId: number) => `s2vet_exec_${grupoId}_${localToday()}`;
const doneTodayKey = (grupoId: number) => `s2vet_done_${grupoId}_${localToday()}`;

export function getExecMap(grupoId: number): ExecMap {
  try { return JSON.parse(localStorage.getItem(execKey(grupoId)) ?? '{}'); }
  catch { return {}; }
}

export function saveExecMap(grupoId: number, map: ExecMap) {
  localStorage.setItem(execKey(grupoId), JSON.stringify(map));
}

export function markDoneToday(grupoId: number) {
  // Guarda o HORÁRIO da execução (exibido no histórico de executadas do dia)
  const now  = new Date();
  const hora = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  localStorage.setItem(doneTodayKey(grupoId), hora);
}

export function isDoneToday(grupoId: number): boolean {
  return !!localStorage.getItem(doneTodayKey(grupoId));
}

export function horaExecucaoHoje(grupoId: number): string | null {
  const v = localStorage.getItem(doneTodayKey(grupoId));
  return v && v.includes(':') ? v : null; // registros antigos ('1') ficam sem horário
}

export function isSlotDone(map: ExecMap, itemId: number, slotIdx: number): boolean {
  return (map[String(itemId)] ?? []).includes(slotIdx);
}

export function toggleSlot(grupoId: number, map: ExecMap, itemId: number, slotIdx: number): ExecMap {
  const updated = { ...map };
  const arr     = [...(updated[String(itemId)] ?? [])];
  const pos     = arr.indexOf(slotIdx);
  if (pos >= 0) arr.splice(pos, 1); else arr.push(slotIdx);
  updated[String(itemId)] = arr;
  saveExecMap(grupoId, updated);
  return updated;
}

// ─── AnimalAvatar ─────────────────────────────────────────────────────────────

export function AnimalAvatar({ animal, size = 'md' }: {
  animal: { nome: string; photoUrl: string | null };
  size?: 'sm' | 'md' | 'lg';
}) {
  const cls = size === 'lg' ? 'w-14 h-14 text-xl rounded-xl'
            : size === 'sm' ? 'w-9 h-9 text-sm rounded-lg'
            :                 'w-11 h-11 text-base rounded-xl';
  return animal.photoUrl ? (
    <img src={animal.photoUrl} alt={animal.nome}
      className={`${cls} object-cover flex-shrink-0`} />
  ) : (
    <div className={`${cls} bg-emerald-100 flex items-center justify-center flex-shrink-0`}>
      <span className="text-emerald-700 font-bold">{animal.nome[0]?.toUpperCase()}</span>
    </div>
  );
}

// ─── VacinaExecViewModal — detalhes da vacina a aplicar (somente leitura) ──────

function VacRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-gray-400 w-28 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 font-medium">{value}</span>
    </div>
  );
}

function VacinaExecViewModal({ v, onClose, onImprimir }: {
  v:          VacinaExecucao;
  onClose:    () => void;
  onImprimir: () => void;
}) {
  const vcNum = v.numero != null
    ? `${v.tipoAtendimento ?? 'VC'}-${String(v.numero).padStart(4, '0')}`
    : null;
  const especieInfo = [v.animal.especie?.nome, v.animal.raca?.nome].filter(Boolean).join(' • ');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Syringe size={16} className="text-teal-600" />
            <h3 className="font-bold text-gray-900">Detalhes da Vacina</h3>
            {vcNum && (
              <span className="text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-lg">{vcNum}</span>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <VacRow label="Paciente" value={`${v.animal.nome}${especieInfo ? ` — ${especieInfo}` : ''}`} />
          <VacRow label="Vacina" value={v.nome} />
          {v.dose && <VacRow label="Tipo Dose" value={v.dose} />}
          {v.quantidade != null && v.quantidade > 1 && <VacRow label="Qtd Doses" value={String(v.quantidade)} />}
          {v.via && <VacRow label="Via" value={v.via} />}
          {v.fabricante && <VacRow label="Fabricante" value={v.fabricante} />}
          {v.lote && <VacRow label="Lote" value={v.lote} />}
          <VacRow label="Aplicação" value={formatDate(v.dataAplicacao)} />
          {v.dataReforco && <VacRow label="Reforço" value={formatDate(v.dataReforco)} />}
          {v.veterinario && <VacRow label="Prescrito por" value={v.veterinario.fullName} />}
          {v.observacao && <VacRow label="Obs." value={v.observacao} />}
        </div>
        <div className="flex gap-2 px-5 pb-5 pt-2 border-t border-gray-100">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Fechar
          </button>
          <button onClick={onImprimir}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            <Printer size={14} /> Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ModalExecucao ────────────────────────────────────────────────────────────

export function ModalExecucao({
  grupo,
  onClose,
  soVisualizacao = false,
  podeCancelar = false,
}: {
  grupo:           GrupoExecucao;
  onClose:         () => void;
  soVisualizacao?: boolean;
  /** `enfermagem.prescricao.deletar` — o botão Cancelar do rodapé era o único da tela
   *  sem gate de permissão. Default false: quem não passar a prop não mostra a ação. */
  podeCancelar?:   boolean;
}) {
  const [execMap,     setExecMap]     = useState<ExecMap>(() => getExecMap(grupo.id));
  const [salvando,    setSalvando]    = useState(false);
  const [erroEstoque, setErroEstoque] = useState<AlertaEstoque[]>([]);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Item escolhido para cancelar (botão ao lado do item). O cancelamento da PRESCRIÇÃO
  // inteira não mora mais aqui — é o botão da linha na lista de /execucao-prescricao.
  const [cancelarItem, setCancelarItem] = useState<ItemExecucao | null>(null);
  const [cancelando,   setCancelando]   = useState(false);

  const itensDoDia = grupo.itens.filter(
    i => i.diaAtual >= 1 && i.diaAtual <= i.duracaoDias,
  );

  // Item já executado HOJE no backend (fonte de verdade — cobre itens sem horários
  // gerados e reaberturas em que o mapa local não registrou a execução).
  const executadoHojeFront = (item: ItemExecucao): boolean => {
    if (!item.executadoEm) return false;
    const d = new Date(item.executadoEm);
    const h = new Date();
    return d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth() && d.getDate() === h.getDate();
  };

  const itensComInfo = itensDoDia.map(item => {
    const slots      = calcSlots(item);
    const activeIdx  = getActiveSlotIdx(slots);
    const activeDone = executadoHojeFront(item) || (activeIdx >= 0 && isSlotDone(execMap, item.id, activeIdx));
    return { item, slots, activeIdx, activeDone };
  });

  const marcados    = itensComInfo.filter(x => x.activeDone).length;
  const totalItens  = itensComInfo.length;
  const todosFeitos = totalItens > 0 && marcados === totalItens;

  const isUltimoDia = itensComInfo.length > 0 &&
    itensComInfo.every(({ item }) => item.diaAtual >= item.duracaoDias);

  const diaAtualLabel = itensComInfo[0]?.item.diaAtual ?? 1;

  // Marca todos os slots de HOJE do item como concluídos (a dose diária é única —
  // executar uma vez cobre o dia inteiro do item). Sem horários gerados (slots vazio),
  // getActiveSlotIdx usa o índice 0 — por isso marcamos no mínimo [0], senão o botão
  // continuaria habilitado.
  const marcarItemFeito = (m: ExecMap, itemId: number, slots: string[]): ExecMap => {
    const updated = { ...m };
    const n = Math.max(slots.length, 1);
    updated[String(itemId)] = Array.from({ length: n }, (_, idx) => idx);
    return updated;
  };

  const tratarErroExec = (err: unknown, fallback: string) => {
    const e = err as { response?: { status?: number; data?: { error?: string; erro?: string; alertas?: AlertaEstoque[] } } };
    if (e?.response?.status === 409 && e?.response?.data?.erro === 'ESTOQUE_INSUFICIENTE') {
      setErroEstoque(e.response.data?.alertas ?? []);
    } else {
      setErroInline(e?.response?.data?.error ?? fallback);
    }
  };

  // Execução ITEM A ITEM: lança o item na fatura assim que ele é executado.
  const handleExecutarItem = async (item: ItemExecucao, slots: string[]) => {
    if (salvando) return;
    setSalvando(true);
    setErroEstoque([]);
    try {
      await api.post(`/clinica/prescricoes/grupos/${grupo.id}/executar`, { itemIds: [item.id] });
      const m = marcarItemFeito(execMap, item.id, slots);
      saveExecMap(grupo.id, m);
      setExecMap(m);
      toast.success(`${item.medicamento} — executado e lançado na fatura`);
      // Execução é POR ITEM: mantém o modal aberto para executar os demais. Só fecha
      // quando TODOS os itens do dia já estão executados (este + os demais já feitos).
      const todosExecutados = itensComInfo.every(x => x.item.id === item.id || x.activeDone);
      if (todosExecutados) { markDoneToday(grupo.id); onClose(); }
    } catch (err) {
      tratarErroExec(err, 'Erro ao executar item');
    } finally {
      setSalvando(false);
    }
  };

  // Executa TODOS os itens restantes do dia de uma vez (backend ignora os já
  // executados hoje). Cada item continua sendo faturado individualmente.
  const handleExecutarTodos = async () => {
    setSalvando(true);
    setErroEstoque([]);
    try {
      await api.post(`/clinica/prescricoes/grupos/${grupo.id}/executar`, {});
      let m = { ...execMap };
      for (const { item, slots, activeIdx } of itensComInfo) {
        if (activeIdx >= 0) m = marcarItemFeito(m, item.id, slots);
      }
      saveExecMap(grupo.id, m);
      setExecMap(m);
      toast.success(
        isUltimoDia
          ? 'Tratamento concluído — prescrição finalizada'
          : `Dia ${diaAtualLabel} executado — estoque debitado e fatura lançada`,
      );
      markDoneToday(grupo.id);
      onClose();
    } catch (err) {
      tratarErroExec(err, 'Erro ao finalizar');
    } finally {
      setSalvando(false);
    }
  };

  // Cancela UM item da prescrição (justificado + auditado). Mesma regra da tela de
  // prescrição: se QUALQUER item do documento já foi executado, o backend recusa com
  // 400 — o que já foi aplicado tem fatura e baixa de estoque e não pode ficar órfão.
  // Fecha o modal ao concluir: o `onClose` do pai recarrega a lista, que é a fonte da
  // verdade dos itens (evita a tela seguir mostrando um item que não existe mais).
  const handleCancelarItem = async (motivo: string) => {
    if (!cancelarItem) return;
    const alvo = cancelarItem;
    setCancelando(true);
    try {
      await api.delete(
        `/clinica/prescricoes/grupos/${grupo.id}/itens/${alvo.id}/cancelar-plantao`,
        { data: { motivo } },
      );
      toast.success(`${alvo.medicamento} — cancelado`);
      setCancelarItem(null);
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setCancelarItem(null);
      setErroInline(e?.response?.data?.error ?? 'Erro ao cancelar item');
    } finally {
      setCancelando(false);
    }
  };

  const { animal } = grupo;
  const especieInfo = [animal.especie?.nome, animal.raca?.nome].filter(Boolean).join(' • ');

  return (
    <>
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh]">

        <InlineError message={erroInline} className="mx-4 mt-3 flex-shrink-0" />

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

                {soVisualizacao ? (
                  <span className="flex-shrink-0 mt-0.5 px-3 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-400 cursor-not-allowed whitespace-nowrap">
                    Somente leitura
                  </span>
                ) : (
                  <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                    <button
                      // Execução item a item: já debita o estoque e lança este item na fatura.
                      onClick={() => handleExecutarItem(item, slots)}
                      disabled={activeIdx < 0 || activeDone || salvando}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                        activeDone
                          ? 'bg-emerald-500 text-white cursor-default'
                          : activeIdx < 0
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}>
                      {activeDone ? 'Executado'
                        : activeIdx < 0 ? 'Aguardando'
                        : salvando ? 'Executando…'
                        : 'Executar'}
                    </button>
                    {podeCancelar && (
                      <button
                        onClick={() => { setErroInline(null); setCancelarItem(item); }}
                        disabled={salvando || cancelando}
                        title="Cancelar item"
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                        <Ban size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

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

        <div className="px-4 pt-2 pb-4 border-t border-gray-100 flex-shrink-0">
          {grupo.status === 'CANCELADO' ? (
            <div className="py-2.5 px-3 rounded-xl text-sm font-semibold bg-red-50 border border-red-200 text-red-600 text-center">
              <span className="inline-flex items-center gap-2"><Ban size={14} /> Prescrição cancelada</span>
              {grupo.motivoCancelamento && (
                <p className="text-xs font-normal text-red-500 mt-1">Motivo: {grupo.motivoCancelamento}</p>
              )}
            </div>
          ) : soVisualizacao ? (
            <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-amber-50 border border-amber-200 text-amber-700">
              <Calendar size={14} />
              Execução disponível apenas para hoje
            </div>
          ) : (
            <>
              {/* Rodapé é só Executar + FECHAR, à direita e no tamanho padrão da aplicação
                  (mesmas classes dos botões de ação da tela de prescrição). Cancelar a
                  prescrição inteira é o botão da linha na lista; cancelar item é o botão
                  ao lado de cada item, acima. */}
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleExecutarTodos}
                  disabled={salvando || todosFeitos}
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5">
                  {salvando
                    ? <Loader2 size={13} className="animate-spin" />
                    : <CheckCircle2 size={13} />}
                  Executar Todos
                </button>
                <button
                  onClick={onClose}
                  disabled={salvando}
                  className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                  Fechar
                </button>
              </div>
              <p className="text-center text-[10px] text-gray-400 mt-1">
                {marcados}/{totalItens} itens executados
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

    {cancelarItem && (
      <ModalJustificativa
        aberto
        titulo={`Cancelar item — ${cancelarItem.medicamento}`}
        descricao={`Cancela este item da prescrição #${grupo.numeroFormatado} e libera o estoque reservado dele. Os demais itens seguem normalmente. A justificativa vai para a auditoria.`}
        acaoLabel="Cancelar item"
        onConfirmar={handleCancelarItem}
        onFechar={() => { if (!cancelando) setCancelarItem(null); }}
      />
    )}
    </>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DiaStatus = 'LIVRE' | 'PARCIAL' | 'OCUPADO';
type ViewMode  = 'MES' | 'SEMANA';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function labelBaia(especieNome: string | null | undefined): 'Baia' | 'Leito' | null {
  if (!especieNome) return null;
  const n = especieNome.toLowerCase();
  if (n.includes('equino') || n.includes('cavalo')) return 'Baia';
  if (n.includes('canino') || n.includes('felino') || n.includes('gato') ||
      n.includes('cachorro') || n.includes('cão')  || n.includes('cao')) return 'Leito';
  return null;
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
        {statusPorDia.size > 0 && (
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            {(['LIVRE','PARCIAL','OCUPADO'] as DiaStatus[]).map(s => (
              <span key={s} className="flex items-center gap-1 text-[10px] font-semibold text-gray-500">
                <span className={`w-2 h-2 rounded-full inline-block ${DOT_COR[s]}`} /> {DOT_LABEL[s]}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-7 mb-1">
          {DIAS_PT.map(d => (
            <div key={d} className="text-center text-[9px] font-bold text-gray-400 uppercase py-1">{d}</div>
          ))}
        </div>

        {viewMode === 'MES' && (
          <div className="grid grid-cols-7 gap-0.5">
            {dias.map((dia, idx) => {
              const dStr  = `${dia.getFullYear()}-${pad(dia.getMonth()+1)}-${pad(dia.getDate())}`;
              const isCur = dia.getMonth() === viewMes;
              const isSelected = dStr === selectedDate;
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

        {viewMode === 'SEMANA' && (
          <div className="grid grid-cols-7 gap-0.5">
            {weekDays.map((dia, idx) => {
              const dStr = `${dia.getFullYear()}-${pad(dia.getMonth()+1)}-${pad(dia.getDate())}`;
              const isSelected = dStr === selectedDate;
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

// ─── Linha da lista ───────────────────────────────────────────────────────────

function LinhaGrupo({
  g,
  onExecutar,
  onVer,
  onImprimir,
  onCancelar,
  podeExecutarAcao,
  podeImprimir,
  podeCancelar = false,
  soVisualizacao,
  executada = false,
  horaExecucao = null,
}: {
  g: GrupoExecucao;
  onExecutar: () => void;
  onVer: () => void;
  onImprimir: () => void;
  onCancelar?: () => void;
  podeExecutarAcao: boolean;
  podeImprimir: boolean;
  /** `enfermagem.prescricao.deletar`. O chamador já desconta prescrição cancelada
   *  ou executada — cancelar depois da execução é recusado pelo backend (400). */
  podeCancelar?: boolean;
  soVisualizacao: boolean;
  executada?: boolean;
  horaExecucao?: string | null;
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

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm leading-tight">{animal.nome}</p>
        <p className="text-xs text-gray-500 truncate">{infoAnimal}</p>
        {animal.baia && lbaia && (
          <span className="inline-block mt-0.5 px-2 py-0.5 bg-cyan-50 border border-cyan-200 text-cyan-700 text-[10px] font-bold rounded-full">
            {lbaia} {animal.baia}
          </span>
        )}
      </div>

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

      <button
        onClick={() => navigate(`/clinica/prescricao/${g.animal.id}`)}
        className="font-mono font-bold text-emerald-600 text-xs sm:hidden flex-shrink-0 hover:underline"
      >
        #{g.numeroFormatado}
      </button>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {g.status === 'CANCELADO' && (
          <span className="flex items-center gap-1 px-2.5 py-1 bg-red-50 border border-red-200 text-red-600 text-[10px] font-bold rounded-full whitespace-nowrap"
            title={g.motivoCancelamento ?? undefined}>
            <Ban size={11} /> Cancelada
          </span>
        )}
        {executada && (
          <span className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold rounded-full whitespace-nowrap">
            <CheckCircle2 size={11} /> Executada{horaExecucao ? ` às ${horaExecucao}` : ''}
          </span>
        )}
        {podeExecutarAcao && !soVisualizacao && !executada && (
          <button
            onClick={onExecutar}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors">
            Executar
          </button>
        )}
        {/* Ações disponíveis nascem PINTADAS (mesma paleta da tela de prescrição):
            emerald = ver, azul = imprimir, vermelho = cancelar. Cinza fica reservado
            para o que está indisponível — ação habilitada não se disfarça de desativada. */}
        {podeCancelar && onCancelar && (
          <button
            onClick={onCancelar}
            title="Cancelar prescrição"
            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Ban size={14} />
          </button>
        )}
        <button onClick={onVer} title="Ver prescrição"
          className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors">
          <Eye size={14} />
        </button>
        {podeImprimir && (
          <button
            onClick={onImprimir}
            title="Imprimir prescrição"
            className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
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
  // Cancelar a prescrição pelo plantão — slug próprio, separado de executar.
  const podeCancelar     = isGestor || podeExecutar('enfermagem.prescricao.deletar');
  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [grupos,   setGrupos]   = useState<GrupoExecucao[]>([]);
  const [vacinas,  setVacinas]  = useState<VacinaExecucao[]>([]);
  const [execVacinaId, setExecVacinaId] = useState<number | null>(null);
  const [viewingVac, setViewingVac] = useState<VacinaExecucao | null>(null);
  // Erro da execução da vacina exibido COLADO no card da vacina (abaixo do botão),
  // não no topo da página — cada erro fica junto da ação que o gerou.
  const [erroVacina, setErroVacina] = useState<{ id: number; msg: string } | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [busca,    setBusca]    = useState('');
  const [modal,    setModal]    = useState<GrupoExecucao | null>(null);
  // Intenção da abertura do modal: "Ver" (olho) força SOMENTE LEITURA mesmo em
  // prescrição de hoje ainda executável — só o botão "Executar" abre em modo de execução.
  const [modalVer, setModalVer] = useState(false);
  const [dataSel,  setDataSel]  = useState(localToday());
  // Prescrição escolhida para cancelar (abre o ModalJustificativa da lista)
  const [cancelarAlvo, setCancelarAlvo] = useState<GrupoExecucao | null>(null);
  const [cancelando,   setCancelando]   = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const isHoje = dataSel === localToday();

  // Fila cross-animal — busca o logo da empresa/equipe no momento da impressão
  // (não há um único animal em contexto na tela, como nas demais páginas).
  const handleImprimirGrupo = async (g: GrupoExecucao) => {
    let logoUrl: string | null = null;
    try {
      const res = await api.get(`/animais/${g.animal.id}/logo-empresa`);
      logoUrl = res.data?.dados?.logoUrl ?? null;
    } catch { /* silencioso — fallback: marca S2Vet no template */ }
    imprimirPrescricao({ ...g, animal: { ...g.animal, logoUrl } });
  };

  const formatDataSel = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const now = new Date();
  const horaAtual = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      // Prescrições da data + vacinas FINALIZADAS aguardando aplicação (dose única,
      // não são filtradas por data — aparecem até serem executadas).
      const [presRes, vacRes] = await Promise.all([
        api.get('/clinica/prescricoes/grupos/execucao', { params: { data: dataSel } }),
        api.get('/clinica/vacinas/para-execucao'),
      ]);
      setGrupos(presRes.data.dados ?? []);
      setVacinas(vacRes.data?.dados ?? []);
    } catch {
      setErroInline('Erro ao carregar prescrições');
    } finally {
      setLoading(false);
    }
  }, [dataSel]);

  useEffect(() => { if (!loadingPerm) carregar(); }, [carregar, loadingPerm]);

  // Cancela a prescrição a partir do plantão. Aponta para `cancelar-plantao`, que no
  // backend é o MESMO controller do cancelar da tela de prescrição — logo, mesma regra:
  // prescrição com QUALQUER execução é recusada (400 EXECUTADO), porque o que já foi
  // aplicado tem item de fatura e baixa de estoque e não pode ficar órfão.
  const handleCancelarGrupo = async (motivo: string) => {
    if (!cancelarAlvo) return;
    if (!podeCancelar) { semPermissao('cancelar prescrição'); return; }
    const alvo = cancelarAlvo;
    setCancelando(true);
    try {
      await api.post(`/clinica/prescricoes/grupos/${alvo.id}/cancelar-plantao`, { motivo });
      toast.success(`Prescrição #${alvo.numeroFormatado} cancelada`);
      setCancelarAlvo(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      // Fecha o modal para o erro não ficar atrás dele (o InlineError vive na página)
      setCancelarAlvo(null);
      setErroInline(msg ?? 'Erro ao cancelar prescrição');
    } finally {
      setCancelando(false);
    }
  };

  // Impressão da vacina — reutiliza o gerador da prescrição (a vacina vira um "grupo"
  // de um único item), igual ao imprimirVacina da tela de Vacina.
  const imprimirVacinaExec = async (v: VacinaExecucao) => {
    let logoUrl: string | null = null;
    try {
      const res = await api.get(`/animais/${v.animal.id}/logo-empresa`);
      logoUrl = res.data?.dados?.logoUrl ?? null;
    } catch { /* silencioso — fallback: marca S2Vet no template */ }

    const vcNum = v.numero != null
      ? `${v.tipoAtendimento ?? 'VC'}-${String(v.numero).padStart(4, '0')}`
      : `VC-${String(v.id).padStart(4, '0')}`;

    const item: PrintItemPrescricao = {
      id:              v.id,
      tipo:            'MEDICAMENTO',
      medicamento:     v.nome,
      dosagem:         v.dose,
      unidade:         v.quantidade != null && v.quantidade > 1 ? `${v.quantidade} doses` : null,
      via:             v.via ?? '—',
      frequencia:      v.dataReforco ? `Reforço em ${formatDate(v.dataReforco)}` : 'Dose única',
      horaInicio:      null,
      horariosGerados: null,
      duracaoDias:     1,
      observacao:      [v.fabricante ? `Fabricante: ${v.fabricante}` : null, v.lote ? `Lote: ${v.lote}` : null, v.observacao].filter(Boolean).join(' · ') || null,
      dataInicio:      v.dataAplicacao,
    };

    const grupo: PrintGrupoPrescricao = {
      numero:          v.numero ?? 0,
      numeroFormatado: vcNum,
      status:          'FINALIZADO',
      finalizadoEm:    null,
      finalizadoPor:   null,
      executadoPor:    null,
      veterinario:     v.veterinario ? { fullName: v.veterinario.fullName } : { fullName: '—' },
      animal: {
        nome:     v.animal.nome,
        photoUrl: v.animal.photoUrl,
        peso:     v.animal.peso,
        baia:     v.animal.baia ?? null,
        especie:  v.animal.especie,
        raca:     v.animal.raca,
        logoUrl,
      },
      itens: [item],
    };
    imprimirPrescricao(grupo);
  };

  const executarVacina = async (v: VacinaExecucao) => {
    setErroVacina(null);
    if (!podeExecutarAcao) {
      setErroVacina({ id: v.id, msg: 'Sem permissão para executar vacina. Verifique com o responsável.' });
      return;
    }
    setExecVacinaId(v.id);
    try {
      await api.patch(`/clinica/vacinas/${v.id}/executar`);
      toast.success(`${v.nome} — aplicada e lançada na fatura`);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroVacina({ id: v.id, msg: msg ?? 'Erro ao executar vacina' });
    } finally {
      setExecVacinaId(null);
    }
  };

  const vacinasFiltradas = vacinas.filter(busca.trim()
    ? (v => {
        const q = busca.toLowerCase();
        return (
          v.animal.nome.toLowerCase().includes(q) ||
          v.nome.toLowerCase().includes(q) ||
          (v.veterinario?.fullName ?? '').toLowerCase().includes(q)
        );
      })
    : () => true);

  const aplicarBusca = (lista: GrupoExecucao[]) =>
    lista.filter(busca.trim() ? (g => {
        const q = busca.toLowerCase();
        return (
          g.animal.nome.toLowerCase().includes(q) ||
          (g.animal.baia ?? '').toLowerCase().includes(q) ||
          g.numeroFormatado.includes(q) ||
          g.veterinario.fullName.toLowerCase().includes(q)
        );
      }) : () => true);

  // Item ainda a executar HOJE: dentro da janela do dia e ainda não executado hoje.
  const itemPendenteHoje = (item: ItemExecucao): boolean => {
    const dentroJanela = item.diaAtual >= 1 && item.diaAtual <= item.duracaoDias;
    const feitoHoje = !!item.executadoEm && String(item.executadoEm).slice(0, 10) === dataSel;
    return dentroJanela && !feitoHoje;
  };

  // Grupo concluído hoje (vai para o Histórico) SÓ quando: totalmente executado
  // (EXECUTADO) ou sem NENHUM item pendente para hoje. Com execução item a item,
  // a prescrição continua em "a executar" enquanto houver item do dia não executado.
  const foiExecutadoHoje = (g: GrupoExecucao): boolean =>
    g.status === 'EXECUTADO' || !g.itens.some(itemPendenteHoje);

  // Hora da execução para o badge: localStorage (hora exata do clique) com
  // fallback no executadoEm dos itens vindo do backend.
  const horaExecucaoDe = (g: GrupoExecucao): string | null => {
    const local = horaExecucaoHoje(g.id);
    if (local) return local;
    const ultima = g.itens
      .map(i => (i.executadoEm ? new Date(i.executadoEm) : null))
      .filter((d): d is Date => !!d && !isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (!ultima) return null;
    return `${String(ultima.getHours()).padStart(2, '0')}:${String(ultima.getMinutes()).padStart(2, '0')}`;
  };

  // Pendentes: mesma regra de sempre — só aparecem no dia da execução.
  // Executadas (hoje): vão para o HISTÓRICO abaixo, somente leitura.
  // Canceladas: sempre na lista principal, com badge "Cancelada" e execução bloqueada.
  const filtrados = aplicarBusca(grupos.filter(g =>
    g.status === 'CANCELADO' ? true : (isHoje ? !foiExecutadoHoje(g) : g.status !== 'EXECUTADO')));
  const executadasHoje = isHoje
    ? aplicarBusca(grupos.filter(g => g.status !== 'CANCELADO' && foiExecutadoHoje(g)))
    : [];

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

        <InlineError message={erroInline} className="mb-4" />

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

        <div className="flex flex-col lg:flex-row gap-5">

          <div className="lg:w-72 flex-shrink-0">
            <CalendarioInterativo
              selectedDate={dataSel}
              onChange={setDataSel}
              statusPorDia={new Map()}
            />
          </div>

          <div className="flex-1 flex flex-col gap-4">

            {!isHoje && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
                <Calendar size={13} className="flex-shrink-0" />
                <span>
                  Visualizando prescrições de <strong>{formatDataSel(dataSel)}</strong> — execução disponível apenas para hoje.
                </span>
              </div>
            )}

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

            {!loading && filtrados.length > 0 && (
              <div className="flex items-center justify-between px-1 pb-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Pill size={13} className="text-emerald-600" /> Medicamentos a aplicar
                </p>
                <span className="text-xs text-gray-400">
                  {filtrados.length} prescrição{filtrados.length !== 1 ? 'ões' : ''}
                </span>
              </div>
            )}

            {loading ? (
              <div className="flex justify-center py-24">
                <Loader2 size={24} className="animate-spin text-emerald-600" />
              </div>
            ) : filtrados.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-3">
                <CheckCircle2 size={40} />
                <p className="text-sm">
                  {grupos.length === 0
                    ? `Nenhuma prescrição para ${isHoje ? 'hoje' : formatDataSel(dataSel)}`
                    : executadasHoje.length > 0
                    ? 'Todas as prescrições de hoje já foram executadas'
                    : 'Nenhum resultado para a busca'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtrados.map(g => (
                  <LinhaGrupo
                    key={g.id}
                    g={g}
                    onExecutar={() => { if (!podeExecutarAcao) { semPermissao('executar prescrição'); return; } setModalVer(false); setModal(g); }}
                    onVer={() => { setModalVer(true); setModal(g); }}
                    onImprimir={() => podeImprimir ? handleImprimirGrupo(g) : semPermissao('imprimir prescrição')}
                    onCancelar={() => { setErroInline(null); setCancelarAlvo(g); }}
                    podeExecutarAcao={podeExecutarAcao && g.status !== 'CANCELADO'}
                    podeImprimir={podeImprimir}
                    podeCancelar={podeCancelar && g.status !== 'CANCELADO'}
                    soVisualizacao={!isHoje || g.status === 'CANCELADO'}
                  />
                ))}
              </div>
            )}

            {/* ── Vacinas a aplicar (FINALIZADAS) — só no dia de hoje ─────── */}
            {!loading && isHoje && vacinasFiltradas.length > 0 && (
              <div className="pt-2">
                <div className="flex items-center justify-between px-1 pb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Syringe size={13} className="text-teal-600" /> Vacinas a aplicar
                  </p>
                  <span className="text-xs text-gray-400">
                    {vacinasFiltradas.length} vacina{vacinasFiltradas.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {vacinasFiltradas.map(v => (
                    <div key={v.id}
                      className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 shadow-sm hover:border-teal-200 transition-colors">
                      <div className="flex items-center gap-3">
                      <AnimalAvatar animal={v.animal} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm leading-tight truncate">{v.animal.nome}</p>
                        <p className="text-xs text-gray-600 truncate">
                          <span className="font-medium">{v.nome}</span>
                          {v.dose ? ` · ${v.dose}` : ''}{v.via ? ` · ${v.via}` : ''}
                          {v.quantidade && v.quantidade > 1 ? ` · ${v.quantidade} doses` : ''}
                        </p>
                        {v.veterinario && (
                          <p className="text-[11px] text-gray-400 truncate">Prescrito por {v.veterinario.fullName}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {podeExecutarAcao && (
                          <button
                            onClick={() => executarVacina(v)}
                            disabled={execVacinaId === v.id}
                            className="flex items-center gap-1.5 px-4 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 text-white text-xs font-semibold rounded-lg transition-colors">
                            {execVacinaId === v.id ? <Loader2 size={12} className="animate-spin" /> : <Syringe size={12} />}
                            Executar
                          </button>
                        )}
                        <button onClick={() => setViewingVac(v)}
                          className="p-1.5 text-gray-400 hover:text-teal-600 rounded-lg hover:bg-gray-50 transition-colors">
                          <Eye size={14} />
                        </button>
                        {podeImprimir && (
                          <button onClick={() => imprimirVacinaExec(v)}
                            title="Imprimir vacina"
                            className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
                            <Printer size={14} />
                          </button>
                        )}
                      </div>
                      </div>
                      {erroVacina?.id === v.id && (
                        <InlineError message={erroVacina.msg} className="mt-2" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Histórico — prescrições já executadas hoje ─────────────── */}
            {!loading && executadasHoje.length > 0 && (
              <div className="pt-2">
                <div className="flex items-center justify-between px-1 pb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Histórico — executadas hoje
                  </p>
                  <span className="text-xs text-gray-400">
                    {executadasHoje.length} prescrição{executadasHoje.length !== 1 ? 'ões' : ''}
                  </span>
                </div>
                <div className="space-y-2 opacity-90">
                  {executadasHoje.map(g => (
                    <LinhaGrupo
                      key={g.id}
                      g={g}
                      onExecutar={() => {}}
                      onVer={() => { setModalVer(true); setModal(g); }}
                      onImprimir={() => podeImprimir ? handleImprimirGrupo(g) : semPermissao('imprimir prescrição')}
                      podeExecutarAcao={false}
                      podeImprimir={podeImprimir}
                      soVisualizacao
                      executada
                      horaExecucao={horaExecucaoDe(g)}
                    />
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {modal && (
        <ModalExecucao
          grupo={modal}
          onClose={() => { setModal(null); carregar(); }}
          soVisualizacao={modalVer || !isHoje || modal.status === 'CANCELADO' || foiExecutadoHoje(modal)}
          podeCancelar={podeCancelar}
        />
      )}

      {cancelarAlvo && (
        <ModalJustificativa
          aberto
          titulo={`Cancelar prescrição #${cancelarAlvo.numeroFormatado}`}
          descricao={`Cancela toda a prescrição de ${cancelarAlvo.animal.nome} e libera o estoque reservado. Prescrição que já teve execução não pode ser cancelada. A justificativa vai para a auditoria.`}
          acaoLabel="Cancelar prescrição"
          onConfirmar={handleCancelarGrupo}
          onFechar={() => { if (!cancelando) setCancelarAlvo(null); }}
        />
      )}

      {viewingVac && (
        <VacinaExecViewModal
          v={viewingVac}
          onClose={() => setViewingVac(null)}
          onImprimir={() => imprimirVacinaExec(viewingVac)}
        />
      )}
    </PageContainer>
  );
}

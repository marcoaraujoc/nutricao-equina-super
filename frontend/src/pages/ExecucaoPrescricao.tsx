// frontend/src/pages/ExecucaoPrescricao.tsx

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, ClipboardList, Loader2, Search,
  Eye, Printer, ChevronLeft, ChevronRight, Calendar,
  User, X, Link, Ban, Syringe, Pill, Stethoscope,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import ModalJustificativa from '../components/ModalJustificativa';
import ConfirmModal from '../components/ConfirmModal';
import { regimeExigeResumo, gerarResumoDoses, DOSES_POR_DIA } from '../utils/posologia';
import toast from 'react-hot-toast';
import api from '../services/api';
import { imprimirPrescricao, type PrintGrupoPrescricao, type PrintItemPrescricao } from '../utils/PrescricaoPrint';
// Data/hora SEMPRE por aqui — `formatDate`/`formatDateShort` só para DATA PURA
// (sem hora); a família `format*`/`diaISO`/`hojeISO` para INSTANTE, já no fuso de
// quem está olhando (a aplicação roda nos 4 fusos do Brasil). Ver utils/dateUtils.ts.
import {
  formatDate, formatDateShort, formatHora, formatDiaMesHora,
  formatHoraComDia, diaISO, hojeISO,
} from '../utils/dateUtils';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import InlineError from '../components/InlineError';
import FotoAnimal from '../components/FotoAnimal';
import { formatNumeroClinico } from '../utils/numeroClinico';
import { linhaInfoAnimal } from '../utils/animalInfo';

// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface ItemExecucao {
  id:              number;
  tipo:            'MEDICAMENTO' | 'PROCEDIMENTO';
  /** ATIVA | CANCELADA — item cancelado por item fica visível marcado como cancelado. */
  status?:         string | null;
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
  executadoEm?:    string | null; // última execução do item (atualizado a cada dose)
  // Quem aplicou a ÚLTIMA dose deste item — existe mesmo quando o GRUPO inteiro
  // ainda não chegou a EXECUTADO (grupo.executadoPor só é gravado quando TODOS os
  // itens terminam). Ver `executorDeTipo`.
  executadoPorDose?: { id: number; fullName: string } | null;
  // Execução por DOSE individual (null = item fora do fluxo novo — sem horaInicio
  // definido, ou frequência agora/SOS/seNecessario; mantém o comportamento antigo).
  dosesExecutadas?:      number | null;
  dosesTotaisEsperadas?: number | null;
  /** Próximo horário esperado (ISO) — ROLLING: recalculado a cada execução a partir
   *  do horário REAL da dose anterior, não uma grade fixa desde `horaInicio`.
   *  🔴 `null` também significa "ainda SEM âncora": item sem Hora Início e sem
   *  nenhuma dose dada não tem horário previsto — quem o define é a 1ª execução. */
  proximaDoseEm?:         string | null;
  /** Horário REAL de cada dose já aplicada (asc por `numeroDose`) — é daqui que
   *  sai o "Dose 01/02 — Executado às 18:00" do card. Só o `executadoEm` do item
   *  não serve: ele guarda apenas a ÚLTIMA execução. */
  doses?: DoseExecutada[] | null;
}

export interface DoseExecutada {
  numeroDose:       number;
  horarioExecutado: string;
  horarioPrevisto:  string;
  classificacao:    'NO_HORARIO' | 'ANTECIPADA' | 'ATRASADA';
  executadoPor:     { id: number; fullName: string } | null;
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
    // Linha "Local • Peso • Idade" da fila (ver utils/animalInfo). `localizacao` é o
    // catálogo; `local` é o campo textual legado — a resolução é do helper.
    local?:          string | null;
    localizacao?:    { nome: string } | null;
    dataNascimento?: string | null;
    idadeAnos?:      number | null;
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

/** Data (ISO) do dia N do curso (1-indexado) a partir de `dataInicio` — usada para
 *  rotular a linha da dose ainda SEM horário definido (antes da 1ª execução).
 *  `gerarResumoDoses` só devolve o número do dia, não a data.
 *  🔴 Meio-dia UTC, NUNCA meia-noite: meia-noite UTC já é o dia ANTERIOR em
 *  qualquer fuso do Brasil (UTC−2 a UTC−5). Ao meio-dia UTC a data é a mesma em
 *  todos eles, então o resultado é uma DATA PURA segura para `formatDateShort`. */
export function dataDoDiaISO(dataInicioISO: string, dia: number): string {
  const d = new Date(dataInicioISO.split('T')[0] + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + (dia - 1));
  return d.toISOString();
}

/**
 * Item ainda a executar NAQUELE dia: dentro da janela do tratamento e ainda não
 * executado na data. Exportado porque o **Painel Principal** monta a mesma fila —
 * duas definições de "o que falta hoje" divergiriam na primeira correção.
 *
 * ⚠️ A data de `executadoEm` é lida no fuso de quem olha (`diaISO`). `slice(0, 10)`
 * devolve a data em UTC e, a partir das 21h (BRT = UTC-3), isso já é o DIA SEGUINTE:
 * o item executado à noite não contaria como feito hoje.
 *
 * ⚠️ Item ELEGÍVEL ao rolling schedule (`dosesTotaisEsperadas != null`) NÃO basta
 * "ainda restar dose do curso" — isso sozinho faz um "1x/semana × 4" (28 dias de
 * janela) aparecer TODO dia da janela, não só nas 4 datas certas (o bug relatado:
 * "continua agendado todos os dias"). 🔴 Regra de produto (2026-08-18): pendente
 * SÓ quando a data pedida é EXATAMENTE `proximaDoseEm` — nunca antes, e NUNCA
 * depois. Dose perdida não fica "atrasada, mas ainda pendente": some da fila no
 * dia seguinte (é cancelada pelo cron `cancelar_doses_prescricao_perdidas` no
 * backend). "A execução seguinte presa esperando a anterior" é o único atraso
 * tolerado, e é automático — sem a anterior, a seguinte nem tem `proximaDoseEm`
 * calculado ainda. Executado NA DATA pedida continua "pendente" ali — é o que
 * alimenta o Histórico do dia em que a dose foi de fato dada.
 */
export function itemPendenteEm(
  item: Pick<ItemExecucao, 'diaAtual' | 'duracaoDias' | 'executadoEm' | 'dosesExecutadas' | 'dosesTotaisEsperadas' | 'proximaDoseEm'>,
  data: string,
): boolean {
  if (item.dosesTotaisEsperadas != null) {
    if (diaISO(item.executadoEm) === data) return true;
    if ((item.dosesExecutadas ?? 0) >= item.dosesTotaisEsperadas) return false;
    // 🔴 Item elegível SEM âncora de horário — Hora Início em branco e nenhuma
    // dose dada, então o backend manda `proximaDoseEm: null`. Não há data de
    // próxima dose para casar: vale a JANELA DO CURSO, e a 1ª execução é que fixa
    // a grade (backend: lib/agendaDoses.js#semAncoraDeHorario). Antes isto era
    // `return false` — com Hora Início opcional, sumiria com o item da fila.
    if (!item.proximaDoseEm) return item.diaAtual >= 1 && item.diaAtual <= item.duracaoDias;
    return diaISO(item.proximaDoseEm) === data;
  }
  const dentroJanela = item.diaAtual >= 1 && item.diaAtual <= item.duracaoDias;
  return dentroJanela && diaISO(item.executadoEm) !== data;
}

// Mesmo intervalo do backend (lib/agendaDoses.js#intervaloEmMs) — para
// encadear a prévia de dias futuros abaixo. Módulo (não local a um componente)
// porque tanto a lista principal quanto `ModalExecucao` precisam dela.
const HORA_MS = 60 * 60 * 1000;
function intervaloEmMs(frequencia: string): number {
  const dosesPorDia = DOSES_POR_DIA[frequencia] ?? 0;
  return dosesPorDia ? (24 * HORA_MS) / dosesPorDia : 24 * HORA_MS;
}

/**
 * PRÉVIA de dias FUTUROS — responde "há dose prevista nesse dia?" projetando as
 * doses RESTANTES a partir do horário REAL já conhecido (`item.proximaDoseEm`),
 * encadeando o mesmo intervalo que o rolling schedule real usa
 * (`calcularProximaDose` no backend). `itemPendenteEm` sozinha nunca acha nada
 * num dia futuro: o rolling schedule só sabe o PRÓXIMO horário, não os seguintes.
 *
 * 🔴 Regra de produto: "o horário BASE é o da PRIMEIRA execução — ela define o
 * horário das demais." Por isso a prévia parte de `proximaDoseEm` (que já É o
 * horário real, uma vez executada a 1ª dose — ou a 1ª dose teórica, antes dela)
 * e NUNCA recalcula a partir de `dataInicio`/`horaInicio` originais. Uma 1ª
 * dose atrasada/antecipada desloca a prévia inteira junto, do mesmo jeito que
 * já acontece com o agendamento real.
 *
 * ⚠️ Só decide SE O ITEM APARECE ao navegar o calendário/filtro de data para um
 * dia futuro — usada tanto pela lista (`itemPendenteHoje`) quanto por
 * `ModalExecucao` (`itemDevidoHoje`), que sem isto perguntava só por HOJE
 * (`hojeISO()` fixo) e mostrava "Nenhum item ativo" ao abrir um item cujo
 * curso ainda não chegou na data visualizada. Nunca usada para calcular
 * horário exibível nem para permitir execução fora de hoje (isso continua
 * sendo só `proximaDoseEm` em si, com o gate de `dataSel === hoje`).
 */
export function itemPrevistoParaDataFutura(
  item: Pick<ItemExecucao, 'dosesExecutadas' | 'dosesTotaisEsperadas' | 'proximaDoseEm' | 'frequencia'
    | 'diaAtual' | 'duracaoDias'>,
  data: string,
): boolean {
  const total = item.dosesTotaisEsperadas;
  if (total == null) return false;
  const jaFeitas = item.dosesExecutadas ?? 0;
  if (jaFeitas >= total) return false;
  // Sem âncora de horário ainda: não há o que projetar — vale a janela do curso
  // (`diaAtual` já vem do backend relativo à data consultada). Ver `itemPendenteEm`.
  if (!item.proximaDoseEm) return item.diaAtual >= 1 && item.diaAtual <= item.duracaoDias;

  let previsto = new Date(item.proximaDoseEm);
  for (let n = jaFeitas; n < total; n++) {
    if (diaISO(previsto.toISOString()) === data) return true;
    previsto = new Date(previsto.getTime() + intervaloEmMs(item.frequencia));
  }
  return false;
}

/** " (03/05)" — a posição da dose no curso, no MESMO formato de duas casas das
 *  linhas do card ("Dose 03/05"). Devolve string vazia quando alguma das duas
 *  contagens não veio (item legado, sem rastreio por dose): a frase segue sem o
 *  número em vez de mostrar "(undefined/undefined)". */
export function rotuloDose(numero?: number | null, total?: number | null): string {
  if (numero == null || total == null) return '';
  return ` (${String(numero).padStart(2, '0')}/${String(total).padStart(2, '0')})`;
}

/**
 * Horário previsto da N-ésima dose ainda não dada (`n` = índice 0 = a próxima).
 * Encadeia o intervalo da frequência a partir de `proximaDoseEm` — a MESMA conta
 * do rolling schedule real (`calcularProximaDose`, backend). Devolve `null`
 * quando o item ainda não tem âncora: aí não existe horário previsto nenhum, e
 * inventar um seria mentir para quem vai aplicar.
 */
export function previsaoDaDose(
  item: Pick<ItemExecucao, 'proximaDoseEm' | 'frequencia'>,
  n: number,
): string | null {
  if (!item.proximaDoseEm || n < 0) return null;
  const base = new Date(item.proximaDoseEm);
  if (isNaN(base.getTime())) return null;
  return new Date(base.getTime() + n * intervaloEmMs(item.frequencia)).toISOString();
}

const execKey      = (grupoId: number) => `s2vet_exec_${grupoId}_${hojeISO()}`;
const doneTodayKey = (grupoId: number) => `s2vet_done_${grupoId}_${hojeISO()}`;

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
  // Sem foto → ícone de paciente (era a LETRA INICIAL; o vazio agora é o mesmo em
  // todas as telas — ver components/FotoAnimal.tsx).
  return <FotoAnimal url={animal.photoUrl} nome={animal.nome}
    className={`${cls} flex-shrink-0`}
    iconSize={size === 'lg' ? 24 : size === 'sm' ? 16 : 20} />;
}

// ─── ModalExecucaoVacina ──────────────────────────────────────────────────────
// Espelho do ModalExecucao (prescrição): executar a vacina ABRE ESTA TELA, onde o
// plantonista confere o que vai aplicar e confirma. Antes o ícone da lista aplicava
// direto, sem conferência — a dose sai do estoque e vai para a fatura no mesmo clique.
// Mesma estrutura do modal do medicamento: cabeçalho do paciente, faixa de contexto,
// corpo com o item e rodapé Executar + Fechar. `soVisualizacao` cobre o olho, igual lá.

export function ModalExecucaoVacina({
  v, onClose, onExecutada, podeExecutarAcao, podeCancelar = false, soVisualizacao = false,
}: {
  v:                 VacinaExecucao;
  onClose:           () => void;
  /** Chamado após aplicar/cancelar — o pai recarrega a fila (a vacina sai dela). */
  onExecutada:       () => void;
  podeExecutarAcao:  boolean;
  /** `enfermagem.prescricao.deletar`, o mesmo gate do cancelar item do medicamento. */
  podeCancelar?:     boolean;
  soVisualizacao?:   boolean;
}) {
  const [salvando,     setSalvando]     = useState(false);
  const [cancelando,   setCancelando]   = useState(false);
  const [confirmarCan, setConfirmarCan] = useState(false);
  const [erroInline,   setErroInline]   = useState<string | null>(null);

  const vcNum       = formatNumeroClinico(v.numero);
  const especieInfo = [v.animal.especie?.nome, v.animal.raca?.nome].filter(Boolean).join(' • ');

  const handleExecutar = async () => {
    if (salvando) return;
    if (!podeExecutarAcao) {
      setErroInline('Sem permissão para executar vacina. Verifique com o responsável da equipe.');
      return;
    }
    setSalvando(true);
    setErroInline(null);
    try {
      await api.patch(`/clinica/vacinas/${v.id}/executar`);
      toast.success(`${v.nome} — aplicada e lançada na fatura`);
      onExecutada();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao executar vacina');
    } finally {
      setSalvando(false);
    }
  };

  // Cancelar a vacina daqui de dentro — irmão do "cancelar item" do medicamento, e pela
  // MESMA rota de plantão (`cancelar-plantao`), com justificativa obrigatória.
  const handleCancelar = async (motivo: string) => {
    setCancelando(true);
    try {
      await api.delete(`/clinica/vacinas/${v.id}/cancelar-plantao`, { data: { motivo } });
      toast.success(`${v.nome} — cancelada`);
      setConfirmarCan(false);
      onExecutada();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setConfirmarCan(false);
      setErroInline(msg ?? 'Erro ao cancelar vacina');
    } finally {
      setCancelando(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh]">

        <InlineError message={erroInline} className="mx-4 mt-3 flex-shrink-0" />

        <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b border-gray-100 flex-shrink-0">
          <AnimalAvatar animal={v.animal} size="lg" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-base leading-tight">{v.animal.nome}</p>
            <p className="text-xs text-gray-500">{especieInfo}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="font-mono text-sm font-bold text-emerald-600">{vcNum ? `#${vcNum}` : '—'}</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 px-4 py-2 text-xs text-gray-500 border-b border-gray-50 flex-shrink-0">
          <span className="flex items-center gap-1">
            <User size={11} /> {v.veterinario?.fullName ?? '—'}
          </span>
          <span>📅 Aplicação: {formatDate(v.dataAplicacao)}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            Vacina a aplicar (1)
          </p>

          <div className="rounded-xl border bg-gray-50 border-gray-100">
            <div className="flex items-start gap-2.5 p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                    <Syringe size={8} /> Vacina
                  </span>
                  <p className="text-sm font-semibold leading-tight text-gray-800">{v.nome}</p>
                </div>

                <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">
                  {v.dose ? `${v.dose} • ` : ''}
                  {v.via ?? '—'}
                  {v.quantidade != null && v.quantidade > 1 ? ` • ${v.quantidade} doses` : ''}
                </p>

                {(v.fabricante || v.lote) && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    {[v.fabricante ? `Fabricante: ${v.fabricante}` : null,
                      v.lote ? `Lote: ${v.lote}` : null].filter(Boolean).join(' · ')}
                  </p>
                )}
                {v.dataReforco && (
                  <p className="text-[10px] text-gray-400 mt-1">Reforço: {formatDate(v.dataReforco)}</p>
                )}
                {v.observacao && (
                  <p className="text-[10px] text-gray-500 mt-1">Obs: {v.observacao}</p>
                )}
              </div>

              {/* AS DUAS AÇÕES do item, como no medicamento: EXECUTAR e CANCELAR, ícones
                  na mesma paleta (emerald / vermelho) — nunca botão sólido. E em
                  visualização, a MESMA tarja "Somente leitura" que o item do medicamento
                  mostra: a tela do olho é igual nos dois. */}
              {soVisualizacao ? (
                <span className="flex-shrink-0 mt-0.5 px-3 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-400 cursor-not-allowed whitespace-nowrap">
                  Somente leitura
                </span>
              ) : (
                <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                  {podeExecutarAcao && (
                    <button
                      onClick={handleExecutar}
                      disabled={salvando || cancelando}
                      title="Aplicar vacina"
                      aria-label="Aplicar vacina"
                      className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50">
                      {salvando
                        ? <Loader2 size={16} className="animate-spin" />
                        : <CheckCircle2 size={16} />}
                    </button>
                  )}
                  {podeCancelar && (
                    <button
                      onClick={() => { setErroInline(null); setConfirmarCan(true); }}
                      disabled={salvando || cancelando}
                      title="Cancelar vacina"
                      aria-label="Cancelar vacina"
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                      <Ban size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Rodapé IDÊNTICO ao do medicamento: em visualização, só a tarja âmbar (o X do
            cabeçalho fecha); executando, FECHAR e depois EXECUTAR TODOS. */}
        <div className="px-4 pt-2 pb-4 border-t border-gray-100 flex-shrink-0">
          {soVisualizacao ? (
            <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-amber-50 border border-amber-200 text-amber-700">
              <Calendar size={14} />
              Execução disponível apenas para hoje
            </div>
          ) : (
            <>
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  disabled={salvando}
                  className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                  Fechar
                </button>
                <button
                  onClick={handleExecutar}
                  disabled={salvando || !podeExecutarAcao}
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5">
                  {salvando ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Executar Todos
                </button>
              </div>
              <p className="text-center text-[10px] text-gray-400 mt-1">
                Executar debita o lote e lança a vacina na fatura
              </p>
            </>
          )}
        </div>
      </div>
    </div>

    {confirmarCan && (
      <ModalJustificativa
        aberto
        titulo={`Cancelar vacina — ${v.nome}`}
        descricao={`Cancela a vacina de ${v.animal.nome}, devolve as doses ao lote e remove o lançamento da fatura. A justificativa vai para a auditoria.`}
        acaoLabel="Cancelar vacina"
        onConfirmar={handleCancelar}
        onFechar={() => { if (!cancelando) setConfirmarCan(false); }}
      />
    )}
    </>
  );
}

// ─── ModalExecucao ────────────────────────────────────────────────────────────

export function ModalExecucao({
  grupo,
  onClose,
  soVisualizacao = false,
  podeCancelar = false,
  tipoFiltro = null,
  dataRef = hojeISO(),
}: {
  grupo:           GrupoExecucao;
  onClose:         () => void;
  soVisualizacao?: boolean;
  /** `enfermagem.prescricao.deletar` — o botão Cancelar do rodapé era o único da tela
   *  sem gate de permissão. Default false: quem não passar a prop não mostra a ação. */
  podeCancelar?:   boolean;
  /** A fila separa Medicamentos e Procedimentos em cards distintos (um grupo com os
   *  dois tipos aparece nos dois cards). Sem este filtro, abrir o modal a partir de
   *  QUALQUER um dos dois cards mostrava TODOS os itens do grupo, dos dois tipos —
   *  e "Executar Todos" chegava a debitar/faturar o tipo que não devia estar ali. */
  tipoFiltro?:     'MEDICAMENTO' | 'PROCEDIMENTO' | null;
  /** Data que o modal está EXIBINDO (calendário/filtro do chamador) — default hoje,
   *  para quem nunca navega data (Painel Principal). Sem isto, "Itens do Dia"
   *  perguntava sempre por HOJE mesmo abrindo um item de um dia FUTURO (a prévia da
   *  Execução de Prescrição) ou PASSADO (Histórico/Mapa de Atendimento): o item ainda
   *  não devido/já dado noutro dia sumia e o modal mostrava "Nenhum item ativo para
   *  hoje" — vazio — mesmo com a prescrição bem viva. */
  dataRef?:        string;
}) {
  const [execMap,     setExecMap]     = useState<ExecMap>(() => getExecMap(grupo.id));
  const [salvando,    setSalvando]    = useState(false);
  // QUAL item está sendo executado — sem isso o spinner apareceria em TODOS os ícones
  // (`salvando` é do modal inteiro; era o defeito do antigo rótulo "Executando…").
  const [execItemId,  setExecItemId]  = useState<number | null>(null);
  const [erroEstoque, setErroEstoque] = useState<AlertaEstoque[]>([]);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Item escolhido para cancelar (botão ao lado do item). O cancelamento da PRESCRIÇÃO
  // inteira não mora mais aqui — é o botão da linha na lista de /execucao-prescricao.
  const [cancelarItem, setCancelarItem] = useState<ItemExecucao | null>(null);
  const [cancelando,   setCancelando]   = useState(false);
  // OVERLAY dos itens após execução NESTA sessão do modal — atualiza a tela sem sair
  // dela. O `grupo` prop fica parado até o pai recarregar (`onClose`), então sem isto
  // as HORAS FUTURAS (que saem de `proximaDoseEm`, recalculado pelo backend a cada
  // dose) só apareciam ao fechar e reabrir. A resposta do `executar` traz
  // `proximaDoseEm`/`dosesExecutadas` frescos; guardamos aqui esses campos + a dose
  // recém-dada ANEXADA ao histórico (a resposta do executar usa GRUPO_INCLUDE, que
  // NÃO traz `doses` — por isso funde-se, não se substitui o item inteiro). A tela lê
  // `comLive(item)` (prop + overlay). Ver `handleExecutarItem`.
  const [itensLive, setItensLive] = useState<Record<number, Partial<ItemExecucao>>>({});
  const comLive = (i: ItemExecucao): ItemExecucao => ({ ...i, ...itensLive[i.id] });
  // Execução fora do horário pendente de confirmação (antecipada/atrasada) — a
  // MESMA tela para os dois casos, nunca bloqueia, só avisa o horário correto.
  const [confirmacao, setConfirmacao] = useState<{
    item: ItemExecucao; slots: string[]; previsto: string; agora: string; classificacao: string;
  } | null>(null);
  // Execução ANTECIPADA (dose FUTURA) barrada pelo backend: diferente da atrasada,
  // NÃO tem "executar mesmo assim" — só sai com justificativa, que vai para a
  // auditoria junto com o previsto e o horário real. `modo` diz qual chamada
  // reenviar: o item do ícone ou o lote do "Executar Todos".
  const [execFutura, setExecFutura] = useState<{
    modo: 'ITEM' | 'LOTE'; item?: ItemExecucao; slots: string[];
    medicamento: string; previsto: string;
    numeroDose?: number; totalDoses?: number;
  } | null>(null);
  // Pergunta feita só logo após a 1ª execução, quando o horário real divergiu do
  // `horaInicio` prescrito: quer atualizar a referência para as próximas doses?
  // (O agendamento em si — `proximaDoseEm` — já segue o horário real por conta
  // própria, sempre; isto só corrige o CAMPO exibido em chip/impressão.)
  const [ajusteHorario, setAjusteHorario] = useState<{
    item: ItemExecucao; horaAnterior: string; horaNova: string; fecharAoConcluir: boolean;
  } | null>(null);
  const [salvandoAjusteHorario, setSalvandoAjusteHorario] = useState(false);

  // Item já executado NA DATA EXIBIDA pelo modal (`dataRef`) — fonte de verdade
  // no backend (cobre itens sem horários gerados e reaberturas em que o mapa
  // local não registrou a execução).
  //
  // 🔴 Era fixo em "hoje real" (`new Date()`) — o modal, aberto a partir de um
  // item de outra data (a prévia futura da Execução de Prescrição, ou o
  // Histórico/Mapa de Atendimento navegando pro passado), perguntava sempre
  // pelo dia ERRADO. `dataRef` é a data que o CHAMADOR está exibindo.
  const executadoHojeFront = (item: ItemExecucao): boolean =>
    diaISO(item.executadoEm) === dataRef;

  // Item está DEVIDO na data exibida (`dataRef`) — decide quem entra no modal.
  //   ELEGÍVEL (rolling schedule) → 🔴 NUNCA usar `diaAtual <= duracaoDias`: essa é
  //     a janela do CURSO INTEIRO (28 dias de "1x/semana × 4"), então valeria TODO
  //     santo dia da janela, não só nas 4 datas certas — era exatamente esse o bug
  //     reportado. 🔴 Regra de produto (2026-08-18): devido SÓ quando a data
  //     exibida é EXATAMENTE `proximaDoseEm` — nunca antes, e NUNCA depois (dose
  //     perdida não fica "atrasada, ainda pendente": some no dia seguinte, cancelada
  //     pelo cron `cancelar_doses_prescricao_perdidas`). Executado NA DATA continua
  //     aparecendo (alimenta o Histórico do dia).
  //   🔴 `dataRef` FUTURA (além de hoje): `proximaDoseEm` sozinho só conhece a
  //     PRÓXIMA dose real — cai na mesma prévia teórica da lista
  //     (`itemPrevistoParaDataFutura`), sem ela o modal de um item da prévia
  //     futura mostrava "Nenhum item ativo" (vazio) mesmo tendo curso pela frente.
  //   LEGADO (sem horaInicio) → mantém a janela do curso inteiro, como sempre foi
  //     (`diaAtual` já vem do backend relativo à data exibida, não a hoje real).
  const itemDevidoHoje = (i: ItemExecucao): boolean => {
    if (i.dosesTotaisEsperadas != null) {
      if (executadoHojeFront(i)) return true;
      if ((i.dosesExecutadas ?? 0) >= i.dosesTotaisEsperadas) return false;
      if (dataRef > hojeISO()) return itemPrevistoParaDataFutura(i, dataRef);
      // 🔴 Sem âncora de horário (`proximaDoseEm` null — Hora Início em branco e
      // nenhuma dose dada): vale a janela do curso. Era `return false`, o que com
      // Hora Início opcional esconderia o item do modal e o deixaria inexecutável.
      if (!i.proximaDoseEm) return i.diaAtual >= 1 && i.diaAtual <= i.duracaoDias;
      return diaISO(i.proximaDoseEm) === dataRef;
    }
    return i.diaAtual >= 1 && i.diaAtual <= i.duracaoDias;
  };

  // `comLive` aplica o overlay desta sessão (proximaDoseEm/dosesExecutadas/doses/
  // executadoEm frescos) — daqui pra frente tudo enxerga o item ATUALIZADO, então a
  // previsão das próximas doses aparece assim que a dose é executada.
  const itensDoDia = grupo.itens.map(comLive).filter(
    i => itemDevidoHoje(i) && (!tipoFiltro || i.tipo === tipoFiltro),
  );

  // Doses do item já dadas. `item` aqui JÁ vem com o overlay desta sessão aplicado
  // (via `itensDoDia`/`itensComInfo` → `comLive`), então `dosesExecutadas` reflete o
  // que o backend acabou de devolver — não precisa mais somar contagem local.
  const dosesFeitas = (item: ItemExecucao): number => item.dosesExecutadas ?? 0;

  /** Horário REAL (ISO) da dose `numeroDose` (1-indexado) deste item, lido de
   *  `item.doses` — que já inclui, além do histórico do backend, a dose que ESTA
   *  sessão do modal acabou de executar (anexada pelo overlay em `handleExecutarItem`).
   *  Devolve null para dose sem registro (curso anterior ao rastreio por dose) — a
   *  linha então fica só "Executado", sem hora inventada. */
  const horaDaDose = (item: ItemExecucao, numeroDose: number): string | null =>
    item.doses?.find(d => d.numeroDose === numeroDose)?.horarioExecutado ?? null;

  // "Concluído" decide o estilo do card e se o botão de executar habilita:
  // elegível → todas as doses do curso já foram dadas (pode haver mais de uma por
  // dia); legado (sem horário) → o critério antigo, executado hoje.
  const itemConcluido = (item: ItemExecucao): boolean =>
    item.status === 'CANCELADA' ? true
      : item.dosesTotaisEsperadas != null
        ? dosesFeitas(item) >= item.dosesTotaisEsperadas
        : executadoHojeFront(item) || (getActiveSlotIdx(calcSlots(item)) >= 0 && isSlotDone(execMap, item.id, getActiveSlotIdx(calcSlots(item))));

  const itensComInfo = itensDoDia.map(item => {
    const slots      = calcSlots(item);
    const activeIdx  = getActiveSlotIdx(slots);
    const activeDone = itemConcluido(item);
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
  //   `confirmarHorario` → reenvio após o usuário confirmar uma dose ATRASADA
  //     (aviso simples, não bloqueia).
  //   `justificativa`    → reenvio após o usuário justificar uma dose ANTECIPADA
  //     (dose FUTURA — bloqueada pelo backend sem isto).
  const handleExecutarItem = async (
    item: ItemExecucao,
    slots: string[],
    opts: { confirmarHorario?: boolean; justificativa?: string } = {},
  ) => {
    if (salvando) return;
    const { confirmarHorario = false, justificativa } = opts;
    // A pergunta de ajuste de horário (ver `ajusteHorario`) só faz sentido quando
    // esta chamada é a 1ª dose do item — captura ANTES do POST, porque o `item`
    // (mesma referência ao longo dos reenvios de CONFIRMACAO_NECESSARIA) ainda
    // reflete o estado de ANTES desta execução.
    const foiPrimeiraDose = (item.dosesExecutadas ?? 0) === 0;
    setSalvando(true);
    setExecItemId(item.id);
    setErroEstoque([]);
    try {
      const res = await api.post(`/clinica/prescricoes/grupos/${grupo.id}/executar`, {
        itemIds: [item.id],
        ...(confirmarHorario ? { confirmarHorario: true } : {}),
        ...(justificativa ? { justificativa } : {}),
      });
      const m = marcarItemFeito(execMap, item.id, slots);
      saveExecMap(grupo.id, m);
      setExecMap(m);

      const itemAtualizado: ItemExecucao | undefined = res.data?.dados?.itens?.find(
        (i: ItemExecucao) => i.id === item.id,
      );
      // Aplica na MESMA TELA o que o backend acabou de recalcular: `proximaDoseEm`
      // fresco (as HORAS FUTURAS de cada dose seguinte), a contagem de doses e o
      // histórico com a dose que acabou de sair. Sem isto, a previsão das próximas
      // doses só aparecia ao fechar e reabrir o modal. A resposta do executar
      // (GRUPO_INCLUDE) NÃO traz `doses`, então a dose recém-dada é ANEXADA ao
      // histórico que já estava no item — nunca se substitui o item inteiro.
      if (item.dosesTotaisEsperadas != null) {
        const quando     = itemAtualizado?.executadoEm ?? new Date().toISOString();
        const numeroDose = (item.dosesExecutadas ?? 0) + 1;
        setItensLive(prev => {
          const base    = { ...(grupo.itens.find(x => x.id === item.id) as ItemExecucao), ...prev[item.id] };
          const doses   = [...(base.doses ?? [])];
          if (!doses.some(d => d.numeroDose === numeroDose)) {
            doses.push({
              numeroDose, horarioExecutado: quando, horarioPrevisto: quando,
              classificacao: 'NO_HORARIO', executadoPor: null,
            });
          }
          return {
            ...prev,
            [item.id]: {
              // `proximaDoseEm` só é sobrescrito quando o backend o devolveu — senão
              // manteria o valor anterior em vez de zerar a âncora das futuras.
              proximaDoseEm:   itemAtualizado ? (itemAtualizado.proximaDoseEm ?? null) : base.proximaDoseEm,
              dosesExecutadas: itemAtualizado?.dosesExecutadas ?? numeroDose,
              executadoEm:     quando,
              doses,
            },
          };
        });
      }
      setConfirmacao(null);
      setExecFutura(null);
      toast.success(`${item.medicamento} — executado e lançado na fatura`);

      // 1ª dose executada num horário DIFERENTE do `horaInicio` prescrito: pergunta
      // se atualiza a referência para as próximas — o AGENDAMENTO em si já segue o
      // horário real por conta própria (`calcularProximaDose`, backend), sempre;
      // isto só corrige o que fica exibido em chip/impressão.
      const horaNova = formatHora(itemAtualizado?.executadoEm);
      const perguntarHorario = foiPrimeiraDose && !!item.horaInicio && !!horaNova && horaNova !== item.horaInicio;

      // Execução é POR ITEM: mantém o modal aberto para executar os demais. Só fecha
      // quando TODOS os itens do dia já estão executados (este + os demais já feitos)
      // E não há pergunta de horário pendente (senão ela fecharia com o modal).
      const todosExecutados = itensComInfo.every(x =>
        x.item.id === item.id
          ? (item.dosesTotaisEsperadas != null ? dosesFeitas(item) + 1 >= item.dosesTotaisEsperadas : true)
          : x.activeDone,
      );
      if (perguntarHorario) {
        setAjusteHorario({ item, horaAnterior: item.horaInicio!, horaNova: horaNova!, fecharAoConcluir: todosExecutados });
      } else if (todosExecutados) {
        markDoneToday(grupo.id); onClose();
      }
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: {
        erro?: string; previsto?: string; agora?: string; classificacao?: string;
        medicamento?: string; numeroDose?: number; totalDoses?: number;
      } } };
      const dados = e?.response?.status === 400 ? e.response.data : undefined;
      if (dados?.erro === 'CONFIRMACAO_NECESSARIA') {
        setConfirmacao({
          item, slots,
          previsto:      dados.previsto ?? new Date().toISOString(),
          agora:         dados.agora ?? new Date().toISOString(),
          classificacao: dados.classificacao ?? 'ATRASADA',
        });
      } else if (dados?.erro === 'EXECUCAO_FUTURA') {
        // Dose FUTURA: não há "executar mesmo assim" — só com justificativa.
        setExecFutura({
          modo: 'ITEM', item, slots,
          medicamento: dados.medicamento ?? item.medicamento,
          previsto:    dados.previsto ?? '',
          numeroDose:  dados.numeroDose,
          totalDoses:  dados.totalDoses,
        });
      } else {
        tratarErroExec(err, 'Erro ao executar item');
      }
    } finally {
      setSalvando(false);
      setExecItemId(null);
    }
  };

  // Resolve a pergunta "atualizar o horário para as próximas execuções?" (ver
  // `ajusteHorario`). A execução da dose JÁ aconteceu — isto só ajusta a
  // referência (`horaInicio`) exibida em chip/impressão, então falha aqui não
  // desfaz nem bloqueia nada, só avisa e segue o fluxo normal do modal.
  const fecharAposAjusteHorario = () => {
    const fechar = ajusteHorario?.fecharAoConcluir;
    setAjusteHorario(null);
    if (fechar) { markDoneToday(grupo.id); onClose(); }
  };

  const handleConfirmarAjusteHorario = async () => {
    if (!ajusteHorario) return;
    setSalvandoAjusteHorario(true);
    try {
      await api.patch(
        `/clinica/prescricoes/grupos/${grupo.id}/itens/${ajusteHorario.item.id}/hora-inicio`,
        { horaInicio: ajusteHorario.horaNova },
      );
      toast.success('Horário atualizado para as próximas execuções');
    } catch {
      toast.error('Não foi possível atualizar o horário — a execução já foi registrada normalmente.');
    } finally {
      setSalvandoAjusteHorario(false);
      fecharAposAjusteHorario();
    }
  };

  // Executa TODOS os itens restantes do dia de uma vez (backend ignora os já
  // executados).
  //
  // 🔴 O clique NÃO libera mais dose fora do horário por conta própria. Antes
  // este handler mandava `confirmarHorario: true` fixo — enquanto o ícone
  // "Executar" (item a item) checava o horário —, então o mesmo documento tinha
  // duas regras: pelo ícone o sistema perguntava, pelo "Executar Todos" aplicava
  // o curso inteiro de uma vez. Agora os dois caminhos passam pelo MESMO gate do
  // backend; o clique em lote vale como confirmação de dose ATRASADA (é ação
  // deliberada sobre uma dose que já era devida), mas dose FUTURA continua
  // bloqueada e só sai com justificativa — igualzinho ao item a item.
  //
  // ⚠️ `itemIds` é OBRIGATÓRIO aqui: sem ele o backend executa TODOS os itens
  // pendentes do grupo, inclusive os de fora deste modal (o tipo filtrado por
  // `tipoFiltro`) — era o que fazia "Executar Todos" no card de Medicamentos
  // debitar/faturar também o Procedimento da mesma prescrição.
  const handleExecutarTodos = async (justificativa?: string) => {
    setSalvando(true);
    setErroEstoque([]);
    try {
      const itemIds = itensComInfo.filter(x => !x.activeDone).map(x => x.item.id);
      await api.post(`/clinica/prescricoes/grupos/${grupo.id}/executar`, {
        itemIds,
        confirmarHorario: true,
        ...(justificativa ? { justificativa } : {}),
      });
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
      setExecFutura(null);
      markDoneToday(grupo.id);
      onClose();
    } catch (err) {
      const e = err as { response?: { status?: number; data?: {
        erro?: string; medicamento?: string; previsto?: string;
        numeroDose?: number; totalDoses?: number;
      } } };
      const dados = e?.response?.status === 400 ? e.response.data : undefined;
      if (dados?.erro === 'EXECUCAO_FUTURA') {
        // Basta UM item com dose futura para o lote inteiro parar: o backend
        // recusa antes de debitar/faturar qualquer coisa (o gate roda inteiro
        // antes da transaction), então não há execução parcial a desfazer.
        setExecFutura({
          modo: 'LOTE', slots: [],
          medicamento: dados.medicamento ?? '',
          previsto:    dados.previsto ?? '',
          numeroDose:  dados.numeroDose,
          totalDoses:  dados.totalDoses,
        });
      } else {
        tratarErroExec(err, 'Erro ao finalizar');
      }
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
      // Cancela SÓ ESTE item (as doses que ainda faltam dele), preservando o que já foi
      // aplicado e os DEMAIS itens da prescrição. O backend (`removerItem`) já não
      // bloqueia mais quando há execução: item em execução vira CANCELADA/inativo e o
      // grupo fica CANCELADO_PARCIALMENTE (segue executável para os outros itens) ou
      // CANCELADO quando este era o único item — aí, no reload, sai de "a aplicar" para
      // o Histórico. Difere do cancelar de FORA (a linha), que cancela a prescrição TODA.
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
              Nenhum item ativo {dataRef === hojeISO() ? 'para hoje' : `para ${formatDateShort(dataRef)}`}.
            </p>
          )}

          {itensComInfo.map(({ item, slots, activeDone }) => {
            // Item cancelado por item: fica VISÍVEL marcado como "Cancelado", sem botões
            // de ação, com as doses já dadas preservadas e as futuras marcadas "Cancelada".
            const cancelado = item.status === 'CANCELADA';
            const temHistorico = regimeExigeResumo(item.frequencia, item.duracaoDias);
            const resumo       = temHistorico ? gerarResumoDoses(item.frequencia, item.duracaoDias) : [];
            const totalDoses   = resumo.length;
            // A dose ATUAL (a próxima a executar): elegível (rastreio por dose) usa
            // `dosesFeitas` — e `item` já vem com o overlay desta sessão (`comLive`),
            // então `dosesExecutadas` avança na hora, sem esperar o pai recarregar
            // (ver `itensLive`); legado usa a posição do dia corrente na grade.
            const idxAtual = item.dosesTotaisEsperadas != null
              ? dosesFeitas(item)
              : Math.max(0, resumo.findIndex(d => d.dia === item.diaAtual));
            // 🔴 A linha em `idxAtual` só é DE VERDADE "Em Execução" quando a data
            // REAL da próxima dose (`proximaDoseEm`, rolling schedule) é hoje —
            // nunca só por `dosesFeitas` ter avançado. Sem isso, executar a dose 1
            // de "1x/semana" hoje "empurrava" a exibição pra dose 2 na hora (ela só
            // vence 7 dias depois — é o `proximaDoseEm` que sabe disso, o contador
            // de doses feitas não).
            // 🔴 Item elegível ainda SEM âncora (`proximaDoseEm` null) conta como
            // "a dose de agora": não há grade definida, e é justamente esta
            // execução que vai criá-la. Sem esta perna, tornar Hora Início
            // opcional deixaria o item visível porém SEM botão de executar.
            const semAncora = item.dosesTotaisEsperadas != null && !item.proximaDoseEm;
            const proximaDoseRealHoje = item.dosesTotaisEsperadas == null
              || semAncora
              || (!!item.proximaDoseEm && diaISO(item.proximaDoseEm) === hojeISO());
            const temAtual = idxAtual < resumo.length && !activeDone && proximaDoseRealHoje;
            // Mostra o curso INTEIRO — inclusive as doses que ainda não chegaram —
            // com a data prevista de cada uma, direto do calendário. A linha em
            // `idxAtual` só vira "Em Execução" quando `temAtual` é true (a data REAL
            // dela — `proximaDoseEm`, rolling schedule — é hoje); nas demais linhas
            // futuras a data vem do calendário TEÓRICO (`dataDoDiaISO`/
            // `gerarResumoDoses`), a melhor previsão disponível antes de a dose
            // anterior ser executada de verdade.
            const linhasVisiveis = resumo;
            const doseTxt = item.dosagem ? `${item.dosagem}${item.unidade ? ' ' + item.unidade : ''}` : '';
            // "1x a cada N dias" (inclui "1x por semana"): `duracaoDias` é guardado em
            // DIAS (vezes × intervalo, para o backend contar as doses certas) — mas o
            // texto fala na MESMA unidade da frequência, nunca em dias brutos (28 dias
            // de "1x/semana" não diz nada; "4 semanas" diz). Semana ganha palavra
            // própria (mesma regra de QTD_LABEL da tela de Prescrição); as demais
            // frequências desse grupo (1x/2,3,21,30,90 dias) usam "vezes" genérico.
            const dosesPorDiaItem = DOSES_POR_DIA[item.frequencia] ?? 1;
            const intervaloDiasItem = dosesPorDiaItem < 1 ? Math.round(1 / dosesPorDiaItem) : null;
            const vezesItem = intervaloDiasItem ? Math.max(1, Math.round(item.duracaoDias / intervaloDiasItem)) : null;
            const duracaoTxt = intervaloDiasItem
              ? (item.frequencia === '1xSemana'
                  ? `${vezesItem} semana${vezesItem !== 1 ? 's' : ''}`
                  : `${vezesItem} vez${vezesItem !== 1 ? 'es' : ''}`)
              : `${item.duracaoDias} dia${item.duracaoDias > 1 ? 's' : ''}`;
            // Dose única/SOS/se necessário (sem histórico) não têm duração que faça
            // sentido mostrar — `duracaoDias` nasce fixo em 1 só para o backend contar
            // a dose, "Dose única por 1 dia" não diz nada de novo.
            const periodicidade = temHistorico
              ? `${POSOLOGIAS[item.frequencia] ?? item.frequencia} por ${duracaoTxt}${doseTxt ? ` - ${doseTxt}` : ''}`
              : `${POSOLOGIAS[item.frequencia] ?? item.frequencia}${doseTxt ? ` - ${doseTxt}` : ''}`;

            const botoesLinhaAtual = !soVisualizacao && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handleExecutarItem(item, slots)}
                  disabled={salvando}
                  title="Executar"
                  aria-label="Executar item"
                  className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors">
                  {execItemId === item.id
                    ? <Loader2 size={15} className="animate-spin" />
                    : <CheckCircle2 size={15} />}
                </button>
                {podeCancelar && (
                  <button
                    onClick={() => { setErroInline(null); setCancelarItem(item); }}
                    disabled={salvando || cancelando}
                    title="Cancelar item"
                    aria-label="Cancelar item"
                    className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                    <Ban size={15} />
                  </button>
                )}
              </div>
            );

            return (
            <div key={item.id}
              className={`rounded-xl border transition-colors ${
                cancelado ? 'bg-rose-50 border-rose-200'
                  : activeDone ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-100'
              }`}>
              <div className="flex items-start gap-2.5 p-3">
                <div className="flex-1 min-w-0">
                  {/* Nome do medicamento/procedimento — PRIMEIRO */}
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
                      cancelado ? 'text-rose-700 line-through' : activeDone ? 'text-gray-400' : 'text-gray-800'
                    }`}>
                      {item.medicamento}
                    </p>
                    {cancelado && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700">
                        <Ban size={9} /> Cancelado
                      </span>
                    )}
                  </div>

                  {/* Periodicidade + Dose */}
                  <p className="text-xs text-red-600 leading-snug mt-1">
                    {periodicidade}
                  </p>

                  {temHistorico && (
                    // Histórico de doses dentro da própria execução: a linha já dada
                    // mostra a HORA REAL em que foi aplicada ("Executado às 18:00"),
                    // a de AGORA vem com Executar + Cancelar juntos, e as futuras
                    // mostram a hora prevista ("Prevista para 06:00 de 24/08") — não
                    // somem até chegar o dia certo.
                    <div className="mt-1.5 space-y-1">
                      {linhasVisiveis.map((linha, idx) => {
                        const executada = idx < idxAtual;
                        const ehAtual   = idx === idxAtual && temAtual;
                        const numero    = String(idx + 1).padStart(2, '0');
                        const total     = String(totalDoses).padStart(2, '0');

                        // ─── Dose JÁ DADA: hora REAL em que foi aplicada ─────────
                        // Vem de `item.doses` (uma linha por dose, do backend).
                        // `item.executadoEm` não serve: guarda só a ÚLTIMA execução,
                        // então todas as linhas anteriores mostrariam a mesma hora.
                        // Dose executada antes desta tela existir (ou item legado)
                        // fica sem hora — aí a linha continua só "Executado".
                        const horaExecutada = executada ? horaDaDose(item, idx + 1) : null;

                        // ─── Dose AINDA POR VIR: DATA + HORA previstas ───────────
                        // "Prevista para 24/08 às 07:44". A próxima (idxAtual) e
                        // TODAS as seguintes saem do rolling schedule real,
                        // encadeando o intervalo a partir de `proximaDoseEm` —
                        // mesma conta do backend —, então a lista inteira do curso
                        // aparece com o horário em que cada dose vence.
                        // Sem âncora (`proximaDoseEm` null: item sem Hora Início e
                        // sem nenhuma dose dada) NÃO há horário a mostrar: cai na
                        // data teórica do calendário, sem hora — é tudo que se sabe
                        // antes da 1ª execução, e inventar um horário aqui seria
                        // mentir para quem vai aplicar.
                        const previsaoISO = previsaoDaDose(item, idx - idxAtual);
                        const quandoPrevisto = (previsaoISO && formatDiaMesHora(previsaoISO))
                          ?? formatDateShort(dataDoDiaISO(item.dataInicio, linha.dia));

                        // A dose de AGORA mostra a MESMA data/hora das futuras — só o
                        // rótulo muda. Ela é a próxima do rolling schedule
                        // (`previsaoDaDose(item, 0)` = `proximaDoseEm`), então o horário
                        // sempre existiu aqui; ficar só com "Em Execução" escondia de
                        // quem vai aplicar justamente a hora em que a dose vence.
                        const status = executada
                          ? (horaExecutada ? `Executado às ${formatHora(horaExecutada)}` : 'Executado')
                          : cancelado
                            ? 'Cancelada'
                            : ehAtual
                              ? `Em Execução (${quandoPrevisto})`
                              : `Prevista para ${quandoPrevisto}`;
                        return (
                          <div key={idx} className="flex items-center justify-between gap-2">
                            <p className={ehAtual ? 'text-xs font-semibold text-gray-800' : 'text-[11px] text-gray-400'}>
                              Dose {numero}/{total} - {status}
                            </p>
                            {ehAtual && botoesLinhaAtual}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {cancelado ? (
                  <span className="flex-shrink-0 mt-0.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-100 text-rose-700 whitespace-nowrap inline-flex items-center gap-1">
                    <Ban size={12} /> Cancelado
                  </span>
                ) : soVisualizacao ? (
                  <span className="flex-shrink-0 mt-0.5 px-3 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-400 cursor-not-allowed whitespace-nowrap">
                    Somente leitura
                  </span>
                ) : !temHistorico ? (
                  // Item SEM histórico (dose única/SOS/etc.) mantém os botões aqui —
                  // os itens com histórico têm os botões na linha "Em Execução".
                  <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                    <button
                      onClick={() => handleExecutarItem(item, slots)}
                      disabled={activeDone || salvando}
                      title={activeDone ? 'Executado' : 'Executar item'}
                      aria-label={activeDone ? 'Item executado' : 'Executar item'}
                      className={`p-1.5 rounded-lg transition-colors ${
                        activeDone
                          ? 'text-emerald-600 cursor-default'
                          : 'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50'
                      }`}>
                      {execItemId === item.id
                        ? <Loader2 size={16} className="animate-spin" />
                        : <CheckCircle2 size={16} />}
                    </button>
                    {podeCancelar && (
                      <button
                        onClick={() => { setErroInline(null); setCancelarItem(item); }}
                        disabled={salvando || cancelando}
                        title="Cancelar item"
                        aria-label="Cancelar item"
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                        <Ban size={16} />
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            );
          })}
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
              {/* Rodapé: FECHAR e depois EXECUTAR TODOS — a ação principal fica por
                  último, encostada à direita, que é onde a mão vai. Cancelar a prescrição
                  inteira é o botão da linha na lista; executar e cancelar UM item são os
                  dois ícones ao lado de cada item, acima. */}
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  disabled={salvando}
                  className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                  Fechar
                </button>
                <button
                  // ⚠️ Arrow OBRIGATÓRIA: `onClick={handleExecutarTodos}` passaria o
                  // MouseEvent como `justificativa` e todo clique viraria uma
                  // antecipação "justificada" — o mesmo bypass silencioso que já
                  // mordeu o `handleSalvar` de ModalNovoFornecedor (CLAUDE.md §12).
                  onClick={() => handleExecutarTodos()}
                  disabled={salvando || todosFeitos}
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5">
                  {salvando && execItemId == null
                    ? <Loader2 size={13} className="animate-spin" />
                    : <CheckCircle2 size={13} />}
                  Executar Todos
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
        descricao={`Cancela as doses que ainda faltam deste item e libera o estoque reservado dele. O que já foi aplicado é preservado (fatura e estoque) e os demais itens da prescrição seguem normalmente.`}
        acaoLabel="Cancelar item"
        onConfirmar={handleCancelarItem}
        onFechar={() => { if (!cancelando) setCancelarItem(null); }}
      />
    )}

    {/* Dose ATRASADA — aviso simples, nunca bloqueia: a dose já era devida, e
        atrasar não inventa dose nova. A tela só lembra o horário correto e deixa
        confirmar. (Dose ANTECIPADA NÃO cai mais aqui — ver `execFutura` abaixo.) */}
    <ConfirmModal
      open={!!confirmacao}
      variante="aviso"
      titulo="Dose atrasada"
      mensagem={confirmacao && (
        <>
          <strong>{confirmacao.item.medicamento}</strong> estava agendado para{' '}
          <strong>{formatHora(confirmacao.previsto)}</strong>. Já passou do horário —
          deseja executar agora mesmo assim?
        </>
      )}
      labelConfirmar={salvando ? 'Executando…' : 'Executar mesmo assim'}
      labelCancelar="Cancelar"
      onConfirmar={() => {
        if (confirmacao) handleExecutarItem(confirmacao.item, confirmacao.slots, { confirmarHorario: true });
      }}
      onCancelar={() => setConfirmacao(null)}
    />

    {/* Dose FUTURA (antecipada) — BLOQUEADA. Ao contrário da atrasada, não há
        "executar mesmo assim": antecipar é decisão clínica e exige justificativa,
        que o backend grava na auditoria com o previsto e o horário real. Vale
        igualmente para o ícone "Executar" e para o "Executar Todos". */}
    {execFutura && (
      <ModalJustificativa
        aberto
        titulo={execFutura.medicamento
          ? `Antecipar dose — ${execFutura.medicamento}`
          : 'Antecipar dose'}
        descricao={
          // "A próxima dose (03/05) está prevista para 00:55 de 24/08, deseja antecipar?"
          // O "(NN/TT)" só entra quando o backend informa as duas contagens — item
          // legado (sem rastreio por dose) cai na frase sem o número, em vez de
          // exibir um "(undefined/undefined)".
          `A próxima dose${rotuloDose(execFutura.numeroDose, execFutura.totalDoses)}` +
          (execFutura.previsto
            ? ` está prevista para ${formatHoraComDia(execFutura.previsto, dataRef)}, deseja antecipar?`
            : ' ainda não chegou, deseja antecipar?')
        }
        acaoLabel="Antecipar"
        placeholder="Por que a dose está sendo antecipada? (obrigatório)"
        processando={salvando}
        onConfirmar={(motivo) => {
          if (execFutura.modo === 'ITEM' && execFutura.item) {
            handleExecutarItem(execFutura.item, execFutura.slots, { justificativa: motivo });
          } else {
            handleExecutarTodos(motivo);
          }
        }}
        onFechar={() => { if (!salvando) setExecFutura(null); }}
      />
    )}

    {/* 1ª dose executada fora do horário prescrito (a antecipada/atrasada acima já
        foi confirmada — a dose ACONTECEU) — pergunta se atualiza a REFERÊNCIA de
        horário para as próximas execuções. As próximas doses já seguem o horário
        real de qualquer forma (rolling schedule); isto só corrige o que fica
        exibido em chip/impressão daqui pra frente. */}
    <ConfirmModal
      open={!!ajusteHorario}
      variante="info"
      titulo="Atualizar horário da prescrição?"
      mensagem={ajusteHorario && (
        <>
          A 1ª dose de <strong>{ajusteHorario.item.medicamento}</strong> foi executada às{' '}
          <strong>{ajusteHorario.horaNova}</strong>, diferente do horário prescrito
          (<strong>{ajusteHorario.horaAnterior}</strong>). Deseja atualizar o horário de início
          para <strong>{ajusteHorario.horaNova}</strong> nas próximas execuções?
        </>
      )}
      labelConfirmar={salvandoAjusteHorario ? 'Atualizando…' : 'Atualizar horário'}
      labelCancelar="Manter horário original"
      onConfirmar={handleConfirmarAjusteHorario}
      onCancelar={fecharAposAjusteHorario}
    />
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
      </div>
    </div>
  );
}

// ─── Linha da lista ───────────────────────────────────────────────────────────

/**
 * Casca ÚNICA da linha da fila do plantão — prescrição e vacina são a MESMA linha.
 *
 * POR QUÊ um componente e não duas marcações parecidas: a vacina nasceu com um card
 * próprio (sem as colunas Nº e Veterinário Responsável, com o olho e a impressora em
 * cinza) e as duas listas foram divergindo a cada ajuste. Mesma lição do
 * `SubModuloMinhaAgenda` (armadilha 28-g): para variar o comportamento, passe uma
 * prop — não copie a linha.
 *
 * As AÇÕES vêm por `children`, na ordem fixa VISUALIZAR · EXECUTAR · IMPRIMIR · CANCELAR.
 */
function LinhaExecucao({
  animal, detalhe, numeroLabel, numeroFormatado, onNumero, tituloNumero,
  veterinarioNome, executorNome = null, children,
}: {
  animal:          GrupoExecucao['animal'];
  /** Linha extra sob o paciente — a vacina diz QUAL vacina é (a prescrição tem N itens,
   *  então não há o que resumir aqui e ela não passa nada). */
  detalhe?:        string | null;
  numeroLabel:     string;
  /** Já formatado, SEM o "#" (ver utils/numeroClinico). `null` = registro legado sem
   *  número: vira "—" e deixa de ser clicável — não há documento a que apontar. */
  numeroFormatado: string | null;
  onNumero:        () => void;
  tituloNumero:    string;
  veterinarioNome: string;
  executorNome?:   string | null;
  children:        React.ReactNode;
}) {
  const lbaia = labelBaia(animal.especie?.nome);
  // LOCAL • PESO • IDADE — quem vai aplicar precisa saber para ONDE ir e o peso da dose;
  // "Equino • Brasileiro de Hipismo" não informa nada numa fila de plantão de equinos.
  // A ESPÉCIE ainda serve para o rótulo da baia (Baia × Leito), logo abaixo.
  const infoAnimal = linhaInfoAnimal(animal);

  return (
    <div className="bg-white border border-gray-200 rounded-xl flex items-center gap-3 px-3 py-2.5 shadow-sm hover:border-emerald-200 transition-colors">

      <AnimalAvatar animal={animal} size="md" />

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm leading-tight">{animal.nome}</p>
        <p className="text-xs text-gray-500 truncate">{infoAnimal}</p>
        {detalhe && <p className="text-xs text-gray-600 truncate">{detalhe}</p>}
        {animal.baia && lbaia && (
          <span className="inline-block mt-0.5 px-2 py-0.5 bg-cyan-50 border border-cyan-200 text-cyan-700 text-[10px] font-bold rounded-full">
            {lbaia} {animal.baia}
          </span>
        )}
      </div>

      <div className="flex-shrink-0 text-center px-3 border-l border-r border-gray-100 hidden sm:block">
        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{numeroLabel}</p>
        {numeroFormatado ? (
          <button
            onClick={onNumero}
            className="font-mono font-bold text-emerald-600 text-sm hover:text-emerald-800 hover:underline transition-colors"
            title={tituloNumero}
          >
            #{numeroFormatado}
          </button>
        ) : (
          <span className="font-mono font-bold text-gray-300 text-sm">—</span>
        )}
      </div>

      <div className="flex-shrink-0 text-xs px-3 border-r border-gray-100 hidden md:flex md:items-start md:gap-4 min-w-[140px]">
        <div className="min-w-0">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide whitespace-nowrap">Veterinário Responsável</p>
          <p className="text-gray-700 font-medium truncate">{veterinarioNome}</p>
        </div>
        {executorNome && (
          <div className="min-w-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide whitespace-nowrap">Executor</p>
            <p className="text-gray-700 font-medium truncate">{executorNome}</p>
          </div>
        )}
      </div>

      {numeroFormatado && (
        <button
          onClick={onNumero}
          title={tituloNumero}
          className="font-mono font-bold text-emerald-600 text-xs sm:hidden flex-shrink-0 hover:underline"
        >
          #{numeroFormatado}
        </button>
      )}

      {children}
    </div>
  );
}

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
  // Sem override explícito, cai no executor do DOCUMENTO inteiro (comportamento de
  // sempre) — quem precisa do executor POR TIPO passa `executorDeTipo(g, tipo)`,
  // mesmo padrão de `horaExecucao`.
  executorNome = g.executadoPor?.fullName ?? null,
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
  executorNome?: string | null;
}) {
  const navigate = useNavigate();

  return (
    <LinhaExecucao
      animal={g.animal}
      numeroLabel="Nº Prescrição"
      numeroFormatado={g.numeroFormatado}
      onNumero={() => navigate(`/clinica/prescricao/${g.animal.id}`)}
      tituloNumero="Ir para a prescrição original"
      veterinarioNome={g.veterinario.fullName}
      executorNome={executorNome}
    >
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
        {/* ORDEM DAS AÇÕES — VISUALIZAR · EXECUTAR · IMPRIMIR · CANCELAR, sempre, nesta
            sequência. A ação que some por falta de permissão NÃO reordena as outras: a
            posição de cada ícone é fixa para a mão do plantonista não ter de reaprender
            a linha a cada perfil.
            Ações disponíveis nascem PINTADAS (mesma paleta da tela de prescrição):
            emerald = ver/executar, azul = imprimir, vermelho = cancelar. Cinza fica
            reservado para o indisponível — ação habilitada não se disfarça de desativada.
            EXECUTAR é ÍCONE, como as demais: continua gateado por
            `enfermagem.prescricao.executar` (o chamador resolve `podeExecutarAcao`), então
            quem não tem a permissão não vê o botão — não vê um botão que só falha depois
            do clique (armadilha 28-d). `title` + `aria-label` obrigatórios: sem rótulo
            visível, são eles que dão nome ao botão no hover e no leitor de tela. */}
        <button onClick={onVer} title="Ver prescrição" aria-label="Ver prescrição"
          className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors">
          <Eye size={14} />
        </button>
        {podeExecutarAcao && !soVisualizacao && !executada && (
          <button
            onClick={onExecutar}
            title="Executar prescrição"
            aria-label="Executar prescrição"
            className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors">
            <CheckCircle2 size={16} />
          </button>
        )}
        {podeImprimir && (
          <button
            onClick={onImprimir}
            title="Imprimir prescrição"
            aria-label="Imprimir prescrição"
            className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
            <Printer size={14} />
          </button>
        )}
        {podeCancelar && onCancelar && (
          <button
            onClick={onCancelar}
            title="Cancelar prescrição"
            aria-label="Cancelar prescrição"
            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Ban size={16} />
          </button>
        )}
      </div>
    </LinhaExecucao>
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

  const navigate = useNavigate();

  const [grupos,   setGrupos]   = useState<GrupoExecucao[]>([]);
  const [vacinas,  setVacinas]  = useState<VacinaExecucao[]>([]);
  // Vacinas que já passaram por EXECUTADA hoje — vão para o Histórico, como o
  // medicamento/procedimento executado (a vacina não some mais da tela sozinha).
  const [vacinasExecutadasHoje, setVacinasExecutadasHoje] = useState<VacinaExecucao[]>([]);
  // Vacina aberta no ModalExecucaoVacina + a intenção da abertura (olho = leitura),
  // exatamente o par `modal`/`modalVer` que a prescrição usa.
  const [vacModal,   setVacModal]   = useState<VacinaExecucao | null>(null);
  const [vacModoVer, setVacModoVer] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [busca,    setBusca]    = useState('');
  // Busca e filtro de status PRÓPRIOS do card Histórico — independentes da busca da
  // fila "a executar" acima, porque a pessoa costuma procurar ali por outro motivo
  // (conferir o que já foi feito ou entender por que algo foi cancelado).
  const [buscaHistorico,   setBuscaHistorico]   = useState('');
  const [filtroHistorico,  setFiltroHistorico]  = useState<'EXECUTADO' | 'CANCELADO'>('EXECUTADO');
  const [modal,    setModal]    = useState<GrupoExecucao | null>(null);
  // Intenção da abertura do modal: "Ver" (olho) força SOMENTE LEITURA mesmo em
  // prescrição de hoje ainda executável — só o botão "Executar" abre em modo de execução.
  const [modalVer, setModalVer] = useState(false);
  // Qual CARD disparou a abertura (Medicamentos × Procedimentos) — o modal filtra os
  // itens exibidos por esse tipo, senão um grupo com os dois tipos misturava tudo
  // dentro do modal, não importa de qual card se clicou.
  const [modalTipo, setModalTipo] = useState<'MEDICAMENTO' | 'PROCEDIMENTO' | null>(null);
  const [dataSel,  setDataSel]  = useState(hojeISO());
  // Prescrição / vacina escolhida para cancelar (abre o ModalJustificativa da lista)
  const [cancelarAlvo,   setCancelarAlvo]   = useState<GrupoExecucao | null>(null);
  const [cancelarVacina, setCancelarVacina] = useState<VacinaExecucao | null>(null);
  const [cancelando,     setCancelando]     = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const isHoje = dataSel === hojeISO();

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
      // não são filtradas por data — aparecem até serem executadas) + vacinas
      // EXECUTADAS na data selecionada (o Histórico navega junto com o calendário,
      // igual à fila de prescrições — antes ficava travado em "hoje").
      const [presRes, vacRes, vacHistRes] = await Promise.all([
        api.get('/clinica/prescricoes/grupos/execucao', { params: { data: dataSel } }),
        api.get('/clinica/vacinas/para-execucao'),
        api.get('/clinica/vacinas/executadas-hoje', { params: { data: dataSel } }),
      ]);
      setGrupos(presRes.data.dados ?? []);
      setVacinas(vacRes.data?.dados ?? []);
      setVacinasExecutadasHoje(vacHistRes?.data?.dados ?? []);
    } catch {
      setErroInline('Erro ao carregar prescrições');
    } finally {
      setLoading(false);
    }
  }, [dataSel]);

  useEffect(() => { if (!loadingPerm) carregar(); }, [carregar, loadingPerm]);

  // Cancela a prescrição a partir do plantão. `cancelar-plantao` aponta para
  // `cancelarNaExecucao` (backend): cancela as doses que ainda FALTAM — inclusive as
  // restantes de um item já parcialmente aplicado —, libera as reservas de estoque e
  // PRESERVA o que já foi executado (item de fatura e baixa de estoque não podem ficar
  // órfãos). Só a prescrição totalmente EXECUTADA é recusada: não sobra dose a cancelar.
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

  // Cancela a vacina a partir do plantão. Aponta para `cancelar-plantao`, que no backend é
  // o MESMO controller do cancelar da tela de Vacina — logo, mesma regra: justificativa
  // obrigatória, estorno do item de fatura e das doses do lote, e auditoria. Só o slug de
  // permissão muda (`enfermagem.prescricao.deletar`), como na prescrição.
  const handleCancelarVacinaPlantao = async (motivo: string) => {
    if (!cancelarVacina) return;
    if (!podeCancelar) { semPermissao('cancelar vacina'); return; }
    const alvo = cancelarVacina;
    setCancelando(true);
    try {
      await api.delete(`/clinica/vacinas/${alvo.id}/cancelar-plantao`, { data: { motivo } });
      toast.success(`${alvo.nome} — cancelada`);
      setCancelarVacina(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      // Fecha o modal para o erro não ficar atrás dele (o InlineError vive na página)
      setCancelarVacina(null);
      setErroInline(msg ?? 'Erro ao cancelar vacina');
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

    // O template escreve o "#" — sem número (legado) sai "#—", nunca um id disfarçado
    // de número de vacina.
    const vcNum = formatNumeroClinico(v.numero) ?? '—';

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

  // Item ainda a executar na data selecionada — fonte única com o Painel Principal
  // (para hoje/passado); data futura cai na prévia teórica acima.
  const itemPendenteHoje = (item: ItemExecucao): boolean =>
    dataSel > hojeISO() ? itemPrevistoParaDataFutura(item, dataSel) : itemPendenteEm(item, dataSel);

  // Item executado NA DATA VISUALIZADA — alimenta o Histórico daquele dia.
  const itemExecutadoNaData = (item: ItemExecucao): boolean =>
    diaISO(item.executadoEm) === dataSel;

  // Item TERMINADO de vez (curso inteiro encerrado, sem depender da data
  // visualizada) — elegível: todas as doses do curso já foram dadas; legado: a
  // janela do curso inteiro já passou. Usado só para decidir Histórico "definitivo";
  // NUNCA usar para decidir se o item está pendente HOJE (ver `itemPendenteEm`).
  const itemTerminado = (item: ItemExecucao): boolean =>
    item.dosesTotaisEsperadas != null
      ? (item.dosesExecutadas ?? 0) >= item.dosesTotaisEsperadas
      : !(item.diaAtual >= 1 && item.diaAtual <= item.duracaoDias);

  // Grupo (documento inteiro) concluído na data — só serve para decidir o modo do
  // MODAL quando `modalTipo` não está disponível (ver `tipoConcluidoEm` abaixo para
  // a decisão de qual CARD mostra o quê).
  const foiExecutadoHoje = (g: GrupoExecucao): boolean =>
    g.status === 'EXECUTADO' || !g.itens.some(itemPendenteHoje);

  // Medicamentos e Procedimentos são fluxos distintos do plantão (aplicar um remédio
  // não é o mesmo gesto que executar um procedimento) — a fila é separada por tipo de
  // ITEM. Um grupo com itens dos dois tipos aparece nas duas seções.
  //
  // ⚠️ "a executar" × "Histórico" é decidido POR TIPO, nunca pelo documento inteiro.
  // Antes um grupo só ia para o Histórico quando TODOS os itens — dos dois tipos —
  // estavam prontos: o medicamento já executado ficava preso no card "a aplicar",
  // com um botão Executar que não tinha mais nada para fazer (item já marcado feito,
  // "Executar Todos" sempre desabilitado) — parecia travado, e não sobrava nenhum
  // sinal de que aquele pedaço já tinha sido concluído. Cada card decide sozinho pelo
  // seu próprio tipo: o pedaço pronto desce para o Histórico (muda de card, como nas
  // demais abas), o outro continua em "a executar" — nunca "some" sem deixar rastro.
  //
  // ⚠️ item PENDENTE hoje ("não" ao Histórico) × item TERMINADO/EXECUTADO na data
  // ("sim" ao Histórico) NÃO são complementares — existe um TERCEIRO estado: item de
  // rolling schedule (ex.: "1x/semana × 4") cuja PRÓXIMA dose ainda não chegou. Esse
  // item não é nem pendente hoje, nem terminado, nem executado na data — não deve
  // aparecer em NENHUM dos dois cards hoje (não há nada para fazer nem para revisar).
  // Tratar "não pendente" como sinônimo de "concluído" empurraria esse item pro
  // Histórico por engano, mesmo sem ter sido tocado.
  //
  // 🔴 `itemPendenteHoje` (`itemPendenteEm`) trata "executado hoje" como pendente
  // DE PROPÓSITO (mantém a linha visível no modal, para o Histórico do próprio
  // modal) — mas para ESTA decisão (a executar × Histórico da LISTA) isso é o
  // oposto do que precisa: um item recém-executado bloqueava a categorização
  // ("some(itemPendenteHoje)" nunca ficava falso) e o card correspondente nunca
  // migrava para o Histórico, mesmo com a dose de hoje já dada. "Ainda precisa
  // ação" exclui explicitamente o que já foi resolvido NESTA data.
  //
  // 🔴 BUG (corrigido): o `!itemExecutadoNaData(i)` acima só faz sentido para item
  // LEGADO (`dosesTotaisEsperadas == null`), cuja pendência (`janelaDoItem`) é o
  // DIA INTEIRO e por isso não sabe, sozinha, que a execução de hoje já resolveu o
  // dia. Para item ELEGÍVEL ao rolling schedule (12em12h..1em1h, várias doses no
  // MESMO dia) essa guarda quebra tudo: `item.executadoEm` é a data da ÚLTIMA
  // execução, então dar a 1ª dose de 6 ("12 em 12h × 3 dias") já marca
  // `itemExecutadoNaData=true` pelo resto do dia — e a 2ª dose, ainda pendente
  // (`proximaDoseEm` = hoje à noite, `itemPendenteHoje` já retornaria `true`
  // sozinho), era descartada aqui e o item sumia da fila de "a executar" e ia
  // pro Histórico como se o dia inteiro já tivesse sido dado. `itemPendenteHoje`
  // (via `itemPendenteEm`) JÁ decide sozinha se ainda falta dose HOJE nesse caso
  // (olha `dosesExecutadas`/`dosesTotaisEsperadas`/`proximaDoseEm`, não a mera
  // presença de uma execução anterior) — não precisa do `!itemExecutadoNaData`.
  const itemAindaPrecisaAcaoHoje = (i: ItemExecucao): boolean =>
    i.status === 'CANCELADA' ? false
      : i.dosesTotaisEsperadas != null
        ? itemPendenteHoje(i)
        : !itemExecutadoNaData(i) && itemPendenteHoje(i);

  const tipoConcluidoEm = (g: GrupoExecucao, tipo: 'MEDICAMENTO' | 'PROCEDIMENTO'): boolean => {
    const itensDoTipo = g.itens.filter(i => i.tipo === tipo);
    if (itensDoTipo.length === 0) return false;
    if (itensDoTipo.some(itemAindaPrecisaAcaoHoje)) return false;
    return itensDoTipo.some(i => itemTerminado(i) || itemExecutadoNaData(i));
  };

  const grupoTemTipo = (g: GrupoExecucao, tipo: 'MEDICAMENTO' | 'PROCEDIMENTO') =>
    g.itens.some(i => i.tipo === tipo);

  // "a executar": tem algo que AINDA precisa de ação hoje. Prescrição CANCELADA SAI
  // daqui — vai só para o Histórico (aba Cancelado). O status do grupo é a autoridade:
  // cobre também o item parcialmente aplicado cujo `proximaDoseEm` ainda cairia hoje,
  // que sem esta guarda seguiria contando como pendente. Item já executado hoje não
  // conta (ver `itemAindaPrecisaAcaoHoje`), senão ficaria nos DOIS cards depois de resolvido.
  const tipoPendenteEm = (g: GrupoExecucao, tipo: 'MEDICAMENTO' | 'PROCEDIMENTO'): boolean =>
    g.status !== 'CANCELADO' && g.itens.some(i => i.tipo === tipo && itemAindaPrecisaAcaoHoje(i));

  // Hora da execução para o badge do Histórico — só entre os itens do TIPO daquele
  // card (senão o horário do medicamento vazava para o card de procedimento e
  // vice-versa). localStorage (hora exata do clique) tem prioridade; fallback no
  // executadoEm vindo do backend.
  const horaExecucaoDeTipo = (g: GrupoExecucao, tipo: 'MEDICAMENTO' | 'PROCEDIMENTO'): string | null => {
    const local = horaExecucaoHoje(g.id);
    if (local) return local;
    const ultima = g.itens
      .filter(i => i.tipo === tipo)
      .map(i => (i.executadoEm ? new Date(i.executadoEm) : null))
      .filter((d): d is Date => !!d && !isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (!ultima) return null;
    return `${String(ultima.getHours()).padStart(2, '0')}:${String(ultima.getMinutes()).padStart(2, '0')}`;
  };

  // Executor da dose mais recente ENTRE OS ITENS DO TIPO daquele card — mesmo motivo
  // do `horaExecucaoDeTipo` acima: `g.executadoPor` só é gravado quando o DOCUMENTO
  // inteiro termina (todos os itens, dos dois tipos), mas o card do Histórico decide
  // por TIPO/dia. Sem isto, um grupo com medicamento pronto e procedimento ainda
  // pendente (ou vice-versa) descia para o Histórico daquele tipo sem dizer quem
  // aplicou a dose — o grupo nunca chega a `EXECUTADO` nesse caso.
  const executorDeTipo = (g: GrupoExecucao, tipo: 'MEDICAMENTO' | 'PROCEDIMENTO'): string | null => {
    const ultimoItem = g.itens
      .filter(i => i.tipo === tipo && i.executadoEm)
      .sort((a, b) => new Date(b.executadoEm!).getTime() - new Date(a.executadoEm!).getTime())[0];
    // Item do fluxo por dose (elegível/rolling) tem o executor exato daquela dose —
    // é o caso que faltava (documento ainda não chegou a EXECUTADO como um todo).
    if (ultimoItem?.executadoPorDose) return ultimoItem.executadoPorDose.fullName;
    // Legado (sem fluxo por dose): só existe registro de executor quando o
    // DOCUMENTO inteiro termina — mesmo dado que `g.executadoPor` já guardava.
    // Sem isso, item legado num grupo ainda parcial voltaria a ficar sem nome,
    // mas NUNCA pior do que já estava (não há de onde tirar esse dado).
    if (g.status === 'EXECUTADO') return g.executadoPor?.fullName ?? null;
    return null;
  };

  // Canceladas SAEM de "a executar" e vão para o Histórico (aba Cancelado): uma vez
  // cancelada não há mais o que aplicar, então some da fila e fica só como registro.
  //
  // "a executar" = tem algo PENDENTE hoje (`tipoPendenteEm`) E não está cancelada —
  // item de rolling schedule cuja próxima dose ainda não chegou NÃO conta como
  // pendente, então não aparece aqui. "Histórico" = nada pendente hoje E algo
  // terminado/executado na data (`tipoConcluidoEm`), OU a prescrição cancelada.
  const gruposMedicamentos = aplicarBusca(grupos.filter(g =>
    grupoTemTipo(g, 'MEDICAMENTO') && tipoPendenteEm(g, 'MEDICAMENTO')));
  const gruposProcedimentos = aplicarBusca(grupos.filter(g =>
    grupoTemTipo(g, 'PROCEDIMENTO') && tipoPendenteEm(g, 'PROCEDIMENTO')));

  // Base do card Histórico — SEM a busca do próprio card, só para CONTAR o que existe
  // em cada status (alimenta as abas "Executado (N)"/"Cancelado (N)"; a aba não some
  // por a busca do momento não bater com nada, só a lista embaixo dela).
  const historicoMedicamentosBase = grupos.filter(g =>
    g.status !== 'CANCELADO' && grupoTemTipo(g, 'MEDICAMENTO') && tipoConcluidoEm(g, 'MEDICAMENTO'));
  const historicoProcedimentosBase = grupos.filter(g =>
    g.status !== 'CANCELADO' && grupoTemTipo(g, 'PROCEDIMENTO') && tipoConcluidoEm(g, 'PROCEDIMENTO'));
  // Cancelada chega até aqui pela DATA EM QUE FOI CANCELADA (`listarParaExecucao`
  // filtra por `updatedAt` local === data selecionada, não pela janela/próxima
  // dose do item — é registro de auditoria, não pendência do dia). Não aparece mais
  // na fila "a executar" (ver `tipoPendenteEm`): o lugar dela é a aba "Cancelado".
  const canceladosMedicamentosBase = grupos.filter(g =>
    g.status === 'CANCELADO' && grupoTemTipo(g, 'MEDICAMENTO'));
  const canceladosProcedimentosBase = grupos.filter(g =>
    g.status === 'CANCELADO' && grupoTemTipo(g, 'PROCEDIMENTO'));

  const totalExecutados = historicoMedicamentosBase.length + historicoProcedimentosBase.length + vacinasExecutadasHoje.length;
  const totalCancelados = canceladosMedicamentosBase.length + canceladosProcedimentosBase.length;
  const temHistorico = totalExecutados > 0 || totalCancelados > 0;

  // Busca PRÓPRIA do card Histórico — filtra só o que está sendo exibido ali,
  // independente da busca da fila "a executar" acima.
  const aplicarBuscaHistorico = (lista: GrupoExecucao[]) =>
    lista.filter(buscaHistorico.trim() ? (g => {
        const q = buscaHistorico.toLowerCase();
        return (
          g.animal.nome.toLowerCase().includes(q) ||
          (g.animal.baia ?? '').toLowerCase().includes(q) ||
          g.numeroFormatado.includes(q) ||
          g.veterinario.fullName.toLowerCase().includes(q)
        );
      }) : () => true);
  const vacinasExecutadasFiltradas = vacinasExecutadasHoje.filter(buscaHistorico.trim() ? (v => {
      const q = buscaHistorico.toLowerCase();
      return (
        v.animal.nome.toLowerCase().includes(q) ||
        v.nome.toLowerCase().includes(q) ||
        (v.veterinario?.fullName ?? '').toLowerCase().includes(q)
      );
    }) : () => true);

  // Só uma aba por vez é exibida — "Executado" ou "Cancelado" — igual ao padrão de
  // abas de status já usado na Vacina (CLAUDE.md §12, sessão 2026-08-18).
  const historicoMedicamentos   = filtroHistorico === 'EXECUTADO' ? aplicarBuscaHistorico(historicoMedicamentosBase)  : [];
  const historicoProcedimentos  = filtroHistorico === 'EXECUTADO' ? aplicarBuscaHistorico(historicoProcedimentosBase) : [];
  const vacinasHistExibidas     = filtroHistorico === 'EXECUTADO' ? vacinasExecutadasFiltradas : [];
  const canceladosMedicamentos  = filtroHistorico === 'CANCELADO' ? aplicarBuscaHistorico(canceladosMedicamentosBase)  : [];
  const canceladosProcedimentos = filtroHistorico === 'CANCELADO' ? aplicarBuscaHistorico(canceladosProcedimentosBase) : [];
  const abaHistoricoVazia = filtroHistorico === 'EXECUTADO'
    ? historicoMedicamentos.length === 0 && historicoProcedimentos.length === 0 && vacinasHistExibidas.length === 0
    : canceladosMedicamentos.length === 0 && canceladosProcedimentos.length === 0;
  // Rótulo do card de Histórico segue a data selecionada no calendário — antes dizia
  // sempre "hoje", mesmo navegando para um dia anterior.
  const rotuloHistorico = isHoje ? 'executadas hoje' : `executadas em ${formatDataSel(dataSel)}`;

  const renderGrupoAtivo = (tipo: 'MEDICAMENTO' | 'PROCEDIMENTO') => (g: GrupoExecucao) => (
    <LinhaGrupo
      key={g.id}
      g={g}
      onExecutar={() => { if (!podeExecutarAcao) { semPermissao('executar prescrição'); return; } setModalVer(false); setModalTipo(tipo); setModal(g); }}
      onVer={() => { setModalVer(true); setModalTipo(tipo); setModal(g); }}
      onImprimir={() => podeImprimir ? handleImprimirGrupo(g) : semPermissao('imprimir prescrição')}
      onCancelar={() => { setErroInline(null); setCancelarAlvo(g); }}
      podeExecutarAcao={podeExecutarAcao && g.status !== 'CANCELADO'}
      podeImprimir={podeImprimir}
      podeCancelar={podeCancelar && g.status !== 'CANCELADO'}
      soVisualizacao={!isHoje || g.status === 'CANCELADO'}
    />
  );

  const renderGrupoHistorico = (tipo: 'MEDICAMENTO' | 'PROCEDIMENTO') => (g: GrupoExecucao) => (
    <LinhaGrupo
      key={g.id}
      g={g}
      onExecutar={() => {}}
      onVer={() => { setModalVer(true); setModalTipo(tipo); setModal(g); }}
      onImprimir={() => podeImprimir ? handleImprimirGrupo(g) : semPermissao('imprimir prescrição')}
      podeExecutarAcao={false}
      podeImprimir={podeImprimir}
      soVisualizacao
      executada
      horaExecucao={horaExecucaoDeTipo(g, tipo)}
      executorNome={executorDeTipo(g, tipo)}
    />
  );

  // Aba "Cancelado" do Histórico — mesma linha, sem o selo "Executada" (o "Cancelada"
  // já vem sozinho de dentro do LinhaGrupo, por `g.status === 'CANCELADO'`).
  const renderGrupoCancelado = (tipo: 'MEDICAMENTO' | 'PROCEDIMENTO') => (g: GrupoExecucao) => (
    <LinhaGrupo
      key={g.id}
      g={g}
      onExecutar={() => {}}
      onVer={() => { setModalVer(true); setModalTipo(tipo); setModal(g); }}
      onImprimir={() => podeImprimir ? handleImprimirGrupo(g) : semPermissao('imprimir prescrição')}
      podeExecutarAcao={false}
      podeImprimir={podeImprimir}
      soVisualizacao
    />
  );

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

          {/* Coluna esquerda: só o calendário — o Histórico vira uma faixa própria,
              abaixo de TODA a agenda (calendário + execuções), ocupando a largura
              inteira da tela. */}
          <div className="lg:w-72 flex-shrink-0">
            <CalendarioInterativo
              selectedDate={dataSel}
              onChange={setDataSel}
              statusPorDia={new Map()}
            />
          </div>

          <div className="flex-1 flex flex-col gap-4 min-w-0">

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

            {/* ── Execuções pendentes — um card só, com scroll interno, para a fila
                não empurrar o resto da tela quando o plantão está cheio. */}
            <div className="bg-white rounded-2xl border border-gray-200 p-3 max-h-[70vh] overflow-y-auto space-y-4">
              {loading ? (
                <div className="flex justify-center py-24">
                  <Loader2 size={24} className="animate-spin text-emerald-600" />
                </div>
              ) : gruposMedicamentos.length === 0 && gruposProcedimentos.length === 0 && vacinasFiltradas.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-3">
                  <CheckCircle2 size={40} />
                  <p className="text-sm">
                    {grupos.length === 0 && vacinas.length === 0
                      ? `Nenhuma prescrição para ${isHoje ? 'hoje' : formatDataSel(dataSel)}`
                      : temHistorico
                      ? `Todas as prescrições de ${isHoje ? 'hoje' : formatDataSel(dataSel)} já foram executadas`
                      : 'Nenhum resultado para a busca'}
                  </p>
                </div>
              ) : (
                <>
                  {gruposMedicamentos.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-1 pb-1">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                          <Pill size={13} className="text-emerald-600" /> Medicamentos a aplicar
                        </p>
                        <span className="text-xs text-gray-400">
                          {gruposMedicamentos.length} prescrição{gruposMedicamentos.length !== 1 ? 'ões' : ''}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {gruposMedicamentos.map(renderGrupoAtivo('MEDICAMENTO'))}
                      </div>
                    </div>
                  )}

                  {gruposProcedimentos.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-1 pb-1">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                          <Stethoscope size={13} className="text-blue-600" /> Procedimentos a executar
                        </p>
                        <span className="text-xs text-gray-400">
                          {gruposProcedimentos.length} prescrição{gruposProcedimentos.length !== 1 ? 'ões' : ''}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {gruposProcedimentos.map(renderGrupoAtivo('PROCEDIMENTO'))}
                      </div>
                    </div>
                  )}

                  {/* ── Vacinas a aplicar (FINALIZADAS) — só no dia de hoje ─────── */}
                  {isHoje && vacinasFiltradas.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-1 pb-1">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                          <Syringe size={13} className="text-emerald-600" /> Vacinas a aplicar
                        </p>
                        <span className="text-xs text-gray-400">
                          {vacinasFiltradas.length} vacina{vacinasFiltradas.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {vacinasFiltradas.map(v => (
                          <LinhaExecucao
                            key={v.id}
                            animal={v.animal}
                            detalhe={[
                              v.nome,
                              v.dose,
                              v.via,
                              v.quantidade && v.quantidade > 1 ? `${v.quantidade} doses` : null,
                            ].filter(Boolean).join(' · ')}
                            numeroLabel="Nº Vacina"
                            numeroFormatado={formatNumeroClinico(v.numero)}
                            onNumero={() => navigate(`/clinica/vacina/${v.animal.id}?item=${v.id}`)}
                            tituloNumero="Ir para a vacina original"
                            veterinarioNome={v.veterinario?.fullName ?? '—'}
                          >
                            {/* MESMA ORDEM da linha da prescrição: VISUALIZAR · EXECUTAR ·
                                IMPRIMIR (a vacina não tem cancelar aqui — o cancelamento é na
                                tela de Vacina). Ver e Executar abrem a MESMA tela, como no
                                medicamento; só o olho a abre em somente leitura. */}
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button onClick={() => { setVacModoVer(true); setVacModal(v); }}
                                title="Ver vacina"
                                aria-label="Ver vacina"
                                className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors">
                                <Eye size={14} />
                              </button>
                              {podeExecutarAcao && (
                                <button
                                  onClick={() => { setVacModoVer(false); setVacModal(v); }}
                                  title="Aplicar vacina"
                                  aria-label="Aplicar vacina"
                                  className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors">
                                  <CheckCircle2 size={16} />
                                </button>
                              )}
                              {podeImprimir && (
                                <button onClick={() => imprimirVacinaExec(v)}
                                  title="Imprimir vacina"
                                  aria-label="Imprimir vacina"
                                  className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
                                  <Printer size={14} />
                                </button>
                              )}
                              {podeCancelar && (
                                <button
                                  onClick={() => { setErroInline(null); setCancelarVacina(v); }}
                                  title="Cancelar vacina"
                                  aria-label="Cancelar vacina"
                                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                  <Ban size={16} />
                                </button>
                              )}
                            </div>
                          </LinhaExecucao>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

          </div>
        </div>

        {/* ── Histórico — prescrições e vacinas já executadas hoje ─────────
            Faixa própria, ABAIXO da agenda inteira (calendário + execuções),
            ocupando a largura toda: o medicamento/procedimento/vacina executado
            sai da fila e desce pra cá. Card com scroll interno para não esticar
            a página quando o histórico do dia é longo. */}
        {!loading && temHistorico && (
          <div className="bg-white rounded-2xl border border-gray-200 p-3 max-h-[50vh] overflow-y-auto space-y-3">
            <p className="px-1 text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-600" /> Histórico — {rotuloHistorico}
            </p>

            {/* Busca + filtro de status PRÓPRIOS do card — não afetam a fila "a
                executar" acima. Abas no mesmo padrão da Vacina: um só realce
                (emerald), contagem entre parênteses. */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-1">
              <div className="relative flex-1 min-w-0">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={buscaHistorico}
                  onChange={e => setBuscaHistorico(e.target.value)}
                  placeholder="Buscar no histórico por nome, baia, prescrição ou veterinário"
                  className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {(['EXECUTADO', 'CANCELADO'] as const).map(key => {
                  const isActive = filtroHistorico === key;
                  const count = key === 'EXECUTADO' ? totalExecutados : totalCancelados;
                  return (
                    <button key={key} onClick={() => setFiltroHistorico(key)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${
                        isActive ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                      }`}>
                      {key === 'EXECUTADO' ? 'Executado' : 'Cancelado'}
                      <span className={isActive ? 'text-emerald-100' : 'text-gray-400'}>({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {abaHistoricoVazia && (
              <p className="px-1 py-4 text-center text-xs text-gray-400">
                {buscaHistorico.trim()
                  ? 'Nenhum resultado para a busca'
                  : filtroHistorico === 'EXECUTADO'
                  ? `Nada executado ${isHoje ? 'hoje' : `em ${formatDataSel(dataSel)}`}`
                  : `Nada cancelado ${isHoje ? 'hoje' : `em ${formatDataSel(dataSel)}`}`}
              </p>
            )}

            {historicoMedicamentos.length > 0 && (
              <div className="space-y-2 opacity-90">
                <div className="flex items-center justify-between px-1 pb-1">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                    <Pill size={12} className="text-emerald-600" /> Medicamentos
                  </p>
                  <span className="text-xs text-gray-400">
                    {historicoMedicamentos.length} prescrição{historicoMedicamentos.length !== 1 ? 'ões' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {historicoMedicamentos.map(renderGrupoHistorico('MEDICAMENTO'))}
                </div>
              </div>
            )}

            {historicoProcedimentos.length > 0 && (
              <div className="space-y-2 opacity-90">
                <div className="flex items-center justify-between px-1 pb-1">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                    <Stethoscope size={12} className="text-blue-600" /> Procedimentos
                  </p>
                  <span className="text-xs text-gray-400">
                    {historicoProcedimentos.length} prescrição{historicoProcedimentos.length !== 1 ? 'ões' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {historicoProcedimentos.map(renderGrupoHistorico('PROCEDIMENTO'))}
                </div>
              </div>
            )}

            {vacinasHistExibidas.length > 0 && (
              <div className="space-y-2 opacity-90">
                <div className="flex items-center justify-between px-1 pb-1">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                    <Syringe size={12} className="text-emerald-600" /> Vacinas
                  </p>
                  <span className="text-xs text-gray-400">
                    {vacinasHistExibidas.length} vacina{vacinasHistExibidas.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {vacinasHistExibidas.map(v => (
                    <LinhaExecucao
                      key={v.id}
                      animal={v.animal}
                      detalhe={[
                        v.nome,
                        v.dose,
                        v.via,
                        v.quantidade && v.quantidade > 1 ? `${v.quantidade} doses` : null,
                      ].filter(Boolean).join(' · ')}
                      numeroLabel="Nº Vacina"
                      numeroFormatado={formatNumeroClinico(v.numero)}
                      onNumero={() => navigate(`/clinica/vacina/${v.animal.id}?item=${v.id}`)}
                      tituloNumero="Ir para a vacina original"
                      veterinarioNome={v.veterinario?.fullName ?? '—'}
                    >
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold rounded-full whitespace-nowrap">
                          <CheckCircle2 size={11} /> Executada
                        </span>
                        <button onClick={() => { setVacModoVer(true); setVacModal(v); }}
                          title="Ver vacina" aria-label="Ver vacina"
                          className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors">
                          <Eye size={14} />
                        </button>
                        {podeImprimir && (
                          <button onClick={() => imprimirVacinaExec(v)}
                            title="Imprimir vacina" aria-label="Imprimir vacina"
                            className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
                            <Printer size={14} />
                          </button>
                        )}
                      </div>
                    </LinhaExecucao>
                  ))}
                </div>
              </div>
            )}

            {canceladosMedicamentos.length > 0 && (
              <div className="space-y-2 opacity-90">
                <div className="flex items-center justify-between px-1 pb-1">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                    <Pill size={12} className="text-red-500" /> Medicamentos
                  </p>
                  <span className="text-xs text-gray-400">
                    {canceladosMedicamentos.length} prescrição{canceladosMedicamentos.length !== 1 ? 'ões' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {canceladosMedicamentos.map(renderGrupoCancelado('MEDICAMENTO'))}
                </div>
              </div>
            )}

            {canceladosProcedimentos.length > 0 && (
              <div className="space-y-2 opacity-90">
                <div className="flex items-center justify-between px-1 pb-1">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                    <Stethoscope size={12} className="text-red-500" /> Procedimentos
                  </p>
                  <span className="text-xs text-gray-400">
                    {canceladosProcedimentos.length} prescrição{canceladosProcedimentos.length !== 1 ? 'ões' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {canceladosProcedimentos.map(renderGrupoCancelado('PROCEDIMENTO'))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {modal && (
        <ModalExecucao
          grupo={modal}
          tipoFiltro={modalTipo}
          dataRef={dataSel}
          onClose={() => { setModal(null); setModalTipo(null); carregar(); }}
          soVisualizacao={modalVer || !isHoje || modal.status === 'CANCELADO'
            || (modalTipo ? tipoConcluidoEm(modal, modalTipo) : foiExecutadoHoje(modal))}
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

      {cancelarVacina && (
        <ModalJustificativa
          aberto
          titulo={`Cancelar vacina — ${cancelarVacina.nome}`}
          descricao={`Cancela a vacina de ${cancelarVacina.animal.nome}, devolve as doses ao lote e remove o lançamento da fatura. A justificativa vai para a auditoria.`}
          acaoLabel="Cancelar vacina"
          onConfirmar={handleCancelarVacinaPlantao}
          onFechar={() => { if (!cancelando) setCancelarVacina(null); }}
        />
      )}

      {vacModal && (
        <ModalExecucaoVacina
          v={vacModal}
          onClose={() => setVacModal(null)}
          onExecutada={carregar}
          // Só o olho abre em leitura; fora de hoje a fila nem lista vacina.
          soVisualizacao={vacModoVer || !isHoje}
          podeExecutarAcao={podeExecutarAcao}
          podeCancelar={podeCancelar}
        />
      )}
    </PageContainer>
  );
}

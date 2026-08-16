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
import { regimeExigeResumo, gerarResumoDoses } from '../utils/posologia';
import toast from 'react-hot-toast';
import api from '../services/api';
import { imprimirPrescricao, type PrintGrupoPrescricao, type PrintItemPrescricao } from '../utils/PrescricaoPrint';
import { formatDate } from '../utils/dateUtils';
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
  // Execução por DOSE individual (null = item fora do fluxo novo — sem horaInicio
  // definido, ou frequência agora/SOS/seNecessario; mantém o comportamento antigo).
  dosesExecutadas?:      number | null;
  dosesTotaisEsperadas?: number | null;
  /** Próximo horário esperado (ISO) — ROLLING: recalculado a cada execução a partir
   *  do horário REAL da dose anterior, não uma grade fixa desde `horaInicio`. */
  proximaDoseEm?:         string | null;
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

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Data ('YYYY-MM-DD') de um timestamp ISO no fuso LOCAL — nunca `slice(0, 10)`,
 *  que devolve a data em UTC e adianta o dia à noite (ver `itemPendenteHoje`). */
export function dataLocalDe(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Item ainda a executar NAQUELE dia: dentro da janela do tratamento e ainda não
 * executado na data. Exportado porque o **Painel Principal** monta a mesma fila —
 * duas definições de "o que falta hoje" divergiriam na primeira correção.
 *
 * ⚠️ A data de `executadoEm` é lida no fuso LOCAL (`dataLocalDe`). `slice(0, 10)`
 * devolve a data em UTC e, a partir das 21h (BRT = UTC-3), isso já é o DIA SEGUINTE:
 * o item executado à noite não contaria como feito hoje.
 */
export function itemPendenteEm(
  item: Pick<ItemExecucao, 'diaAtual' | 'duracaoDias' | 'executadoEm' | 'dosesExecutadas' | 'dosesTotaisEsperadas'>,
  data: string,
): boolean {
  // Elegível ao fluxo por dose: pendente enquanto restar dose do curso, sem
  // depender de "já executou hoje" — pode haver mais de uma dose no mesmo dia.
  if (item.dosesTotaisEsperadas != null) {
    return (item.dosesExecutadas ?? 0) < item.dosesTotaisEsperadas;
  }
  const dentroJanela = item.diaAtual >= 1 && item.diaAtual <= item.duracaoDias;
  return dentroJanela && dataLocalDe(item.executadoEm) !== data;
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
                      <Ban size={14} />
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
  // Doses executadas NESTA sessão do modal, além do que `item.dosesExecutadas` já
  // trazia do backend — o `grupo` prop fica parado até o pai recarregar a lista
  // (`onClose`), então sem isso a 2ª dose do mesmo item pareceria sempre disponível.
  const [doseOverride, setDoseOverride] = useState<Record<number, number>>({});
  // Execução fora do horário pendente de confirmação (antecipada/atrasada) — a
  // MESMA tela para os dois casos, nunca bloqueia, só avisa o horário correto.
  const [confirmacao, setConfirmacao] = useState<{
    item: ItemExecucao; slots: string[]; previsto: string; agora: string; classificacao: string;
  } | null>(null);

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

  // Doses do item já dadas, contando o que este modal executou nesta sessão —
  // só existe para itens elegíveis ao fluxo por dose (`dosesTotaisEsperadas != null`).
  const dosesFeitas = (item: ItemExecucao): number =>
    (item.dosesExecutadas ?? 0) + (doseOverride[item.id] ?? 0);

  // "Concluído" decide o estilo do card e se o botão de executar habilita:
  // elegível → todas as doses do curso já foram dadas (pode haver mais de uma por
  // dia); legado (sem horário) → o critério antigo, executado hoje.
  const itemConcluido = (item: ItemExecucao): boolean =>
    item.dosesTotaisEsperadas != null
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
  // `confirmarHorario`: reenvio após o usuário confirmar execução fora do horário
  // (antecipada/atrasada) na tela de aviso — nunca bloqueia, só confirma.
  const handleExecutarItem = async (item: ItemExecucao, slots: string[], confirmarHorario = false) => {
    if (salvando) return;
    setSalvando(true);
    setExecItemId(item.id);
    setErroEstoque([]);
    try {
      await api.post(`/clinica/prescricoes/grupos/${grupo.id}/executar`, {
        itemIds: [item.id],
        ...(confirmarHorario ? { confirmarHorario: true } : {}),
      });
      const m = marcarItemFeito(execMap, item.id, slots);
      saveExecMap(grupo.id, m);
      setExecMap(m);
      // Doses do curso ainda por vir: soma localmente até o pai recarregar a lista.
      if (item.dosesTotaisEsperadas != null) {
        setDoseOverride(prev => ({ ...prev, [item.id]: (prev[item.id] ?? 0) + 1 }));
      }
      setConfirmacao(null);
      toast.success(`${item.medicamento} — executado e lançado na fatura`);
      // Execução é POR ITEM: mantém o modal aberto para executar os demais. Só fecha
      // quando TODOS os itens do dia já estão executados (este + os demais já feitos).
      const todosExecutados = itensComInfo.every(x =>
        x.item.id === item.id
          ? (item.dosesTotaisEsperadas != null ? dosesFeitas(item) + 1 >= item.dosesTotaisEsperadas : true)
          : x.activeDone,
      );
      if (todosExecutados) { markDoneToday(grupo.id); onClose(); }
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: {
        erro?: string; previsto?: string; agora?: string; classificacao?: string;
      } } };
      if (e?.response?.status === 400 && e?.response?.data?.erro === 'CONFIRMACAO_NECESSARIA') {
        setConfirmacao({
          item, slots,
          previsto:      e.response.data.previsto ?? new Date().toISOString(),
          agora:         e.response.data.agora ?? new Date().toISOString(),
          classificacao: e.response.data.classificacao ?? 'ANTECIPADA',
        });
      } else {
        tratarErroExec(err, 'Erro ao executar item');
      }
    } finally {
      setSalvando(false);
      setExecItemId(null);
    }
  };

  // Executa TODOS os itens restantes do dia de uma vez (backend ignora os já
  // executados). Ação de LOTE: manda `confirmarHorario` direto, sem abrir um
  // aviso por item — o próprio clique em "Executar Todos" já é a confirmação.
  const handleExecutarTodos = async () => {
    setSalvando(true);
    setErroEstoque([]);
    try {
      await api.post(`/clinica/prescricoes/grupos/${grupo.id}/executar`, { confirmarHorario: true });
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

                  {regimeExigeResumo(item.frequencia, item.duracaoDias) && (() => {
                    const resumo = gerarResumoDoses(item.frequencia, item.duracaoDias);
                    // Só a linha da dose que será executada AGORA — não o curso inteiro.
                    // Elegível (backend rastreia por dose): a próxima é `dosesExecutadas`
                    // (0-indexado, já é a próxima). Legado (sem rastreio por dose): a
                    // 1ª dose do dia corrente (`diaAtual`).
                    const linhaAtual = item.dosesExecutadas != null
                      ? resumo[item.dosesExecutadas]
                      : resumo.find(d => d.dia === item.diaAtual);
                    if (!linhaAtual) return null;
                    return (
                      <p className="mt-1.5 text-xs font-bold text-red-600">
                        {POSOLOGIAS[item.frequencia] ?? item.frequencia} por {item.duracaoDias} dia{item.duracaoDias > 1 ? 's' : ''} — {
                          linhaAtual.simples
                            ? `${String(linhaAtual.dia).padStart(2, '0')}/${String(linhaAtual.totalDias).padStart(2, '0')}`
                            : `${linhaAtual.rotulo} Execução - ${String(linhaAtual.dia).padStart(2, '0')}/${String(linhaAtual.totalDias).padStart(2, '0')} Dias`
                        }
                      </p>
                    );
                  })()}

                  {slots.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {slots.map((slot, idx) => {
                        const done   = isSlotDone(execMap, item.id, idx);
                        const active = idx === activeIdx;
                        const past   = activeIdx >= 0 && idx < activeIdx;
                        // Horário FEITO é emerald; o horário DA VEZ é âmbar (pendente, a
                        // convenção de rascunho/pendente da aplicação). Os dois eram verdes
                        // vizinhos e ficavam indistinguíveis a um relance.
                        return (
                          <span key={slot} className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-medium border transition-all ${
                            done
                              ? 'bg-emerald-500 text-white border-emerald-500'
                              : active
                              ? 'bg-amber-500 text-white border-amber-500 shadow-sm ring-2 ring-amber-200'
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
                  /* EXECUTAR é a MESMA ação-ícone da lista (emerald `CheckCircle2`), não
                     mais um botão sólido — dentro e fora do modal a ação tem a mesma cara.
                     O ESTADO, que o rótulo antigo carregava ("Executado"/"Aguardando"),
                     agora aparece em três lugares: a cor do ícone (cinza = ainda não deu o
                     horário, e cinza é justamente o "indisponível" da §6), o `title` e o
                     fundo emerald que o card inteiro ganha quando o item é executado. */
                  <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                    <button
                      // Execução item a item: já debita o estoque e lança este item na fatura.
                      // Antecipada/atrasada NUNCA bloqueia aqui — o backend responde
                      // CONFIRMACAO_NECESSARIA e a tela de aviso decide, não este botão.
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
                  onClick={handleExecutarTodos}
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
        descricao={`Cancela este item da prescrição #${grupo.numeroFormatado} e libera o estoque reservado dele. Os demais itens seguem normalmente. A justificativa vai para a auditoria.`}
        acaoLabel="Cancelar item"
        onConfirmar={handleCancelarItem}
        onFechar={() => { if (!cancelando) setCancelarItem(null); }}
      />
    )}

    {/* Execução antecipada OU atrasada — MESMA tela para os dois casos, nunca
        bloqueia: só avisa o horário correto e deixa confirmar. A execução real
        (com auditoria de paciente/medicamento/previsto/executado/quem) só acontece
        ao confirmar. */}
    <ConfirmModal
      open={!!confirmacao}
      variante="aviso"
      titulo={confirmacao?.classificacao === 'ATRASADA' ? 'Dose atrasada' : 'Dose antecipada'}
      mensagem={confirmacao && (
        <>
          <strong>{confirmacao.item.medicamento}</strong> está agendado para{' '}
          <strong>{new Date(confirmacao.previsto).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>.
          {confirmacao.classificacao === 'ATRASADA'
            ? ' Já passou do horário — deseja executar agora mesmo assim?'
            : ' Ainda não chegou o horário — deseja executar agora mesmo assim?'}
        </>
      )}
      labelConfirmar={salvando ? 'Executando…' : 'Executar mesmo assim'}
      labelCancelar="Cancelar"
      onConfirmar={() => { if (confirmacao) handleExecutarItem(confirmacao.item, confirmacao.slots, true); }}
      onCancelar={() => setConfirmacao(null)}
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
  const navigate = useNavigate();

  return (
    <LinhaExecucao
      animal={g.animal}
      numeroLabel="Nº Prescrição"
      numeroFormatado={g.numeroFormatado}
      onNumero={() => navigate(`/clinica/prescricao/${g.animal.id}`)}
      tituloNumero="Ir para a prescrição original"
      veterinarioNome={g.veterinario.fullName}
      executorNome={g.executadoPor?.fullName ?? null}
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
            <Ban size={14} />
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
  // Vacina aberta no ModalExecucaoVacina + a intenção da abertura (olho = leitura),
  // exatamente o par `modal`/`modalVer` que a prescrição usa.
  const [vacModal,   setVacModal]   = useState<VacinaExecucao | null>(null);
  const [vacModoVer, setVacModoVer] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [busca,    setBusca]    = useState('');
  const [modal,    setModal]    = useState<GrupoExecucao | null>(null);
  // Intenção da abertura do modal: "Ver" (olho) força SOMENTE LEITURA mesmo em
  // prescrição de hoje ainda executável — só o botão "Executar" abre em modo de execução.
  const [modalVer, setModalVer] = useState(false);
  const [dataSel,  setDataSel]  = useState(localToday());
  // Prescrição / vacina escolhida para cancelar (abre o ModalJustificativa da lista)
  const [cancelarAlvo,   setCancelarAlvo]   = useState<GrupoExecucao | null>(null);
  const [cancelarVacina, setCancelarVacina] = useState<VacinaExecucao | null>(null);
  const [cancelando,     setCancelando]     = useState(false);
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

  // Item ainda a executar na data selecionada — fonte única com o Painel Principal.
  const itemPendenteHoje = (item: ItemExecucao): boolean => itemPendenteEm(item, dataSel);

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

  // Medicamentos e Procedimentos são fluxos distintos do plantão (aplicar um remédio
  // não é o mesmo gesto que executar um procedimento) — a fila é separada por tipo de
  // ITEM. Um grupo com itens dos dois tipos aparece nas duas seções: a separação é por
  // conteúdo pendente, não por documento (a prescrição continua sendo um documento só).
  const grupoTemTipo = (g: GrupoExecucao, tipo: 'MEDICAMENTO' | 'PROCEDIMENTO') =>
    g.itens.some(i => i.tipo === tipo);
  const gruposMedicamentos    = filtrados.filter(g => grupoTemTipo(g, 'MEDICAMENTO'));
  const gruposProcedimentos   = filtrados.filter(g => grupoTemTipo(g, 'PROCEDIMENTO'));
  const historicoMedicamentos  = executadasHoje.filter(g => grupoTemTipo(g, 'MEDICAMENTO'));
  const historicoProcedimentos = executadasHoje.filter(g => grupoTemTipo(g, 'PROCEDIMENTO'));

  const renderGrupoAtivo = (g: GrupoExecucao) => (
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
  );

  const renderGrupoHistorico = (g: GrupoExecucao) => (
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
              ) : filtrados.length === 0 && vacinasFiltradas.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-3">
                  <CheckCircle2 size={40} />
                  <p className="text-sm">
                    {grupos.length === 0 && vacinas.length === 0
                      ? `Nenhuma prescrição para ${isHoje ? 'hoje' : formatDataSel(dataSel)}`
                      : executadasHoje.length > 0
                      ? 'Todas as prescrições de hoje já foram executadas'
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
                        {gruposMedicamentos.map(renderGrupoAtivo)}
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
                        {gruposProcedimentos.map(renderGrupoAtivo)}
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
                                  <Ban size={14} />
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

        {/* ── Histórico — prescrições já executadas hoje ───────────────────
            Faixa própria, ABAIXO da agenda inteira (calendário + execuções),
            ocupando a largura toda: o medicamento/procedimento executado sai da
            fila e desce pra cá (a vacina executada some da tela: vira EXECUTADA
            e o /para-execucao deixa de devolvê-la). Card com scroll interno
            para não esticar a página quando o histórico do dia é longo. */}
        {!loading && executadasHoje.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-3 max-h-[50vh] overflow-y-auto space-y-4">
            <p className="px-1 text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-600" /> Histórico — executadas hoje
            </p>

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
                  {historicoMedicamentos.map(renderGrupoHistorico)}
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
                  {historicoProcedimentos.map(renderGrupoHistorico)}
                </div>
              </div>
            )}
          </div>
        )}
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

// backend/src/lib/agendaDoses.js
// Fonte ÚNICA da fórmula de horário da execução de prescrição POR DOSE — reusada
// pelo controller de execução (PrescricaoGrupoController) e pelo cron de aviso de
// WhatsApp (lembreteDosePrescricaoService). Duas cópias divergiriam na primeira
// correção, exatamente como INTERVALO_HORAS/POSOLOGIAS já divergiam entre
// frontend e backend antes desta lib existir.
'use strict';

// Doses por dia, por frequência. Espelha o que já existia em
// PrescricaoGrupoController.js (cálculo de quantidade) — migrado para cá.
const DOSES_POR_DIA = {
  '1xDia':        1,    '12em12h':  2,    '8em8h':        3,
  '6em6h':        4,    '4em4h':    6,    '1em1h':        24,
  'continuo':     1,    'seNecessario': 1, 'SOS':         1,
  '1x2dias':      1/2,  '1x3dias':  1/3,  '1xSemana':    1/7,
  '1x21dias':     1/21, '1x30dias': 1/30, '1x90dias':    1/90,
};

const HORA_MS = 60 * 60 * 1000;

// Intervalo entre duas doses consecutivas, em milissegundos. Para as intra-dia é
// 24h/dosesPorDia; para as de vários dias (1x2dias..1x90dias) é o próprio período
// (1/dosesPorDia já É o número de dias, então isso cai direto na mesma conta).
function intervaloEmMs(frequencia) {
  const dosesPorDia = DOSES_POR_DIA[frequencia];
  if (!dosesPorDia) return 24 * HORA_MS;
  return (24 * HORA_MS) / dosesPorDia;
}

// Frequências SEM horário fixo — nunca entram no fluxo de agendamento por dose.
const FREQUENCIAS_SEM_HORARIO = new Set(['agora', 'SOS', 'seNecessario']);

/**
 * Item elegível ao fluxo novo (rolling schedule, confirmação de antecipação/atraso,
 * aviso de WhatsApp)? Precisa de uma âncora de horário (`horaInicio`) e de uma
 * frequência que implique horário esperado. Sem isso, mantém o comportamento
 * antigo (uma execução cobre o dia inteiro, sem checagem de horário).
 */
function elegivelParaFluxoNovo(item) {
  if (!item) return false;
  if (FREQUENCIAS_SEM_HORARIO.has(item.frequencia)) return false;
  if (!item.horaInicio || !String(item.horaInicio).trim()) return false;
  return true;
}

// Total de doses esperadas no curso inteiro (dosesPorDia × duracaoDias).
function dosesTotaisEsperadas(item) {
  const dosesPorDia = DOSES_POR_DIA[item.frequencia] ?? 1;
  const dias        = Math.max(Number(item.duracaoDias) || 1, 1);
  return Math.max(1, Math.round(dosesPorDia * dias));
}

// 1ª dose esperada: dataInicio (só a data) + horaInicio (HH:MM).
function primeiraDoseEsperada(item) {
  const base = new Date(item.dataInicio);
  const diaBase = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const [h, m] = String(item.horaInicio).split(':').map(Number);
  diaBase.setUTCHours(h || 0, m || 0, 0, 0);
  return diaBase;
}

// Rolling schedule: a PRÓXIMA dose é sempre o horário REAL da última + o
// intervalo da frequência — nunca uma grade fixa recontada desde o início.
function calcularProximaDose(horarioRealDaUltima, frequencia) {
  return new Date(new Date(horarioRealDaUltima).getTime() + intervaloEmMs(frequencia));
}

const TOLERANCIA_PADRAO_MIN = 2;

/**
 * Classifica uma execução em relação ao horário esperado. Tolerância pequena
 * (2min) evita popup de confirmação por um clique poucos segundos fora do horário.
 * @returns {'NO_HORARIO'|'ANTECIPADA'|'ATRASADA'}
 */
function classificarExecucao(agora, previsto, toleranciaMin = TOLERANCIA_PADRAO_MIN) {
  const diffMin = (new Date(agora).getTime() - new Date(previsto).getTime()) / 60000;
  if (Math.abs(diffMin) <= toleranciaMin) return 'NO_HORARIO';
  return diffMin < 0 ? 'ANTECIPADA' : 'ATRASADA';
}

// Diferença em minutos (executado − previsto), arredondada — usada no log de
// auditoria e no registro de PrescricaoExecucaoDose.
function diferencaEmMinutos(agora, previsto) {
  return Math.round((new Date(agora).getTime() - new Date(previsto).getTime()) / 60000);
}

module.exports = {
  DOSES_POR_DIA,
  intervaloEmMs,
  elegivelParaFluxoNovo,
  dosesTotaisEsperadas,
  primeiraDoseEsperada,
  calcularProximaDose,
  classificarExecucao,
  diferencaEmMinutos,
};

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
 * "1x a cada N dias" (inclui "1x por semana") — a cadência é o que importa (a
 * cada quantos DIAS), não a hora do dia. Por isso, ao contrário das frequências
 * intra-dia (12em12h etc., que precisam de `horaInicio` para saber os horários
 * do próprio dia), esta família NÃO exige `horaInicio` para entrar no rolling
 * schedule — ver `elegivelParaFluxoNovo`.
 */
function ehIntervaloMultiDia(frequencia) {
  const dosesPorDia = DOSES_POR_DIA[frequencia];
  return dosesPorDia != null && dosesPorDia < 1;
}

/**
 * Item elegível ao fluxo novo (rolling schedule — agenda só nas datas certas, não
 * todo santo dia da janela do curso)?
 *
 * "1x a cada N dias" (inclui semana): SEMPRE elegível, com ou sem `horaInicio`.
 * Hora Início NUNCA é impeditivo aqui — 🔴 exigi-la fazia o item cair no fluxo
 * ANTIGO sem ela (uma execução cobrindo o dia inteiro, repetido todo dia da
 * janela — ex.: "1x/semana × 4" virando "pendente" nos 28 dias, não só nas 4
 * datas certas). Sem `horaInicio`, a 1ª dose fica esperada para `dataInicio` à
 * meia-noite (`primeiraDoseEsperada`) — mera âncora de CALENDÁRIO, não de
 * horário; a execução real da 1ª dose vira a base de tudo dali em diante
 * (`calcularProximaDose(agora, frequencia)`, gravado como `proximaDoseEm` —
 * ver `executar` em PrescricaoGrupoController). Ou seja: o HORÁRIO só se fixa
 * DEPOIS da 1ª execução, nunca antes — CONFIRMACAO_NECESSARIA também não deve
 * bloquear essa 1ª execução por "atraso" contra uma meia-noite que ninguém
 * escolheu (ver o guard em `executar`).
 *
 * Demais frequências (intra-dia, tipo 12em12h): precisam de `horaInicio` — sem
 * ele não há como saber os horários do próprio dia, então mantêm o fluxo antigo.
 */
function elegivelParaFluxoNovo(item) {
  if (!item) return false;
  if (FREQUENCIAS_SEM_HORARIO.has(item.frequencia)) return false;
  if (ehIntervaloMultiDia(item.frequencia)) return true;
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
//
// 🔴 SEM horaInicio (a família "1x a cada N dias" não exige mais — ver
// `elegivelParaFluxoNovo`), o padrão NÃO PODE ser meia-noite UTC: `dataInicio`
// chega do front como data pura ("2026-08-19") e `new Date(...)` interpreta
// isso como meia-noite **UTC**, que em qualquer fuso negativo (Brasil é UTC-3)
// já é 21h do dia ANTERIOR em horário local. Toda comparação de "que dia é
// isso" no sistema usa componentes LOCAIS (`dataLocalStr`/`hojeLocalStr`, nunca
// `toISOString()`) — então meia-noite UTC fazia a 1ª dose nascer "vencida
// ontem": o item sumia da fila no PRÓPRIO dia em que foi prescrito, e o cron de
// dose perdida (`prescricaoCronService.js`) cancelaria no dia seguinte um item
// que ninguém teve a chance de executar. Meio-dia UTC (09h em horário de
// Brasília) fica dentro do mesmo dia LOCAL de `dataInicio` com folga.
function primeiraDoseEsperada(item) {
  const base = new Date(item.dataInicio);
  const diaBase = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const temHoraInicio = item.horaInicio && String(item.horaInicio).trim();
  if (temHoraInicio) {
    const [h, m] = String(item.horaInicio).split(':').map(Number);
    diaBase.setUTCHours(h || 0, m || 0, 0, 0);
  } else {
    diaBase.setUTCHours(12, 0, 0, 0);
  }
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
  ehIntervaloMultiDia,
  elegivelParaFluxoNovo,
  dosesTotaisEsperadas,
  primeiraDoseEsperada,
  calcularProximaDose,
  classificarExecucao,
  diferencaEmMinutos,
};

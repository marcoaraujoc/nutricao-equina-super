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
 * 🔴 `horaInicio` NÃO é mais requisito de NADA (2026-08-23). Antes, frequência
 * intra-dia (12em12h..1em1h) e 1xDia sem hora caíam no fluxo LEGADO, que trata
 * UMA execução como "o dia inteiro coberto" — e foi por isso que Hora Início era
 * obrigatória no formulário. Só que a hora nunca precisou ser prescrita: quem
 * define a grade é a PRIMEIRA EXECUÇÃO. Ivermectina "de 12 em 12h" executada às
 * 20:00 tem a próxima dose às 08:00 — o rolling schedule
 * (`calcularProximaDose(agora, frequencia)`, gravado em `proximaDoseEm` por
 * `executar`) já produzia exatamente isso; o que faltava era deixar o item
 * ENTRAR nesse fluxo sem hora.
 *
 * Agora toda frequência com cadência definida é elegível. Sem hora e sem
 * nenhuma dose dada, o item simplesmente não tem horário previsto ainda — ver
 * `semAncoraDeHorario`, que é o que impede tratar essa ausência como "atraso".
 */
function elegivelParaFluxoNovo(item) {
  if (!item) return false;
  return !FREQUENCIAS_SEM_HORARIO.has(item.frequencia);
}

function temHoraInicio(item) {
  return !!(item && item.horaInicio && String(item.horaInicio).trim());
}

/**
 * O item ainda NÃO tem âncora de horário: nenhuma hora prescrita E nenhuma dose
 * executada. Enquanto isso for verdade não existe "horário previsto" — logo não
 * existe adiantar nem atrasar, e o item fica disponível em qualquer dia da
 * janela do curso (`dentroDaJanelaDoCurso`), como o fluxo legado fazia.
 *
 * 🔴 É este predicado que sustenta a regra de produto "o marco das próximas
 * doses é contado DEPOIS da primeira execução". Todo lugar que compara `agora`
 * com o previsto (gate de execução futura, cron de dose perdida, fila do dia)
 * precisa consultá-lo antes — senão a 1ª dose de um item sem hora nasceria
 * "atrasada" contra uma meia-noite que ninguém escolheu.
 */
function semAncoraDeHorario(item) {
  return !temHoraInicio(item) && (item?.dosesExecutadas ?? 0) === 0;
}

// Total de doses esperadas no curso inteiro (dosesPorDia × duracaoDias).
function dosesTotaisEsperadas(item) {
  const dosesPorDia = DOSES_POR_DIA[item.frequencia] ?? 1;
  const dias        = Math.max(Number(item.duracaoDias) || 1, 1);
  return Math.max(1, Math.round(dosesPorDia * dias));
}

// 1ª dose esperada: dataInicio (só a data) + horaInicio (HH:MM).
//
// 🔴 O HORÁRIO É LOCAL, NUNCA UTC (corrigido em 2026-08-23 — era a origem do
// "sistema 3 horas atrás"). `horaInicio` é o que o veterinário digitou no
// relógio DELE: "20:00" significa 20:00 em Brasília. A versão anterior fazia
// `setUTCHours(20)`, ou seja, gravava 20:00 **UTC** — que o front exibe como
// 17:00 (UTC-3). Toda a cadeia herdava o erro: chip do horário, `proximaDoseEm`,
// a classificação antecipada/atrasada e o lembrete de WhatsApp.
// O processo roda com `process.env.TZ = 'America/Sao_Paulo'` (server.ts), então
// o construtor LOCAL `new Date(ano, mes, dia, h, m)` produz o instante certo.
//
// ⚠️ A DATA continua sendo extraída com os getters UTC: `dataInicio` chega do
// front como data pura ("2026-08-19") e o Prisma a grava como meia-noite UTC —
// `getUTCFullYear/Month/Date` é o que devolve o dia do CALENDÁRIO ali (mesma
// convenção de `janelaDoItem`/`listarParaExecucao`). Usar os getters locais
// devolveria o dia anterior.
//
// Sem `horaInicio` o retorno é meia-noite LOCAL de `dataInicio` — âncora de
// CALENDÁRIO, não de horário. Ela só serve para dizer em que dia o curso começa;
// quem compara horário precisa checar `semAncoraDeHorario` antes e ignorar este
// valor como "previsto" (senão a 1ª dose nasceria atrasada desde 00:01).
function primeiraDoseEsperada(item) {
  const base = new Date(item.dataInicio);
  const ano  = base.getUTCFullYear();
  const mes  = base.getUTCMonth();
  const dia  = base.getUTCDate();
  if (temHoraInicio(item)) {
    const [h, m] = String(item.horaInicio).split(':').map(Number);
    return new Date(ano, mes, dia, h || 0, m || 0, 0, 0);
  }
  return new Date(ano, mes, dia, 0, 0, 0, 0);
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

// Horário previsto de UMA dose: se já houve dose(s) antes, é o rolling schedule
// JÁ PERSISTIDO (`proximaDoseEm` — calculado a partir do horário REAL da última
// execução); sem nenhuma dose ainda, é a 1ª dose esperada (de `dataInicio` +
// `horaInicio`). Fonte ÚNICA — movida para cá (era local ao controller) porque a
// prévia de dias futuros abaixo precisa dela também, e duas cópias divergiriam
// na primeira correção.
//
// 🔴 Devolve `null` quando o item ainda não tem âncora (sem `horaInicio` e sem
// nenhuma dose dada): nesse estado NÃO EXISTE horário previsto, e devolver a
// meia-noite de `primeiraDoseEsperada` faria o item parecer atrasado o dia
// inteiro. Todo caller precisa tratar o null — ver `semAncoraDeHorario`.
function horarioPrevistoDoItem(item) {
  if (semAncoraDeHorario(item)) return null;
  return (item.dosesExecutadas ?? 0) > 0 && item.proximaDoseEm
    ? item.proximaDoseEm
    : primeiraDoseEsperada(item);
}

// Data (YYYY-MM-DD local) do 1º e do último dia do curso. Enquanto o item não
// tem âncora de horário, é esta janela — e não um horário — que decide se ele
// está disponível no dia (mesma semântica do `janelaDoItem` do controller).
function janelaDoCurso(item) {
  const inicio = primeiraDoseEsperada({ ...item, horaInicio: null });
  const fim    = new Date(inicio);
  fim.setDate(fim.getDate() + Math.max(Number(item.duracaoDias) || 1, 1) - 1);
  return { inicioStr: dataLocalDe(inicio), fimStr: dataLocalDe(fim) };
}

function dentroDaJanelaDoCurso(item, dataStr) {
  const { inicioStr, fimStr } = janelaDoCurso(item);
  return inicioStr <= dataStr && dataStr <= fimStr;
}

// Data (YYYY-MM-DD, fuso LOCAL) de um instante qualquer.
function dataLocalDe(d) {
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/**
 * PRÉVIA de dias FUTUROS — responde "há dose prevista nesse dia?" projetando
 * as doses RESTANTES a partir do horário REAL já conhecido (`proximaDoseEm` —
 * ver `horarioPrevistoDoItem`), encadeando `calcularProximaDose` pra frente.
 *
 * 🔴 Regra de produto: "o horário BASE é o da PRIMEIRA execução — ela define o
 * horário das demais." Por isso a prévia NUNCA reconta a partir de
 * `dataInicio`/`horaInicio` originais: parte de `horarioPrevistoDoItem`, que já
 * é o horário REAL (pós 1ª execução) ou a 1ª dose teórica (antes dela) — exatamente
 * a mesma âncora que o rolling schedule de verdade usa. Uma 1ª dose
 * atrasada/antecipada desloca a prévia inteira junto, como já acontece com o
 * agendamento real — nunca um grid fixo recalculado do zero.
 *
 * ⚠️ Só serve para DECIDIR SE O ITEM APARECE ao navegar o calendário da
 * Execução de Prescrição para um dia futuro — nunca para calcular horário
 * exibível nem para permitir execução fora de hoje (isso continua sendo só
 * `proximaDoseEm` em si, com o gate de `dataSel === hoje` no front).
 */
function itemPrevistoParaDataFutura(item, dataStr) {
  if (!elegivelParaFluxoNovo(item)) return false;
  const totalDoses = dosesTotaisEsperadas(item);
  const jaFeitas    = item.dosesExecutadas ?? 0;
  if (jaFeitas >= totalDoses) return false;

  // Sem âncora ainda: não há horário para projetar — o que se sabe é só a janela
  // do curso. Continua "previsto" em qualquer dia dela, como o fluxo legado.
  const previstoInicial = horarioPrevistoDoItem(item);
  if (!previstoInicial) return dentroDaJanelaDoCurso(item, dataStr);

  let previsto = previstoInicial;
  for (let n = jaFeitas; n < totalDoses; n++) {
    if (dataLocalDe(previsto) === dataStr) return true;
    previsto = calcularProximaDose(previsto, item.frequencia);
  }
  return false;
}

module.exports = {
  DOSES_POR_DIA,
  intervaloEmMs,
  ehIntervaloMultiDia,
  elegivelParaFluxoNovo,
  temHoraInicio,
  semAncoraDeHorario,
  dosesTotaisEsperadas,
  primeiraDoseEsperada,
  calcularProximaDose,
  classificarExecucao,
  diferencaEmMinutos,
  horarioPrevistoDoItem,
  janelaDoCurso,
  dentroDaJanelaDoCurso,
  dataLocalDe,
  itemPrevistoParaDataFutura,
};

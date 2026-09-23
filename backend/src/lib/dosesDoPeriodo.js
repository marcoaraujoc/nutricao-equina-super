// backend/src/lib/dosesDoPeriodo.js
// Quantas DOSES de prescrição caem num período, e em que situação cada uma está.
//
// 🔴 POR QUE ESTA LIB EXISTE (2026-09-22): o Mapa de Atendimento contava GRUPOS,
// não doses. O card "Prescrições / Dosagens" somava documentos — um grupo de
// "8 em 8h por 5 dias" valia 1, exatamente igual a uma dose única —, e a decisão
// "foi executada?" saía de `Prescricao.executadoEm`, que guarda só a ÚLTIMA dose.
// Resultado: executar 1 das 2 doses do dia marcava o documento inteiro como
// executado, e o log append-only `tb_prescricao_execucoes_dose` — que é a única
// fonte de "esta dose aconteceu" desde a migration 20260820 — não era lido em
// lugar nenhum do painel. "Atrasada" era pior: dependia de `horaInicio`, que
// desde 2026-08-23 deixou de ser obrigatório (e nesta base está VAZIO em todo
// item), então nenhuma dose jamais foi classificada como atrasada.
//
// Toda a aritmética de horário vem de `agendaDoses.js` (fonte única com o plantão
// e com o cron de WhatsApp) — nada é recalculado aqui.
'use strict';

const {
  DOSES_POR_DIA,
  elegivelParaFluxoNovo,
  dosesTotaisEsperadas,
  horarioPrevistoDoItem,
  primeiraDoseEsperada,
  calcularProximaDose,
  janelaDoCurso,
  dataLocalDe,
  temHoraInicio,
} = require('./agendaDoses');

// Mesma lista de `PrescricaoGrupoController.FREQUENCIAS_FORA_DA_EXECUCAO`: são
// doses SEM agenda ("se necessário"/SOS). O plantão não as lista, então contá-las
// como pendentes faria o painel cobrar trabalho que ninguém deixou de fazer.
const FREQUENCIAS_FORA_DA_EXECUCAO = new Set(['seNecessario', 'SOS']);

// Tolerância antes de chamar a dose de atrasada — a mesma do status ATRASADA de
// AgendamentoClinico, que este painel já usava.
const TOLERANCIA_ATRASO_MIN = 30;

const ZERO = Object.freeze({
  executadas: 0, atrasadas: 0, previstas: 0, total: 0,
  proximoHorario: null, ultimaExecucao: null,
});

/**
 * Item que NÃO entra na conta de doses:
 *  - aplicado pelo proprietário (nunca chega ao plantão — não há o que executar);
 *  - "se necessário"/SOS (não têm agenda);
 *  - item inativo (removido do documento).
 * ⚠️ `aplicadaPeloProprietario` precisa ter sido anexado por
 * `PrescricaoGrupoController.anexarAplicadaProprietario` — o client Prisma pode
 * não conhecer a coluna.
 */
function foraDaContagem(item) {
  return !item
    || item.ativo === false
    || item.aplicadaPeloProprietario === true
    || FREQUENCIAS_FORA_DA_EXECUCAO.has(item.frequencia);
}

/** Doses que o item já deu — legado ('agora') não incrementa `dosesExecutadas`. */
function dosesJaDadas(item) {
  if (elegivelParaFluxoNovo(item)) return item.dosesExecutadas ?? 0;
  return item.executadoEm ? dosesTotaisEsperadas(item) : 0;
}

function dentroDoPeriodo(quando, inicioStr, fimStr) {
  const dia = dataLocalDe(quando);
  return dia >= inicioStr && dia <= fimStr;
}

/**
 * Horários das doses AINDA NÃO DADAS que caem no período.
 *
 * ⚠️ `temHorario: false` significa "sabe-se o DIA, não a hora" — é o item sem
 * `horaInicio` e sem nenhuma dose dada (`semAncoraDeHorario` de agendaDoses).
 * Tratar a meia-noite dele como horário previsto faria a dose nascer atrasada às
 * 00:01 de todo dia da janela; por isso ele é classificado por DIA.
 */
function pendentesNoPeriodo(item, inicioStr, fimStr) {
  const restantes = Math.max(0, dosesTotaisEsperadas(item) - dosesJaDadas(item));
  if (restantes === 0) return [];

  // Legado ('agora'): dose única, no dia em que o curso começa.
  if (!elegivelParaFluxoNovo(item)) {
    const { inicioStr: diaDaDose } = janelaDoCurso(item);
    if (diaDaDose < inicioStr || diaDaDose > fimStr) return [];
    return [{ quando: primeiraDoseEsperada(item), temHorario: false }];
  }

  // Âncora: o rolling schedule já persistido quando houve dose; a 1ª dose teórica
  // quando não houve. Sem `horaInicio` e sem dose, `horarioPrevistoDoItem` devolve
  // null de propósito — aí a âncora é o DIA de início do curso.
  const comHorario = temHoraInicio(item) || (item.dosesExecutadas ?? 0) > 0;
  const ancora     = horarioPrevistoDoItem(item) ?? primeiraDoseEsperada(item);

  const saida = [];
  let previsto = new Date(ancora);
  for (let n = 0; n < restantes; n++) {
    const dia = dataLocalDe(previsto);
    if (dia > fimStr) break;
    if (dia >= inicioStr) saida.push({ quando: new Date(previsto), temHorario: comHorario });
    previsto = calcularProximaDose(previsto, item.frequencia);
  }
  return saida;
}

/**
 * Uma dose pendente está ATRASADA ou ainda PREVISTA?
 * Dia futuro nunca está atrasado; dia passado sempre está. No dia de HOJE, só
 * decide pelo relógio quem tem horário de verdade — sem hora, o dia ainda não
 * acabou e a dose segue prevista.
 */
function situacaoDaPendente({ quando, temHorario }, hojeStr, agora) {
  const dia = dataLocalDe(quando);
  if (dia > hojeStr) return 'PREVISTA';
  if (dia < hojeStr) return 'ATRASADA';
  if (!temHorario)   return 'PREVISTA';
  const atrasoMin = (new Date(agora).getTime() - new Date(quando).getTime()) / 60000;
  return atrasoMin > TOLERANCIA_ATRASO_MIN ? 'ATRASADA' : 'PREVISTA';
}

/**
 * Doses de UM item no período.
 *
 * @param {object} item  item de prescrição com `frequencia`, `dataInicio`,
 *   `duracaoDias`, `horaInicio`, `dosesExecutadas`, `proximaDoseEm`,
 *   `executadoEm`, `aplicadaPeloProprietario` e `execucoesDose[]`.
 * @param {object} ctx   { inicioStr, fimStr, hojeStr, agora, grupoCancelado }
 */
function dosesDoItemNoPeriodo(item, ctx) {
  if (foraDaContagem(item)) return { ...ZERO };
  const { inicioStr, fimStr, hojeStr, agora, grupoCancelado = false } = ctx;

  // ── Executadas: o log append-only é a fonte. Só o legado ('agora'), que não
  // grava dose, cai em `executadoEm`.
  let executadas     = 0;
  let ultimaExecucao = null;
  if (elegivelParaFluxoNovo(item)) {
    for (const d of item.execucoesDose ?? []) {
      if (!dentroDoPeriodo(d.horarioExecutado, inicioStr, fimStr)) continue;
      executadas++;
      const q = new Date(d.horarioExecutado);
      if (!ultimaExecucao || q > ultimaExecucao) ultimaExecucao = q;
    }
  } else if (item.executadoEm && dentroDoPeriodo(item.executadoEm, inicioStr, fimStr)) {
    executadas     = 1;
    ultimaExecucao = new Date(item.executadoEm);
  }

  // ── Pendentes ─────────────────────────────────────────────────────────────
  let atrasadas      = 0;
  let previstas      = 0;
  let proximoHorario = null;
  for (const p of pendentesNoPeriodo(item, inicioStr, fimStr)) {
    const situacao = situacaoDaPendente(p, hojeStr, agora);
    if (situacao === 'ATRASADA') { atrasadas++; continue; }
    // 🔴 Curso CANCELADO não projeta dose para o futuro: o que venceu antes do
    // cancelamento de fato deixou de ser executado (e continua contando), mas
    // prometer as doses seguintes de um tratamento interrompido encheria o
    // painel de trabalho que ninguém vai fazer.
    if (grupoCancelado) continue;
    previstas++;
    if (p.temHorario && (!proximoHorario || p.quando < proximoHorario)) proximoHorario = p.quando;
  }

  return {
    executadas, atrasadas, previstas,
    total: executadas + atrasadas + previstas,
    proximoHorario, ultimaExecucao,
  };
}

/** Soma as doses de todos os itens de um grupo (documento de prescrição). */
function dosesDoGrupoNoPeriodo(grupo, ctx) {
  const cancelado = grupo.status === 'CANCELADO' || grupo.status === 'CANCELADO_PARCIALMENTE';
  const acc = {
    executadas: 0, atrasadas: 0, previstas: 0, total: 0,
    proximoHorario: null, ultimaExecucao: null,
  };
  for (const item of grupo.itens ?? []) {
    const d = dosesDoItemNoPeriodo(item, { ...ctx, grupoCancelado: cancelado });
    acc.executadas += d.executadas;
    acc.atrasadas  += d.atrasadas;
    acc.previstas  += d.previstas;
    acc.total      += d.total;
    if (d.proximoHorario && (!acc.proximoHorario || d.proximoHorario < acc.proximoHorario)) {
      acc.proximoHorario = d.proximoHorario;
    }
    if (d.ultimaExecucao && (!acc.ultimaExecucao || d.ultimaExecucao > acc.ultimaExecucao)) {
      acc.ultimaExecucao = d.ultimaExecucao;
    }
  }
  return acc;
}

/**
 * Status do documento no período, derivado das DOSES — não da coluna `status`.
 * Ordem: atrasada > ainda há dose a fazer > o que havia foi executado > cancelado.
 */
function statusDasDoses(doses, grupoStatus) {
  if (doses.atrasadas > 0) return 'ATRASADA';
  if (doses.previstas > 0) return 'AGENDADO';
  if (doses.executadas > 0) return 'EXECUTADO';
  if (grupoStatus === 'CANCELADO' || grupoStatus === 'CANCELADO_PARCIALMENTE') return 'CANCELADO';
  return grupoStatus === 'EXECUTADO' ? 'EXECUTADO' : 'AGENDADO';
}

module.exports = {
  DOSES_POR_DIA,
  FREQUENCIAS_FORA_DA_EXECUCAO,
  TOLERANCIA_ATRASO_MIN,
  foraDaContagem,
  dosesJaDadas,
  pendentesNoPeriodo,
  situacaoDaPendente,
  dosesDoItemNoPeriodo,
  dosesDoGrupoNoPeriodo,
  statusDasDoses,
};

// backend/src/services/agendamentoCronService.js
// Rotina executada no fim do dia: cancela os agendamentos que não foram realizados.
// Registrada como job em server.ts via cronManager — a agenda (horário) e o liga/desliga
// ficam sob controle do ADMIN na tela de Configuração (CronAgenda).
//
// ⚠️ PADRÃO POR EMPRESA (fase 7 do multi-tenancy — `lib/cronTenant.js`). Antes estas
// funções varriam TODAS as empresas numa consulta só, com o `prisma` global. Agora
// recebem o CLIENTE DA TRANSAÇÃO, que já vem com o tenant carimbado: a consulta é a
// mesma, mas o RLS a limita à empresa da vez.
//
// O parâmetro `db` tem default `prisma` para que as funções sigam chamáveis fora do
// cron (teste, script) — mas no cron ele SEMPRE vem preenchido. Chamar sem `db` depois
// da fase 7c significa rodar sem tenant, e o RLS devolverá zero linha: o padrão não é
// conveniência, é o caminho de quem não está num contexto de empresa.
'use strict';

const prisma = require('../lib/prisma').default;

// Status próprio da rotina — nunca 'CANCELADO' puro. `CANCELADO` continua reservado à
// desistência HUMANA (botão Cancelar, com justificativa); esta rotina grava
// 'CANCELADO_AUTOMATICAMENTE' para que a Auditoria/relatório consigam distinguir "a
// clínica desmarcou" de "ninguém tratou disso e o sistema encerrou sozinho no fim do
// dia". `AgendamentoController.atualizarStatus` recusa esse valor vindo de um clique
// humano (STATUS_SOMENTE_SISTEMA) — é EXCLUSIVO desta rotina.
const MOTIVO_NAO_INICIADO =
  'Cancelado automaticamente pelo sistema — agendamento não realizado no dia.';
const MOTIVO_EM_ANDAMENTO =
  'Cancelado automaticamente pelo sistema — atendimento foi iniciado (Em Andamento) e '
  + 'não chegou a ser concluído/finalizado até o fechamento do dia.';
// Mantido por compatibilidade com quem já importava esta constante (ex.: testes).
const MOTIVO_CANCELAMENTO = MOTIVO_NAO_INICIADO;

/**
 * Cancela os agendamentos que não foram REALIZADOS no dia — cujo horário já passou e
 * que nunca chegaram a CONCLUIDO/FINALIZADO. Cobre dois casos, com motivo próprio para
 * cada um:
 *   AGENDADO/ATRASADA → ninguém sequer iniciou o atendimento.
 *   EM_ANDAMENTO      → o atendimento foi INICIADO (a evolução foi aberta a partir daqui)
 *                       mas ficou pendurado sem nunca ser concluído/finalizado — sem
 *                       este ramo, o agendamento ficava travado em "Em Andamento" para
 *                       sempre, mesmo com o dia (ou vários dias) já encerrado.
 * Só CONCLUIDO/FINALIZADO conta como realizado; futuros são preservados (dataHora ainda
 * não passou). Grava o motivo em `observacao` (mesmo campo exibido no card do dia).
 *
 * ⚠️ PENDENTE: o ramo EM_ANDAMENTO só encerra o AGENDAMENTO — a evolução clínica que
 * ele abriu (se ainda EM_ANDAMENTO) NÃO é tocada aqui, de propósito: ela é um registro
 * clínico com conteúdo potencialmente já escrito pelo profissional, e fechá-la sozinha
 * é uma decisão maior do que a desta rotina (mesmo padrão de `cancelarPrescricoesNaoExecutadas`,
 * que também não cascateia para fora do próprio grupo). Quem abrir o paciente ainda vê
 * (e pode finalizar/cancelar manualmente) a evolução aberta, mesmo com o agendamento já
 * CANCELADO_AUTOMATICAMENTE — os dois ciclos de vida são independentes.
 *
 * @returns ResultadoCron para o comAlerta/reportarCron (Monitoração + e-mail ADMIN).
 */
async function cancelarAgendamentosNaoRealizados(db = prisma) {
  const agora = new Date();

  const [naoIniciados, emAndamento] = await Promise.all([
    db.agendamentoClinico.findMany({
      where:  { status: { in: ['AGENDADO', 'ATRASADA'] }, ativo: true, dataHora: { lt: agora } },
      select: { id: true },
    }),
    db.agendamentoClinico.findMany({
      where:  { status: 'EM_ANDAMENTO', ativo: true, dataHora: { lt: agora } },
      select: { id: true },
    }),
  ]);

  if (naoIniciados.length === 0 && emAndamento.length === 0) return { ok: true, notificar: false };

  let count = 0;
  if (naoIniciados.length > 0) {
    const r = await db.agendamentoClinico.updateMany({
      where: { id: { in: naoIniciados.map(a => a.id) } },
      data:  { status: 'CANCELADO_AUTOMATICAMENTE', observacao: MOTIVO_NAO_INICIADO },
    });
    count += r.count;
  }
  if (emAndamento.length > 0) {
    const r = await db.agendamentoClinico.updateMany({
      where: { id: { in: emAndamento.map(a => a.id) } },
      data:  { status: 'CANCELADO_AUTOMATICAMENTE', observacao: MOTIVO_EM_ANDAMENTO },
    });
    count += r.count;
  }

  return {
    ok: true,
    notificar: true,
    resumo: `${count} agendamento(s) não realizado(s) cancelado(s) automaticamente no fechamento do dia.`,
  };
}

const MINUTOS_TOLERANCIA_ATRASO = 30;

/**
 * Marca como ATRASADA todo agendamento ainda AGENDADO cujo horário + 30min já passou.
 * Roda com frequência (a cada poucos minutos) — status intermediário, meramente
 * informativo; o cancelamento definitivo continua sendo feito só no fechamento do dia
 * (cancelarAgendamentosNaoRealizados, que agora também varre ATRASADA).
 */
async function marcarAgendamentosAtrasados(db = prisma) {
  const limite = new Date(Date.now() - MINUTOS_TOLERANCIA_ATRASO * 60 * 1000);

  const { count } = await db.agendamentoClinico.updateMany({
    where: { status: 'AGENDADO', ativo: true, dataHora: { lt: limite } },
    data:  { status: 'ATRASADA' },
  });

  return {
    ok: true,
    notificar: false, // status informativo — não precisa de e-mail a cada execução
    resumo: count > 0 ? `${count} agendamento(s) marcado(s) como ATRASADA.` : undefined,
  };
}

module.exports = {
  cancelarAgendamentosNaoRealizados, marcarAgendamentosAtrasados,
  MOTIVO_CANCELAMENTO, MOTIVO_NAO_INICIADO, MOTIVO_EM_ANDAMENTO,
  MINUTOS_TOLERANCIA_ATRASO,
};

// backend/src/services/agendamentoCronService.js
// Rotina corporativa (global) executada no fim do dia: cancela os agendamentos que
// não foram realizados. Registrada como job em server.ts via cronManager — a agenda
// (horário) e o liga/desliga ficam sob controle do ADMIN na tela de Configuração
// (CronAgenda). É corporativa: opera sobre TODAS as empresas/equipes.
'use strict';

const prisma = require('../lib/prisma').default;

const MOTIVO_CANCELAMENTO =
  'Cancelado automaticamente pelo sistema — agendamento não realizado no dia.';

/**
 * Cancela todos os agendamentos ainda AGENDADO cujo horário já passou (não realizados).
 * "Realizado" = status CONCLUIDO; itens EM_ANDAMENTO (em atendimento) e futuros são
 * preservados. Grava o motivo em `observacao` (mesmo campo exibido no card do dia).
 *
 * @returns ResultadoCron para o comAlerta/reportarCron (Monitoração + e-mail ADMIN).
 */
async function cancelarAgendamentosNaoRealizados() {
  const agora = new Date();

  const naoRealizados = await prisma.agendamentoClinico.findMany({
    where:  { status: 'AGENDADO', ativo: true, dataHora: { lt: agora } },
    select: { id: true },
  });

  if (naoRealizados.length === 0) return { ok: true, notificar: false };

  const { count } = await prisma.agendamentoClinico.updateMany({
    where: { id: { in: naoRealizados.map(a => a.id) } },
    data:  { status: 'CANCELADO', observacao: MOTIVO_CANCELAMENTO },
  });

  return {
    ok: true,
    notificar: true,
    resumo: `${count} agendamento(s) não realizado(s) cancelado(s) automaticamente no fechamento do dia.`,
  };
}

module.exports = { cancelarAgendamentosNaoRealizados, MOTIVO_CANCELAMENTO };

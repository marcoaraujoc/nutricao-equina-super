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

const MOTIVO_CANCELAMENTO =
  'Cancelado automaticamente pelo sistema — agendamento não realizado no dia.';

/**
 * Cancela todos os agendamentos ainda AGENDADO/ATRASADA cujo horário já passou (não
 * realizados). "Realizado" = status CONCLUIDO; itens EM_ANDAMENTO (em atendimento) e
 * futuros são preservados. Grava o motivo em `observacao` (mesmo campo exibido no
 * card do dia).
 *
 * @returns ResultadoCron para o comAlerta/reportarCron (Monitoração + e-mail ADMIN).
 */
async function cancelarAgendamentosNaoRealizados(db = prisma) {
  const agora = new Date();

  const naoRealizados = await db.agendamentoClinico.findMany({
    where:  { status: { in: ['AGENDADO', 'ATRASADA'] }, ativo: true, dataHora: { lt: agora } },
    select: { id: true },
  });

  if (naoRealizados.length === 0) return { ok: true, notificar: false };

  const { count } = await db.agendamentoClinico.updateMany({
    where: { id: { in: naoRealizados.map(a => a.id) } },
    data:  { status: 'CANCELADO', observacao: MOTIVO_CANCELAMENTO },
  });

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

module.exports = { cancelarAgendamentosNaoRealizados, marcarAgendamentosAtrasados, MOTIVO_CANCELAMENTO, MINUTOS_TOLERANCIA_ATRASO };

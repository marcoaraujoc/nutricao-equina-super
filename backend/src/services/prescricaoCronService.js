// backend/src/services/prescricaoCronService.js
// Rotina corporativa (global) executada no fim do dia: encerra prescrições cuja
// janela de tratamento (dataInicio + duracaoDias de TODOS os itens) já passou e
// que não foram totalmente executadas.
//   - Nenhum item executado      → grupo CANCELADO (cancelamento automático)
//   - Execução parcial           → grupo CANCELADO_PARCIALMENTE (parcialmente
//     executada); os itens ainda NÃO executados são cancelados automaticamente
//     e os executados/faturados são preservados.
// Reservas de estoque remanescentes do grupo são liberadas nos dois casos.
// Registrada como job em server.ts via cronManager — agenda e liga/desliga sob
// controle do ADMIN na tela de Configuração (CronAgenda).
'use strict';

const prisma = require('../lib/prisma').default;

const MOTIVO_NAO_EXECUTADA =
  'Cancelada automaticamente pelo sistema — prescrição não executada dentro do período de tratamento.';
const MOTIVO_PARCIAL =
  'Encerrada automaticamente pelo sistema — prescrição parcialmente executada; itens não executados foram cancelados.';

// Último dia válido da janela do item (dataInicio + duracaoDias − 1), em 'YYYY-MM-DD'.
// Mesmo cálculo do janelaDoItem do PrescricaoGrupoController (UTC).
function ultimoDiaDoItem(item) {
  const fim = new Date(new Date(item.dataInicio).toISOString().split('T')[0]);
  fim.setUTCDate(fim.getUTCDate() + Math.max(Number(item.duracaoDias) || 1, 1) - 1);
  return fim.toISOString().split('T')[0];
}

/**
 * Cancela/encerra grupos de prescrição FINALIZADO cuja janela de todos os itens
 * ativos já passou. Não toca em grupos EXECUTADO, CANCELADO ou dentro da janela.
 *
 * @returns ResultadoCron para o comAlerta/reportarCron (Monitoração + e-mail ADMIN).
 */
async function cancelarPrescricoesNaoExecutadas() {
  const hojeStr = new Date().toISOString().split('T')[0];

  const grupos = await prisma.prescricaoGrupo.findMany({
    where:   { status: 'FINALIZADO' },
    include: { itens: { where: { ativo: true }, select: { id: true, dataInicio: true, duracaoDias: true, executadoEm: true } } },
  });

  let canceladas = 0;
  let parciais   = 0;

  for (const grupo of grupos) {
    if (grupo.itens.length === 0) continue;
    // Só encerra quando NENHUM item pode mais ser executado (janela passou para todos)
    const expirado = grupo.itens.every(item => hojeStr > ultimoDiaDoItem(item));
    if (!expirado) continue;

    const houveExecucao = grupo.itens.some(item => item.executadoEm);

    await prisma.$transaction(async (tx) => {
      // Libera reservas de estoque remanescentes (sem dar baixa)
      await tx.reservaEstoque.deleteMany({ where: { prescricaoGrupoId: grupo.id } });
      // Cancela apenas os itens nunca executados (preserva executados/faturados)
      await tx.prescricao.updateMany({
        where: { grupoId: grupo.id, ativo: true, executadoEm: null },
        data:  { status: 'CANCELADA', ativo: false },
      });
      await tx.prescricaoGrupo.update({
        where: { id: grupo.id },
        data:  {
          status:             houveExecucao ? 'CANCELADO_PARCIALMENTE' : 'CANCELADO',
          motivoCancelamento: houveExecucao ? MOTIVO_PARCIAL : MOTIVO_NAO_EXECUTADA,
        },
      });
    });

    if (houveExecucao) parciais++; else canceladas++;
  }

  if (canceladas === 0 && parciais === 0) return { ok: true, notificar: false };

  return {
    ok: true,
    notificar: true,
    resumo:
      `Prescrições com período de tratamento vencido: ${canceladas} não executada(s) cancelada(s), ` +
      `${parciais} parcialmente executada(s) encerrada(s) (itens restantes cancelados).`,
  };
}

module.exports = { cancelarPrescricoesNaoExecutadas, MOTIVO_NAO_EXECUTADA, MOTIVO_PARCIAL };

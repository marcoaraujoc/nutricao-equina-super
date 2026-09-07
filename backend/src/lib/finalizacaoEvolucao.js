// backend/src/lib/finalizacaoEvolucao.js
//
// CASCATA DA FINALIZAÇÃO DO ATENDIMENTO — fonte única.
//
// Finalizar uma evolução não mexe só nela: o atendimento é uma unidade, e fechá-lo
// move junto o que ficou pendurado embaixo.
//
//   AGENDAMENTO (EM_ANDAMENTO) ──→ FINALIZADO
//   PRESCRIÇÃO  (grupo SALVO)  ──→ FINALIZADO (+ itens ATIVA) → vai ao plantão
//   VACINA      (SALVA)        ──→ FINALIZADA                 → vai ao plantão
//
// 🔴 POR QUE VIROU LIB: esta cascata nasceu inline em `EvolucaoController.atualizar` e
// passou a ter um SEGUNDO chamador — a inativação do paciente, que finaliza sozinha o
// atendimento aberto (`AnimalController.inativar`). Duas cópias divergiriam na
// primeira correção, e o modo de divergir é silencioso: a prescrição do atendimento
// fechado por um caminho iria para o plantão e pelo outro não, sem nada acusar.
//
// ⚠️ SÓ TRANSIÇÃO DE STATUS. Fatura e baixa de estoque continuam acontecendo na
// EXECUÇÃO, no plantão — nunca aqui (regra de 2026-07-25). A única exceção é o EXAME,
// que é lançado com valor ZERADO ao finalizar a evolução; isso mora em
// `lancarExamesDaEvolucao`, chamado DEPOIS do commit porque não pode derrubar a
// finalização se a fatura de destino estiver paga.
//
// ⚠️ IDEMPOTENTE: todo `updateMany` filtra pelo status de origem, então rodar duas
// vezes não desfaz nada nem promove o que já passou adiante.
'use strict';

const prismaPadrao = require('./prisma').default;
const { invalidarVersoes } = require('./concorrenciaRegistro');
const { lancarExameNaFatura } = require('./faturaUtils');

/**
 * Move os filhos do atendimento para o estado de "finalizado".
 *
 * @param {object} tx           transaction aberta (obrigatória — ou tudo fecha, ou nada)
 * @param {number} evolucaoId
 * @param {object} opts
 * @param {number|null} [opts.agendamentoId] agendamento de origem, quando houver
 * @param {number}      opts.porUsuarioId    quem está finalizando (grava em `finalizadoPorId`)
 * @returns {Promise<{grupos:number[], agendamento:boolean}>} o que realmente mudou
 */
async function cascataDaFinalizacao(tx, evolucaoId, { agendamentoId = null, porUsuarioId }) {
  const id = Number(evolucaoId);

  // Evolução nascida de um agendamento (AG-XXXX): ele sai de EM_ANDAMENTO para
  // FINALIZADO — distinto do CONCLUIDO manual, que é o encerramento sem evolução.
  let agendamento = false;
  if (agendamentoId) {
    const r = await tx.agendamentoClinico.updateMany({
      where: { id: Number(agendamentoId), status: 'EM_ANDAMENTO' },
      data:  { status: 'FINALIZADO' },
    });
    agendamento = r.count > 0;
  }

  // Prescrições SALVAS do atendimento → FINALIZADO: passam a "Em Execução" e entram
  // na fila do plantão. Os ITENS vão junto (é o `status` deles que a execução lê).
  const gruposSalvos = await tx.prescricaoGrupo.findMany({
    where:  { evolucaoId: id, status: 'SALVO' },
    select: { id: true },
  });
  const grupoIds = gruposSalvos.map(g => g.id);
  if (grupoIds.length > 0) {
    await tx.prescricao.updateMany({
      where: { grupoId: { in: grupoIds }, ativo: true },
      data:  { status: 'ATIVA' },
    });
    await tx.prescricaoGrupo.updateMany({
      where: { id: { in: grupoIds } },
      data:  { status: 'FINALIZADO', finalizadoPorId: porUsuarioId, finalizadoEm: new Date() },
    });
    // A prescrição mudou de estado: quem a tiver aberta na tela segura uma versão
    // velha e precisa levar 409 em vez de gravar por cima. Ver lib/concorrenciaRegistro.js.
    await invalidarVersoes(tx, 'PRESCRICAO_GRUPO', grupoIds);
  }

  // Vacinas SALVAS → FINALIZADA. Por SQL cru: `status` de VacinaClinica vive fora do
  // client gerado (CLAUDE.md §11), e um `updateMany` tipado quebraria antes do generate.
  await tx.$executeRawUnsafe(
    `UPDATE schs2vet.tb_vacinas_clinicas
        SET status = 'FINALIZADA'
      WHERE evolucao_id = $1 AND status = 'SALVA' AND ativo = true`,
    id,
  );

  return { grupos: grupoIds, agendamento };
}

/**
 * Lança os exames do atendimento na fatura com VALOR ZERADO (o financeiro define o
 * preço depois). Idempotente — `lancarExameNaFatura` ignora exame já faturado.
 *
 * ⚠️ CHAMAR DEPOIS DO COMMIT, fora da transaction da finalização e sem `await` no
 * caminho da resposta: se a fatura de destino estiver PAGA o helper lança, e isso não
 * pode reverter um atendimento que já foi clinicamente fechado.
 */
async function lancarExamesDaEvolucao(evolucaoId, empresaId, client) {
  const db = client || prismaPadrao;
  const exames = await db.exameClinico.findMany({
    where:  { evolucaoId: Number(evolucaoId), ativo: true },
    select: { id: true, animalId: true, veterinarioId: true, tipo: true, descricao: true, numero: true },
  });
  if (exames.length === 0) return 0;

  const animalId = exames[0].animalId;
  const animal = await db.animal.findUnique({ where: { id: animalId }, select: { userId: true } });
  await db.$transaction(async (tx) => {
    for (const ex of exames) await lancarExameNaFatura(tx, ex, animal?.userId, empresaId ?? null);
  });
  return exames.length;
}

module.exports = { cascataDaFinalizacao, lancarExamesDaEvolucao };

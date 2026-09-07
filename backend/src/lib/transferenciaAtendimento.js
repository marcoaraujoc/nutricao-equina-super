// backend/src/lib/transferenciaAtendimento.js
'use strict';

// Invalidar a versão dos filhos arrastados é o que impede o profissional anterior
// de gravar por cima — ver o bloco acima e lib/concorrenciaRegistro.js.
const { invalidarVersoes } = require('./concorrenciaRegistro');
// A cadeia de responsáveis acompanha o arrasto: a evolução arrastada também trocou
// de mãos, e a tela dela risca todos os que já responderam.
const { empilharResponsavel } = require('./cadeiaResponsaveis');

/**
 * ARRASTO DO ATENDIMENTO — quem assume a cabeça assume tudo que está embaixo.
 *
 * POR QUE EXISTE
 * Assumir uma evolução (ou um agendamento) trocava APENAS o `veterinarioId` daquele
 * registro. A prescrição, o pedido de exame, o encaminhamento e a vacina lançados
 * dentro do mesmo atendimento continuavam com o profissional anterior — e, com a
 * premissa de AUTORIA de volta (`podeOperarRegistro`), quem assumiu ficava sem poder
 * editar ou finalizar o que passou a conduzir, enquanto o antigo responsável seguia
 * podendo mexer num atendimento que não é mais dele. O atendimento é uma unidade:
 * muda de mãos inteiro.
 *
 * HIERARQUIA
 *   AGENDAMENTO → EVOLUÇÃO (EM_ANDAMENTO) → { PRESCRIÇÃO (grupo + itens), EXAME,
 *                                             ENCAMINHAMENTO, VACINA }
 *
 * NÃO ARRASTA: `FaturaItem.veterinarioId`. Ali o campo é atribuição FINANCEIRA (quem
 * gerou a cobrança / a quem a comissão pertence), não condução clínica — reatribuir
 * receita já lançada por causa de uma troca de plantão é decisão comercial e nunca foi
 * pedida. O vínculo com a origem clínica continua no FaturaItem para rastreio.
 *
 * Todo retorno é a LISTA DO QUE REALMENTE MUDOU DE DONO, para o chamador auditar item
 * a item (`registrarTransferencia`). Registro que já pertencia a quem assumiu não entra
 * — auditar "de Fulano para Fulano" seria só ruído.
 *
 * 🔴 O ARRASTO TAMBÉM INVALIDA A TELA DO PROFISSIONAL ANTERIOR, e isso é parte da
 * regra, não um detalhe: a AUTORIA sozinha não o barra, porque `podeOperarRegistro`
 * tem bypass de GESTOR — um gestor que perdeu o atendimento continuava podendo
 * gravar por cima do novo responsável. Cada registro arrastado tem a `versao`
 * incrementada (`invalidarVersoes`), então a tela dele — que segura a versão antiga
 * — leva 409 no próximo salvar, INDEPENDENTE de cargo. É o que faz o bloqueio ser
 * automático em vez de depender de quem é a pessoa.
 */

// Só faz sentido arrastar evolução ainda aberta: registro finalizado é histórico
// fechado e não muda de responsável por troca de plantão.
const STATUS_EVOLUCAO_ARRASTAVEL = ['EM_ANDAMENTO'];

/**
 * Filhos diretos de uma evolução: [modelo Prisma, rótulo na auditoria, filtro extra].
 * `PrescricaoGrupo` não tem `ativo` (o soft delete dele é o status CANCELADO), por isso
 * o filtro é por modelo e não uma constante única.
 */
// 4º campo: o recurso em `lib/concorrenciaRegistro.js#TABELAS` cuja `versao` deve
// ser invalidada ao arrastar. `null` = a tabela ainda não tem a coluna — o registro
// é transferido normalmente, só sem invalidar a tela de quem o perdeu (encaminhamento
// e vacina são formulários curtos, sem o risco de texto longo em digitação).
const FILHOS_DA_EVOLUCAO = [
  ['prescricaoGrupo',       'PRESCRICAO',     {},               'PRESCRICAO_GRUPO'],
  ['exameClinico',          'EXAME_CLINICO',  { ativo: true },  'EXAME_CLINICO'],
  ['encaminhamentoClinico', 'ENCAMINHAMENTO', { ativo: true },  null],
  ['vacinaClinica',         'VACINA',         { ativo: true },  null],
];

/**
 * Move para `paraVetId` todos os registros pendurados nas evoluções informadas.
 *
 * @param {object} tx            transaction Prisma (obrigatória — o arrasto tem de ser atômico)
 * @param {number[]} evolucaoIds evoluções cujos filhos serão movidos
 * @param {number} paraVetId     novo responsável
 * @returns {Promise<Array<{entidade, entidadeId, animalId, deVetId}>>}
 */
async function transferirFilhosDasEvolucoes(tx, evolucaoIds, paraVetId) {
  const ids = [...new Set((evolucaoIds ?? []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return [];

  const movidos = [];

  for (const [modelo, entidade, filtro, recursoConcorrencia] of FILHOS_DA_EVOLUCAO) {
    const candidatos = await tx[modelo].findMany({
      where:  { evolucaoId: { in: ids }, ...filtro },
      select: { id: true, animalId: true, veterinarioId: true },
    });
    // Filtro do "já é dele" em JS de propósito: `{ not: X }` sobre coluna anulável tem
    // semântica de NULL que varia entre versões do Prisma, e um registro órfão
    // (veterinarioId null) PRECISA ser arrastado — é justamente o que ninguém opera.
    const alvos = candidatos.filter(c => Number(c.veterinarioId) !== Number(paraVetId));
    if (alvos.length === 0) continue;

    await tx[modelo].updateMany({
      where: { id: { in: alvos.map(a => a.id) } },
      data:  { veterinarioId: Number(paraVetId) },
    });

    // Os ITENS da prescrição têm veterinarioId próprio e é por ele que a autoria do
    // item é avaliada — mover só o grupo deixaria cada item preso ao dono antigo.
    if (modelo === 'prescricaoGrupo') {
      await tx.prescricao.updateMany({
        where: { grupoId: { in: alvos.map(a => a.id) }, ativo: true },
        data:  { veterinarioId: Number(paraVetId) },
      });
    }

    // 🔴 Invalida a tela de quem PERDEU o registro: a versão avança, e o próximo
    // salvar dele — mesmo sendo gestor — recebe 409 em vez de sobrescrever o novo
    // responsável. Na MESMA transaction do arrasto: revertida a transferência, a
    // versão não pode ter avançado.
    if (recursoConcorrencia) {
      await invalidarVersoes(tx, recursoConcorrencia, alvos.map(a => a.id));
    }

    for (const a of alvos) {
      movidos.push({ entidade, entidadeId: a.id, animalId: a.animalId ?? null, deVetId: a.veterinarioId ?? null });
    }
  }

  return movidos;
}

/**
 * Move as evoluções ABERTAS de um agendamento (e tudo que está sob elas).
 * Usado quando a cabeça transferida é o AGENDAMENTO.
 */
async function transferirEvolucoesDoAgendamento(tx, agendamentoId, paraVetId) {
  const evolucoes = await tx.evolucaoClinica.findMany({
    where: {
      agendamentoId: Number(agendamentoId),
      ativo:         true,
      status:        { in: STATUS_EVOLUCAO_ARRASTAVEL },
    },
    select: { id: true, animalId: true, veterinarioId: true },
  });
  if (evolucoes.length === 0) return [];

  const aMover = evolucoes.filter(e => Number(e.veterinarioId) !== Number(paraVetId));
  if (aMover.length > 0) {
    await tx.evolucaoClinica.updateMany({
      where: { id: { in: aMover.map(e => e.id) } },
      data:  {
        veterinarioId:   Number(paraVetId),
        modificadoPorId: Number(paraVetId),
        dataModificacao: new Date(),
      },
    });
  }

  // A própria evolução arrastada invalida junto — quem a perdeu pode estar com o
  // texto aberto na tela, que é o caso de maior prejuízo de todos.
  await invalidarVersoes(tx, 'EVOLUCAO', aMover.map(e => e.id));

  // Cada evolução empilha o SEU dono anterior (não há um só: o agendamento pode ter
  // evoluções de profissionais diferentes penduradas nele).
  for (const e of aMover) {
    await empilharResponsavel(tx, 'EVOLUCAO', [e.id], e.veterinarioId);
  }

  const movidos = aMover.map(e => ({
    entidade: 'EVOLUCAO', entidadeId: e.id, animalId: e.animalId ?? null, deVetId: e.veterinarioId ?? null,
  }));

  // Os filhos são arrastados para TODAS as evoluções do agendamento (inclusive a que
  // já era de quem assume): um item pendurado nela ainda pode estar com outro dono.
  const filhos = await transferirFilhosDasEvolucoes(tx, evolucoes.map(e => e.id), paraVetId);
  return [...movidos, ...filhos];
}

module.exports = {
  transferirFilhosDasEvolucoes,
  transferirEvolucoesDoAgendamento,
  STATUS_EVOLUCAO_ARRASTAVEL,
  FILHOS_DA_EVOLUCAO,
};

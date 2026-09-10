// backend/src/lib/orcamentoRecusa.js
//
// MOTIVO DA RECUSA do orçamento — leitura e escrita das colunas novas
// `tb_orcamentos.motivo_recusa` e `tb_orcamento_itens.motivo_recusa`
// (migration `20260927000000_orcamento_motivo_recusa`).
//
// 🔴 SQL CRU, COM `catch`, PELO MOTIVO DE SEMPRE (§11): no Windows o
// `prisma generate` falha com o backend rodando, então o client pode não conhecer as
// colunas. Um `select`/`data` tipado ali derrubaria a tela de Orçamentos INTEIRA numa
// máquina que ainda não regenerou; assim, o pior caso é o motivo não aparecer.
//
// ⚠️ São DOIS motivos diferentes, de propósito:
//   • do ORÇAMENTO → o documento inteiro foi rejeitado;
//   • do ITEM      → só alguns itens foram (aprovação parcial), e é o que permite
//     renegociar o que caiu sem adivinhar o quê.
'use strict';

const prisma = require('./prisma').default;

/** Motivo por orçamento: Map(orcamentoId → motivo). */
async function motivosDeOrcamentos(ids, db = prisma) {
  if (!ids?.length) return new Map();
  const linhas = await db
    .$queryRaw`SELECT "id", "motivo_recusa" FROM "schs2vet"."tb_orcamentos" WHERE "id" = ANY(${ids}::int[])`
    .catch(() => []);
  return new Map(linhas.map(l => [l.id, l.motivo_recusa ?? null]));
}

/** Motivo por item: Map(itemId → motivo). */
async function motivosDeItens(ids, db = prisma) {
  if (!ids?.length) return new Map();
  const linhas = await db
    .$queryRaw`SELECT "id", "motivo_recusa" FROM "schs2vet"."tb_orcamento_itens" WHERE "id" = ANY(${ids}::int[])`
    .catch(() => []);
  return new Map(linhas.map(l => [l.id, l.motivo_recusa ?? null]));
}

/**
 * Grava o motivo da recusa do ORÇAMENTO. String vazia grava NULL — é o que permite
 * desfazer um motivo digitado errado.
 * ⚠️ Nunca lança: a recusa em si já foi gravada pelo caller, e perder o motivo é
 * menos grave que reverter a decisão do cliente por causa de uma coluna ausente.
 */
async function salvarMotivoOrcamento(db, orcamentoId, motivo) {
  const valor = String(motivo ?? '').trim() || null;
  await db
    .$executeRaw`UPDATE "schs2vet"."tb_orcamentos" SET "motivo_recusa" = ${valor} WHERE "id" = ${Number(orcamentoId)}`
    .catch(() => {});
}

/** Idem, para UM item do orçamento. */
async function salvarMotivoItem(db, itemId, motivo) {
  const valor = String(motivo ?? '').trim() || null;
  await db
    .$executeRaw`UPDATE "schs2vet"."tb_orcamento_itens" SET "motivo_recusa" = ${valor} WHERE "id" = ${Number(itemId)}`
    .catch(() => {});
}

/** Tamanho mínimo do motivo — o mesmo do `ModalJustificativa` (§33). */
const MIN_MOTIVO = 3;

/**
 * 🔴 O QUE NÃO FOI APROVADO PRECISA DIZER POR QUÊ (a pedido, 2026-09-08).
 *
 * Sem o motivo, a clínica sabe que "3 de 7 itens caíram" e não sabe se foi preço,
 * prazo ou o cliente ter resolvido tratar em outro lugar — que é justamente o que
 * permitiria renegociar. E o relatório de orçamentos fica com a coluna Motivo vazia
 * em toda linha recusada, que é o mesmo que não ter a coluna.
 *
 * ⚠️ RECUSA TOTAL pede UM motivo (`motivoGeral`): ali o cliente recusou o documento,
 * não sete linhas, e exigir sete justificativas idênticas transformaria a regra em
 * obstáculo — e obstáculo se contorna digitando "x" sete vezes, que é pior que nada.
 * ⚠️ RECUSA PARCIAL pede por ITEM, porque cada linha pode ter caído por uma razão
 * diferente — mas o motivo GERAL serve de padrão para quem tem uma razão só.
 *
 * @returns {boolean} true = falta motivo, a decisão deve ser recusada com 400.
 */
function faltaMotivoDeRecusa({ idsRecusados, totalDeItens, motivoGeral, motivoPorItem }) {
  if (!idsRecusados?.length) return false;           // nada recusado, nada a justificar
  const geral = String(motivoGeral ?? '').trim();
  const porItem = motivoPorItem instanceof Map ? motivoPorItem : new Map(Object.entries(motivoPorItem ?? {}));
  const recusaTotal = idsRecusados.length === totalDeItens;
  if (recusaTotal) return geral.length < MIN_MOTIVO;
  return idsRecusados.some(id => {
    const proprio = String(porItem.get(id) ?? porItem.get(String(id)) ?? '').trim();
    return (proprio || geral).length < MIN_MOTIVO;
  });
}

module.exports = {
  motivosDeOrcamentos, motivosDeItens, salvarMotivoOrcamento, salvarMotivoItem,
  faltaMotivoDeRecusa, MIN_MOTIVO,
};

// backend/src/lib/faturaUtils.js
// Utilitários de fatura compartilhados entre controllers clínicos
'use strict';

/**
 * Formata o número do atendimento: 'AG', 3 → 'AG-0003'
 */
function formatAtendimentoNum(tipo, numero) {
  if (!tipo || numero == null) return null;
  return `${tipo}-${String(numero).padStart(4, '0')}`;
}

/**
 * Busca ou cria a fatura ABERTA do proprietário do animal.
 * Deve ser chamado dentro de uma transaction (tx).
 *
 * @param {object}  tx             - prisma transaction client
 * @param {number}  proprietarioId - userId do proprietário (pode ser null)
 * @returns {object} fatura Prisma record
 */
async function getOrCreateFatura(tx, proprietarioId) {
  const mesAtual = new Date().toISOString().slice(0, 7); // '2026-06'
  let fatura = await tx.fatura.findFirst({ where: { proprietarioId, status: 'ABERTA' } });
  if (!fatura) {
    fatura = await tx.fatura.create({
      data: { proprietarioId, mesReferencia: mesAtual, status: 'ABERTA', total: 0 },
    });
  }
  return fatura;
}

/**
 * Adiciona um item na fatura e incrementa o total.
 * Deve ser chamado dentro de uma transaction (tx).
 *
 * @param {object} tx
 * @param {object} opts
 * @param {number}  opts.faturaId
 * @param {number}  opts.animalId
 * @param {string}  opts.tipo         - 'MEDICAMENTO' | 'PROCEDIMENTO' | 'VACINA' | 'ENCAMINHAMENTO'
 * @param {string}  opts.descricao
 * @param {number}  opts.valor
 * @param {number}  opts.quantidade
 * @param {number|null} opts.veterinarioId
 */
async function adicionarFaturaItem(tx, { faturaId, animalId, tipo, descricao, valor, quantidade, veterinarioId }) {
  await tx.faturaItem.create({
    data: { faturaId, animalId, tipo, descricao, valor: valor ?? 0, quantidade: quantidade ?? 1, veterinarioId: veterinarioId ?? null },
  });
  if ((valor ?? 0) > 0) {
    await tx.fatura.update({
      where: { id: faturaId },
      data:  { total: { increment: (valor ?? 0) * (quantidade ?? 1) } },
    });
  }
}

module.exports = { formatAtendimentoNum, getOrCreateFatura, adicionarFaturaItem };

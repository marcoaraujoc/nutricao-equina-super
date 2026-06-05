'use strict';

const prisma = require('../lib/prisma').default;

function mesReferenciaAtual() {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Garante que existe uma fatura ABERTA para o proprietário.
 * Se já existir (de qualquer vínculo anterior), retorna ela.
 * Se não, cria uma nova. Regra: uma fatura por proprietário —
 * os animais são discriminados pelos FaturaItems (animalId).
 */
async function garantirFaturaAberta(proprietarioId) {
  if (!proprietarioId) return null;
  const id = Number(proprietarioId);

  const existe = await prisma.fatura.findFirst({
    where: { proprietarioId: id, status: 'ABERTA' },
  });
  if (existe) return existe;

  return prisma.fatura.create({
    data: {
      proprietarioId: id,
      mesReferencia:  mesReferenciaAtual(),
      total:          0,
      status:         'ABERTA',
    },
  });
}

module.exports = { garantirFaturaAberta };

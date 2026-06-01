'use strict';

const prisma = require('./prisma').default;

/**
 * Retorna o empresaId do vet:
 * 1. Via MembroEquipe → Equipe.empresaId
 * 2. Fallback: Empresa.ownerId (vet criou empresa mas não tem membroEquipe registrado)
 */
async function getEmpresaIdDoVet(vetUserId) {
  const id = Number(vetUserId);

  const membro = await prisma.membroEquipe.findFirst({
    where:   { userId: id },
    include: { equipe: { select: { empresaId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  if (membro?.equipe?.empresaId) return membro.equipe.empresaId;

  const empresa = await prisma.empresa.findFirst({ where: { ownerId: id } });
  return empresa?.id ?? null;
}

module.exports = { getEmpresaIdDoVet };
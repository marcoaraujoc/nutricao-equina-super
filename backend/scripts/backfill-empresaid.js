'use strict';

/**
 * Backfill: seta empresaId nos animais que têm VINCULO ACEITO
 * mas ainda têm empresaId = null.
 *
 * Uso: node backend/scripts/backfill-empresaid.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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

async function main() {
  // Animais sem empresaId que têm VINCULO ACEITO
  const solicitacoes = await prisma.vetAnimalSolicitacao.findMany({
    where: {
      tipo:   'VINCULO',
      status: 'ACEITO',
      animal: { empresaId: null },
    },
    select: {
      animalId:  true,
      vetUserId: true,
    },
  });

  console.log(`Animais sem empresaId com VINCULO ACEITO: ${solicitacoes.length}`);
  if (solicitacoes.length === 0) {
    console.log('Nada a fazer.');
    return;
  }

  let atualizados = 0;
  let semEquipe   = 0;

  for (const sol of solicitacoes) {
    const empresaId = await getEmpresaIdDoVet(sol.vetUserId);

    if (!empresaId) {
      console.log(`  Animal ${sol.animalId} — vet ${sol.vetUserId} não tem equipe/empresa. Pulando.`);
      semEquipe++;
      continue;
    }

    await prisma.animal.update({
      where: { id: sol.animalId },
      data:  { empresaId },
    });

    console.log(`  Animal ${sol.animalId} → empresaId ${empresaId} ✓`);
    atualizados++;
  }

  console.log(`\nResultado: ${atualizados} atualizados, ${semEquipe} sem equipe/empresa.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
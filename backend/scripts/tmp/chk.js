require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { comTenantAutomatico, comEscopoPlataforma } = require('../../src/lib/prismaTenant');
const prisma = comTenantAutomatico(new PrismaClient());
(async () => {
  // Como o Prisma traduz `NOT: { contains }` quando a coluna e NULL?
  const sql = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM schs2vet.tb_medicamentos
     WHERE ativo = true AND NOT (classificacao ILIKE '%vacin%')`);
  const sqlNull = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM schs2vet.tb_medicamentos
     WHERE ativo = true AND (classificacao IS NULL OR NOT (classificacao ILIKE '%vacin%'))`);
  const nulos = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM schs2vet.tb_medicamentos
     WHERE ativo = true AND classificacao IS NULL`);
  console.log('NOT(LIKE) puro :', sql[0].n);
  console.log('com IS NULL    :', sqlNull[0].n);
  console.log('classificacao NULL:', nulos[0].n);

  const viaPrisma = await prisma.medicamento.count({
    where: { ativo: true, NOT: { classificacao: { contains: 'vacin', mode: 'insensitive' } } },
  });
  console.log('via Prisma NOT contains:', viaPrisma);
  await prisma.$disconnect();
})().catch(async e => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const comps = await prisma.composicaoAlimento.findMany({
    where: { alimentoId: 12 },
    include: { nutriente: true },
    orderBy: { nutrienteId: 'asc' },
  });

  console.log('Composicoes do alimento 12:');
  comps.forEach(c =>
    console.log('  compId=' + c.id + ' nutrienteId=' + c.nutrienteId +
      ' nome="' + c.nutriente.nome + '" unidade=' + c.nutriente.unidadePadrao +
      ' valorPorKg=' + c.valorPorKg)
  );

  const n57  = await prisma.nutriente.findUnique({ where: { id: 57  } });
  const n108 = await prisma.nutriente.findUnique({ where: { id: 108 } });
  console.log('\nNutriente 57:', n57);
  console.log('Nutriente 108:', n108);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

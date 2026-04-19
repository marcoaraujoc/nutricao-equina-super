const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de espécies e raças...');

  // Espécies
  await prisma.especie.upsert({ where: { id: 1 }, update: {}, create: { id: 1, nome: 'Equino' } });
  await prisma.especie.upsert({ where: { id: 2 }, update: {}, create: { id: 2, nome: 'Canino' } });
  await prisma.especie.upsert({ where: { id: 3 }, update: {}, create: { id: 3, nome: 'Felino' } });

  // Raças para Equino
  const racasEquino = [
    'Quarto de Milha', 'Mangalarga Marchador', 'Árabe', 'Puro Sangue Inglês',
    'Crioulo', 'Appaloosa', 'Paint Horse', 'Brasileiro de Hipismo'
  ];

  for (const nome of racasEquino) {
    await prisma.raca.upsert({
      where: { nome_especieId: { nome, especieId: 1 } },
      update: {},
      create: { nome, especieId: 1 }
    });
  }

  console.log('✅ Seed concluído com sucesso!');
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
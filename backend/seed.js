const { PrismaClient } = require('@prisma/client');
const { MODULOS_SISTEMA } = require('./src/seeds/002_permissoes_padrao.seed');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // ── Espécies ──────────────────────────────────────────────────────────────────
  await prisma.especie.upsert({ where: { id: 1 }, update: {}, create: { id: 1, nome: 'Equino' } });
  await prisma.especie.upsert({ where: { id: 2 }, update: {}, create: { id: 2, nome: 'Canino' } });
  await prisma.especie.upsert({ where: { id: 3 }, update: {}, create: { id: 3, nome: 'Felino' } });
  console.log('  ✓ Espécies');

  // ── Raças (Equino) ────────────────────────────────────────────────────────────
  const racasEquino = [
    'Quarto de Milha', 'Mangalarga Marchador', 'Árabe', 'Puro Sangue Inglês',
    'Crioulo', 'Appaloosa', 'Paint Horse', 'Brasileiro de Hipismo',
  ];
  for (const nome of racasEquino) {
    const existe = await prisma.raca.findFirst({ where: { nome, especieId: 1 } });
    if (!existe) await prisma.raca.create({ data: { nome, especieId: 1 } });
  }
  console.log('  ✓ Raças');

  // ── Módulos do Sistema ────────────────────────────────────────────────────────
  for (const mod of MODULOS_SISTEMA) {
    await prisma.moduloSistema.upsert({
      where:  { slug: mod.slug },
      update: { label: mod.label, modulo: mod.modulo, submodulo: mod.submodulo, acao: mod.acao, ordemExib: mod.ordemExib },
      create: mod,
    });
  }
  console.log(`  ✓ Módulos do sistema (${MODULOS_SISTEMA.length} registros)`);

  console.log('✅ Seed concluído com sucesso!');
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
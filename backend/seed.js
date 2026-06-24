const { PrismaClient } = require('@prisma/client');
const { MODULOS_SISTEMA, PERMISSOES_PADRAO } = require('./src/seeds/002_permissoes_padrao.seed');
const seedMedicamentos = require('./src/seeds/003_medicamentos.seed');
const seedProcedimentos = require('./src/seeds/004_procedimentos.seed');
const { seedLaboratorios }   = require('./src/seeds/003_laboratorios.seed');
const { seedImagemExames }  = require('./src/seeds/004_imagem_exames.seed');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // ── Espécies (sempre no singular; update garante correção de registros antigos) ─
  await prisma.especie.upsert({ where: { id: 1 }, update: { nome: 'Equino' }, create: { id: 1, nome: 'Equino' } });
  await prisma.especie.upsert({ where: { id: 2 }, update: { nome: 'Canino' }, create: { id: 2, nome: 'Canino' } });
  await prisma.especie.upsert({ where: { id: 3 }, update: { nome: 'Felino' }, create: { id: 3, nome: 'Felino' } });
  await prisma.especie.upsert({ where: { id: 4 }, update: { nome: 'Bovino' }, create: { id: 4, nome: 'Bovino' } });
  await prisma.especie.upsert({ where: { id: 5 }, update: { nome: 'Réptil' }, create: { id: 5, nome: 'Réptil' } });
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

  // ── PerfilEquipe — garante que todos os perfis padrão existem em cada equipe ──
  // MatrizPerfil tem FK (equipeId, perfilSlug) → PerfilEquipe, então os perfis
  // precisam existir antes de criar entradas na matriz.
  const PERFIS_PADRAO = [
    { slug: 'GESTOR',        label: 'Gestor',        descricao: 'Acesso total irrestrito. Bypass de todas as permissões do sistema.' },
    { slug: 'VETERINARIO',  label: 'Veterinário',   descricao: 'Acesso clínico completo: prontuários, exames, prescrições e nutrição.' },
    { slug: 'FORNECEDOR',   label: 'Fornecedor',    descricao: 'Fornecedor de serviços. Acesso configurável pelo gestor da equipe.' },
    { slug: 'ESTAGIARIO',   label: 'Estagiário',    descricao: 'Acesso de leitura por padrão. Permissões elevadas pelo gestor conforme necessário.' },
    { slug: 'PROPRIETARIO', label: 'Proprietário',  descricao: 'Proprietário de animais. Acesso de leitura configurável pelo gestor.' },
  ];

  const equipes = await prisma.equipe.findMany({ select: { id: true } });
  let perfilCount = 0;
  for (const equipe of equipes) {
    for (const perfil of PERFIS_PADRAO) {
      await prisma.perfilEquipe.upsert({
        where:  { equipeId_slug: { equipeId: equipe.id, slug: perfil.slug } },
        update: { label: perfil.label, descricao: perfil.descricao },
        create: { equipeId: equipe.id, slug: perfil.slug, label: perfil.label, descricao: perfil.descricao },
      });
      perfilCount++;
    }
  }
  console.log(`  ✓ PerfilEquipe (${perfilCount} perfis verificados em ${equipes.length} equipe(s))`);

  // ── MatrizPerfil — sincroniza defaults para todas as equipes existentes ───────
  // Upsert apenas entradas ausentes (update: {} preserva personalizações do gestor).
  let matrizCount = 0;
  for (const equipe of equipes) {
    for (const [cargo, slugMap] of Object.entries(PERMISSOES_PADRAO)) {
      for (const [slug, nivel] of Object.entries(slugMap)) {
        await prisma.matrizPerfil.upsert({
          where:  { equipeId_perfilSlug_moduloSlug: { equipeId: equipe.id, perfilSlug: cargo, moduloSlug: slug } },
          update: {},
          create: { equipeId: equipe.id, perfilSlug: cargo, moduloSlug: slug, nivel, locked: false },
        });
        matrizCount++;
      }
    }
  }
  console.log(`  ✓ MatrizPerfil (${matrizCount} entradas verificadas em ${equipes.length} equipe(s))`);

  // ── PermissaoMembro — backfill para membros existentes ────────────────────────
  // Cria entradas faltantes (slugs novos adicionados após a entrada do membro).
  // Para membros com múltiplos cargos (cargos[]), usa a união (nível máximo) de todos.
  // update: {} garante que personalizações manuais não sejam sobrescritas.
  const NIVEL_ORD_SEED = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };
  const membros = await prisma.membroEquipe.findMany({ select: { userId: true, equipeId: true, cargo: true, cargos: true } });
  let permCount = 0;
  for (const membro of membros) {
    const todosCargos = membro.cargos && membro.cargos.length > 0 ? membro.cargos : [membro.cargo];
    const slugMapUniao = {};
    for (const cargo of todosCargos) {
      const slugMap = PERMISSOES_PADRAO[cargo];
      if (!slugMap) continue;
      for (const [slug, nivel] of Object.entries(slugMap)) {
        const atual = slugMapUniao[slug];
        if (!atual || (NIVEL_ORD_SEED[nivel] ?? 0) > (NIVEL_ORD_SEED[atual] ?? 0)) {
          slugMapUniao[slug] = nivel;
        }
      }
    }
    for (const [slug, nivel] of Object.entries(slugMapUniao)) {
      await prisma.permissaoMembro.upsert({
        where:  { equipeId_userId_moduloSlug: { equipeId: membro.equipeId, userId: membro.userId, moduloSlug: slug } },
        update: {},
        create: { equipeId: membro.equipeId, userId: membro.userId, moduloSlug: slug, nivel, atualizadoPor: membro.userId },
      });
      permCount++;
    }
  }
  console.log(`  ✓ PermissaoMembro backfill (${permCount} entradas verificadas em ${membros.length} membro(s))`);

  // ── Medicamentos (catálogo) ───────────────────────────────────────────────────
  await seedMedicamentos(prisma);

  // ── Procedimentos veterinários (catálogo) ─────────────────────────────────────
  await seedProcedimentos(prisma);
  await seedLaboratorios();
  await seedImagemExames(prisma);

  console.log('✅ Seed concluído com sucesso!');
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
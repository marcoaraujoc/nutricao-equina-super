const { PrismaClient } = require('@prisma/client');
const { comTenantAutomatico, comEscopoPlataforma } = require('./src/lib/prismaTenant');
const { MODULOS_SISTEMA, PERMISSOES_PADRAO } = require('./src/seeds/002_permissoes_padrao.seed');
const seedMedicamentos = require('./src/seeds/003_medicamentos.seed');
const seedProcedimentos = require('./src/seeds/004_procedimentos.seed');
const { seedLaboratorios }   = require('./src/seeds/003_laboratorios.seed');
const { seedImagemExames }  = require('./src/seeds/004_imagem_exames.seed');
const { seedDocumentosCfmv } = require('./src/seeds/006_documentos_cfmv.seed');

// Catálogos globais (medicamentos, procedimentos, laboratórios, módulos do sistema)
// não pertencem a nenhuma empresa — precisam do client ESTENDIDO de tenant para que
// as escritas em tabelas com RLS (ex.: tb_medicamentos) carimbem `app.plataforma` em
// vez de `app.empresa_id`. Um PrismaClient puro nunca passa pela policy dessas
// tabelas: FORCE ROW LEVEL SECURITY vale até para o dono do schema.
const prisma = comTenantAutomatico(new PrismaClient());

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
  // Raças de EQUÍDEOS (inclui asininos e muares — "Jumento Nacional", "Muar" — que
  // compartilham a espécie Equino no cadastro, como no formulário de referência).
  // Ampliada em 2026-08-28 de 8 para 36 a partir da lista de referência do cliente.
  //
  // ⚠️ "Raça Indefinida" da lista de origem NÃO entrou: é o mesmo conceito do 'SRD'
  // que o seed já cria para TODAS as espécies logo abaixo. Ter os dois dividiria o
  // mesmo caso em duas opções e a base ficaria com metade dos animais em cada —
  // exatamente o tipo de duplicata que um catálogo controlado existe para evitar.
  const racasEquino = [
    'American Tennessee', 'American Trotter', 'Anglo Arabe', 'Anglo European Studbook',
    'Appaloosa', 'Árabe', 'Brasileiro de Hipismo', 'Bretão',
    'Campeiro', 'Campolina', 'Clydesdale', 'Crioulo',
    'Friesian', 'Gypsy Vanner', 'Hannover', 'Holsteiner',
    'Jumento Nacional', 'Mangalarga', 'Mangalarga Marchador', 'Mangolina',
    'Marajoara', 'Muar', 'Paint Horse', 'Pampa',
    'Pantaneiro', 'Pêga', 'Pequira', 'Polo Argentino',
    'Pônei', 'Pura Raza Española', 'Puro Sangue Inglês', 'Puro Sangue Lusitano',
    'Quarto de Milha', 'Sela Belga', 'Sela Francesa', 'Sela Holandesa',
  ];
  for (const nome of racasEquino) {
    const existe = await prisma.raca.findFirst({ where: { nome, especieId: 1 } });
    if (!existe) await prisma.raca.create({ data: { nome, especieId: 1 } });
  }

  // ── SRD (Sem Raça Definida) — em TODA espécie ────────────────────────────────
  // Raça é obrigatória no cadastro do paciente e boa parte dos animais atendidos
  // não tem raça definida: sem esta opção o usuário era obrigado a escolher uma
  // raça ERRADA só para conseguir salvar. Vale para todas as espécies, não só
  // Equino — o problema é o mesmo em qualquer uma.
  const todasEspecies = await prisma.especie.findMany({ select: { id: true } });
  for (const { id } of todasEspecies) {
    const existe = await prisma.raca.findFirst({ where: { nome: 'SRD', especieId: id } });
    if (!existe) await prisma.raca.create({ data: { nome: 'SRD', especieId: id } });
  }
  console.log('  ✓ Raças (inclui SRD por espécie)');

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
    { slug: 'SECRETARIA',   label: 'Secretaria',    descricao: 'Recepção e administrativo: agendamentos, cadastros e financeiro básico.' },
    { slug: 'FINANCEIRO',   label: 'Financeiro',    descricao: 'Setor financeiro: acesso completo ao módulo de faturas e cobrança.' },
    { slug: 'ENFERMEIRO',   label: 'Enfermeiro',    descricao: 'Técnico de enfermagem: execução de prescrições, vacinas e evoluções.' },
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

  // ── Modelos de documento do CFMV (Res. 1.321/2020) ────────────────────────────
  // Catálogo GLOBAL (empresa_id null) da Central de Documentos. Idempotente por
  // `chave`, e o update é DELIBERADO: é assim que uma revisão de norma alcança as
  // clínicas. A cópia personalizada de cada empresa não é tocada.
  // ⚠️ Depende da migration `20260918000000_central_documentos`.
  try {
    const r = await seedDocumentosCfmv(prisma);
    console.log(`  ✓ Modelos de documento CFMV (${r.criados} criados, ${r.atualizados} atualizados)`);
  } catch (err) {
    // Tabela ainda não migrada não pode derrubar o seed inteiro — quem roda o seed
    // costuma estar semeando permissões/catálogo, não os documentos.
    console.warn(`  ⚠ Modelos de documento CFMV não semeados: ${err.message}`);
  }

  console.log('✅ Seed concluído com sucesso!');
}

comEscopoPlataforma(main)
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
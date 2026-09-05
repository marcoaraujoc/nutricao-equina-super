// backend/src/seeds/003_planos.seed.js
//
// Catálogo de PLANOS do SaaS — fase 2 do multi-tenancy (docs/MULTI-TENANCY-PLANO.md §5.2).
// Idempotente (upsert por `slug`): rodar de novo não duplica e não sobrescreve preço
// negociado, só garante que os planos existem.
//
// ⚠️ NÃO atribui plano a empresa nenhuma. Empresa sem assinatura é tratada como
// ILIMITADA (ver lib/planoEmpresa.js) — atribuir plano em massa aqui poderia trancar
// gente para fora de clínicas que já operam. A atribuição é ato deliberado do ADMIN.

const PLANOS = [
  {
    slug: 'gratuito',
    nome: 'Gratuito',
    limiteUsuarios: 1,
    limiteAnimais: 10,
    precoMensal: 0,
    ordem: 1,
  },
  {
    slug: 'essencial',
    nome: 'Essencial',
    limiteUsuarios: 5,
    limiteAnimais: 100,
    precoMensal: null,   // preço definido comercialmente, não chutado aqui
    ordem: 2,
  },
  {
    slug: 'clinica',
    nome: 'Clínica',
    limiteUsuarios: 15,
    limiteAnimais: 500,
    precoMensal: null,
    ordem: 3,
  },
  {
    slug: 'ilimitado',
    nome: 'Ilimitado',
    // NULL = sem teto. Não é 0 — zero seria um plano que não deixa ninguém entrar.
    limiteUsuarios: null,
    limiteAnimais: null,
    precoMensal: null,
    ordem: 4,
  },
];

async function seedPlanos(prisma) {
  let criados = 0;
  for (const p of PLANOS) {
    // SQL cru pelo mesmo motivo do resto do projeto: o client Prisma pode não ter sido
    // regenerado ainda (no Windows o `generate` falha com o backend rodando).
    const r = await prisma.$executeRawUnsafe(
      `INSERT INTO schs2vet.tb_planos (slug, nome, limite_usuarios, limite_animais, preco_mensal, ordem, ativo, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
       ON CONFLICT (slug) DO NOTHING`,
      p.slug, p.nome, p.limiteUsuarios, p.limiteAnimais, p.precoMensal, p.ordem,
    );
    criados += r;
  }
  console.log(`[seed] planos: ${criados} criado(s), ${PLANOS.length - criados} já existia(m)`);
  return criados;
}

module.exports = { seedPlanos, PLANOS };

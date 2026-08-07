// backend/scripts/orfasTenancy.js
//
// FASE 4 DO MULTI-TENANCY — levantamento das linhas ÓRFÃS (sem empresa resolvível).
//
// ⚠️ SOMENTE LEITURA. Este script NÃO apaga nada e NÃO deve ganhar essa capacidade:
// ele existe para que a lista seja CONFERIDA antes de qualquer DELETE, e para servir
// de critério de aceite depois ("0 órfãs").
//
// Uso:  node scripts/orfasTenancy.js
//       node scripts/orfasTenancy.js --json   (saída bruta, para diff entre execuções)

'use strict';

const { PrismaClient } = require('@prisma/client');
const { comTenantAutomatico, comEscopoPlataforma } = require('../src/lib/prismaTenant');
// ⚠️ FASE 7c — o RLS agora é FAIL-CLOSED, e o `FORCE` alcança até o DONO das tabelas.
// Script de manutenção que não declarar escopo enxerga ZERO linha: o inventário chegou a
// acusar '32 de 32 órfãs' em tb_movimentos_estoque porque o LEFT JOIN no pai voltava
// vazio. Manutenção lê a base inteira por definição — escopo de PLATAFORMA, explícito.
const prisma = comTenantAutomatico(new PrismaClient());

const JSON_OUT = process.argv.includes('--json');

const q = (sql, ...args) => prisma.$queryRawUnsafe(sql, ...args);

// Serializa BigInt/Date para caber em JSON e em console.table
const limpo = (rows) => rows.map(r => Object.fromEntries(
  Object.entries(r).map(([k, v]) => [
    k,
    typeof v === 'bigint' ? Number(v)
      : v instanceof Date ? v.toISOString().slice(0, 16).replace('T', ' ')
      : v,
  ]),
));

async function main() { return comEscopoPlataforma(async () => {
  const relatorio = {};

  // ── 1. ANIMAIS sem empresa ────────────────────────────────────────────────
  // Raiz de 33 tabelas: tudo que herda tenant do animal cai junto.
  const animais = limpo(await q(`
    SELECT a.id, a.nome, a.ativo, a."userId" AS proprietario_id,
           u."fullName" AS proprietario, u."userType" AS tipo_prop
    FROM schs2vet.tb_animais a
    LEFT JOIN schs2vet.users u ON u.id = a."userId"
    WHERE a."empresaId" IS NULL
    ORDER BY a.id`));
  relatorio.animaisOrfaos = animais;

  const idsAnimais = animais.map(a => a.id);

  // Dependentes de cada animal órfão — o que o DELETE em cascata levaria junto
  relatorio.dependentesDosAnimais = [];
  if (idsAnimais.length) {
    const deps = [
      ['tb_evolucoes_clinicas',   '"animalId"'],
      ['tb_prescricoes',          '"animalId"'],
      ['tb_prescricao_grupos',    '"animalId"'],
      ['tb_vacinas_clinicas',     '"animalId"'],
      ['tb_exames_clinicos',      '"animalId"'],
      ['tb_encaminhamentos_clinicos', '"animalId"'],
      // ⚠️ estas três são snake_case — o schema NÃO é uniforme (ver armadilha 41 do
      // CLAUDE.md: há tabela com `@map` e tabela sem). Conferir sempre em
      // information_schema antes de escrever SQL cru.
      ['tb_agendamentos_clinicos', 'animal_id'],
      ['tb_designacoes_prestador', 'animal_id'],
      ['tb_dieta',                '"animalId"'],
      ['tb_planos_dieta',         '"animalId"'],
      ['tb_exames_nutricionais',  '"animalId"'],
      ['tb_fatura_itens',         '"animalId"'],
      ['tb_faturas',              '"animalId"'],
      ['tb_relatorios_salvos',    '"animalId"'],
      ['tb_resenha_equino',       'animal_id'],
      ['tb_midia_arquivos',       'animal_id'],
      ['tb_audit_logs',           '"animalId"'],
    ];
    for (const [tabela, col] of deps) {
      try {
        const r = await q(
          `SELECT COUNT(*)::int AS n FROM schs2vet.${tabela} WHERE ${col} = ANY($1::int[])`,
          idsAnimais,
        );
        if (r[0].n > 0) relatorio.dependentesDosAnimais.push({ tabela, linhas: r[0].n });
      } catch (e) {
        relatorio.dependentesDosAnimais.push({ tabela, linhas: `ERRO: ${e.message.slice(0, 60)}` });
      }
    }
  }

  // ── 2. FATURAS sem empresa ────────────────────────────────────────────────
  // `empresa_id` próprio; o proprietário pode pertencer a MAIS DE UMA empresa
  // (é a ambiguidade que impede backfill automático — D7).
  relatorio.faturasOrfas = limpo(await q(`
    SELECT f.id, f."mesReferencia" AS mes, f.status, f.total,
           f."proprietarioId" AS prop_id, u."fullName" AS proprietario,
           f."animalId" AS animal_id,
           (SELECT COUNT(*)::int FROM schs2vet.tb_fatura_itens fi WHERE fi."faturaId" = f.id) AS itens,
           (SELECT COUNT(DISTINCT ue.empresa_id)::int
              FROM schs2vet.tb_usuario_empresa ue
             WHERE ue.user_id = f."proprietarioId") AS empresas_do_prop
    FROM schs2vet.tb_faturas f
    LEFT JOIN schs2vet.users u ON u.id = f."proprietarioId"
    WHERE f.empresa_id IS NULL
    ORDER BY f.id`));

  // ── 3. AUDITORIA sem empresa (D11 — evento de plataforma) ─────────────────
  relatorio.auditoriaSemEmpresa = limpo(await q(`
    SELECT action, COUNT(*)::int AS linhas,
           MIN(timestamp) AS mais_antiga, MAX(timestamp) AS mais_recente
    FROM schs2vet.tb_audit_logs
    WHERE "empresaId" IS NULL
    GROUP BY action
    ORDER BY linhas DESC`));

  relatorio.auditoriaTotais = limpo(await q(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE "empresaId" IS NULL)::int AS sem_empresa,
           COUNT(*) FILTER (WHERE "empresaId" IS NULL AND timestamp > now() - interval '7 days')::int AS sem_empresa_7d,
           COUNT(DISTINCT "userId") FILTER (WHERE "empresaId" IS NULL)::int AS usuarios_distintos
    FROM schs2vet.tb_audit_logs`));

  // ── 4. As pequenas — resolver caso a caso ─────────────────────────────────
  relatorio.pequenas = [];
  const pequenas = [
    ['tb_estoque_clinica', '"empresaId" IS NULL', 'estoque de medicamento sem empresa'],
    ['tb_lotes_vacina',    'empresa_id IS NULL',  'lote de vacina sem empresa'],
    ['tb_midia_arquivos',  'empresa_id IS NULL AND animal_id IS NULL', 'arquivo sem dono (nem empresa nem animal)'],
  ];
  for (const [tabela, cond, oque] of pequenas) {
    const r = await q(`SELECT COUNT(*)::int AS n FROM schs2vet.${tabela} WHERE ${cond}`);
    relatorio.pequenas.push({ tabela, linhas: r[0].n, oque });
  }

  // Dieta / exame clínico órfãos são consequência do animal órfão — medidos à parte
  // para não parecerem um problema independente.
  const viaAnimal = [
    ['tb_dieta',           '"animalId"'],
    ['tb_exames_clinicos', '"animalId"'],
    ['tb_resenha_equino',  'animal_id'],
  ];
  relatorio.orfasViaAnimal = [];
  for (const [tabela, col] of viaAnimal) {
    const r = await q(`
      SELECT COUNT(*)::int AS n FROM schs2vet.${tabela} t
      LEFT JOIN schs2vet.tb_animais a ON a.id = t.${col}
      WHERE a.id IS NULL OR a."empresaId" IS NULL`);
    relatorio.orfasViaAnimal.push({ tabela, linhas: r[0].n });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(relatorio, null, 2));
    return;
  }

  const titulo = (t) => console.log(`\n${'═'.repeat(78)}\n${t}\n${'═'.repeat(78)}`);

  titulo('1. ANIMAIS SEM EMPRESA (raiz de 33 tabelas)');
  console.table(relatorio.animaisOrfaos);
  console.log('\nO que um DELETE em cascata levaria junto:');
  console.table(relatorio.dependentesDosAnimais);

  titulo('2. FATURAS SEM EMPRESA');
  console.log('`empresas_do_prop` > 1 = AMBÍGUA (não dá para deduzir de quem é a fatura)');
  console.table(relatorio.faturasOrfas);

  titulo('3. AUDITORIA SEM EMPRESA (D11)');
  console.table(relatorio.auditoriaTotais);
  console.table(relatorio.auditoriaSemEmpresa);

  titulo('4. PEQUENAS — caso a caso');
  console.table(relatorio.pequenas);
  console.log('\nÓrfãs por herdarem de animal órfão (somem junto com o item 1):');
  console.table(relatorio.orfasViaAnimal);

  console.log('\n⚠️  NADA FOI APAGADO — este script é somente leitura.\n');
}); }

main()
  .catch((e) => { console.error('ERRO:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

// backend/scripts/fase4SanearOrfas.js
//
// FASE 4 DO MULTI-TENANCY — apaga as linhas ÓRFÃS (sem empresa resolvível).
//
// ⚠️ DESTRUTIVO. Roda em modo SECO por padrão; só apaga com `--apply`.
//     node scripts/fase4SanearOrfas.js          → mostra o que faria
//     node scripts/fase4SanearOrfas.js --apply  → apaga (dentro de UMA transaction)
//
// Sempre grava um backup JSON de TUDO que será removido antes de tocar em qualquer
// linha. O backup fica FORA do repositório (a base é de teste, mas o custo é zero).
//
// ── DECISÃO REGISTRADA (2026-08-06) ──────────────────────────────────────────
// A medição (scripts/orfasTenancy.js) mostrou que 3 dos 5 animais e 4 das 10 faturas
// tinham empresa INFERÍVEL pelos próprios registros filhos, e a recomendação técnica
// era BACKFILL. O usuário optou por APAGAR TODAS — base 100% de teste. Fica o registro
// de que a alternativa existia e foi descartada conscientemente, não por omissão.
//
// ── O QUE **NÃO** É APAGADO, E POR QUÊ ───────────────────────────────────────
// `tb_midia_arquivos` id 11 (`pasta='marca'`, `publico=true`) é a MARCA DO PRODUTO,
// servida por `GET /api/marca` na tela de login. Ela é órfã POR CONSTRUÇÃO (CLAUDE.md
// §8): não pertence a tenant nenhum, e apagá-la quebraria o logo do login sem ajudar
// em nada na migração. Ela será CLASSIFICADA como global, junto de `tb_composicao_alimento`.
//
// ── ORDEM DE REMOÇÃO (ditada pelas FKs, verificadas no information_schema) ────
//   1. `tb_fatura_itens` das faturas órfãs — `faturaId` é **RESTRICT**: sem isto o
//      DELETE das faturas falha.
//   2. faturas órfãs.
//   3. animais órfãos — os 17 filhos clínicos são **CASCADE** e somem sozinhos.
//      ⚠️ `tb_fatura_itens.animalId` e `tb_faturas.animalId` são **SET NULL**: item de
//      animal órfão que esteja numa fatura VIVA NÃO é apagado — só perde o vínculo.
//      É por isso que o total da fatura viva não muda.
//   4. estoque e lote sem empresa.
//   5. auditoria sem empresa (D11 — policy (b), sem `OR IS NULL`).

'use strict';

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const { comTenantAutomatico, comEscopoPlataforma } = require('../src/lib/prismaTenant');
// ⚠️ FASE 7c — o RLS agora é FAIL-CLOSED, e o `FORCE` alcança até o DONO das tabelas.
// Script de manutenção que não declarar escopo enxerga ZERO linha: o inventário chegou a
// acusar '32 de 32 órfãs' em tb_movimentos_estoque porque o LEFT JOIN no pai voltava
// vazio. Manutenção lê a base inteira por definição — escopo de PLATAFORMA, explícito.
const prisma = comTenantAutomatico(new PrismaClient());
const APLICAR = process.argv.includes('--apply');

const DIR_BACKUP = process.env.BACKUP_DIR
  || 'C:/Users/marco/AppData/Local/Temp/claude/d--Projetos-nutricao-equina-super-nutricao-equina-super/d192ab17-784d-484e-adb2-328d2bcccec2/scratchpad';

const q = (sql, ...args) => prisma.$queryRawUnsafe(sql, ...args);
const serializavel = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)));

async function main() { return comEscopoPlataforma(async () => {
  // ── Alvos, recalculados AO VIVO (nunca id chumbado no código) ──────────────
  const animais = await q(`SELECT id, nome, ativo, "userId" FROM schs2vet.tb_animais WHERE "empresaId" IS NULL ORDER BY id`);
  const faturas = await q(`SELECT id, "mesReferencia", status, total, "proprietarioId" FROM schs2vet.tb_faturas WHERE empresa_id IS NULL ORDER BY id`);
  const idsAnimais = animais.map(a => a.id);
  const idsFaturas = faturas.map(f => f.id);

  const itensDasFaturas = idsFaturas.length
    ? await q(`SELECT * FROM schs2vet.tb_fatura_itens WHERE "faturaId" = ANY($1::int[]) ORDER BY id`, idsFaturas)
    : [];
  const estoque = await q(`SELECT * FROM schs2vet.tb_estoque_clinica WHERE "empresaId" IS NULL ORDER BY id`);
  const lotes   = await q(`SELECT * FROM schs2vet.tb_lotes_vacina WHERE empresa_id IS NULL ORDER BY id`);
  const audit   = await q(`SELECT * FROM schs2vet.tb_audit_logs WHERE "empresaId" IS NULL ORDER BY id`);

  // ── RESÍDUOS que o próprio DELETE cria ─────────────────────────────────────
  // Duas categorias que NÃO somem sozinhas com o animal:
  //
  //  (a) `tb_midia_arquivos.animal_id` é COLUNA SOLTA, sem FK (mesmo padrão de
  //      `AuditLog.animalId`). Nenhum CASCADE a alcança: a foto do animal apagado
  //      fica apontando para um id que não existe mais, ocupando bytea no banco.
  //  (b) `tb_resenha_equino.animal_id` é **SET NULL** — a resenha sobrevive à
  //      exclusão do animal e vira uma ficha de ninguém.
  //
  // Por isso o script precisa de uma SEGUNDA passada: rodar só a primeira deixaria
  // o inventário acusando órfãs logo depois de "terminar" a fase 4.
  const midiaPendurada = await q(`
    SELECT m.* FROM schs2vet.tb_midia_arquivos m
    LEFT JOIN schs2vet.tb_animais a ON a.id = m.animal_id
    WHERE m.animal_id IS NOT NULL AND a.id IS NULL ORDER BY m.id`);
  const resenhaSemAnimal = await q(`SELECT * FROM schs2vet.tb_resenha_equino WHERE animal_id IS NULL ORDER BY id`);

  // Filhos em CASCADE dos animais — só para o backup e para o relatório
  const cascata = {};
  const filhos = [
    ['tb_evolucoes_clinicas', '"animalId"'], ['tb_prescricoes', '"animalId"'],
    ['tb_prescricao_grupos', '"animalId"'],  ['tb_vacinas_clinicas', '"animalId"'],
    ['tb_exames_clinicos', '"animalId"'],    ['tb_encaminhamentos_clinicos', '"animalId"'],
    ['tb_agendamentos_clinicos', 'animal_id'], ['tb_dieta', '"animalId"'],
    ['tb_planos_dieta', '"animalId"'],       ['tb_exames_nutricionais', '"animalId"'],
    ['tb_relatorios_salvos', '"animalId"'],  ['tb_designacoes_prestador', 'animal_id'],
    ['tb_reservas_estoque', '"animalId"'],   ['tb_resumo_atendimento_ia', 'animal_id'],
    ['tb_resenha_grafica', 'animal_id'],     ['tb_ocorrencias_saude', '"animalId"'],
    ['tb_exame_imagem_anexos', '"animalId"'],
  ];
  if (idsAnimais.length) {
    for (const [tabela, col] of filhos) {
      const rows = await q(`SELECT * FROM schs2vet.${tabela} WHERE ${col} = ANY($1::int[])`, idsAnimais);
      if (rows.length) cascata[tabela] = rows;
    }
  }

  // Itens que apenas PERDEM o animal (SET NULL) — não são apagados
  const itensPreservados = idsAnimais.length
    ? await q(`
        SELECT fi.id, fi."faturaId", fi."animalId", fi.valor, f.status, f.empresa_id
        FROM schs2vet.tb_fatura_itens fi
        JOIN schs2vet.tb_faturas f ON f.id = fi."faturaId"
        WHERE fi."animalId" = ANY($1::int[]) AND f.empresa_id IS NOT NULL
        ORDER BY fi.id`, idsAnimais)
    : [];

  // ── Relatório ──────────────────────────────────────────────────────────────
  const totalCascata = Object.values(cascata).reduce((s, r) => s + r.length, 0);
  console.log(`\n${'═'.repeat(70)}`);
  console.log(APLICAR ? '  FASE 4 — APLICANDO (destrutivo)' : '  FASE 4 — MODO SECO (nada será apagado)');
  console.log('═'.repeat(70));
  console.log(`animais órfãos ............. ${animais.length}  (ids ${idsAnimais.join(', ') || '-'})`);
  console.log(`  └ filhos em CASCADE ...... ${totalCascata} linhas em ${Object.keys(cascata).length} tabelas`);
  console.log(`faturas órfãs .............. ${faturas.length}  (ids ${idsFaturas.join(', ') || '-'})`);
  console.log(`  └ itens dessas faturas ... ${itensDasFaturas.length}`);
  console.log(`estoque sem empresa ........ ${estoque.length}`);
  console.log(`lotes de vacina sem empresa  ${lotes.length}`);
  console.log(`auditoria sem empresa ...... ${audit.length}`);
  console.log(`mídia de animal inexistente  ${midiaPendurada.length}  (coluna solta, sem FK)`);
  console.log(`resenha sem animal ......... ${resenhaSemAnimal.length}  (animal_id é SET NULL)`);
  console.log(`\nPRESERVADO (SET NULL, só perde o vínculo com o animal): ${itensPreservados.length} itens em fatura viva`);
  console.log('PRESERVADO: tb_midia_arquivos id 11 — marca do produto (global por construção)\n');

  // ── Backup ─────────────────────────────────────────────────────────────────
  fs.mkdirSync(DIR_BACKUP, { recursive: true });
  const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  const arq = path.join(DIR_BACKUP, `backup_fase4_orfas_${carimbo}.json`);
  fs.writeFileSync(arq, JSON.stringify(serializavel({
    geradoEm: new Date().toISOString(),
    animais, cascata, faturas, itensDasFaturas, estoque, lotes, audit,
    midiaPendurada, resenhaSemAnimal,
    itensPreservadosApenasDesvinculados: itensPreservados,
  }), null, 2));
  console.log(`backup → ${arq}\n`);

  if (!APLICAR) {
    console.log('Nada foi apagado. Rode com --apply para executar.\n');
    return;
  }

  // ── Execução — TUDO numa transaction só ────────────────────────────────────
  const res = await prisma.$transaction(async (tx) => {
    const r = {};
    if (idsFaturas.length) {
      // 1. itens ANTES das faturas (faturaId é RESTRICT)
      r.faturaItens = await tx.$executeRawUnsafe(
        `DELETE FROM schs2vet.tb_fatura_itens WHERE "faturaId" = ANY($1::int[])`, idsFaturas);
      // 2. faturas
      r.faturas = await tx.$executeRawUnsafe(
        `DELETE FROM schs2vet.tb_faturas WHERE id = ANY($1::int[])`, idsFaturas);
    }
    // 3. animais (filhos clínicos vão em CASCADE)
    if (idsAnimais.length) {
      r.animais = await tx.$executeRawUnsafe(
        `DELETE FROM schs2vet.tb_animais WHERE id = ANY($1::int[])`, idsAnimais);
    }
    // 4. estoque e lotes
    r.estoque = await tx.$executeRawUnsafe(`DELETE FROM schs2vet.tb_estoque_clinica WHERE "empresaId" IS NULL`);
    r.lotes   = await tx.$executeRawUnsafe(`DELETE FROM schs2vet.tb_lotes_vacina WHERE empresa_id IS NULL`);
    // 5. auditoria de plataforma (D11)
    r.audit   = await tx.$executeRawUnsafe(`DELETE FROM schs2vet.tb_audit_logs WHERE "empresaId" IS NULL`);
    // 6. resíduos que nenhum CASCADE alcança (ver comentário na coleta)
    if (midiaPendurada.length) {
      r.midiaPendurada = await tx.$executeRawUnsafe(
        `DELETE FROM schs2vet.tb_midia_arquivos WHERE id = ANY($1::int[])`,
        midiaPendurada.map(m => m.id));
    }
    if (resenhaSemAnimal.length) {
      r.resenhaSemAnimal = await tx.$executeRawUnsafe(
        `DELETE FROM schs2vet.tb_resenha_equino WHERE id = ANY($1::int[])`,
        resenhaSemAnimal.map(x => x.id));
    }
    return r;
  }, { timeout: 60_000 });

  console.log('APAGADO:');
  console.table(Object.entries(res).map(([tabela, linhas]) => ({ tabela, linhas })));
  console.log('');
}); }

main()
  .catch((e) => { console.error('ERRO:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

/**
 * Sanitização de tb_medicamentos (catálogo global, empresa_id IS NULL):
 * colapsa pares duplicados onde a única diferença de apresentacao é o sufixo
 * de quantidade ("Frasco" vs "Frasco de 1 L"), mantendo a linha mais ANTIGA
 * (id menor) com a apresentacao no formato SEM quantidade, e removendo a
 * linha mais NOVA — SOMENTE quando controlado, classificacao, fabricante,
 * multidose, dosesPorEmbalagem e formaCalculo são IDÊNTICOS entre as duas.
 *
 * Espécies e vias de administração da linha removida são UNIDAS (union) na
 * linha que sobrevive antes da remoção — nenhuma indicação é perdida.
 *
 * Uso:
 *   node scripts/sanitizarMedicamentosDuplicados.js            → DRY RUN (não grava nada)
 *   node scripts/sanitizarMedicamentosDuplicados.js --executar → grava de verdade, em uma transaction
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const EXECUTAR = process.argv.includes('--executar');
const FIELDS = ['controlado', 'classificacao', 'fabricante', 'multidose', 'dosesPorEmbalagem', 'formaCalculo'];

async function carregarPares() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT id, nome, "formaFarmaceutica", unidade, apresentacao, ativo, controlado, classificacao, fabricante,
           multidose, doses_por_embalagem AS "dosesPorEmbalagem", forma_calculo AS "formaCalculo"
    FROM tb_medicamentos
    WHERE empresa_id IS NULL
      AND (nome, "formaFarmaceutica", unidade) IN (
        SELECT nome, "formaFarmaceutica", unidade
        FROM tb_medicamentos
        WHERE empresa_id IS NULL
        GROUP BY nome, "formaFarmaceutica", unidade
        HAVING COUNT(*) > 1
      )
    ORDER BY nome, "formaFarmaceutica", unidade, apresentacao
  `);

  const groups = {};
  for (const r of rows) {
    const key = `${r.nome}|||${r.formaFarmaceutica}|||${r.unidade}`;
    (groups[key] = groups[key] || []).push(r);
  }

  const matching = [];
  for (const items of Object.values(groups)) {
    if (items.length !== 2) continue;
    const [a, b] = items;
    const short = a.apresentacao.length <= b.apresentacao.length ? a : b;
    const long = a.apresentacao.length <= b.apresentacao.length ? b : a;
    const prefix = short.apresentacao + ' de ';
    if (long.apresentacao.startsWith(prefix) && long.apresentacao.length > prefix.length) {
      matching.push({ short, long });
    }
  }

  const eligible = matching.filter(m => FIELDS.every(f => m.short[f] === m.long[f]));
  // segurança extra: nome/formaFarmaceutica/unidade IDÊNTICOS (garantido pelo agrupamento, reforçado aqui)
  return eligible.filter(m =>
    m.short.nome === m.long.nome &&
    m.short.formaFarmaceutica === m.long.formaFarmaceutica &&
    m.short.unidade === m.long.unidade
  );
}

async function main() {
  const pares = await carregarPares();
  console.log(`Pares elegíveis: ${pares.length}`);
  console.log(EXECUTAR ? '>>> MODO EXECUÇÃO — vai gravar no banco <<<' : '>>> DRY RUN — nada será gravado <<<');

  let atualizados = 0;
  let removidos = 0;
  let especiesUnidas = 0;
  let viasUnidas = 0;

  const run = async (tx) => {
    let idx = 0;
    for (const { short, long } of pares) {
      idx++;
      const ctx = (etapa) => `[par ${idx}/${pares.length}] etapa=${etapa} short=${short.id} long=${long.id} nome="${short.nome}"`;
      try {
        // 1) une espécies da linha nova (short) que a antiga (long) não tem
        const especiesNovas = await tx.$queryRawUnsafe(
          `SELECT "especieId" FROM tb_medicamento_especies
           WHERE "medicamentoId" = $1
             AND "especieId" NOT IN (
               SELECT "especieId" FROM tb_medicamento_especies WHERE "medicamentoId" = $2
             )`,
          short.id, long.id
        );
        for (const e of especiesNovas) {
          especiesUnidas++;
          if (EXECUTAR) {
            try {
              await tx.$executeRawUnsafe(
                `INSERT INTO tb_medicamento_especies ("medicamentoId", "especieId") VALUES ($1, $2)
                 ON CONFLICT ("medicamentoId", "especieId") DO NOTHING`,
                long.id, Number(e.especieId)
              );
            } catch (err) {
              console.error(ctx(`insert especie especieId=${e.especieId}`), err.message || err);
              throw err;
            }
          }
        }

        // 2) une vias da linha nova (short) que a antiga (long) não tem
        const viasNovas = await tx.$queryRawUnsafe(
          `SELECT via FROM tb_medicamento_vias
           WHERE "medicamentoId" = $1
             AND via NOT IN (
               SELECT via FROM tb_medicamento_vias WHERE "medicamentoId" = $2
             )`,
          short.id, long.id
        );
        for (const v of viasNovas) {
          viasUnidas++;
          if (EXECUTAR) {
            try {
              await tx.$executeRawUnsafe(
                `INSERT INTO tb_medicamento_vias ("medicamentoId", via) VALUES ($1, $2)
                 ON CONFLICT ("medicamentoId", via) DO NOTHING`,
                long.id, v.via
              );
            } catch (err) {
              console.error(ctx(`insert via via=${v.via}`), err.message || err);
              throw err;
            }
          }
        }

        // 3) remove a linha nova (short) PRIMEIRO — cascade cuida de especies/vias/... dela.
        //    Precisa vir ANTES do update abaixo: tb_medicamentos tem um índice único em
        //    (nome, formaFarmaceutica, apresentacao, unidade, empresa_id) — atualizar a
        //    apresentacao da linha antiga ENQUANTO a nova ainda existe cria, por um
        //    instante, duas linhas idênticas nesses campos e viola o índice (23505).
        removidos++;
        if (EXECUTAR) {
          try {
            await tx.$executeRawUnsafe(`DELETE FROM tb_medicamentos WHERE id = $1`, short.id);
          } catch (err) {
            console.error(ctx('delete short'), err.message || err);
            throw err;
          }
        }

        // 4) reescreve a apresentacao da linha antiga (long) para o formato sem quantidade
        atualizados++;
        if (EXECUTAR) {
          try {
            await tx.$executeRawUnsafe(
              `UPDATE tb_medicamentos SET apresentacao = $1, "updatedAt" = NOW() AT TIME ZONE 'UTC' WHERE id = $2`,
              short.apresentacao, long.id
            );
          } catch (err) {
            console.error(ctx('update apresentacao'), err.message || err);
            throw err;
          }
        }
      } catch (err) {
        console.error('FALHOU EM', ctx('geral'));
        throw err;
      }
    }
  };

  if (EXECUTAR) {
    await prisma.$transaction(async (tx) => {
      // tb_medicamentos é CATÁLOGO MISTO: WITH CHECK só permite escrever linha com
      // empresa_id IS NULL quando app_plataforma() é true (CLAUDE.md §12, armadilha 42).
      await tx.$executeRawUnsafe(`SELECT set_config('app.plataforma', 'on', true)`);
      await run(tx);
    }, { timeout: 5 * 60 * 1000 });
  } else {
    await run(prisma);
  }

  console.log({ paresProcessados: pares.length, linhasAtualizadas: atualizados, linhasRemovidas: removidos, especiesUnidas, viasUnidas });

  // amostra para conferência
  console.log('Amostra (10 primeiros):');
  console.log(pares.slice(0, 10).map(m => ({
    mantido_id: m.long.id,
    removido_id: m.short.id,
    nome: m.short.nome,
    apresentacao_final: m.short.apresentacao,
  })));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

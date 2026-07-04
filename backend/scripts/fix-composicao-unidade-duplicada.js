/**
 * fix-composicao-unidade-duplicada.js
 *
 * Corrige casos em que o mesmo nutriente foi cadastrado duas vezes com unidades
 * diferentes (ex: g e mg), criando nutrientes duplicados em tb_nutrientes.
 *
 * Para cada par de nutrientes com mesmo nome mas unidades diferentes:
 *   - O nutriente com menor ID é canônico (mais antigo).
 *   - As composições do nutriente duplicado são migradas para o canônico,
 *     convertendo o valorPorKg para a unidade canônica.
 *   - Se o alimento já tinha composição no canônico, a duplicata é removida
 *     (mantém o valor canônico já existente).
 *   - Ao final, o nutriente duplicado é removido se não restar composições.
 *
 * Uso (rodar dentro de backend/):
 *   node scripts/fix-composicao-unidade-duplicada.js        ← processa tudo
 *   node scripts/fix-composicao-unidade-duplicada.js 12     ← só alimento 12
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Conversão entre unidades de massa ────────────────────────────────────────

const FATOR_PARA_G = { g: 1, mg: 1e-3, mcg: 1e-6, 'µg': 1e-6 };

function converterUnidade(valor, unidadeOrigem, unidadeDestino) {
  const orig = String(unidadeOrigem || '').toLowerCase().trim();
  const dest = String(unidadeDestino || '').toLowerCase().trim();
  if (orig === dest) return valor;
  const fo = FATOR_PARA_G[orig];
  const fd = FATOR_PARA_G[dest];
  if (!fo || !fd) return null; // unidade não convertível (ex: UI, UFC)
  return (Number(valor) * fo) / fd;
}

// ── Lógica principal ─────────────────────────────────────────────────────────

async function main() {
  const filtroAlimentoId = process.argv[2] ? Number(process.argv[2]) : null;

  // 1. Encontra todos os nomes de nutrientes que aparecem mais de uma vez
  //    (indicativo de duplicata com unidades distintas)
  const todosNutrientes = await prisma.nutriente.findMany({
    orderBy: { id: 'asc' },
  });

  // Agrupa por nome normalizado
  const porNome = {};
  for (const n of todosNutrientes) {
    if (!porNome[n.nome]) porNome[n.nome] = [];
    porNome[n.nome].push(n);
  }

  let totalMigradas = 0;
  let totalRemovidas = 0;
  let totalNutrientesRemovidos = 0;

  for (const [nome, nutrientes] of Object.entries(porNome)) {
    if (nutrientes.length < 2) continue;

    // Menor ID = canônico
    const canonico = nutrientes[0]; // já ordenado por id asc
    const duplicatas = nutrientes.slice(1);

    for (const dup of duplicatas) {
      const valorConvertivel = converterUnidade(1, dup.unidadePadrao, canonico.unidadePadrao) !== null;
      if (!valorConvertivel) {
        console.log(
          `[AVISO] "${nome}": unidade ${dup.unidadePadrao} → ${canonico.unidadePadrao} não convertível. Pulando nutriente ${dup.id}.`
        );
        continue;
      }

      // Composições do nutriente duplicado (filtro opcional por alimento)
      const composicoesDup = await prisma.composicaoAlimento.findMany({
        where: {
          nutrienteId: dup.id,
          ...(filtroAlimentoId ? { alimentoId: filtroAlimentoId } : {}),
        },
      });

      if (composicoesDup.length === 0 && filtroAlimentoId) continue;

      for (const comp of composicoesDup) {
        const valorConvertido = converterUnidade(comp.valorPorKg, dup.unidadePadrao, canonico.unidadePadrao);

        // Verifica se já existe composição canônica para este alimento
        const compCanonica = await prisma.composicaoAlimento.findFirst({
          where: { alimentoId: comp.alimentoId, nutrienteId: canonico.id },
        });

        if (compCanonica) {
          // Já existe entrada canônica — apenas remove a duplicata
          await prisma.composicaoAlimento.delete({ where: { id: comp.id } });
          console.log(
            `  [RM-DUP] Alimento ${comp.alimentoId} / "${nome}": ` +
            `duplicata id=${comp.id} (${dup.unidadePadrao}=${comp.valorPorKg}) removida ` +
            `(canônico id=${compCanonica.id} já existe, valor=${compCanonica.valorPorKg} ${canonico.unidadePadrao})`
          );
          totalRemovidas++;
        } else {
          // Migra: cria entrada canônica com valor convertido e remove a duplicata
          await prisma.$transaction([
            prisma.composicaoAlimento.create({
              data: {
                alimentoId: comp.alimentoId,
                nutrienteId: canonico.id,
                valorPorKg: valorConvertido,
                base: comp.base,
                ...(comp.especieId ? { especieId: comp.especieId } : {}),
              },
            }),
            prisma.composicaoAlimento.delete({ where: { id: comp.id } }),
          ]);
          console.log(
            `  [MIGRA]  Alimento ${comp.alimentoId} / "${nome}": ` +
            `${comp.valorPorKg} ${dup.unidadePadrao} → ${valorConvertido} ${canonico.unidadePadrao} ` +
            `(nutriente ${dup.id} → ${canonico.id})`
          );
          totalMigradas++;
        }
      }

      // Remove o nutriente duplicado se não houver mais composições vinculadas
      if (!filtroAlimentoId) {
        const restantes = await prisma.composicaoAlimento.count({ where: { nutrienteId: dup.id } });
        if (restantes === 0) {
          await prisma.nutriente.delete({ where: { id: dup.id } });
          console.log(`  [DEL-NUT] Nutriente ${dup.id} ("${nome}" ${dup.unidadePadrao}) removido.`);
          totalNutrientesRemovidos++;
        } else {
          console.log(
            `  [MANTÉM] Nutriente ${dup.id} ainda tem ${restantes} composição(ões) ` +
            `(outros alimentos não processados?). Não removido.`
          );
        }
      }
    }
  }

  console.log(
    '\nConcluído.' +
    ` Migrações: ${totalMigradas}.` +
    ` Duplicatas removidas: ${totalRemovidas}.` +
    (filtroAlimentoId ? '' : ` Nutrientes removidos: ${totalNutrientesRemovidos}.`) +
    '\n'
  );
}

main()
  .catch((err) => {
    console.error('Erro fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

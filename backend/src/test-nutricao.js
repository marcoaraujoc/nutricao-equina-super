const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testarQuery() {
  try {
    console.log('🚀 Executando query de avaliação nutricional...\n');

    const resultado = await prisma.$queryRaw`
      WITH ConsumoBase AS (
          SELECT 
              n.id AS nutriente_id,
              n.nome,
              n.unidadePadrao AS unidade,
              al.nome AS alimento,
              (d.qtdGramasDia * (ca.valorPorKg / 1000)) AS valor_g     -- ← CORRIGIDO (valorPorKg)
          FROM tb_dieta d
          JOIN tb_alimentos al ON al.id = d.alimentoId
          JOIN tb_composicao_alimento ca ON ca.alimentoId = al.id
          JOIN tb_nutrientes n ON n.id = ca.nutrienteId
          WHERE d.animalId = 1
      ),
      Pivo AS (
          SELECT
              nutriente_id,
              nome,
              unidade,
              SUM(CASE WHEN alimento = 'Amino E' THEN valor_g ELSE 0 END) AS "AminoE",
              SUM(CASE WHEN alimento = 'Alfafa' THEN valor_g ELSE 0 END) AS "Alfafa",
              SUM(CASE WHEN alimento = 'Feno' THEN valor_g ELSE 0 END) AS "Feno",
              SUM(CASE WHEN alimento = 'Capim' THEN valor_g ELSE 0 END) AS "Capim",
              SUM(CASE WHEN alimento = 'Ração Royal Horse S-280' THEN valor_g ELSE 0 END) AS "Racao",
              SUM(CASE WHEN alimento = 'Sal Mineral' THEN valor_g ELSE 0 END) AS "Sal",
              SUM(valor_g) AS total_g
          FROM ConsumoBase
          GROUP BY nutriente_id, nome, unidade
      ),
      AvaliacaoNutrientes AS (
          SELECT
              p.nome,
              p.unidade,
              ROUND(CASE 
                  WHEN p.unidade = 'mg'  THEN p.total_g * 1000 
                  WHEN p.unidade = 'mcg' THEN p.total_g * 1000000 
                  ELSE p.total_g 
               END, 2) AS consumo,

              ROUND(COALESCE(e.valor_exigido, 0), 2) AS valor_exigido,

              ROUND(
                  CASE 
                      WHEN p.unidade = 'mg'  THEN p.total_g * 1000 
                      WHEN p.unidade = 'mcg' THEN p.total_g * 1000000 
                      ELSE p.total_g 
                  END - COALESCE(e.valor_exigido, 0), 2
              ) AS saldo,

              ROUND(
                  (CASE 
                      WHEN p.unidade = 'mg'  THEN p.total_g * 1000 
                      WHEN p.unidade = 'mcg' THEN p.total_g * 1000000 
                      ELSE p.total_g 
                   END) / NULLIF(COALESCE(e.valor_exigido, 0), 0) * 100, 2
              ) AS percentual_atendido,

              CASE
                  WHEN e.valor_exigido IS NULL THEN 'SEM EXIGÊNCIA'
                  WHEN (CASE WHEN p.unidade = 'mg' THEN p.total_g*1000 WHEN p.unidade = 'mcg' THEN p.total_g*1000000 ELSE p.total_g END) 
                       / NULLIF(e.valor_exigido, 0) * 100 < 70 THEN 'DEFICIÊNCIA CRÍTICA'
                  WHEN (CASE WHEN p.unidade = 'mg' THEN p.total_g*1000 WHEN p.unidade = 'mcg' THEN p.total_g*1000000 ELSE p.total_g END) 
                       / NULLIF(e.valor_exigido, 0) * 100 < 90 THEN 'DEFICIÊNCIA'
                  WHEN (CASE WHEN p.unidade = 'mg' THEN p.total_g*1000 WHEN p.unidade = 'mcg' THEN p.total_g*1000000 ELSE p.total_g END) 
                       / NULLIF(e.valor_exigido, 0) * 100 <= 120 THEN 'ADEQUADO'
                  WHEN (CASE WHEN p.unidade = 'mg' THEN p.total_g*1000 WHEN p.unidade = 'mcg' THEN p.total_g*1000000 ELSE p.total_g END) 
                       / NULLIF(e.valor_exigido, 0) * 100 <= 200 THEN 'EXCESSO'
                  ELSE 'EXCESSO ALTO'
              END AS status_nutricional

          FROM Pivo p
          LEFT JOIN tb_exames_nutricionais e 
              ON e.nutriente_id = p.nutriente_id 
             AND e.peso = 550
             AND e.tipo_exercicio = 'Exercicio Moderado'
      )
      SELECT 
          nome AS "Nutriente",
          unidade,
          consumo,
          valor_exigido,
          saldo,
          percentual_atendido,
          status_nutricional
      FROM AvaliacaoNutrientes
      ORDER BY 
          CASE status_nutricional 
              WHEN 'DEFICIÊNCIA CRÍTICA' THEN 1
              WHEN 'DEFICIÊNCIA'         THEN 2
              WHEN 'ADEQUADO'            THEN 3
              WHEN 'EXCESSO'             THEN 4
              ELSE 5 
          END;
    `;

    console.log("✅ Resultado da query:");
    console.table(resultado);

  } catch (error) {
    console.error("❌ Erro:", error.message);
    if (error.meta) console.error(error.meta);
  } finally {
    await prisma.$disconnect();
  }
}

testarQuery();
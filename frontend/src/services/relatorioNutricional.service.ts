const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class RelatorioNutricionalService {

  async gerarRelatorioParaLLM(animalId, peso = 500, tipoExercicio = 'Exercício Moderado') {
    
    const sql = `
      WITH consumo_por_alimento AS (
        SELECT
          n.id AS nutriente_id,
          n.nome AS nutriente,
          n.unidadePadrao AS unidade,
          COALESCE(a.nome, 'Sem_Alimento') AS alimento_nome,
          COALESCE(SUM(d.qtdGramasDia * ca.valorPorKg), 0) AS contribuicao_g
        FROM tb_nutrientes n
        LEFT JOIN tb_composicao_alimento ca ON ca.nutrienteId = n.id
        LEFT JOIN tb_dieta d ON d.alimentoId = ca.alimentoId AND d.animalId = ?
        LEFT JOIN tb_alimentos a ON a.id = d.alimentoId
        GROUP BY n.id, n.nome, n.unidadePadrao, a.nome
      ),
      consumo_total AS (
        SELECT 
          nutriente_id, 
          nutriente, 
          unidade, 
          SUM(contribuicao_g) AS consumo_total_g 
        FROM consumo_por_alimento 
        GROUP BY nutriente_id, nutriente, unidade
      ),
      exigencia AS (
        SELECT nutrienteId, valorExigido 
        FROM tb_exigencias_nrc 
        WHERE peso = ? AND tipoExercicio = ?
      )
      SELECT 
        ct.nutriente,
        ct.unidade,
        JSON_OBJECTAGG(
          COALESCE(cpa.alimento_nome, 'Outros'), 
          ROUND(cpa.contribuicao_g, 4)
        ) AS consumo_por_alimento_json,
        ROUND(ct.consumo_total_g, 4) AS total_consumido,
        ROUND(COALESCE(e.valorExigido, 0), 4) AS exigido_nrc,
        ROUND(ct.consumo_total_g - COALESCE(e.valorExigido, 0), 4) AS saldo,
        ROUND(ct.consumo_total_g / NULLIF(COALESCE(e.valorExigido, 0), 0) * 100, 2) AS percentual_atendido,
        CASE
          WHEN ct.consumo_total_g / NULLIF(COALESCE(e.valorExigido, 0), 0) * 100 < 70  THEN 'DEFICIÊNCIA CRÍTICA'
          WHEN ct.consumo_total_g / NULLIF(COALESCE(e.valorExigido, 0), 0) * 100 < 90  THEN 'DEFICIÊNCIA'
          WHEN ct.consumo_total_g / NULLIF(COALESCE(e.valorExigido, 0), 0) * 100 <= 120 THEN 'ADEQUADO'
          WHEN ct.consumo_total_g / NULLIF(COALESCE(e.valorExigido, 0), 0) * 100 <= 200 THEN 'EXCESSO'
          ELSE 'EXCESSO ALTO'
        END AS status_nutricional
      FROM consumo_total ct
      LEFT JOIN exigencia e ON e.nutrienteId = ct.nutriente_id
      LEFT JOIN consumo_por_alimento cpa ON cpa.nutriente_id = ct.nutriente_id
      GROUP BY ct.nutriente_id, ct.nutriente, ct.unidade, ct.consumo_total_g, e.valorExigido
      ORDER BY 
        CASE 
          WHEN status_nutricional = 'DEFICIÊNCIA CRÍTICA' THEN 1
          WHEN status_nutricional = 'DEFICIÊNCIA' THEN 2
          WHEN status_nutricional = 'ADEQUADO' THEN 3
          WHEN status_nutricional = 'EXCESSO' THEN 4
          ELSE 5
        END,
        percentual_atendido ASC;
    `;

    const resultado = await prisma.$queryRawUnsafe(sql, animalId, peso, tipoExercicio);
    return resultado;
  }
}

module.exports = { RelatorioNutricionalService };
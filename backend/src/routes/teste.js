const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const router = express.Router();

router.get('/teste-query', async (req, res) => {
  const { animalId } = req.query;

  if (!animalId) {
    return res.status(400).json({ 
      sucesso: false, 
      error: 'Informe o animalId. Exemplo: ?animalId=1' 
    });
  }

  try {
    const alimentosUnicos = await prisma.$queryRaw`
      SELECT DISTINCT a.nome AS alimento
      FROM tb_dieta d
      JOIN tb_alimentos a ON a.id = d.alimentoId
      WHERE d.animalId = ${Number(animalId)}
        AND d.dataFim IS NULL
      ORDER BY a.nome;
    `;

    const colunasPivot = alimentosUnicos
      .map(item => 
        `MAX(CASE WHEN dc.alimento = '${item.alimento}' THEN ROUND(dc.consumo_kg, 3) END) AS "${item.alimento}"`
      )
      .join(',\n        ');

    const sql = `
      WITH DietaConsumo AS (
        SELECT 
          n.nome AS nutriente,
          n.unidadePadrao AS unidade,
          a.nome AS alimento,
          COALESCE(SUM(c.valorPorKg * (d.qtdGramasDia / 1000.0)), 0) AS consumo_kg
        FROM tb_dieta d
        JOIN tb_alimentos a ON a.id = d.alimentoId
        JOIN tb_composicao_alimento c ON c.alimentoId = a.id
        JOIN tb_nutrientes n ON n.id = c.nutrienteId
        WHERE d.animalId = ${Number(animalId)}
          AND d.dataFim IS NULL
        GROUP BY n.nome, n.unidadePadrao, a.nome
      ),
      Exigencia AS (
        SELECT 
          n.nome AS nutriente,
          e.valorExigido
        FROM tb_exigencias_nrc e
        JOIN tb_nutrientes n ON n.id = e.nutrienteId
        WHERE e.peso = (SELECT peso FROM tb_animais WHERE id = ${Number(animalId)})
          AND e.tipoExercicio = (SELECT tipoExercicio FROM tb_animais WHERE id = ${Number(animalId)})
      )
      SELECT 
        dc.nutriente,
        dc.unidade,
        ${colunasPivot || 'NULL AS "Sem_Alimentos"'},
        ROUND(COALESCE(e.valorExigido, 0), 3) AS "ValorExigido",
        ROUND(SUM(dc.consumo_kg), 3) AS "TotalDieta",
        ROUND(SUM(dc.consumo_kg) - COALESCE(e.valorExigido, 0), 3) AS "Saldo",
        ROUND(CASE WHEN COALESCE(e.valorExigido,0) = 0 THEN 0 
                   ELSE (SUM(dc.consumo_kg) / e.valorExigido) * 100 END, 2) AS "%_Atendido",
        CASE
          WHEN (SUM(dc.consumo_kg) / NULLIF(e.valorExigido, 0)) * 100 < 70  THEN 'DEFICIÊNCIA CRÍTICA'
          WHEN (SUM(dc.consumo_kg) / NULLIF(e.valorExigido, 0)) * 100 < 90  THEN 'DEFICIÊNCIA'
          WHEN (SUM(dc.consumo_kg) / NULLIF(e.valorExigido, 0)) * 100 <= 120 THEN 'ADEQUADO'
          WHEN (SUM(dc.consumo_kg) / NULLIF(e.valorExigido, 0)) * 100 <= 200 THEN 'EXCESSO'
          ELSE 'EXCESSO ALTO'
        END AS "Status"
      FROM DietaConsumo dc
      LEFT JOIN Exigencia e ON e.nutriente = dc.nutriente
      GROUP BY dc.nutriente, dc.unidade, e.valorExigido
      ORDER BY dc.nutriente;
    `;

    const result = await prisma.$queryRawUnsafe(sql);

    console.log('\n' + '='.repeat(140));
    console.log(`📊 ANÁLISE NUTRICIONAL - ANIMAL ID ${animalId}`);
    console.log('='.repeat(140));
    console.table(result);

    res.json({
      sucesso: true,
      animalId: Number(animalId),
      totalNutrientes: result.length,
      dados: result
    });

  } catch (err) {
    console.error('Erro na query:', err);
    res.status(500).json({ sucesso: false, error: err.message });
  }
});

module.exports = router;
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class RelatorioNutricionalService {

  async gerarRelatorioParaLLM(animalId, peso = 500, tipoExercicio = 'Exercício Moderado') {
    
    // 1. Busca alimentos da dieta (sem ORDER BY problemático)
    const alimentosRaw = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT COALESCE(ta.nome, 'Sem_Alimento') AS alimento_nome
      FROM tb_dieta td
      LEFT JOIN tb_alimentos ta ON ta.id = td.alimentoId
      WHERE td.animalId = ?
    `, animalId);

    const alimentos = alimentosRaw.map(r => r.alimento_nome);

    // 2. Gera colunas do pivot (mantém acentuação)
    let pivotColumns = alimentos
      .map(nome => {
        const safeNome = nome.replace(/'/g, "''");
        const colName = nome
          .normalize('NFC')
          .replace(/[^a-zA-Z0-9áéíóúãõçÁÉÍÓÚÃÕÇ\s-]/g, '')
          .trim()
          .replace(/\s+/g, '_');
        
        return `ROUND(MAX(CASE WHEN ta.nome = '${safeNome}' THEN (tca.valorPorKg * td.qtdGramasDia) ELSE 0 END), 8) AS \`${colName}\``;
      })
      .join(',\n            ');

    if (!pivotColumns) pivotColumns = 'NULL AS sem_alimentos';

    // 3. Query principal - Mais portável
    const sql = `
      SELECT
        tn.nome AS nutriente,
        ${pivotColumns},
        ROUND(SUM(COALESCE(tca.valorPorKg * td.qtdGramasDia, 0)), 8) AS \`Total_Dieta\`,
        ROUND(COALESCE(nrc.valorExigido, 0), 8) AS \`Exigido_NRC\`,
        ROUND(SUM(COALESCE(tca.valorPorKg * td.qtdGramasDia, 0)) - COALESCE(nrc.valorExigido, 0), 8) AS \`Saldo\`,
        ROUND(
          SUM(COALESCE(tca.valorPorKg * td.qtdGramasDia, 0)) / NULLIF(COALESCE(nrc.valorExigido, 0), 0) * 100, 
        4) AS \`Percentual_Atendido\`,
        CASE
          WHEN SUM(COALESCE(tca.valorPorKg * td.qtdGramasDia, 0)) < COALESCE(nrc.valorExigido, 0) * 0.7 THEN 'DEFICIÊNCIA CRÍTICA'
          WHEN SUM(COALESCE(tca.valorPorKg * td.qtdGramasDia, 0)) < COALESCE(nrc.valorExigido, 0) THEN 'DEFICIÊNCIA'
          WHEN SUM(COALESCE(tca.valorPorKg * td.qtdGramasDia, 0)) <= COALESCE(nrc.valorExigido, 0) * 1.2 THEN 'ADEQUADO'
          WHEN SUM(COALESCE(tca.valorPorKg * td.qtdGramasDia, 0)) <= COALESCE(nrc.valorExigido, 0) * 2 THEN 'EXCESSO'
          ELSE 'EXCESSO ALTO'
        END AS \`status_nutricional\`
      FROM tb_nutrientes tn
      LEFT JOIN tb_composicao_alimento tca ON tca.nutrienteId = tn.id
      LEFT JOIN tb_dieta td ON td.alimentoId = tca.alimentoId AND td.animalId = ?
      LEFT JOIN tb_alimentos ta ON ta.id = td.alimentoId
      LEFT JOIN tb_exigencias_nrc nrc 
        ON nrc.nutrienteId = tn.id 
       AND nrc.peso = ?
       AND nrc.tipoExercicio = ?
      GROUP BY tn.id, tn.nome, nrc.valorExigido
      ORDER BY 
        CASE 
          WHEN \`status_nutricional\` = 'DEFICIÊNCIA CRÍTICA' THEN 1
          WHEN \`status_nutricional\` = 'DEFICIÊNCIA' THEN 2
          WHEN \`status_nutricional\` = 'ADEQUADO' THEN 3
          WHEN \`status_nutricional\` = 'EXCESSO' THEN 4
          ELSE 5
        END,
        \`Percentual_Atendido\` ASC;
    `;

    const resultado = await prisma.$queryRawUnsafe(sql, animalId, peso, tipoExercicio);
    return resultado;
  }
}

module.exports = { RelatorioNutricionalService };
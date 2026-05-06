const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class RelatorioNutricionalService {

  async gerarRelatorioParaLLM(animalId, peso = 500, tipoExercicio = 'Exercício Moderado') {
    
    // 1. Busca os alimentos da dieta do animal
    const alimentosRaw = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT COALESCE(ta.nome, 'Sem_Alimento') AS alimento_nome
      FROM tb_dieta td
      LEFT JOIN tb_alimentos ta ON ta.id = td.alimentoId
      WHERE td.animalId = ?
      ORDER BY alimento_nome
    `, animalId);

    const alimentos = alimentosRaw.map(r => r.alimento_nome);

    // 2. Gera as colunas do pivot → MELHORIA PRINCIPAL AQUI
    let pivotColumns = alimentos
      .map(nome => {
        const safeNome = nome.replace(/'/g, "''");
        
        // ✅ Mantém acentos (ç, ã, õ, ó, ú, etc.)
        const colName = nome
          .normalize('NFC')                    // Normaliza acentos
          .replace(/[^a-zA-Z0-9áéíóúãõçÁÉÍÓÚÃÕÇ\s-]/g, '')  // Permite caracteres portugueses
          .trim()
          .replace(/\s+/g, '_');

        return `ROUND(MAX(CASE WHEN ta.nome = '${safeNome}' THEN (tca.valorPorKg * td.qtdGramasDia) / 1000 ELSE 0 END), 4) AS \`${colName}\``;
      })
      .join(',\n            ');

    if (!pivotColumns) pivotColumns = 'NULL AS sem_alimentos';

    // 3. Query principal (mantida igual, só adicionei unidadePadrao no GROUP BY para segurança)
    const sql = `
      SELECT
        tn.nome AS nutriente,
        ${pivotColumns},
        ROUND(SUM(tca.valorPorKg * td.qtdGramasDia), 4) AS \`Total_Dieta\`,
        ROUND(COALESCE(nrc.valorExigido, 0), 4) AS \`Exigido_NRC\`,
        ROUND(SUM(tca.valorPorKg * td.qtdGramasDia) - COALESCE(nrc.valorExigido, 0), 4) AS \`Saldo\`,
        ROUND(
          SUM(tca.valorPorKg * td.qtdGramasDia) / NULLIF(COALESCE(nrc.valorExigido, 0), 0) * 100, 
        2) AS \`Percentual_Atendido\`,
        CASE
          WHEN SUM(tca.valorPorKg * td.qtdGramasDia) < COALESCE(nrc.valorExigido, 0) * 0.7 THEN 'DEFICIÊNCIA CRÍTICA'
          WHEN SUM(tca.valorPorKg * td.qtdGramasDia) < COALESCE(nrc.valorExigido, 0) THEN 'DEFICIÊNCIA'
          WHEN SUM(tca.valorPorKg * td.qtdGramasDia) <= COALESCE(nrc.valorExigido, 0) * 1.2 THEN 'ADEQUADO'
          WHEN SUM(tca.valorPorKg * td.qtdGramasDia) <= COALESCE(nrc.valorExigido, 0) * 2 THEN 'EXCESSO'
          ELSE 'EXCESSO ALTO'
        END AS \`status_nutricional\`
      FROM tb_dieta td
      JOIN tb_alimentos ta ON ta.id = td.alimentoId
      JOIN tb_composicao_alimento tca ON tca.alimentoId = ta.id
      JOIN tb_nutrientes tn ON tn.id = tca.nutrienteId
      LEFT JOIN tb_exigencias_nrc nrc 
        ON nrc.nutrienteId = tn.id 
       AND nrc.peso = ?
       AND nrc.tipoExercicio = ?
      WHERE td.animalId = ?
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

    const resultado = await prisma.$queryRawUnsafe(
      sql, 
      peso, tipoExercicio, animalId
    );

    return resultado;
  }
}

module.exports = { RelatorioNutricionalService };
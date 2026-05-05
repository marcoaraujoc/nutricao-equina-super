const fs = require('fs');
const csv = require('csv-parser');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "mysql://nutriadmin:Inicial_001@localhost:3306/nutricao"
    }
  }
});

async function importarComposicaoAlimento() {
  const results = [];
  const csvPath = 'backend/scripts/ComposicaoAlimentar.csv';

  console.log(`📂 Lendo arquivo: ${csvPath}`);

  fs.createReadStream(csvPath)
    .pipe(csv({ 
      separator: ',',           // ← Mudado para vírgula
      trim: true
    }))
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`✅ ${results.length} composições lidas.`);

      try {
        let imported = 0;
        let skipped = 0;

        for (const row of results) {
          const alimentoId = parseInt(row.alimento_id || row.alimentoId);
          const nutrienteId = parseInt(row.nutriente_id || row.nutrienteId);
          const valorPorKg = parseFloat(row.valor_por_grama || row.valorPorKg || row.valorPorKg);

          if (isNaN(alimentoId) || isNaN(nutrienteId) || isNaN(valorPorKg)) {
            console.warn('⚠️ Pulando linha inválida:', row);
            skipped++;
            continue;
          }

          await prisma.composicaoAlimento.upsert({
            where: {
              alimentoId_nutrienteId: {
                alimentoId: alimentoId,
                nutrienteId: nutrienteId
              }
            },
            update: {
              valorPorKg: valorPorKg,
              base: 'Seca',
            },
            create: {
              alimentoId: alimentoId,
              nutrienteId: nutrienteId,
              valorPorKg: valorPorKg,
              base: 'Seca',
            }
          });

          imported++;
        }

        console.log(`🎉 ${imported} composições importadas com sucesso!`);
        if (skipped > 0) console.log(`⚠️ ${skipped} linhas foram puladas.`);
      } catch (error) {
        console.error('❌ Erro durante importação:', error.message);
      } finally {
        await prisma.$disconnect();
      }
    });
}

importarComposicaoAlimento();

// backend/scripts/import-csv.js
const fs = require('fs');
const csv = require('csv-parser');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function importarComposicaoAlimentar() {
  const results = [];

  console.log('📥 Lendo CSV...');

  fs.createReadStream('tabelas - ComposicaoAlimentar.csv')
    .pipe(csv({ separator: ',' }))
    .on('data', (data) => {
      if (data.alimento_id && data.nutriente_id) {
        results.push(data);
      }
    })
    .on('end', async () => {
      console.log(`✅ ${results.length} registros lidos do CSV.`);

      let imported = 0;

      for (const row of results) {
        try {
          await prisma.ComposicaoAlimento.create({
            data: {
              alimentoId: parseInt(row.alimento_id),
              nutrienteId: parseInt(row.nutriente_id),
              valorPorKg: parseFloat(row.valor_por_grama),
              base: "Seca"
            }
          });
          imported++;
        } catch (err) {
          console.error(`Erro no registro alimento_id=${row.alimento_id} nutriente_id=${row.nutriente_id}:`, err.message);
        }
      }

      console.log(`\n✅ Importação finalizada! ${imported} registros inseridos com sucesso.`);
      await prisma.$disconnect();
    });
}

importarComposicaoAlimentar();
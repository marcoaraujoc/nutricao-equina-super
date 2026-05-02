const fs = require('fs');
const csv = require('csv-parser');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function importarComposicao() {
  const results = [];

  fs.createReadStream('ComposicaoAlimentar.csv')
    .pipe(csv({ separator: ',' }))
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`✅ ${results.length} linhas lidas do CSV.`);

      try {
        let imported = 0;
        let skipped = 0;

        for (const row of results) {
          const alimento = await prisma.Alimento.findFirst({
            where: { nome: row.alimento_id }
          });

          const nutriente = await prisma.Nutriente.findFirst({
            where: { nome: row.nutriente_id }
          });

          if (!alimento || !nutriente) {
            skipped++;
            console.log(`⏭️ Pulando: Alimento="${row.alimento_id}" | Nutriente="${row.nutriente_id}"`);
            continue;
          }

          await prisma.ComposicaoAlimento.upsert({
            where: {
              alimentoId_nutrienteId: {
                alimentoId: alimento.id,
                nutrienteId: nutriente.id
              }
            },
            update: {
              valorPorKg: parseFloat(row.valor_por_grama) * 1000   // converte por grama → por kg
            },
            create: {
              alimentoId: alimento.id,
              nutrienteId: nutriente.id,
              valorPorKg: parseFloat(row.valor_por_grama) * 1000,
              base: "Seca"
            }
          });

          imported++;
        }

        console.log(`✅ Importação finalizada!`);
        console.log(`   ✅ Inseridos/Atualizados: ${imported}`);
        console.log(`   ⏭️  Pulados: ${skipped}`);

      } catch (error) {
        console.error('❌ Erro durante a importação:', error.message);
      } finally {
        await prisma.$disconnect();
      }
    });
}

importarComposicao();
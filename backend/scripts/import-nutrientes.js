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

async function importarNutrientes() {
  const results = [];
  const csvPath = 'backend/scripts/Nutriente.csv';

  console.log(`📂 Lendo arquivo: ${csvPath}`);

  fs.createReadStream(csvPath)
    .pipe(csv({ 
      separator: ',', 
      trim: true 
    }))
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`✅ ${results.length} nutrientes lidos.`);

      try {
        let imported = 0;
        let skipped = 0;

        for (const row of results) {
          const nome = (row.nome || '').trim();
          const categoria = (row.categoria || '').trim();
          const unidadePadrao = (row.unidade || row.unidadePadrao || '').trim();

          if (!nome || !categoria) {
            console.warn('⚠️ Pulando linha sem nome ou categoria:', row);
            skipped++;
            continue;
          }

          await prisma.nutriente.create({
            data: {
              nome: nome,
              categoria: categoria,
              unidadePadrao: unidadePadrao,
            }
          });

          imported++;
        }

        console.log(`🎉 ${imported} nutrientes importados com sucesso!`);
        if (skipped > 0) console.log(`⚠️ ${skipped} linhas puladas.`);

      } catch (error) {
        console.error('❌ Erro durante importação:', error.message);
        if (error.meta) console.dir(error.meta);
      } finally {
        await prisma.$disconnect();
      }
    });
}

importarNutrientes();

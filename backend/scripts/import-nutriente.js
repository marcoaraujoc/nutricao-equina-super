// backend/scripts/import-nutriente.js
const fs = require('fs');
const csv = require('csv-parser');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function importarNutrientes() {
  const results = [];

  fs.createReadStream('Nutriente.csv')
    .pipe(csv({ separator: '\t' }))           // ← separador por TAB (como no seu CSV)
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`✅ ${results.length} nutrientes lidos.`);

      try {
        for (const row of results) {
          await prisma.Nutriente.upsert({
            where: { id: parseInt(row.id) },
            update: {
              nome: row.nome,
              categoria: row.categoria,
              unidadePadrao: row.unidade
            },
            create: {
              id: parseInt(row.id),
              nome: row.nome,
              categoria: row.categoria,
              unidadePadrao: row.unidade
            }
          });
        }
        console.log('✅ Nutrientes importados com sucesso!');
      } catch (error) {
        console.error('❌ Erro ao importar nutrientes:', error.message);
      } finally {
        await prisma.$disconnect();
      }
    });
}

importarNutrientes();
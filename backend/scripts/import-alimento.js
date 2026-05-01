// backend/scripts/import-alimento.js
const fs = require('fs');
const csv = require('csv-parser');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function importarAlimentos() {
  const results = [];

  fs.createReadStream('Alimento.csv')
    .pipe(csv({ separator: '\t' }))           // ← separador por TAB
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`✅ ${results.length} alimentos lidos.`);

      try {
        for (const row of results) {
          await prisma.Alimento.upsert({
            where: { id: parseInt(row.id) },
            update: {
              nome: row.nome,
              categoria: row.categoria,
              fabricante: row.fabricante || null,
              forma: null                     // campo existe no schema, mas não no CSV
            },
            create: {
              id: parseInt(row.id),
              nome: row.nome,
              categoria: row.categoria,
              fabricante: row.fabricante || null,
              forma: null
            }
          });
        }
        console.log('✅ Alimentos importados com sucesso!');
      } catch (error) {
        console.error('❌ Erro ao importar alimentos:', error.message);
      } finally {
        await prisma.$disconnect();
      }
    });
}

importarAlimentos();
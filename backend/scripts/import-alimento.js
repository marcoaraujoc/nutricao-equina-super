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

async function importarAlimentos() {
  const results = [];
  const csvPath = 'Alimento.csv';

  console.log(`📂 Lendo arquivo: ${csvPath}`);

  fs.createReadStream(csvPath)
    .pipe(csv({ separator: '\t' }))
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`✅ ${results.length} alimentos lidos.`);

      try {
        let imported = 0;

        for (const row of results) {
          const id = parseInt(row.id);
          if (isNaN(id)) continue;

          await prisma.alimento.upsert({
            where: { id },
            update: {
              nome: (row.nome || '').trim(),
              categoria: (row.categoria || '').trim(),
              fabricante: row.fabricante && row.fabricante.trim() !== 'NULL' ? row.fabricante.trim() : null,
              forma: null,
              ativo: true,
            },
            create: {
              id,
              nome: (row.nome || '').trim(),
              categoria: (row.categoria || '').trim(),
              fabricante: row.fabricante && row.fabricante.trim() !== 'NULL' ? row.fabricante.trim() : null,
              forma: null,
              ativo: true,
            }
          });
          imported++;
        }

        console.log(`🎉 ${imported} alimentos importados com sucesso!`);
      } catch (error) {
        console.error('❌ Erro:', error.message);
      } finally {
        await prisma.$disconnect();
      }
    });
}

importarAlimentos();

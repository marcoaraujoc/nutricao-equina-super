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

async function importarDieta() {
  const results = [];
  const csvPath = 'backend/scripts/Dieta.csv';

  console.log(`📂 Lendo arquivo: ${csvPath}`);

  fs.createReadStream(csvPath)
    .pipe(csv({ separator: ',', trim: true }))
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`✅ ${results.length} dietas lidas.`);

      try {
        let imported = 0;
        const usuarioId = 1;   // ← Alterado conforme solicitado

        for (const row of results) {
          const id = parseInt(row.id);
          const animalId = parseInt(row.animal_id);
          const alimentoId = parseInt(row.alimento_id);
          const qtdGramasDia = parseFloat(row.quantidade_gramas);

          if (isNaN(animalId) || isNaN(alimentoId) || isNaN(qtdGramasDia)) {
            console.warn('⚠️ Pulando linha inválida:', row);
            continue;
          }

          await prisma.dieta.upsert({
            where: { id: id },
            update: {
              animalId: animalId,
              alimentoId: alimentoId,
              qtdGramasDia: qtdGramasDia,
              periodicidade: 'Diário',
              unidade: 'g',
              criadopor: usuarioId,
              modificadopor: usuarioId,
            },
            create: {
              id: id,
              animalId: animalId,
              alimentoId: alimentoId,
              qtdGramasDia: qtdGramasDia,
              periodicidade: 'Diário',
              unidade: 'g',
              dataInicio: new Date(),
              criadopor: usuarioId,
              modificadopor: usuarioId,
            }
          });

          imported++;
        }

        console.log(`🎉 ${imported} dietas importadas com sucesso! (criadopor/modificadopor = 1)`);
      } catch (error) {
        console.error('❌ Erro durante importação:', error.message);
        if (error.meta) console.dir(error.meta);
      } finally {
        await prisma.$disconnect();
      }
    });
}

importarDieta();

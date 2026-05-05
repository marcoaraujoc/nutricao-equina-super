require('dotenv').config({ path: '../.env' });

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const csvPath = path.join(__dirname, 'Nutriente.csv');

async function importarNutrientes() {
  console.log('📂 Lendo Nutriente.csv...');

  const results = [];

  fs.createReadStream(csvPath)
    .pipe(csv({ separator: ',' }))
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`✅ ${results.length} registros lidos.`);

      let imported = 0;

      try {
        for (const row of results) {
          const nome = String(row.nome || '').trim();
          if (!nome) continue;

          const categoria = String(row.categoria || 'Geral').trim();
          const unidadePadrao = String(row.unidade || 'g').trim();

          // Busca por nome
          const existente = await prisma.nutriente.findFirst({
            where: { nome: nome }
          });

          if (existente) {
            await prisma.nutriente.update({
              where: { id: existente.id },
              data: { categoria, unidadePadrao }
            });
          } else {
            await prisma.nutriente.create({
              data: { nome, categoria, unidadePadrao }
            });
          }

          imported++;
        }

        console.log(`✅ Sucesso! ${imported} nutrientes importados/atualizados.`);
      } catch (error) {
        console.error('❌ Erro ao importar:', error.message);
      } finally {
        await prisma.$disconnect();
      }
    });
}

importarNutrientes();
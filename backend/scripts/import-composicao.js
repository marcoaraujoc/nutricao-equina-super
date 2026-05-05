require('dotenv').config({ path: '../.env' });

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const csvPath = path.join(__dirname, 'ComposicaoAlimentar.csv');
const logPath = path.join(__dirname, 'rejeitados_composicao.log');

async function importarComposicao() {
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Arquivo não encontrado: ${csvPath}`);
    process.exit(1);
  }

  console.log('📂 Lendo ComposicaoAlimentar.csv...');

  const results = [];
  const rejeitados = [];

  fs.createReadStream(csvPath)
    .pipe(csv({ separator: ',' }))
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`✅ ${results.length} registros lidos.`);

      let imported = 0;

      for (const [index, row] of results.entries()) {
        const linha = index + 2; // +2 por causa do cabeçalho
        const alimentoId = parseInt(row.alimento_id);
        const nutrienteId = parseInt(row.nutriente_id);
        const valorPorKg = parseFloat(row.valor_por_grama);

        if (isNaN(alimentoId) || isNaN(nutrienteId) || isNaN(valorPorKg)) {
          rejeitados.push(`Linha ${linha}: Dados inválidos - alimento_id=${row.alimento_id}, nutriente_id=${row.nutriente_id}`);
          continue;
        }

        try {
          await prisma.composicaoAlimento.upsert({
            where: {
              alimentoId_nutrienteId: {
                alimentoId: alimentoId,
                nutrienteId: nutrienteId
              }
            },
            update: {
              valorPorKg: valorPorKg,
              base: "Seca"
            },
            create: {
              alimentoId: alimentoId,
              nutrienteId: nutrienteId,
              valorPorKg: valorPorKg,
              base: "Seca"
            }
          });
          imported++;
        } catch (error) {
          rejeitados.push(`Linha ${linha}: FK violation - alimento_id=${alimentoId}, nutriente_id=${nutrienteId} | ${error.message}`);
        }
      }

      console.log(`✅ Importados: ${imported}`);
      console.log(`❌ Rejeitados: ${rejeitados.length}`);

      if (rejeitados.length > 0) {
        fs.writeFileSync(logPath, rejeitados.join('\n'));
        console.log(`📄 Log salvo em: ${logPath}`);
      } else {
        console.log('✅ Todos os registros foram importados com sucesso!');
      }

      await prisma.$disconnect();
    });
}

importarComposicao();
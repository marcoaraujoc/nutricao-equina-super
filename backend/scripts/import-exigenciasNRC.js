require('dotenv').config({ path: '../.env' });

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const csvPath = path.join(__dirname, 'Exigencias_NRC.csv');
const logPath = path.join(__dirname, 'rejeitados_exigencias_nrc.log');

async function importarExigenciasNRC() {
  try {
    if (!fs.existsSync(csvPath)) {
      console.error(`❌ Arquivo não encontrado: ${csvPath}`);
      process.exit(1);
    }

    console.log('🔄 Iniciando reset e importação de tb_exigencias_nrc...');

    // 1. Limpa a tabela e reseta AUTO_INCREMENT (MySQL)
    await prisma.$executeRawUnsafe('DELETE FROM tb_exigencias_nrc;');
    await prisma.$executeRawUnsafe('ALTER TABLE tb_exigencias_nrc AUTO_INCREMENT = 1;');

    console.log('✅ Tabela limpa e AUTO_INCREMENT resetado para 1');

    // 2. Lê o CSV com TAB como separador
    console.log('📂 Lendo Exigencias_NRC.csv...');

    const results = [];
    const rejeitados = [];

    fs.createReadStream(csvPath)
      .pipe(csv({ 
        separator: '\t',           // <<< CORREÇÃO PRINCIPAL
        trim: true 
      }))
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        console.log(`✅ ${results.length} registros lidos do CSV.`);

        let imported = 0;

        for (const [index, row] of results.entries()) {
          const linha = index + 2;

          const nutrienteId = parseInt(row.nutriente_id);
          const peso = parseFloat(row.peso);
          const tipoExercicio = (row.tipo_exercicio || '').trim();
          const valorExigido = parseFloat(row.valor_exigido);

          // Validação detalhada
          if (isNaN(nutrienteId) || isNaN(peso) || !tipoExercicio || isNaN(valorExigido)) {
            rejeitados.push(`Linha ${linha}: Dados inválidos | nutriente_id=${row.nutriente_id} | tipo=${tipoExercicio} | valor=${row.valor_exigido}`);
            continue;
          }

          try {
            await prisma.exigenciasNRC.upsert({
              where: {
                // Nome da constraint única gerada pelo Prisma
                nutrienteId_peso_tipoExercicio: {
                  nutrienteId: nutrienteId,
                  peso: peso,
                  tipoExercicio: tipoExercicio
                }
              },
              update: {
                valorExigido: valorExigido
              },
              create: {
                nutrienteId: nutrienteId,
                peso: peso,
                tipoExercicio: tipoExercicio,
                valorExigido: valorExigido
              }
            });
            imported++;
          } catch (error) {
            rejeitados.push(`Linha ${linha}: Erro (nutriente ${nutrienteId} - ${tipoExercicio}) | ${error.message}`);
          }
        }

        console.log(`✅ Importados com sucesso: ${imported}`);
        console.log(`❌ Rejeitados: ${rejeitados.length}`);

        if (rejeitados.length > 0) {
          fs.writeFileSync(logPath, rejeitados.join('\n'));
          console.log(`📄 Log salvo em: ${logPath}`);
        } else {
          console.log('🎉 Todos os registros importados com sucesso!');
        }

        const total = await prisma.exigenciasNRC.count();
        console.log(`📊 Total na tabela: ${total}`);

        await prisma.$disconnect();
      });

  } catch (error) {
    console.error('❌ Erro crítico:', error);
    await prisma.$disconnect();
  }
}

importarExigenciasNRC();
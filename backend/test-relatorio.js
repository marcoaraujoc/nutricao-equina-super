require('dotenv').config({ path: '.env' });

const { RelatorioNutricionalService } = require('./src/services/relatorioNutricional.service');

async function main() {
  const service = new RelatorioNutricionalService();
  const relatorio = await service.gerarRelatorioParaLLM(1);

  console.log('✅ Relatório gerado com', relatorio.length, 'nutrientes\n');
  console.dir(relatorio.slice(0, 8), { depth: 3 });   // mostra os primeiros 8
}

main().catch(console.error);
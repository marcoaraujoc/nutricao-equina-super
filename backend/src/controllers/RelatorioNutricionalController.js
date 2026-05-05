const relatorioService = require('../services/relatorioNutricionalService');

async function gerarRelatorio(req, res) {
  try {
    const { animalId } = req.params;
    const { peso = 500, tipoExercicio = 'Exercício Moderado' } = req.query;

    const result = await relatorioService.gerarAnaliseCompleta(animalId, peso, tipoExercicio);
    
    res.json({ 
      success: true, 
      ...result 
    });
  } catch (error) {
    console.error('❌ Erro ao gerar relatório:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}

module.exports = { gerarRelatorio };
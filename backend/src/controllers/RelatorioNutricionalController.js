const relatorioService = require('../services/relatorioNutricionalService');
const { responderErro } = require('../lib/erroResposta');

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
    // O erro vinha do cálculo nutricional e chegava cru à tela ("Cannot read
    // properties of undefined…"): diz tudo ao desenvolvedor e nada a quem espera o
    // relatório. O detalhe segue no log, com stack.
    responderErro(res, error, {
      contexto: 'RelatorioNutricionalController.gerarRelatorio',
      mensagem: 'Não foi possível gerar o relatório nutricional deste paciente.',
    });
  }
}

module.exports = { gerarRelatorio };
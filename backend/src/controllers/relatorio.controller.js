// backend/src/controllers/relatorio.controller.js
const { computarRelatorio } = require('../services/relatorioNutricional.service');
const { responderErro } = require('../lib/erroResposta');

const RelatorioController = {

  /**
   * GET /api/relatorio/animal/:animalId
   *
   * Busca o plano ativo do animal e computa o relatório nutricional
   * comparando a dieta com as exigências NRC cadastradas.
   *
   * Usa automaticamente o peso, categoriaAnimal e tipoExercicio
   * do próprio cadastro do animal — sem necessidade de query params.
   */
  gerarPorAnimal: async (req, res) => {
    const { animalId } = req.params;

    if (!animalId || isNaN(Number(animalId))) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'animalId inválido ou não informado',
      });
    }

    try {
      const dados = await computarRelatorio(animalId);
      res.json({ sucesso: true, dados });
    } catch (error) {
      console.error('Erro ao gerar relatório nutricional:', error);
      responderErro(res, error, {
        contexto: 'RelatorioController.gerarPorAnimal',
        mensagem: 'Não foi possível gerar o relatório nutricional deste paciente.',
      });
    }
  },

};

module.exports = RelatorioController;
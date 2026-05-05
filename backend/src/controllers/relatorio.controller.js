const { RelatorioNutricionalService } = require('../services/relatorioNutricional.service');

const service = new RelatorioNutricionalService();

class RelatorioController {

  async gerarRelatorio(req, res) {
    try {
      const { animalId } = req.params;
      const { peso = 500, tipoExercicio = 'Exercício Moderado' } = req.query;

      if (!animalId) {
        return res.status(400).json({ sucesso: false, mensagem: "animalId é obrigatório" });
      }

      const dados = await service.gerarRelatorioParaLLM(
        Number(animalId),
        Number(peso),
        tipoExercicio
      );

      res.json({
        sucesso: true,
        animalId: Number(animalId),
        dados: dados
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ 
        sucesso: false, 
        mensagem: "Erro ao gerar relatório" 
      });
    }
  }
}

module.exports = new RelatorioController();
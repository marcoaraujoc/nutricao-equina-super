const prisma = require('../lib/prisma').default;

class AnaliseController {
  async calcularBalanço(req, res) {
    const { animalId } = req.params;

    const dietas = await prisma.dieta.findMany({
      where: { animalId: parseInt(animalId) },
      include: { produto: { include: { composicoes: { include: { nutriente: true } } } } }
    });

    const ingestao = {};

    dietas.forEach(d => {
      d.produto.composicoes.forEach(c => {
        const nutriente = c.nutriente.nome;
        const quantidade = (d.qtdGramasDia / 1000) * c.valorPorKg; // converte para kg
        ingestao[nutriente] = (ingestao[nutriente] || 0) + quantidade;
      });
    });

    res.json({
      animalId: parseInt(animalId),
      ingestaoPorNutriente: ingestao,
      mensagem: "Cálculo de balanço nutricional (versão inicial)"
    });
  }
}
module.exports = new AnaliseController();

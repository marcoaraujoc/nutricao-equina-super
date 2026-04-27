const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class DietaController {
  async listar(req, res) {
    try {
      const dietas = await prisma.dieta.findMany({
        include: {
          animal: true,
          alimento: true
        },
        orderBy: { dataInicio: 'desc' }
      });
      res.json(dietas);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao listar dietas' });
    }
  }

  async obterPorId(req, res) {
    const { id } = req.params;
    try {
      const dieta = await prisma.dieta.findUnique({
        where: { id: Number(id) },
        include: { animal: true, alimento: true }
      });
      if (!dieta) return res.status(404).json({ error: 'Dieta não encontrada' });
      res.json(dieta);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar dieta' });
    }
  }

  async criar(req, res) {
    const { animalId, alimentoId, qtdGramasDia, dataInicio, dataFim, horario, observacao } = req.body;
    try {
      const dieta = await prisma.dieta.create({
        data: {
          animalId: Number(animalId),
          alimentoId: Number(alimentoId),
          qtdGramasDia: Number(qtdGramasDia),
          dataInicio: dataInicio ? new Date(dataInicio) : undefined,
          dataFim: dataFim ? new Date(dataFim) : undefined,
          horario,
          observacao
        }
      });
      res.status(201).json(dieta);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar dieta' });
    }
  }

  async atualizar(req, res) {
    const { id } = req.params;
    const { animalId, alimentoId, qtdGramasDia, dataInicio, dataFim, horario, observacao } = req.body;
    try {
      const dieta = await prisma.dieta.update({
        where: { id: Number(id) },
        data: {
          animalId: Number(animalId),
          alimentoId: Number(alimentoId),
          qtdGramasDia: Number(qtdGramasDia),
          dataInicio: dataInicio ? new Date(dataInicio) : undefined,
          dataFim: dataFim ? new Date(dataFim) : undefined,
          horario,
          observacao
        }
      });
      res.json(dieta);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar dieta' });
    }
  }

  async excluir(req, res) {
    const { id } = req.params;
    try {
      await prisma.dieta.delete({ where: { id: Number(id) } });
      res.json({ message: 'Dieta excluída com sucesso' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao excluir dieta' });
    }
  }
}

module.exports = new DietaController();
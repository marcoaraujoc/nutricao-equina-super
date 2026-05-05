const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class DietaController {
  async listarPorAnimal(req, res) {
    const { animalId } = req.params;
    try {
      const dietas = await prisma.dieta.findMany({
        where: { animalId: Number(animalId) },
        include: {
          alimento: true,
          animal: {
            include: {
              user: { select: { fullName: true, email: true } },
              raca: true,
              especie: true
            }
          }
        },
        orderBy: { dataCriacao: 'desc' }
      });
      res.json(dietas);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao listar dieta do animal' });
    }
  }

  async obterPorId(req, res) {
    const { id } = req.params;
    try {
      const dieta = await prisma.dieta.findUnique({
        where: { id: Number(id) },
        include: { alimento: true }
      });
      if (!dieta) return res.status(404).json({ error: 'Item da dieta não encontrado' });
      res.json(dieta);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar item da dieta' });
    }
  }

  async criarItem(req, res) {
    const { 
      animalId, 
      alimentoId, 
      qtdGramasDia, 
      unidade, 
      periodicidade, 
      observacao,
      criadopor,
      modificadopor
    } = req.body;

    const userId = Number(criadopor || modificadopor || req.user?.id || 1);

    try {
      const dieta = await prisma.dieta.create({
        data: {
          animalId: Number(animalId),
          alimentoId: Number(alimentoId),
          qtdGramasDia: parseFloat(qtdGramasDia) || 0,
          unidade: unidade || null,
          periodicidade: periodicidade || null,
          observacao: observacao || null,
          criadopor: userId,
          modificadopor: userId
        },
        include: { alimento: true }
      });

      res.status(201).json(dieta);
    } catch (error) {
      console.error('❌ Erro ao criar item da dieta:', error);
      res.status(500).json({ error: 'Erro ao salvar alimento na dieta' });
    }
  }

  async atualizarItem(req, res) {
    const { id } = req.params;
    const { qtdGramasDia, unidade, periodicidade, observacao } = req.body;
    const userId = Number(req.user?.id || req.body.modificadopor || 1);

    try {
      const dieta = await prisma.dieta.update({
        where: { id: Number(id) },
        data: {
          qtdGramasDia: parseFloat(qtdGramasDia) || 0,
          unidade: unidade || null,
          periodicidade: periodicidade || null,
          observacao: observacao || null,
          modificadopor: userId
        }
      });
      res.json(dieta);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar item da dieta' });
    }
  }

  async excluirItem(req, res) {
    const { id } = req.params;
    try {
      await prisma.dieta.delete({ where: { id: Number(id) } });
      res.json({ message: 'Item excluído com sucesso' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao excluir item' });
    }
  }
}

module.exports = new DietaController();
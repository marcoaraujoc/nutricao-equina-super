const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class DietaController {
  // LISTAR DIETAS DE UM ANIMAL ESPECÍFICO (nova tela)
    async listarPorAnimal(req, res) {
    const { animalId } = req.params;
    try {
      const dietas = await prisma.dieta.findMany({
        where: { animalId: Number(animalId) },
        include: {
          alimento: true,
          animal: {
            include: {
              user: { select: { fullName: true, email: true } } // nome + e-mail do proprietário
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

  // ADICIONAR / EDITAR ITEM (novo fluxo)
  async criarItem(req, res) {
    const { animalId, alimentoId, periodicidade, quantidadePorVez, dataInicio, dataFim, horario, observacao } = req.body;
    const userId = req.user?.id || req.body.userId; // middleware de auth ou body

    try {
      const dieta = await prisma.dieta.create({
        data: {
          animalId: Number(animalId),
          alimentoId: Number(alimentoId),
          periodicidade,
          quantidadePorVez,
          qtdGramasDia: 0, // conversão futura
          dataInicio: dataInicio ? new Date(dataInicio) : undefined,
          dataFim: dataFim ? new Date(dataFim) : undefined,
          horario,
          observacao,
          criadopor: Number(userId),
          modificadopor: Number(userId)
        },
        include: { alimento: true }
      });
      res.status(201).json(dieta);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar item da dieta' });
    }
  }

  async atualizarItem(req, res) {
    const { id } = req.params;
    const { periodicidade, quantidadePorVez, dataFim, horario, observacao } = req.body;
    const userId = req.user?.id || req.body.userId;

    try {
      const dieta = await prisma.dieta.update({
        where: { id: Number(id) },
        data: {
          periodicidade,
          quantidadePorVez,
          qtdGramasDia: 0,
          dataFim: dataFim ? new Date(dataFim) : undefined,
          horario,
          observacao,
          modificadopor: Number(userId)
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

  // Manter compatibilidade com rotas antigas (opcional)
  async listar(req, res) { /* ... mesmo código antigo ... */ }
  // ... (outros métodos antigos se necessário)
}

module.exports = new DietaController();
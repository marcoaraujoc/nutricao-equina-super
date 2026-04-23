const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class AlimentoController {
  async listar(req, res) {
    try {
      const alimentos = await prisma.alimento.findMany({
        where: { ativo: true },
        orderBy: { nome: 'asc' }
      });
      res.json(alimentos);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao listar alimentos' });
    }
  }

  async obterPorId(req, res) {
    const { id } = req.params;
    try {
      const alimento = await prisma.alimento.findUnique({
        where: { id: Number(id) }
      });
      if (!alimento) return res.status(404).json({ error: 'Alimento não encontrado' });
      res.json(alimento);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar alimento' });
    }
  }

  async criar(req, res) {
    const { nome, categoria, fabricante, forma } = req.body;

    try {
      const alimento = await prisma.alimento.create({
        data: {
          nome,
          categoria,
          fabricante,
          forma,
          ativo: true
        }
      });
      res.status(201).json(alimento);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar alimento' });
    }
  }

  async atualizar(req, res) {
    const { id } = req.params;
    const { nome, categoria, fabricante, forma, ativo } = req.body;

    try {
      const alimento = await prisma.alimento.update({
        where: { id: Number(id) },
        data: { nome, categoria, fabricante, forma, ativo }
      });
      res.json(alimento);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar alimento' });
    }
  }

  async excluir(req, res) {
    const { id } = req.params;
    try {
      await prisma.alimento.update({
        where: { id: Number(id) },
        data: { ativo: false }
      });
      res.json({ message: 'Alimento desativado com sucesso' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao excluir alimento' });
    }
  }
}

module.exports = new AlimentoController();
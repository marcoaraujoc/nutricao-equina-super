const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class NutrientesController {
  async listar(req, res) {
    try {
      const nutrientes = await prisma.nutriente.findMany({
        orderBy: { nome: 'asc' }
      });
      res.json(nutrientes);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao listar nutrientes' });
    }
  }

  async obterPorId(req, res) {
    const { id } = req.params;
    try {
      const nutriente = await prisma.nutriente.findUnique({
        where: { id: Number(id) }
      });
      if (!nutriente) return res.status(404).json({ error: 'Nutriente não encontrado' });
      res.json(nutriente);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar nutriente' });
    }
  }

  async criar(req, res) {
    const { nome, categoria, unidadePadrao } = req.body;
    try {
      const nutriente = await prisma.nutriente.create({
        data: {
          nome,
          categoria,
          unidadePadrao
        }
      });
      res.status(201).json(nutriente);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar nutriente' });
    }
  }

  async atualizar(req, res) {
    const { id } = req.params;
    const { nome, categoria, unidadePadrao } = req.body;
    try {
      const nutriente = await prisma.nutriente.update({
        where: { id: Number(id) },
        data: { nome, categoria, unidadePadrao }
      });
      res.json(nutriente);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar nutriente' });
    }
  }

  async excluir(req, res) {
    const { id } = req.params;
    try {
      await prisma.nutriente.delete({ where: { id: Number(id) } });
      res.json({ message: 'Nutriente excluído com sucesso' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao excluir nutriente' });
    }
  }
}

module.exports = new NutrientesController();
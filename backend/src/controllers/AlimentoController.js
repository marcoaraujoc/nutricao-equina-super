// src/controllers/AlimentoController.js

const prisma = require('../lib/prisma').default;

const AlimentoController = {

  listar: async (req, res) => {
    try {
      const { ativo, categoria } = req.query;

      const where = {};
      if (ativo !== undefined) where.ativo = ativo === 'true';
      if (categoria)          where.categoria = categoria;

      const alimentos = await prisma.alimento.findMany({
        where,
        orderBy: { nome: 'asc' },
      });

      res.json({ sucesso: true, dados: alimentos });
    } catch (error) {
      console.error('Erro ao listar alimentos:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar alimentos' });
    }
  },

  obterPorId: async (req, res) => {
    const { id } = req.params;
    try {
      const alimento = await prisma.alimento.findUnique({
        where: { id: Number(id) },
      });

      if (!alimento) {
        return res.status(404).json({ sucesso: false, mensagem: 'Alimento não encontrado' });
      }

      res.json({ sucesso: true, dados: alimento });
    } catch (error) {
      console.error('Erro ao buscar alimento:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar alimento' });
    }
  },

  criar: async (req, res) => {
    const { nome, categoria, fabricante, forma, unidade } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Nome do alimento é obrigatório' });
    }
    if (!categoria) {
      return res.status(400).json({ sucesso: false, mensagem: 'Categoria é obrigatória' });
    }

    try {
      const existente = await prisma.alimento.findFirst({
        where: { nome: nome.trim() },
      });

      if (existente) {
        return res.status(409).json({
          sucesso: false,
          mensagem: `O alimento "${nome.trim()}" já está cadastrado.`,
        });
      }

      const alimento = await prisma.alimento.create({
        data: {
          nome:       nome.trim(),
          categoria,
          fabricante: fabricante?.trim() || null,
          forma:      forma || null,
          unidade:    unidade || null,
          ativo:      true,
        },
      });

      res.status(201).json({ sucesso: true, dados: alimento });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({ sucesso: false, mensagem: 'Alimento já cadastrado.' });
      }
      console.error('Erro ao criar alimento:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar alimento' });
    }
  },

  atualizar: async (req, res) => {
    const { id } = req.params;
    const { nome, categoria, fabricante, forma, unidade, ativo } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Nome do alimento é obrigatório' });
    }

    try {
      const existe = await prisma.alimento.findUnique({ where: { id: Number(id) } });
      if (!existe) {
        return res.status(404).json({ sucesso: false, mensagem: 'Alimento não encontrado' });
      }

      const alimento = await prisma.alimento.update({
        where: { id: Number(id) },
        data: {
          nome:       nome.trim(),
          categoria,
          fabricante: fabricante?.trim() || null,
          forma:      forma || null,
          unidade:    unidade || null,
          ativo:      ativo !== undefined ? Boolean(ativo) : existe.ativo,
        },
      });

      res.json({ sucesso: true, dados: alimento });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({ sucesso: false, mensagem: 'Alimento não encontrado' });
      }
      console.error('Erro ao atualizar alimento:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar alimento' });
    }
  },

  excluir: async (req, res) => {
    const { id } = req.params;
    try {
      const existe = await prisma.alimento.findUnique({ where: { id: Number(id) } });
      if (!existe) {
        return res.status(404).json({ sucesso: false, mensagem: 'Alimento não encontrado' });
      }

      // Soft delete — mantém histórico em dietas e composições
      await prisma.alimento.update({
        where: { id: Number(id) },
        data:  { ativo: false },
      });

      res.json({ sucesso: true, mensagem: 'Alimento desativado com sucesso' });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({ sucesso: false, mensagem: 'Alimento não encontrado' });
      }
      console.error('Erro ao excluir alimento:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir alimento' });
    }
  },

};

module.exports = AlimentoController;
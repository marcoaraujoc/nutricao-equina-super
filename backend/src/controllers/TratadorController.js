// backend/src/controllers/TratadorController.js
'use strict';

const prisma = require('../lib/prisma').default;

const TratadorController = {

  // GET /api/tratadores/locais — lista locais de trabalho únicos cadastrados
  listarLocais: async (req, res) => {
    try {
      const where = {};
      if (req.empresaId) where.empresaId = req.empresaId;

      const tratadores = await prisma.tratador.findMany({
        where: { ...where, localTrabalho: { not: null } },
        select: { localTrabalho: true },
        distinct: ['localTrabalho'],
        orderBy: { localTrabalho: 'asc' },
      });
      const locais = tratadores.map(t => t.localTrabalho).filter(Boolean);
      res.json({ sucesso: true, dados: locais });
    } catch (err) {
      console.error('Erro ao listar locais:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar locais' });
    }
  },

  // GET /api/tratadores
  listar: async (req, res) => {
    try {
      const { busca, ativo } = req.query;
      const where = {};

      if (ativo === 'all') { /* sem filtro — retorna todos */ }
      else if (ativo !== undefined) where.ativo = ativo === 'true';
      else where.ativo = true;

      if (busca?.trim()) {
        where.OR = [
          { nome:          { contains: busca.trim(), mode: 'insensitive' } },
          { localTrabalho: { contains: busca.trim(), mode: 'insensitive' } },
        ];
      }

      // Filtra por empresa se o usuário pertencer a uma
      if (req.empresaId) where.empresaId = req.empresaId;

      const tratadores = await prisma.tratador.findMany({
        where,
        orderBy: { nome: 'asc' },
      });

      res.json({ sucesso: true, dados: tratadores });
    } catch (err) {
      console.error('Erro ao listar tratadores:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar tratadores' });
    }
  },

  // GET /api/tratadores/:id
  obterPorId: async (req, res) => {
    try {
      const tratador = await prisma.tratador.findUnique({ where: { id: Number(req.params.id) } });
      if (!tratador) return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });
      res.json({ sucesso: true, dados: tratador });
    } catch (err) {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar tratador' });
    }
  },

  // POST /api/tratadores
  criar: async (req, res) => {
    const { nome, telefone, localTrabalho } = req.body;
    if (!nome?.trim())         return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!telefone?.trim())     return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });
    if (!localTrabalho?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Local de trabalho é obrigatório' });

    try {
      const tratador = await prisma.tratador.create({
        data: {
          nome:          nome.trim(),
          telefone:      telefone?.trim()      || null,
          localTrabalho: localTrabalho?.trim() || null,
          empresaId:     req.empresaId         || null,
        },
      });
      res.status(201).json({ sucesso: true, dados: tratador });
    } catch (err) {
      console.error('Erro ao criar tratador:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar tratador' });
    }
  },

  // PUT /api/tratadores/:id
  atualizar: async (req, res) => {
    const { id } = req.params;
    const { nome, telefone, localTrabalho } = req.body;
    if (!nome?.trim())          return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!telefone?.trim())      return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });
    if (!localTrabalho?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Local de trabalho é obrigatório' });

    try {
      const existe = await prisma.tratador.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });

      const tratador = await prisma.tratador.update({
        where: { id: Number(id) },
        data: {
          nome:          nome.trim(),
          telefone:      telefone?.trim()      || null,
          localTrabalho: localTrabalho?.trim() || null,
        },
      });
      res.json({ sucesso: true, dados: tratador });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });
      console.error('Erro ao atualizar tratador:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar tratador' });
    }
  },

  // PATCH /api/tratadores/:id/toggle
  toggleAtivo: async (req, res) => {
    const { id } = req.params;
    try {
      const existe = await prisma.tratador.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });

      const tratador = await prisma.tratador.update({
        where: { id: Number(id) },
        data:  { ativo: !existe.ativo },
      });
      res.json({ sucesso: true, dados: tratador, mensagem: `Tratador ${tratador.ativo ? 'ativado' : 'inativado'}` });
    } catch (err) {
      console.error('Erro ao alternar status:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alternar status' });
    }
  },

  // DELETE /api/tratadores/:id  (soft delete)
  excluir: async (req, res) => {
    const { id } = req.params;
    try {
      const existe = await prisma.tratador.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });

      await prisma.tratador.update({ where: { id: Number(id) }, data: { ativo: false } });
      res.json({ sucesso: true, mensagem: 'Tratador excluído com sucesso' });
    } catch (err) {
      console.error('Erro ao excluir tratador:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir tratador' });
    }
  },
};

module.exports = TratadorController;

// backend/src/controllers/TratadorController.js
'use strict';

const prisma = require('../lib/prisma').default;

const TratadorController = {

  // GET /api/cadastro/tratadores?busca=X&ativo=true|false|all&localizacaoId=N
  listar: async (req, res) => {
    try {
      const { busca, ativo, localizacaoId } = req.query;
      const where = {};

      if (ativo === 'all') { /* sem filtro */ }
      else if (ativo !== undefined) where.ativo = ativo === 'true';
      else where.ativo = true;

      if (busca?.trim()) {
        where.OR = [
          { nome:     { contains: busca.trim(), mode: 'insensitive' } },
          { telefone: { contains: busca.trim(), mode: 'insensitive' } },
        ];
      }

      if (localizacaoId) {
        where.localizacaoId = Number(localizacaoId);
      }

      const tratadores = await prisma.tratador.findMany({
        where,
        include: {
          localizacao: { select: { id: true, nome: true, tipoLocalizacao: true } },
        },
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      });

      res.json({ sucesso: true, dados: tratadores });
    } catch (err) {
      console.error('Erro ao listar tratadores:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar tratadores' });
    }
  },

  // GET /api/cadastro/tratadores/:id
  obterPorId: async (req, res) => {
    try {
      const tratador = await prisma.tratador.findUnique({
        where: { id: Number(req.params.id) },
        include: {
          localizacao: { select: { id: true, nome: true, tipoLocalizacao: true } },
        },
      });
      if (!tratador) return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });
      res.json({ sucesso: true, dados: tratador });
    } catch (err) {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar tratador' });
    }
  },

  // POST /api/cadastro/tratadores
  // ADMIN cria com tipoEntrada=SYSTEM; demais criam com tipoEntrada=CLIENTE
  criar: async (req, res) => {
    const { nome, telefone, localizacaoId } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });

    const tipoEntrada = req.user?.role === 'ADMIN' ? 'SYSTEM' : 'CLIENTE';
    const locId = localizacaoId ? Number(localizacaoId) : null;

    try {
      const duplicado = await prisma.tratador.findFirst({
        where: {
          nome:          { equals: nome.trim(), mode: 'insensitive' },
          localizacaoId: locId,
        },
      });
      if (duplicado)
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe um tratador com esse nome neste local' });

      const tratador = await prisma.tratador.create({
        data: {
          nome:          nome.trim(),
          telefone:      telefone?.trim() || null,
          localizacaoId: locId,
          tipoEntrada,
        },
        include: {
          localizacao: { select: { id: true, nome: true, tipoLocalizacao: true } },
        },
      });
      res.status(201).json({ sucesso: true, dados: tratador });
    } catch (err) {
      if (err.code === 'P2002')
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe um tratador com esse nome neste local' });
      console.error('Erro ao criar tratador:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar tratador' });
    }
  },

  // PUT /api/cadastro/tratadores/:id — apenas ADMIN
  atualizar: async (req, res) => {
    if (req.user?.role !== 'ADMIN')
      return res.status(403).json({ sucesso: false, mensagem: 'Apenas ADMIN pode editar tratadores diretamente' });

    const { id } = req.params;
    const { nome, telefone, localizacaoId } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });

    const locId = localizacaoId !== undefined ? (localizacaoId ? Number(localizacaoId) : null) : undefined;

    try {
      const existe = await prisma.tratador.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });

      const locIdParaCheck = locId !== undefined ? locId : existe.localizacaoId;
      const duplicado = await prisma.tratador.findFirst({
        where: {
          nome:          { equals: nome.trim(), mode: 'insensitive' },
          localizacaoId: locIdParaCheck,
          id:            { not: Number(id) },
        },
      });
      if (duplicado)
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe um tratador com esse nome neste local' });

      const tratador = await prisma.tratador.update({
        where: { id: Number(id) },
        data: {
          nome:     nome.trim(),
          telefone: telefone?.trim() || null,
          ...(locId !== undefined && { localizacaoId: locId }),
        },
        include: {
          localizacao: { select: { id: true, nome: true, tipoLocalizacao: true } },
        },
      });
      res.json({ sucesso: true, dados: tratador });
    } catch (err) {
      if (err.code === 'P2002')
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe um tratador com esse nome neste local' });
      if (err.code === 'P2025')
        return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });
      console.error('Erro ao atualizar tratador:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar tratador' });
    }
  },

  // PATCH /api/cadastro/tratadores/:id/toggle — apenas ADMIN
  toggleAtivo: async (req, res) => {
    if (req.user?.role !== 'ADMIN')
      return res.status(403).json({ sucesso: false, mensagem: 'Apenas ADMIN pode ativar/inativar tratadores' });

    const { id } = req.params;
    try {
      const existe = await prisma.tratador.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });

      const tratador = await prisma.tratador.update({
        where: { id: Number(id) },
        data:  { ativo: !existe.ativo },
      });
      res.json({
        sucesso:  true,
        dados:    tratador,
        mensagem: `Tratador ${tratador.ativo ? 'ativado' : 'inativado'} com sucesso`,
      });
    } catch (err) {
      console.error('Erro ao alternar status do tratador:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alternar status' });
    }
  },
};

module.exports = TratadorController;

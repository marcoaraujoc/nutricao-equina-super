// backend/src/controllers/PermissaoController.js
'use strict';

const PermissaoService = require('../services/PermissaoService');
const prisma = require('../lib/prisma').default;

const PermissaoController = {

  async getPermissoesMembro(req, res) {
    try {
      const equipeId = Number(req.params.equipeId);
      const userId   = Number(req.params.membroUserId);
      const dados    = await PermissaoService.getPermissoesMembro({ equipeId, userId });
      return res.json({ sucesso: true, dados });
    } catch (err) {
      console.error('[PermissaoController.getPermissoesMembro]', err);
      return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
  },

  async atualizarPermissoes(req, res) {
    try {
      const equipeId      = Number(req.params.equipeId);
      const alvoUserId    = Number(req.params.membroUserId);
      const { alteracoes } = req.body;

      if (!alteracoes || typeof alteracoes !== 'object') {
        return res.status(400).json({ sucesso: false, mensagem: 'Campo "alteracoes" é obrigatório.' });
      }

      const resultado = await PermissaoService.atualizarPermissoes({
        equipeId,
        alvoUserId,
        alteracoes,
        atualizadoPorId:   req.user.id,
        atualizadoPorNome: req.user.fullName ?? req.user.email,
        ipOrigem:          req.ip,
      });

      return res.json({ sucesso: true, ...resultado });
    } catch (err) {
      console.error('[PermissaoController.atualizarPermissoes]', err);
      const status = err.message.includes('não pode conceder') ? 403 : 500;
      return res.status(status).json({ sucesso: false, mensagem: err.message });
    }
  },

  async getPermissoesProprietarios(req, res) {
    try {
      const equipeId = Number(req.params.equipeId);
      const dados    = await PermissaoService.getPermissoesProprietarios({ equipeId });
      return res.json({ sucesso: true, dados });
    } catch (err) {
      console.error('[PermissaoController.getPermissoesProprietarios]', err);
      return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
  },

  async atualizarPermissoesProprietario(req, res) {
    try {
      const equipeId    = Number(req.params.equipeId);
      const alvoUserId  = Number(req.params.alvoUserId);
      const { funcionalidades } = req.body;

      if (!funcionalidades || typeof funcionalidades !== 'object') {
        return res.status(400).json({ sucesso: false, mensagem: 'Campo "funcionalidades" é obrigatório.' });
      }

      const resultado = await PermissaoService.atualizarPermissoesProprietario({
        equipeId,
        alvoUserId,
        funcionalidades,
        atualizadoPor: req.user.id,
        ipOrigem:      req.ip,
      });

      return res.json({ sucesso: true, ...resultado });
    } catch (err) {
      console.error('[PermissaoController.atualizarPermissoesProprietario]', err);
      return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
  },

  async getPerfisByEquipe(req, res) {
    try {
      const equipeId = Number(req.params.equipeId);
      const dados    = await PermissaoService.getPerfisByEquipe({ equipeId });
      return res.json({ sucesso: true, dados });
    } catch (err) {
      console.error('[PermissaoController.getPerfisByEquipe]', err);
      return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
  },

  async getMatrizPorCargo(req, res) {
    try {
      const equipeId = Number(req.params.equipeId);
      const { cargo } = req.params;
      const dados    = await PermissaoService.getMatrizPorCargo({ equipeId, cargo });
      return res.json({ sucesso: true, dados });
    } catch (err) {
      console.error('[PermissaoController.getMatrizPorCargo]', err);
      return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
  },

  async salvarMatrizPorCargo(req, res) {
    try {
      const equipeId         = Number(req.params.equipeId);
      const { cargo }        = req.params;
      const { permissoes }   = req.body;

      if (!permissoes || typeof permissoes !== 'object') {
        return res.status(400).json({ sucesso: false, mensagem: 'Campo "permissoes" é obrigatório.' });
      }

      const resultado = await PermissaoService.salvarMatrizPorCargo({
        equipeId,
        cargo,
        permissoes,
        atualizadoPorId:   req.user.id,
        atualizadoPorNome: req.user.fullName ?? req.user.email,
        ipOrigem:          req.ip,
      });
      return res.json({ sucesso: true, ...resultado });
    } catch (err) {
      console.error('[PermissaoController.salvarMatrizPorCargo]', err);
      return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
  },

  async criarPerfil(req, res) {
    try {
      const equipeId           = Number(req.params.equipeId);
      const { slug, label, descricao } = req.body;

      if (!slug?.trim() || !label?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'slug e label são obrigatórios.' });
      }

      // Garante que o usuário pertence à equipe (ADMIN tem acesso irrestrito)
      if (req.user.role !== 'ADMIN') {
        const membro = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
        });
        if (!membro) {
          return res.status(403).json({ sucesso: false, mensagem: 'Você não pertence a esta equipe.' });
        }
      }

      const perfil = await PermissaoService.criarPerfil({ equipeId, slug, label, descricao });
      return res.status(201).json({ sucesso: true, dados: perfil });
    } catch (err) {
      console.error('[PermissaoController.criarPerfil]', err);
      const status = err.message.includes('não podem ser removidos') || err.message.includes('Unique') ? 409 : 500;
      return res.status(status).json({ sucesso: false, mensagem: err.message });
    }
  },

  async deletarPerfil(req, res) {
    try {
      const equipeId = Number(req.params.equipeId);
      const { cargo } = req.params;

      await PermissaoService.deletarPerfil({ equipeId, slug: cargo });
      return res.json({ sucesso: true });
    } catch (err) {
      console.error('[PermissaoController.deletarPerfil]', err);
      const status = err.message.includes('não podem ser removidos') ? 403 : 500;
      return res.status(status).json({ sucesso: false, mensagem: err.message });
    }
  },

  async getAuditoria(req, res) {
    try {
      const equipeId = Number(req.params.equipeId);
      const page     = Number(req.query.page)  || 1;
      const limit    = Number(req.query.limit) || 30;
      const dados    = await PermissaoService.getAuditoriaPermissoes({ equipeId, page, limit });
      return res.json({ sucesso: true, ...dados });
    } catch (err) {
      console.error('[PermissaoController.getAuditoria]', err);
      return res.status(500).json({ sucesso: false, mensagem: err.message });
    }
  },
};

module.exports = PermissaoController;
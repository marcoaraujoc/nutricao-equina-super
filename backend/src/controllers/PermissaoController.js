// backend/src/controllers/PermissaoController.js
'use strict';

const PermissaoService = require('../services/PermissaoService');

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
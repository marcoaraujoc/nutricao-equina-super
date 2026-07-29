// backend/src/controllers/SegurancaController.js
// Configuração global de segurança da plataforma — ADMIN.
// Hoje expõe só a chave mestra do 2FA por e-mail; é o ponto de entrada para
// futuras políticas globais (expiração de senha, IP allowlist, etc.).
'use strict';

const { obterConfigSeguranca, salvarConfigSeguranca } = require('../services/mfaService');
const { registrarAuditoria } = require('../lib/auditoria');

const SegurancaController = {

  // GET /api/seguranca/config
  obter: async (req, res) => {
    try {
      res.json({ sucesso: true, dados: await obterConfigSeguranca() });
    } catch (err) {
      console.error('SegurancaController.obter:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao carregar a configuração de segurança' });
    }
  },

  // PUT /api/seguranca/config  { mfaEmailAtivo: boolean }
  salvar: async (req, res) => {
    try {
      const { mfaEmailAtivo } = req.body ?? {};
      if (typeof mfaEmailAtivo !== 'boolean') {
        return res.status(400).json({ sucesso: false, mensagem: 'mfaEmailAtivo deve ser true ou false' });
      }

      const anterior = await obterConfigSeguranca();
      const dados    = await salvarConfigSeguranca({ mfaEmailAtivo, atualizadoPorId: req.user.id });

      // Ligar/desligar o segundo fator de TODA a plataforma é ação sensível —
      // fica registrada com quem fez, quando e de qual IP.
      if (anterior.mfaEmailAtivo !== dados.mfaEmailAtivo) {
        await registrarAuditoria(null, req, {
          categoria: 'CONFIGURACAO',
          entidade:  'CONFIGURACAO_SEGURANCA',
          entidadeId: 1,
          motivo:    `2FA por e-mail ${dados.mfaEmailAtivo ? 'ATIVADO' : 'DESATIVADO'} para toda a plataforma`,
          detalhes:  JSON.stringify({ de: anterior.mfaEmailAtivo, para: dados.mfaEmailAtivo }),
        }).catch(() => { /* auditoria nunca bloqueia a operação */ });
      }

      res.json({ sucesso: true, dados });
    } catch (err) {
      console.error('SegurancaController.salvar:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao salvar a configuração de segurança' });
    }
  },
};

module.exports = SegurancaController;

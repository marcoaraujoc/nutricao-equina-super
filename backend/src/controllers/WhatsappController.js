// backend/src/controllers/WhatsappController.js
// Gestão da conexão WhatsApp (Evolution API) pela tela de Configurações.
// Somente GESTOR/dono do contexto ativo (mesmo escopo da EmpresaConfiguracao).
// NUNCA expõe ao frontend: API key, nome da instância, URL da Evolution —
// as respostas contêm apenas status e QR Code.
'use strict';

const whatsappService  = require('../services/whatsappService');
const EvolutionService = require('../services/EvolutionService');
const { resolverEscopoConfiguracao } = require('./EquipeController');

async function escopoOu403(req, res) {
  const escopo = await resolverEscopoConfiguracao(req);
  if (!escopo) {
    res.status(403).json({ sucesso: false, mensagem: 'Somente o gestor da empresa gerencia o WhatsApp.' });
    return null;
  }
  return escopo;
}

function tratarErro(res, err, acao) {
  if (err?.code === 'EVOLUTION_NAO_CONFIGURADA') {
    return res.status(503).json({ sucesso: false, mensagem: 'Integração de WhatsApp não configurada no servidor.', code: err.code });
  }
  console.error(`WhatsappController.${acao}:`, err.message);
  return res.status(502).json({ sucesso: false, mensagem: 'Falha ao comunicar com o serviço de WhatsApp.', code: err?.code ?? 'ERRO' });
}

const WhatsappController = {

  // GET /api/equipes/whatsapp/status
  status: async (req, res) => {
    try {
      const escopo = await escopoOu403(req, res);
      if (!escopo) return;
      const dados = await whatsappService.obterStatus(escopo.empresaId, escopo.equipeId);
      res.json({ sucesso: true, dados: { ...dados, disponivel: EvolutionService.configurado() } });
    } catch (err) { tratarErro(res, err, 'status'); }
  },

  // POST /api/equipes/whatsapp/conectar → { status, qrcodeBase64, pairingCode }
  conectar: async (req, res) => {
    try {
      const escopo = await escopoOu403(req, res);
      if (!escopo) return;
      const dados = await whatsappService.conectar(escopo.empresaId, escopo.equipeId);
      res.json({ sucesso: true, dados });
    } catch (err) { tratarErro(res, err, 'conectar'); }
  },

  // POST /api/equipes/whatsapp/reconectar → restart + novo QR/estado
  reconectar: async (req, res) => {
    try {
      const escopo = await escopoOu403(req, res);
      if (!escopo) return;
      const dados = await whatsappService.reconectar(escopo.empresaId, escopo.equipeId);
      res.json({ sucesso: true, dados });
    } catch (err) { tratarErro(res, err, 'reconectar'); }
  },

  // POST /api/equipes/whatsapp/desconectar
  desconectar: async (req, res) => {
    try {
      const escopo = await escopoOu403(req, res);
      if (!escopo) return;
      const dados = await whatsappService.desconectar(escopo.empresaId, escopo.equipeId);
      res.json({ sucesso: true, dados });
    } catch (err) { tratarErro(res, err, 'desconectar'); }
  },
};

module.exports = WhatsappController;

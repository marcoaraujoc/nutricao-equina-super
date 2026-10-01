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

/**
 * Frase para quem está na frente da tela quando o serviço NÃO está pronto. Cada
 * motivo pede uma ação diferente — "ative o serviço" não serve para o servidor fora
 * do ar, onde não há o que o gestor ative.
 */
const MENSAGEM_PRONTIDAO = {
  NAO_PROVISIONADO:      'O serviço de WhatsApp da clínica não está ativo. É necessário ativá-lo em Configurações › WhatsApp.',
  DESCONECTADO:          'O serviço de WhatsApp da clínica está desativado (desconectado). É necessário ativá-lo lendo o QR Code em Configurações › WhatsApp.',
  AGUARDANDO_QR:         'O serviço de WhatsApp da clínica ainda não foi ativado: falta ler o QR Code em Configurações › WhatsApp.',
  SERVIDOR_INDISPONIVEL: 'O serviço de WhatsApp não está respondendo no momento. Tente novamente em instantes.',
  SEM_EMPRESA:           'Não há empresa no contexto ativo para enviar pelo WhatsApp.',
};

const WhatsappController = {

  // GET /api/equipes/whatsapp/prontidao — "posso mandar um WhatsApp agora?"
  // 🔴 (2026-09-30) Consultado pelo front ANTES de todo envio: serviço inativo NÃO
  // gera PDF nem cai no plano B — a tela informa que é preciso ativar o serviço.
  // ⚠️ Qualquer membro (quem envia é a enfermeira, a secretária…), e por isso a
  // resposta é só o veredito: nada de instância, URL, telefone da clínica ou QR.
  // ⚠️ MULTI-TENANT: a empresa é SEMPRE a do contexto autenticado (`req.empresaId`,
  // carimbada no RLS pelo `authenticate`) — nunca um id vindo do cliente.
  prontidao: async (req, res) => {
    const responder = (pronto, motivo, podeAtivar = false) => res.json({
      sucesso: true,
      dados: {
        pronto,
        motivo: pronto ? null : motivo,
        mensagem: pronto ? null : (MENSAGEM_PRONTIDAO[motivo] ?? MENSAGEM_PRONTIDAO.SERVIDOR_INDISPONIVEL),
        podeAtivar,
      },
    });
    try {
      if (!req.empresaId) return responder(false, 'SEM_EMPRESA');
      const { getWhatsAppProvider } = require('../messaging/whatsappProvider');
      const r = await getWhatsAppProvider().prontidaoParaEnviar({
        empresaId: Number(req.empresaId), equipeId: req.equipeId ? Number(req.equipeId) : null,
      });
      if (r.pronto) return responder(true, null);
      // Quem pode ATIVAR é o gestor/dono (mesmo gate de /whatsapp/conectar) — a tela
      // diz "ative em Configurações" para ele e "peça ao gestor" para os demais.
      const podeAtivar = !!(await resolverEscopoConfiguracao(req).catch(() => null));
      return responder(false, r.motivo ?? 'SERVIDOR_INDISPONIVEL', podeAtivar);
    } catch (err) {
      console.error('WhatsappController.prontidao:', err.message);
      return responder(false, 'SERVIDOR_INDISPONIVEL');
    }
  },

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

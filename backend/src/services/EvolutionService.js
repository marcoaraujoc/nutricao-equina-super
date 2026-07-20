// backend/src/services/EvolutionService.js
// ÚNICA camada que conversa com a Evolution API (HTTP). Nenhum outro módulo
// pode usar axios contra a Evolution — o restante da aplicação fala com o
// WhatsappService, que delega para cá. (Mesmo princípio do StorageProvider
// e do AIProvider: integração externa isolada atrás de um serviço.)
//
// Configuração 100% por variáveis de ambiente (nunca hardcoded):
//   EVOLUTION_URL            — base URL do servidor Evolution (ex: https://evo.minhaclinica.com)
//   EVOLUTION_API_KEY        — apikey global do servidor Evolution
//   EVOLUTION_TIMEOUT_MS     — timeout por chamada (default 15000)
//   EVOLUTION_WEBHOOK_TOKEN  — token do webhook (validado em /api/webhooks/evolution)
//   APP_URL                  — usado para montar a URL pública do webhook
//
// Erros: timeout + retry (2 tentativas com backoff) para falhas de rede/5xx;
// erro padronizado EvolutionError com `code` estável para os callers.
'use strict';

const axios  = require('axios');
const logger = require('../lib/logger');

class EvolutionError extends Error {
  constructor(mensagem, code = 'EVOLUTION_ERROR', detalhes = null) {
    super(mensagem);
    this.name     = 'EvolutionError';
    this.code     = code;
    this.detalhes = detalhes;
  }
}

const TIMEOUT_MS = Number(process.env.EVOLUTION_TIMEOUT_MS || 15000);

function configurado() {
  return Boolean(process.env.EVOLUTION_URL && process.env.EVOLUTION_API_KEY);
}

let _http = null;
function http() {
  if (!configurado()) {
    throw new EvolutionError('Evolution API não configurada (defina EVOLUTION_URL e EVOLUTION_API_KEY).', 'EVOLUTION_NAO_CONFIGURADA');
  }
  if (!_http) {
    _http = axios.create({
      baseURL: process.env.EVOLUTION_URL.replace(/\/+$/, ''),
      timeout: TIMEOUT_MS,
      headers: { apikey: process.env.EVOLUTION_API_KEY },
    });
  }
  return _http;
}

// Retry: 2 tentativas extras para erro de rede/timeout/5xx (4xx não re-tenta).
async function chamar(metodo, url, body = undefined, tentativa = 1) {
  const MAX = 3;
  try {
    const res = await http().request({ method: metodo, url, data: body });
    return res.data;
  } catch (err) {
    const status    = err.response?.status;
    const transiente = !status || status >= 500;
    if (transiente && tentativa < MAX) {
      const espera = 500 * tentativa;
      logger.warn(`[Evolution] ${metodo.toUpperCase()} ${url} falhou (${status ?? err.code}) — retry ${tentativa}/${MAX - 1} em ${espera}ms`);
      await new Promise(r => setTimeout(r, espera));
      return chamar(metodo, url, body, tentativa + 1);
    }
    const detalhe = err.response?.data ?? err.message;
    logger.error(`[Evolution] ${metodo.toUpperCase()} ${url} falhou definitivamente: ${JSON.stringify(detalhe).slice(0, 400)}`);
    throw new EvolutionError(
      `Falha na Evolution API (${status ?? err.code ?? 'rede'})`,
      status === 404 ? 'INSTANCIA_NAO_ENCONTRADA' : 'EVOLUTION_INDISPONIVEL',
      detalhe,
    );
  }
}

// URL pública do webhook desta aplicação (registrada na instância ao criar)
function webhookUrl() {
  const base  = (process.env.APP_URL || '').replace(/\/+$/, '');
  const token = process.env.EVOLUTION_WEBHOOK_TOKEN || '';
  if (!base) return null;
  return `${base}/api/webhooks/evolution${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

const EVENTOS_WEBHOOK = ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'LOGOUT_INSTANCE', 'APPLICATION_STARTUP'];

const EvolutionService = {
  configurado,
  EvolutionError,

  /**
   * Cria a instância exclusiva da clínica. `numero` = telefone principal já
   * cadastrado na clínica (EmpresaConfiguracao.whatsapp) — reutilizado, nunca
   * pedido de novo. Registra o webhook da aplicação na própria criação.
   */
  async createInstance(instanceName, { numero = null } = {}) {
    const wh = webhookUrl();
    const dados = await chamar('post', '/instance/create', {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      ...(numero ? { number: numero } : {}),
      ...(wh ? { webhook: { url: wh, byEvents: false, base64: true, events: EVENTOS_WEBHOOK } } : {}),
    });
    logger.info(`[Evolution] Instância criada: ${instanceName}`);
    return dados;
  },

  async deleteInstance(instanceName) {
    const dados = await chamar('delete', `/instance/delete/${encodeURIComponent(instanceName)}`);
    logger.info(`[Evolution] Instância removida: ${instanceName}`);
    return dados;
  },

  /** Inicia a conexão — retorna QR Code (base64/code) quando ainda não pareado. */
  async connect(instanceName) {
    const dados = await chamar('get', `/instance/connect/${encodeURIComponent(instanceName)}`);
    logger.info(`[Evolution] QR gerado / conexão iniciada: ${instanceName}`);
    return dados;
  },

  /** Desconecta a sessão do WhatsApp (logout) mantendo a instância. */
  async disconnect(instanceName) {
    return this.logout(instanceName);
  },

  async logout(instanceName) {
    const dados = await chamar('delete', `/instance/logout/${encodeURIComponent(instanceName)}`);
    logger.info(`[Evolution] Logout da instância: ${instanceName}`);
    return dados;
  },

  async restart(instanceName) {
    const dados = await chamar('post', `/instance/restart/${encodeURIComponent(instanceName)}`);
    logger.info(`[Evolution] Restart da instância: ${instanceName}`);
    return dados;
  },

  /** Estado da conexão: { instance: { state: 'open' | 'connecting' | 'close' } } */
  async getStatus(instanceName) {
    return chamar('get', `/instance/connectionState/${encodeURIComponent(instanceName)}`);
  },

  /** QR Code atual (mesmo endpoint do connect — Evolution regenera se preciso). */
  async getQRCode(instanceName) {
    return this.connect(instanceName);
  },

  async sendText(instanceName, numero, texto) {
    return chamar('post', `/message/sendText/${encodeURIComponent(instanceName)}`, {
      number: numero,
      text:   texto,
    });
  },

  async sendImage(instanceName, numero, urlOuBase64, legenda = '') {
    return chamar('post', `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      number: numero, mediatype: 'image', media: urlOuBase64, caption: legenda,
    });
  },

  async sendDocument(instanceName, numero, urlOuBase64, nomeArquivo, legenda = '') {
    return chamar('post', `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      number: numero, mediatype: 'document', media: urlOuBase64, fileName: nomeArquivo, caption: legenda,
    });
  },

  async sendAudio(instanceName, numero, urlOuBase64) {
    return chamar('post', `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, {
      number: numero, audio: urlOuBase64,
    });
  },

  async sendVideo(instanceName, numero, urlOuBase64, legenda = '') {
    return chamar('post', `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      number: numero, mediatype: 'video', media: urlOuBase64, caption: legenda,
    });
  },

  /** Perfil do número conectado na instância. */
  async getProfile(instanceName, numero = null) {
    return chamar('post', `/chat/fetchProfile/${encodeURIComponent(instanceName)}`, {
      ...(numero ? { number: numero } : {}),
    });
  },
};

module.exports = EvolutionService;

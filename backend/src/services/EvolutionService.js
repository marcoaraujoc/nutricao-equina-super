// backend/src/services/EvolutionService.js
// ÚNICA camada que conversa com a Evolution API (HTTP). Nenhum outro módulo
// pode usar axios contra a Evolution — o restante da aplicação fala com o
// WhatsappService, que delega para cá. (Mesmo princípio do StorageProvider
// e do AIProvider: integração externa isolada atrás de um serviço.)
//
// Configuração 100% por variáveis de ambiente (nunca hardcoded):
//   EVOLUTION_URL            — base URL do servidor Evolution (ex: https://evo.minhaclinica.com)
//   EVOLUTION_API_KEY        — apikey global do servidor Evolution
//   EVOLUTION_TIMEOUT_MS     — timeout por chamada de CONSULTA (default 15000)
//   EVOLUTION_SEND_TIMEOUT_MS — timeout das rotas /message/* (default 45000)
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

// ⚠️ ENVIO PRECISA DE TETO PRÓPRIO, e bem maior que o das consultas.
// `/message/sendMedia` NÃO devolve assim que o WhatsApp aceita a mídia: a Evolution
// ainda grava a mensagem no banco dela e, quando o webhook da instância está com
// `base64: true`, BAIXA a mídia de volta dos servidores do WhatsApp antes de
// responder (whatsapp.baileys.service.ts → `downloadMediaMessage`). Com o teto de
// 15s das consultas, um PDF de prescrição estourava o timeout com o envio JÁ FEITO —
// e o front caía no fallback manual (baixa o PDF e abre o wa.me com o texto), que é
// exatamente o sintoma "manda como texto, não como anexo".
const SEND_TIMEOUT_MS = Number(process.env.EVOLUTION_SEND_TIMEOUT_MS || 45000);

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
//
// ⚠️ `opts.repetir: false` para toda rota de ENVIO. Repetir um POST que ESTOUROU O
// TIMEOUT não é seguro: o timeout é do NOSSO lado, então a mensagem pode ter saído
// (e sai, no caso da mídia — ver SEND_TIMEOUT_MS) e a retentativa entrega o mesmo
// PDF de novo ao cliente. Consulta é idempotente e continua repetindo.
async function chamar(metodo, url, body = undefined, tentativa = 1, opts = {}) {
  const { repetir = true, timeout } = opts;
  const MAX = 3;
  try {
    const res = await http().request({ method: metodo, url, data: body, ...(timeout ? { timeout } : {}) });
    return res.data;
  } catch (err) {
    const status    = err.response?.status;
    const transiente = repetir && (!status || status >= 500);
    if (transiente && tentativa < MAX) {
      const espera = 500 * tentativa;
      logger.warn(`[Evolution] ${metodo.toUpperCase()} ${url} falhou (${status ?? err.code}) — retry ${tentativa}/${MAX - 1} em ${espera}ms`);
      await new Promise(r => setTimeout(r, espera));
      return chamar(metodo, url, body, tentativa + 1, opts);
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

/** Rota de ENVIO: teto próprio e SEM retry (ver `chamar`). */
const enviar = (url, body) => chamar('post', url, body, 1, { repetir: false, timeout: SEND_TIMEOUT_MS });

// URL pública do webhook desta aplicação (registrada na instância ao criar)
function webhookUrl() {
  const base  = (process.env.APP_URL || '').replace(/\/+$/, '');
  const token = process.env.EVOLUTION_WEBHOOK_TOKEN || '';
  if (!base) return null;
  return `${base}/api/webhooks/evolution${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

const EVENTOS_WEBHOOK = ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'LOGOUT_INSTANCE', 'APPLICATION_STARTUP'];

// 🔴 `base64: false` — NUNCA ligar. Com `true`, a Evolution embute o arquivo INTEIRO
// em base64 no corpo do webhook, e isso cobra dois preços que nada aqui aproveita
// (`routes/webhooks.js` só LOGA `messages.upsert`; nenhum byte de mídia é usado):
//   1. o corpo passa de 15 MB e o `express.json` responde 413 — a Evolution então
//      repete o POST até 10 vezes com backoff exponencial (413 não está na lista de
//      status não-repetíveis dela), e nesse meio-tempo CONNECTION_UPDATE/QRCODE
//      ficam na fila atrás do evento gigante: o status da instância no banco para
//      de ser atualizado.
//   2. no ENVIO, a Evolution BAIXA a mídia de volta do WhatsApp antes de responder
//      (`downloadMediaMessage`), somando segundos a cada PDF mandado — foi o que
//      estourava o timeout do nosso lado e derrubava o envio para o fallback manual.
const WEBHOOK_BASE64 = false;

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
      ...(wh ? { webhook: { url: wh, byEvents: false, base64: WEBHOOK_BASE64, events: EVENTOS_WEBHOOK } } : {}),
    });
    logger.info(`[Evolution] Instância criada: ${instanceName}`);
    return dados;
  },

  /**
   * (Re)aplica a configuração de webhook numa instância que JÁ existe.
   * `createInstance` só roda uma vez na vida da clínica, então instância criada
   * antes desta correção continuaria para sempre com `base64: true` gravado na
   * Evolution — a correção no código não a alcançaria. Chamado em
   * `garantirInstancia` (best-effort), que roda a cada conectar/provisionar.
   */
  async setWebhook(instanceName) {
    const wh = webhookUrl();
    if (!wh) return null;
    const dados = await chamar('post', `/webhook/set/${encodeURIComponent(instanceName)}`, {
      webhook: { enabled: true, url: wh, byEvents: false, base64: WEBHOOK_BASE64, events: EVENTOS_WEBHOOK },
    });
    logger.info(`[Evolution] Webhook reconfigurado: ${instanceName} (base64=${WEBHOOK_BASE64})`);
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
    return enviar(`/message/sendText/${encodeURIComponent(instanceName)}`, {
      number: numero,
      text:   texto,
    });
  },

  async sendImage(instanceName, numero, urlOuBase64, legenda = '') {
    return enviar(`/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      number: numero, mediatype: 'image', media: urlOuBase64, caption: legenda,
    });
  },

  async sendDocument(instanceName, numero, urlOuBase64, nomeArquivo, legenda = '') {
    return enviar(`/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      number: numero, mediatype: 'document', media: urlOuBase64, fileName: nomeArquivo, caption: legenda,
    });
  },

  async sendAudio(instanceName, numero, urlOuBase64) {
    return enviar(`/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, {
      number: numero, audio: urlOuBase64,
    });
  },

  async sendVideo(instanceName, numero, urlOuBase64, legenda = '') {
    return enviar(`/message/sendMedia/${encodeURIComponent(instanceName)}`, {
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

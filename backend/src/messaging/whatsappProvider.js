// backend/src/messaging/whatsappProvider.js
// Abstração de envio de WhatsApp — provider-agnostic (mesmo princípio do
// StorageProvider e do AIProvider). Só o NoopWhatsAppProvider está implementado:
// ele apenas LOGA a mensagem (envio simulado), permitindo testar todo o pipeline
// de lembretes sem credenciais. O disparo real pluga aqui quando o provedor for
// escolhido — ver os stubs comentados em getWhatsAppProvider().
//
// Seleção via env WHATSAPP_PROVIDER (default 'noop').
'use strict';

const logger = require('../lib/logger');

/** Contrato que todo provider deve implementar. */
class WhatsAppProvider {
  /**
   * @param {{ para: string, texto: string, remetente?: string, contexto?: object }} msg
   *   para       — número internacional (ex: 5511999999999)
   *   texto      — corpo da mensagem
   *   remetente  — número da empresa (quando aplicável)
   *   contexto   — metadados livres (agendamentoId, tipo do lembrete, etc.)
   * @returns {Promise<{ sucesso: boolean, simulado?: boolean, id?: string }>}
   */
  // eslint-disable-next-line no-unused-vars
  async enviarMensagem(msg) {
    throw new Error('WhatsAppProvider.enviarMensagem não implementado');
  }
}

/** Provider padrão — não envia nada, apenas registra no log (base pronta). */
class NoopWhatsAppProvider extends WhatsAppProvider {
  async enviarMensagem({ para, texto, contexto }) {
    const ctx = contexto ? ` ${JSON.stringify(contexto)}` : '';
    logger.info(`[WhatsApp:noop] (simulado) para=${para || '—'}${ctx} :: ${String(texto).replace(/\n/g, ' | ')}`);
    return { sucesso: true, simulado: true };
  }
}

let instancia = null;

/**
 * Fábrica singleton. Para plugar um provedor real, implemente a classe
 * correspondente e adicione o case abaixo (as credenciais vêm de env vars,
 * nunca hardcoded — ver seção de Segurança no CLAUDE.md).
 */
function getWhatsAppProvider() {
  if (instancia) return instancia;
  const tipo = String(process.env.WHATSAPP_PROVIDER || 'noop').toLowerCase();
  switch (tipo) {
    // case 'cloud':  instancia = new CloudApiWhatsAppProvider();  break; // Meta WhatsApp Cloud API
    // case 'twilio': instancia = new TwilioWhatsAppProvider();    break; // Twilio WhatsApp
    // case 'zapi':   instancia = new ZApiWhatsAppProvider();       break; // Z-API / Evolution (não-oficial)
    default:
      if (tipo !== 'noop') {
        logger.warn(`[WhatsApp] Provider "${tipo}" não implementado — usando noop (envio simulado).`);
      }
      instancia = new NoopWhatsAppProvider();
  }
  return instancia;
}

module.exports = { getWhatsAppProvider, WhatsAppProvider, NoopWhatsAppProvider };

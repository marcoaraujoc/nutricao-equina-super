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

  /**
   * Envio de documento (PDF, etc.).
   * @param {{ para:string, arquivo:{ base64:string, nome:string }, legenda?:string,
   *           contexto?:object }} msg
   * @returns {Promise<{ sucesso: boolean, simulado?: boolean, id?: string, erro?: string }>}
   */
  // eslint-disable-next-line no-unused-vars
  async enviarDocumento(msg) {
    throw new Error('WhatsAppProvider.enviarDocumento não implementado');
  }
}

/** Provider padrão — não envia nada, apenas registra no log (base pronta). */
class NoopWhatsAppProvider extends WhatsAppProvider {
  async enviarMensagem({ para, texto, contexto }) {
    const ctx = contexto ? ` ${JSON.stringify(contexto)}` : '';
    logger.info(`[WhatsApp:noop] (simulado) para=${para || '—'}${ctx} :: ${String(texto).replace(/\n/g, ' | ')}`);
    return { sucesso: true, simulado: true };
  }

  async enviarDocumento({ para, arquivo, legenda, contexto }) {
    const ctx = contexto ? ` ${JSON.stringify(contexto)}` : '';
    const kb  = Math.round((arquivo?.base64?.length ?? 0) * 0.75 / 1024);
    logger.info(`[WhatsApp:noop] (simulado) documento para=${para || '—'}${ctx} :: ${arquivo?.nome} (~${kb}KB) :: ${legenda ?? ''}`);
    return { sucesso: true, simulado: true };
  }
}

/**
 * Provider real via Evolution API — envia pela INSTÂNCIA da clínica.
 * Requer `contexto.empresaId` (a instância é por clínica); sem ele a mensagem
 * é suprimida com warn. Toda a comunicação passa pelo WhatsappService.
 */
class EvolutionWhatsAppProvider extends WhatsAppProvider {
  async enviarMensagem({ para, texto, contexto }) {
    const empresaId = contexto?.empresaId ?? null;
    if (!empresaId) {
      logger.warn('[WhatsApp:evolution] contexto.empresaId ausente — mensagem suprimida.');
      return { sucesso: false, erro: 'SEM_EMPRESA' };
    }
    // require tardio evita ciclo de dependência no boot
    const whatsappService = require('../services/whatsappService');
    const res = await whatsappService.sendMessage(
      { empresaId, equipeId: contexto?.equipeId ?? null }, para, texto,
    );
    if (!res.sucesso) logger.warn(`[WhatsApp:evolution] Envio falhou (${res.erro}) para=${para}`);
    return res;
  }

  async enviarDocumento({ para, arquivo, legenda, contexto }) {
    const empresaId = contexto?.empresaId ?? null;
    if (!empresaId) {
      logger.warn('[WhatsApp:evolution] contexto.empresaId ausente — documento suprimido.');
      return { sucesso: false, erro: 'SEM_EMPRESA' };
    }
    const whatsappService = require('../services/whatsappService');
    const res = await whatsappService.sendMedia(
      { empresaId, equipeId: contexto?.equipeId ?? null }, para,
      { base64: arquivo?.base64, nomeArquivo: arquivo?.nome, legenda, tipo: 'document' },
    );
    if (!res.sucesso) logger.warn(`[WhatsApp:evolution] Envio de documento falhou (${res.erro}) para=${para}`);
    return res;
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
    case 'evolution': instancia = new EvolutionWhatsAppProvider(); break; // Evolution API (instância por clínica)
    // case 'cloud':  instancia = new CloudApiWhatsAppProvider();  break; // Meta WhatsApp Cloud API
    // case 'twilio': instancia = new TwilioWhatsAppProvider();    break; // Twilio WhatsApp
    default:
      if (tipo !== 'noop') {
        logger.warn(`[WhatsApp] Provider "${tipo}" não implementado — usando noop (envio simulado).`);
      }
      instancia = new NoopWhatsAppProvider();
  }
  return instancia;
}

module.exports = { getWhatsAppProvider, WhatsAppProvider, NoopWhatsAppProvider };

'use strict';
// Serviço de WhatsApp via Z-API.
// Variáveis de ambiente necessárias:
//   ZAPI_INSTANCE_ID    — ID da instância no painel Z-API
//   ZAPI_TOKEN          — Token da instância
//   ZAPI_SECURITY_TOKEN — (opcional) Security Token adicional

const ZAPI_BASE = 'https://api.z-api.io';

function isConfigured() {
  return !!(process.env.ZAPI_INSTANCE_ID && process.env.ZAPI_TOKEN);
}

// Normaliza telefone para formato internacional sem + (ex: 5511999999999)
function formatPhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 11 || digits.length === 10) return `55${digits}`;
  return digits;
}

/**
 * Envia uma mensagem de texto via WhatsApp (Z-API).
 * Silencioso se ZAPI não estiver configurado ou se o telefone estiver ausente.
 *
 * @param {string} phone   — telefone do destinatário (qualquer formato)
 * @param {string} message — texto da mensagem
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function sendWhatsApp(phone, message) {
  if (!isConfigured()) {
    console.info('[whatsapp] Z-API não configurado (ZAPI_INSTANCE_ID/ZAPI_TOKEN ausentes) — mensagem suprimida');
    return { sent: false, reason: 'not_configured' };
  }

  if (!phone) {
    return { sent: false, reason: 'no_phone' };
  }

  const phoneFormatted = formatPhone(phone);
  if (phoneFormatted.length < 12) {
    console.warn(`[whatsapp] Telefone inválido: "${phone}" → "${phoneFormatted}"`);
    return { sent: false, reason: 'invalid_phone' };
  }

  const { ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_SECURITY_TOKEN } = process.env;
  const url = `${ZAPI_BASE}/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`;

  const headers = { 'Content-Type': 'application/json' };
  if (ZAPI_SECURITY_TOKEN) headers['Client-Token'] = ZAPI_SECURITY_TOKEN;

  try {
    const response = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ phone: phoneFormatted, message }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[whatsapp] Erro ao enviar para ${phoneFormatted}: ${response.status} — ${err}`);
      return { sent: false, reason: `api_error_${response.status}` };
    }

    const data = await response.json();
    console.info(`[whatsapp] Mensagem enviada → ${phoneFormatted}`);
    return { sent: true, data };
  } catch (err) {
    console.error(`[whatsapp] Falha de rede: ${err.message}`);
    return { sent: false, reason: 'network_error' };
  }
}

module.exports = { sendWhatsApp, isConfigured };

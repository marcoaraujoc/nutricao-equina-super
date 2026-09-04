// backend/src/ai/retentativa.js
// Retentativa ÚNICA para falha TRANSITÓRIA do provedor de IA.
//
// O Gemini devolve 503 ("This model is currently experiencing high demand") de vez
// em quando, e a falha é do MINUTO, não do arquivo: a segunda tentativa costuma
// passar. Sem isto, um pico de demanda do Google faz o vet perder a leitura do laudo
// por um motivo que não tem nada a ver com o documento dele.
//
// ⚠️ UMA retentativa só, e só para falha TRANSITÓRIA. Erro de CONTEÚDO (prompt grande
// demais, chave inválida, arquivo ilegível) não melhora repetindo — insistir apenas
// dobraria a espera antes de cair no mesmo lugar.
//
// Fonte ÚNICA: nasceu em `documentoConversaoService` e foi extraída para cá quando o
// `exameParserService` passou a precisar da mesma regra. Duas cópias divergiriam na
// primeira vez que o provedor mudasse o texto do erro.
'use strict';

const ESPERA_MS = 1500;

/**
 * A falha é do provedor e passageira?
 * ⚠️ Casa com o texto que `geminiClient` produz ("Gemini API error 503: ...") em vez
 * de procurar o número solto: sem a âncora `error `, um "1429" no corpo da mensagem
 * passaria por transitório e a retentativa viraria espera dobrada à toa.
 */
function ehFalhaTransitoria(err) {
  const msg = String(err?.message ?? '');
  return /error (429|500|502|503|504)/i.test(msg)
      || /UNAVAILABLE|overloaded|high demand|rate limit/i.test(msg);
}

async function comRetentativa(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!ehFalhaTransitoria(err)) throw err;
    await new Promise(r => setTimeout(r, ESPERA_MS));
    return fn();
  }
}

module.exports = { comRetentativa, ehFalhaTransitoria, ESPERA_MS };

// backend/src/ai/retentativa.js
// Retentativa para falha TRANSITÓRIA do provedor de IA.
//
// O Gemini devolve 503 ("This model is currently experiencing high demand") de vez
// em quando, e a falha é do MINUTO, não do arquivo: a tentativa seguinte costuma
// passar. Sem isto, um pico de demanda do Google faz o vet perder a leitura do laudo
// por um motivo que não tem nada a ver com o documento dele.
//
// 🔴 DE UMA PARA DUAS RETENTATIVAS, COM ESPERA CRESCENTE (2026-09-19) — medido, não
// suposto. A leitura de um orçamento de balcão falhou com `Gemini API error 503` e o
// log de IA (id 517) registrou **91,8 s de latência**: duas chamadas de ~45 s com os
// 1,5 s de espera no meio. Sete minutos antes, o MESMO documento havia sido lido com
// sucesso (id 516, 12,4 s) — ou seja, o arquivo estava certo e o provedor é que
// estava saturado. Com espera FIXA de 1,5 s a segunda tentativa cai no mesmo pico que
// derrubou a primeira; a espera CRESCENTE dá ao provedor tempo de se recuperar.
// ⚠️ O JITTER não é enfeite: sem ele, todos os clientes que tomaram 503 no mesmo
// segundo voltam juntos e reforçam a sobrecarga que estão esperando passar.
//
// ⚠️ SÓ para falha TRANSITÓRIA. Erro de CONTEÚDO (prompt grande demais, chave
// inválida, arquivo ilegível) não melhora repetindo — insistir apenas multiplicaria a
// espera antes de cair no mesmo lugar.
//
// 🔴 ORÇAMENTO DE TEMPO — é ele que impede a retentativa virar um problema pior que o
// que resolve. Quem espera é uma PESSOA com o documento na mão, e o front desiste em
// 180 s (`LeitorDocumentoCompra`, `documentos/api.ts`). Uma nova tentativa só COMEÇA
// enquanto o decorrido couber em `ORCAMENTO_INICIO_MS`: com 503 imediato (o caso
// comum) cabem as três tentativas em segundos; com o provedor lento (45 s por
// chamada, o caso medido) ele para na segunda, exatamente como parava antes.
//
// Fonte ÚNICA: nasceu em `documentoConversaoService` e foi extraída para cá quando o
// `exameParserService` passou a precisar da mesma regra. Duas cópias divergiriam na
// primeira vez que o provedor mudasse o texto do erro.
'use strict';

/** Espera da PRIMEIRA retentativa; a seguinte dobra (1,5 s → 3 s). */
const ESPERA_MS = 1500;

/** Chamadas no total: 1 original + 2 retentativas. */
const TENTATIVAS = 3;

/**
 * Teto para COMEÇAR uma tentativa nova, contado do início da primeira.
 * Não é o tempo máximo da operação: a tentativa já iniciada vai até o fim (o teto
 * por chamada é o `TIMEOUT_MS` do geminiClient).
 */
const ORCAMENTO_INICIO_MS = 60_000;

/**
 * A falha é do provedor e passageira?
 * ⚠️ Casa com o texto que `geminiClient` produz ("Gemini API error 503: ...") em vez
 * de procurar o número solto: sem a âncora `error `, um "1429" no corpo da mensagem
 * passaria por transitório e a retentativa viraria espera dobrada à toa.
 * ⚠️ `AbortError`/"demorou demais" entram: é o timeout do nosso lado sobre um
 * provedor que parou de responder — o mesmo evento que produz o 503, visto do outro
 * lado do fio.
 */
function ehFalhaTransitoria(err) {
  const msg = String(err?.message ?? '');
  return /error (429|500|502|503|504)/i.test(msg)
      || /UNAVAILABLE|overloaded|high demand|rate limit/i.test(msg)
      || err?.name === 'AbortError' || err?.name === 'TimeoutError'
      || /demorou demais|aborted|timeout/i.test(msg);
}

/** Espera crescente com jitter de até 30% para cima. */
function esperaDaTentativa(indice) {
  const base = ESPERA_MS * 2 ** (indice - 1);
  return Math.round(base * (1 + Math.random() * 0.3));
}

async function comRetentativa(fn, { tentativas = TENTATIVAS, orcamentoMs = ORCAMENTO_INICIO_MS } = {}) {
  const inicio = Date.now();
  let ultimo;

  for (let i = 1; i <= tentativas; i += 1) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      if (!ehFalhaTransitoria(err)) throw err;
      if (i === tentativas) break;
      // Orçamento conferido ANTES de dormir: não faz sentido esperar para então
      // descobrir que não havia tempo de tentar.
      if (Date.now() - inicio >= orcamentoMs) break;
      await new Promise(r => setTimeout(r, esperaDaTentativa(i)));
    }
  }

  throw ultimo;
}

module.exports = { comRetentativa, ehFalhaTransitoria, ESPERA_MS, TENTATIVAS, ORCAMENTO_INICIO_MS };

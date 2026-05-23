// backend/src/services/clinicaLLMService.js
'use strict';

const { callAI }      = require('../ai');
const { buildPrompt } = require('../ai/prompts');

// =====================================================================
// EXPORTAÇÃO PRINCIPAL
// =====================================================================

/**
 * Interpreta uma evolução clínica textual e retorna itens faturáveis.
 *
 * @param {string} texto      — texto da evolução clínica
 * @param {number} [userId]   — id do usuário (para log)
 * @param {number} [animalId] — id do animal (para log)
 * @returns {Promise<{ acoes: Array }>}
 */
async function interpretarEvolucao(texto, userId = null, animalId = null) {
  const { operacaoVers, prompt } = buildPrompt('interpretacao_clinica', texto);
  try {
    const respostaTexto = await callAI({
      operacao:    operacaoVers,
      prompt,
      maxTokens:   1000,
      temperature: 0.1,
      userId,
      animalId,
    });

    const jsonMatch = respostaTexto.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { acoes: [] };

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      console.error('[clinicaLLMService] Erro ao parsear resposta:', respostaTexto);
      return { acoes: [] };
    }
  } catch (err) {
    console.error('[clinicaLLMService] Falha na chamada ao modelo:', err.message);
    return { acoes: [] };
  }
}

module.exports = { interpretarEvolucao };
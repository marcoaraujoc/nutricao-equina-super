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
    if (!jsonMatch) return { acoes: [], titulo: '' };

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        acoes:  Array.isArray(parsed.acoes) ? parsed.acoes : [],
        titulo: typeof parsed.titulo === 'string' ? parsed.titulo : '',
      };
    } catch {
      console.error('[clinicaLLMService] Erro ao parsear resposta:', respostaTexto);
      return { acoes: [], titulo: '' };
    }
  } catch (err) {
    console.error('[clinicaLLMService] Falha na chamada ao modelo:', err.message);
    return { acoes: [], titulo: '' };
  }
}

/**
 * Gera resumos de uma linha para um lote de eventos do histórico clínico.
 *
 * @param {Array}  eventos  — array de eventos do HistoricoController
 * @param {number} [userId]
 * @param {number} [animalId]
 * @returns {Promise<string[]>} — array de resumos (mesmo tamanho que eventos), fallback para titulo em caso de falha
 */
async function resumirHistorico(eventos, userId = null, animalId = null) {
  if (!eventos || eventos.length === 0) return [];

  const { operacaoVers, prompt } = buildPrompt('resumo_historico', eventos);
  try {
    const respostaTexto = await callAI({
      operacao:    operacaoVers,
      prompt,
      maxTokens:   600,
      temperature: 0.2,
      userId,
      animalId,
    });

    const jsonMatch = respostaTexto.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Resposta sem JSON array');

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length !== eventos.length) throw new Error('Array com tamanho inesperado');

    return parsed.map(p => (typeof p.resumo === 'string' ? p.resumo : ''));
  } catch (err) {
    console.error('[clinicaLLMService] resumirHistorico falhou:', err.message);
    // Fallback: retorna o titulo existente de cada evento
    return eventos.map(e => e.titulo ?? '');
  }
}

module.exports = { interpretarEvolucao, resumirHistorico };
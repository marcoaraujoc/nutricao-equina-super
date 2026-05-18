// backend/src/services/clinicaLLMService.js
'use strict';

const { chamarGroqComLog } = require('./aiLogger.service');

// =====================================================================
// PROMPT
// =====================================================================

const PROMPT_INTERPRETAR = (texto) =>
  `Você é um assistente clínico veterinário especializado.

Analise o texto da evolução clínica abaixo e identifique APENAS itens que possam gerar cobrança ou registro clínico:
- Medicamentos prescritos  → tipo: "MEDICAMENTO"
- Procedimentos realizados → tipo: "PROCEDIMENTO"
- Exames solicitados       → tipo: "EXAME"
- Encaminhamentos          → tipo: "ENCAMINHAMENTO"
- Vacinas aplicadas        → tipo: "VACINA"

Estime valores em reais baseados na tabela veterinária brasileira vigente.

Retorne APENAS um JSON válido, sem markdown, sem texto adicional:
{
  "acoes": [
    {
      "tipo": "MEDICAMENTO",
      "descricao": "Amoxicilina 500mg — 1 comprimido 2x ao dia por 7 dias",
      "valorEstimado": 45.00,
      "quantidade": 1
    }
  ]
}

Se não identificar nenhum item faturável, retorne: { "acoes": [] }

Texto da evolução:
${texto.slice(0, 8000)}`;

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
  try {
    const respostaTexto = await chamarGroqComLog({
      operacao:    'interpretacao_clinica',
      prompt:      PROMPT_INTERPRETAR(texto),
      modelo:      'llama-3.3-70b-versatile',
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
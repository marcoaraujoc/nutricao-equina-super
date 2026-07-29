// backend/src/services/agendamentoLLMService.js
'use strict';

const { callAI, MODULOS_IA } = require('../ai');
const { buildPrompt }        = require('../ai/prompts');

const HORARIOS_PADRAO = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];

/**
 * Interpreta uma solicitação de agendamento em texto livre (voz transcrita ou digitada).
 *
 * @param {{
 *   texto: string,
 *   vets: Array<{id: number, fullName: string}>,
 *   animais: Array<{id: number, nome: string, especie?: {nome: string}}>,
 *   dataReferencia: string,
 *   vetHint?: number,
 *   horaHint?: string,
 * }} param
 * @returns {Promise<{data, hora, animalId, vetId, animalNomeNaoEncontrado, vetNomeNaoEncontrado, confianca, resumo} | null>}
 */
async function interpretarAgendamento({ texto, vets, animais, dataReferencia, vetHint, horaHint, userId = null, empresaId = null }) {
  const animaisLimitados = animais.slice(0, 120);

  const vetsStr = vets.length
    ? vets.map(v => `  ID:${v.id} → "${v.fullName}"`).join('\n')
    : '  (nenhum veterinário disponível)';

  const animaisStr = animaisLimitados.length
    ? animaisLimitados.map(a => `  ID:${a.id} → "${a.nome}" (${a.especie?.nome ?? 'equino'})`).join('\n')
    : '  (nenhum animal disponível)';

  const hints = [];
  if (vetHint)  hints.push(`Se o usuário não mencionar veterinário, use ID ${vetHint}.`);
  if (horaHint) hints.push(`Se o usuário não mencionar horário, use "${horaHint}".`);

  const { operacaoVers, prompt } = buildPrompt('interpretacao_agendamento', {
    texto,
    vetsStr,
    animaisStr,
    dataReferencia,
    hints: hints.join('\n'),
  });

  try {
    const resposta = await callAI({
      operacao:    operacaoVers,
      modulo:      MODULOS_IA.AGENDA,
      prompt,
      maxTokens:   400,
      temperature: 0.05,
      userId,
      empresaId,
    });

    const jsonMatch = resposta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      data:                    parsed.data                    ?? null,
      hora:                    parsed.hora                    ?? null,
      animalId:                typeof parsed.animalId === 'number' ? parsed.animalId : null,
      vetId:                   typeof parsed.vetId    === 'number' ? parsed.vetId    : null,
      animalNomeNaoEncontrado: parsed.animalNomeNaoEncontrado ?? null,
      vetNomeNaoEncontrado:    parsed.vetNomeNaoEncontrado    ?? null,
      confianca:               typeof parsed.confianca === 'number' ? parsed.confianca : 0,
      resumo:                  typeof parsed.resumo === 'string'    ? parsed.resumo    : '',
    };
  } catch (err) {
    console.error('[agendamentoLLMService] Erro ao interpretar:', err.message);
    return null;
  }
}

module.exports = { interpretarAgendamento, HORARIOS_PADRAO };

// backend/src/services/agendamentoLLMService.js
'use strict';

const { callAI } = require('../ai');

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
async function interpretarAgendamento({ texto, vets, animais, dataReferencia, vetHint, horaHint }) {
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

  const prompt = `Você é um assistente de agendamento veterinário. Analise a solicitação em português e extraia as informações de agendamento.

DATA DE REFERÊNCIA (hoje): ${dataReferencia}

VETERINÁRIOS DISPONÍVEIS:
${vetsStr}

ANIMAIS CADASTRADOS:
${animaisStr}

${hints.length ? hints.join('\n') + '\n\n' : ''}REGRAS:
- "amanhã" → data de referência + 1 dia
- "próxima segunda" → próxima segunda-feira
- Sem data → use data de referência
- "9h", "09:00", "nove horas" → "09:00"; "14h30" → "14:30"
- Horários permitidos: 08:00 a 18:00 (inteiros)
- Combine nomes por similaridade fonética (ex: "Belinha" ≈ "Belinha", "Dr. João" ≈ "João Silva")
- Se animal não encontrado nos cadastrados, coloque o nome mencionado em animalNomeNaoEncontrado
- Se veterinário não encontrado na lista, coloque o nome mencionado em vetNomeNaoEncontrado

SOLICITAÇÃO: "${texto}"

Responda APENAS com JSON válido (sem markdown):
{
  "data": "YYYY-MM-DD ou null",
  "hora": "HH:MM ou null",
  "animalId": numero_ou_null,
  "vetId": numero_ou_null,
  "animalNomeNaoEncontrado": "nome_ou_null",
  "vetNomeNaoEncontrado": "nome_ou_null",
  "confianca": 0.0_a_1.0,
  "resumo": "frase curta do que foi entendido"
}`;

  try {
    const resposta = await callAI({
      operacao:    'agendamento_interpretacao@v1',
      prompt,
      maxTokens:   400,
      temperature: 0.05,
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

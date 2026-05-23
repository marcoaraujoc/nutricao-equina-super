// backend/src/services/composicaoParserService.js
'use strict';

const fs       = require('fs');
const pdfParse = require('pdf-parse');
const { logAiUsage } = require('./aiLogger.service');
const { PROMPTS, buildPrompt } = require('../ai/prompts');
// Nota: composicaoParserService usa Gemini Vision — provider-específico por natureza
// (multimodal com imagem). callAI() cobre apenas text completions.

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// =====================================================================
// CHAMADAS GEMINI (com logging manual via logAiUsage)
// =====================================================================

async function chamarGeminiVisao(imageBase64, mimeType, userId = null, animalId = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada no ambiente');

  const inicio = Date.now();
  let sucesso      = true;
  let erroMensagem = null;
  let respostaTexto = '';

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: imageBase64 } },
              { text: PROMPTS['parse_composicao_visao'].text },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini Vision Error HTTP ${response.status}: ${err}`);
    }

    const data    = await response.json();
    respostaTexto = data.candidates[0].content.parts[0].text.trim();

    return respostaTexto;

  } catch (err) {
    sucesso      = false;
    erroMensagem = err.message;
    throw err;

  } finally {
    await logAiUsage({
      operacao:      `parse_composicao_visao@${PROMPTS['parse_composicao_visao'].version}`,
      modelo:        'gemini-2.5-flash',
      provedor:      'google',
      promptTexto:   PROMPTS['parse_composicao_visao'].text,
      respostaTexto,
      latenciaMs:    Date.now() - inicio,
      userId,
      animalId,
      sucesso,
      erroMensagem,
    });
  }
}

async function chamarGeminiTexto(prompt, userId = null, animalId = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada no ambiente');

  const inicio = Date.now();
  let sucesso      = true;
  let erroMensagem = null;
  let respostaTexto = '';

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini Text Error HTTP ${response.status}: ${err}`);
    }

    const data    = await response.json();
    respostaTexto = data.candidates[0].content.parts[0].text.trim();

    return respostaTexto;

  } catch (err) {
    sucesso      = false;
    erroMensagem = err.message;
    throw err;

  } finally {
    await logAiUsage({
      operacao:      `parse_composicao_texto@${PROMPTS['parse_composicao_texto'].version}`,
      modelo:        'gemini-2.5-flash',
      provedor:      'google',
      promptTexto:   prompt,
      respostaTexto,
      latenciaMs:    Date.now() - inicio,
      userId,
      animalId,
      sucesso,
      erroMensagem,
    });
  }
}

// =====================================================================
// PARSER DA RESPOSTA GEMINI
// =====================================================================

function tentarRepararJSON(texto) {
  let trabalho = texto.trim();

  const ultimoObjeto = trabalho.lastIndexOf('},');
  if (ultimoObjeto !== -1) {
    trabalho = trabalho.substring(0, ultimoObjeto + 1);
  } else {
    const ultimoFechamento = trabalho.lastIndexOf('}');
    if (ultimoFechamento !== -1) {
      trabalho = trabalho.substring(0, ultimoFechamento + 1);
    }
  }

  let abreCol = 0, fechaCol = 0, abreChave = 0, fechaChave = 0;
  for (const c of trabalho) {
    if (c === '[') abreCol++;
    if (c === ']') fechaCol++;
    if (c === '{') abreChave++;
    if (c === '}') fechaChave++;
  }
  while (fechaCol   < abreCol)   { trabalho += ']'; fechaCol++;   }
  while (fechaChave < abreChave) { trabalho += '}'; fechaChave++; }

  try   { return JSON.parse(trabalho); }
  catch { return null; }
}

function parsearRespostaGemini(textoResposta) {
  console.log('\n=== RESPOSTA GEMINI ===\n', textoResposta, '\n======================\n');

  let parsed;
  try {
    const clean = textoResposta.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    const clean = textoResposta.replace(/```json|```/g, '').trim();
    parsed = tentarRepararJSON(clean);

    if (!parsed) {
      console.error('[composicaoParserService] JSON inválido e irreparável:', textoResposta);
      throw new Error('O modelo retornou resposta em formato inválido');
    }

    console.warn('[composicaoParserService] JSON reparado — resposta estava truncada.');
  }

  if (!parsed.nutrientes || !Array.isArray(parsed.nutrientes)) {
    throw new Error('Resposta não contém lista de nutrientes');
  }

  const composicoes = parsed.nutrientes
    .filter((n) => n.nome && n.valor !== null && n.valor !== undefined)
    .map((n) => ({
      alimentoNome:     parsed.nomeAlimento || 'Produto detectado',
      nutrienteNome:    String(n.nome).trim(),
      valorPorKg:       Number(n.valor),
      unidadeDetectada: String(n.unidade || 'g/kg').trim(),
      base:             'Seca',
    }));

  console.log(`[composicaoParserService] ${composicoes.length} nutrientes extraídos`);
  return { composicoes, nomeAlimento: parsed.nomeAlimento || null };
}

// =====================================================================
// EXPORTAÇÃO PRINCIPAL
// =====================================================================

module.exports = {
  /**
   * @param {string} filePath   — caminho absoluto do arquivo em disco
   * @param {string} [mimetype] — mime type do arquivo
   * @param {number} [userId]   — id do usuário (para log)
   * @param {number} [animalId] — id do animal (para log)
   */
  async processarArquivo(filePath, mimetype = '', userId = null, animalId = null) {
    const isPdf =
      mimetype === 'application/pdf' || filePath.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      const dataBuffer    = fs.readFileSync(filePath);
      const { text }      = await pdfParse(dataBuffer);
      if (!text?.trim()) {
        throw new Error('PDF sem texto extraível. Envie uma imagem do rótulo.');
      }
      const { prompt } = buildPrompt('parse_composicao_texto', text);
      const respostaGemini = await chamarGeminiTexto(prompt, userId, animalId);
      return parsearRespostaGemini(respostaGemini);
    }

    // Imagem → Gemini Vision
    const imageBuffer    = fs.readFileSync(filePath);
    const imageBase64    = imageBuffer.toString('base64');
    const respostaGemini = await chamarGeminiVisao(
      imageBase64,
      mimetype || 'image/jpeg',
      userId,
      animalId,
    );
    return parsearRespostaGemini(respostaGemini);
  },
};
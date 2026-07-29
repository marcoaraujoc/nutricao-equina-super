// backend/src/services/composicaoParserService.js
'use strict';

const fs       = require('fs');
const pdfParse = require('pdf-parse');
const { logAiUsage } = require('./aiLogger.service');
const { PROMPTS, buildPrompt } = require('../ai/prompts');
const { MODULOS_IA } = require('../ai');
const { gerarConteudo, MODELO_PADRAO, PROVEDOR } = require('../ai/geminiClient');
// Rótulo em imagem é multimodal: entra pelo gerarConteudo (inlineData), não pelo
// callAI() — que cobre apenas texto. O log de uso é feito aqui, manualmente.

// =====================================================================
// CHAMADAS GEMINI (com logging manual via logAiUsage)
// =====================================================================

async function chamarGemini({ parts, promptTexto, operacaoVers, userId, animalId, empresaId }) {
  const inicio = Date.now();
  let sucesso       = true;
  let erroMensagem  = null;
  let respostaTexto = '';
  let tokensEntradaApi = null;
  let tokensSaidaApi   = null;
  let modelo = MODELO_PADRAO;

  try {
    const r = await gerarConteudo(parts, { temperature: 0.1, maxTokens: 8192 });
    respostaTexto    = (r.text ?? '').trim();
    tokensEntradaApi = r.tokensEntrada;
    tokensSaidaApi   = r.tokensSaida;
    modelo           = r.modelo;
    return respostaTexto;

  } catch (err) {
    sucesso      = false;
    erroMensagem = err.message;
    throw err;

  } finally {
    await logAiUsage({
      operacao:   operacaoVers,
      modulo:     MODULOS_IA.NUTRICAO,
      modelo,
      provedor:   PROVEDOR,
      promptTexto,
      respostaTexto,
      tokensEntradaApi: tokensEntradaApi ?? undefined,
      tokensSaidaApi:   tokensSaidaApi   ?? undefined,
      latenciaMs: Date.now() - inicio,
      userId,
      animalId,
      empresaId,
      sucesso,
      erroMensagem,
    });
  }
}

function chamarGeminiVisao(imageBase64, mimeType, userId = null, animalId = null, empresaId = null) {
  const entrada = PROMPTS['parse_composicao_visao'];
  return chamarGemini({
    parts: [
      { inlineData: { mimeType, data: imageBase64 } },
      { text: entrada.text },
    ],
    promptTexto:  entrada.text,
    operacaoVers: `parse_composicao_visao@${entrada.version}`,
    userId,
    animalId,
    empresaId,
  });
}

function chamarGeminiTexto(prompt, operacaoVers, userId = null, animalId = null, empresaId = null) {
  return chamarGemini({
    parts: [{ text: prompt }],
    promptTexto: prompt,
    operacaoVers,
    userId,
    animalId,
    empresaId,
  });
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
  async processarArquivo(filePath, mimetype = '', userId = null, animalId = null, empresaId = null) {
    const isPdf =
      mimetype === 'application/pdf' || filePath.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      const dataBuffer    = fs.readFileSync(filePath);
      const { text }      = await pdfParse(dataBuffer);
      if (!text?.trim()) {
        throw new Error('PDF sem texto extraível. Envie uma imagem do rótulo.');
      }
      const { operacaoVers, prompt } = buildPrompt('parse_composicao_texto', text);
      const respostaGemini = await chamarGeminiTexto(prompt, operacaoVers, userId, animalId, empresaId);
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
      empresaId,
    );
    return parsearRespostaGemini(respostaGemini);
  },
};
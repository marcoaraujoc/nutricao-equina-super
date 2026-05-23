// backend/src/services/exameParserService.js
'use strict';

const fs       = require('fs');
const pdfParse = require('pdf-parse');
const { callAI }      = require('../ai');
const { buildPrompt } = require('../ai/prompts');

// =====================================================================
// EXTRAÇÃO DE TEXTO DO PDF
// =====================================================================

async function extrairTextoPDF(fileBuffer) {
  const data = await pdfParse(fileBuffer);
  return data.text || '';
}

// =====================================================================
// EXPORTAÇÃO PRINCIPAL
// =====================================================================

module.exports = {
  /**
   * @param {string} filePath   — caminho absoluto do PDF/imagem em disco
   * @param {number} [userId]   — id do usuário que disparou a ação (para log)
   * @param {number} [animalId] — id do animal relacionado (para log)
   */
  async processarExame(filePath, userId = null, animalId = null) {
    const fileBuffer = fs.readFileSync(filePath);
    const texto      = await extrairTextoPDF(fileBuffer);

    // Log do texto bruto para diagnóstico de extração PDF
    const logger = require('../lib/logger');
    logger.debug('[exameParser] Texto extraído do PDF:\n' + texto.slice(0, 3000));

    const { operacaoVers, prompt } = buildPrompt('parse_laudo', texto);

    const respostaTexto = await callAI({
      operacao:    operacaoVers,
      prompt,
      maxTokens:   2000,
      temperature: 0.1,
      userId,
      animalId,
    });

    // Parse da resposta
    const jsonMatch = respostaTexto.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Não encontrou JSON na resposta do modelo');

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error('[exameParserService] Erro ao parsear JSON:', respostaTexto);
      throw new Error('Modelo retornou resposta em formato inválido');
    }
  },
};
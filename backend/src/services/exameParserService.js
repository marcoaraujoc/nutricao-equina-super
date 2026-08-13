// backend/src/services/exameParserService.js
'use strict';

const fs       = require('fs');
const pdfParse = require('pdf-parse');
const { callAI, MODULOS_IA } = require('../ai');
const { buildPrompt } = require('../ai/prompts');

// =====================================================================
// EXTRAÇÃO DE TEXTO DO PDF
// =====================================================================

async function extrairTextoPDF(fileBuffer) {
  const data = await pdfParse(fileBuffer);
  return data.text || '';
}

/**
 * @param {Buffer} fileBuffer  — conteúdo do PDF/imagem já em memória
 * @param {number} [userId]    — id do usuário que disparou a ação (para log)
 * @param {number} [animalId]  — id do animal relacionado (para log)
 */
async function processarBuffer(fileBuffer, userId = null, animalId = null, empresaId = null) {
  const texto = await extrairTextoPDF(fileBuffer);

  // Log do texto bruto para diagnóstico de extração PDF
  const logger = require('../lib/logger');
  logger.debug('[exameParser] Texto extraído do PDF:\n' + texto.slice(0, 3000));

  const { operacaoVers, prompt } = buildPrompt('parse_laudo', texto);

  const respostaTexto = await callAI({
    operacao:    operacaoVers,
    modulo:      MODULOS_IA.EXAMES,
    prompt,
    maxTokens:   2000,
    temperature: 0.1,
    userId,
    animalId,
    empresaId,
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
  async processarExame(filePath, userId = null, animalId = null, empresaId = null) {
    const fileBuffer = fs.readFileSync(filePath);
    return processarBuffer(fileBuffer, userId, animalId, empresaId);
  },

  // Mesma extração, mas a partir de um buffer em memória (multer.memoryStorage) —
  // usada pela ANÁLISE do exame "não pedido", que não deve gravar nada em disco
  // antes de o usuário confirmar a criação do registro.
  processarBuffer,
};
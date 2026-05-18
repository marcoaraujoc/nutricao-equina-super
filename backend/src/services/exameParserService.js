// backend/src/services/exameParserService.js
'use strict';

const fs                             = require('fs');
const pdfParse                       = require('pdf-parse');
const { chamarGroqComLog }           = require('./aiLogger.service');

// =====================================================================
// PROMPT
// =====================================================================

function montarPrompt(texto) {
  return `Você é um especialista em extração de laudos laboratoriais veterinários.

Primeiro, encontre a **data do exame** (data real da análise/coleta):
- Procure por palavras como: "Realizado em", "Data do Exame", "Data da Coleta", "Data de Realização", "Requisição", "Exame realizado", "Coleta".
- **Ignore completamente** qualquer data próxima de: "Nascimento", "Nasc", "Data de Nasc", "Aniversário", "Niver", "Data de Nascimento".

Depois, extraia **TODOS** os exames, incluindo:
- Cobre
- Relação Sódio/Potássio
- Qualquer outro nutriente que aparecer na tabela.

Retorne APENAS um JSON válido, sem markdown, sem texto antes ou depois:

{
  "dataExame": "YYYY-MM-DD",
  "exames": [
    {
      "nomeNutriente": "Cobre",
      "valorEncontrado": 72.4,
      "unidade": "ug/dL",
      "valorMinRef": 0.0,
      "valorMaxRef": 0.0,
      "observacao": "Colorimétrico",
      "statusClinico": "alto"
    }
  ]
}

Texto completo do laudo:
${texto.slice(0, 22000)}`;
}

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
    const prompt     = montarPrompt(texto);

    // chamarGroqComLog já faz o fetch, trata erro e loga automaticamente
    const respostaTexto = await chamarGroqComLog({
      operacao:    'parse_laudo',
      prompt,
      modelo:      'llama-3.3-70b-versatile',
      maxTokens:   1500,
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
// backend/src/services/composicaoParserService.js
'use strict';

const fs       = require('fs');
const pdfParse = require('pdf-parse');
const { logAiUsage } = require('./aiLogger.service');
// Nota: composicaoParserService usa Gemini (não Groq), então usa logAiUsage
// diretamente em vez de chamarGroqComLog

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// =====================================================================
// PROMPTS
// =====================================================================

const PROMPT_VISAO = `
Você é um especialista em nutrição animal. Analise esta imagem de rótulo de produto e extraia TODOS os dados da seção nutricional.

A seção pode ter vários nomes: "Níveis de Garantia", "Níveis de Garantia por Kg", "Informação Nutricional", "Composição Garantida", "Análise Garantida", "Composición", etc.

FORMATOS POSSÍVEIS — saiba identificar cada um:
1. TABELA COM UMA COLUNA DE VALOR: extraia direto.
2. TABELA COM MÚLTIPLAS COLUNAS (ex: "por tablete" e "por kg"): use SEMPRE a coluna "por kg" ou "total/por kg". Ignore colunas "por porção", "por tablete", "por dose".
3. PARÁGRAFO CORRIDO: os nutrientes aparecem em texto contínuo separados por vírgula. Ex: "proteína bruta (mín.) 140 g/kg, extrato etéreo (mín.) 70 g/kg, ...". Extraia cada par nutriente+valor+unidade.
4. LISTA SIMPLES: nutriente em uma linha, valor e unidade na mesma linha ou na próxima.

BASE DE CÁLCULO:
- Se o título disser "por kg" ou "g/kg": use os valores como estão — não altere nada.
- Se o título disser "por 100g" ou "100g": multiplique APENAS O VALOR NUMÉRICO por 10. Nunca altere a unidade. Exemplos corretos: 635mg → valor 6350, unidade "mg"; 2,26g → valor 22,6, unidade "g"; 450UI → valor 4500, unidade "UI".
- Se a unidade for %, mantenha como % (não converta e não multiplique por 10).
- PROIBIDO converter entre unidades: não transforme mg em g, não transforme g em mg, não transforme UI em mg. A unidade de saída deve ser idêntica à unidade impressa no rótulo.

Retorne APENAS um objeto JSON válido, sem texto antes ou depois, sem blocos de código markdown:

{
  "nomeAlimento": "nome do produto conforme aparece no rótulo, ou null se não encontrado",
  "baseCalculo": "kg" ou "100g",
  "nutrientes": [
    {
      "nome": "nome do nutriente sem indicadores como (mín.) (máx.) (min.) (max.)",
      "valor": 0.00,
      "unidade": "g/kg"
    }
  ]
}

Regras finais:
1. Remova os indicadores (mín.), (máx.), (min.), (max.) do nome do nutriente.
2. Não invente valores — use apenas o que está claramente visível.
3. Se não conseguir ler um valor com segurança, use null.
4. Inclua TODOS os nutrientes visíveis, mesmo probióticos (UFC/g) e energia (kcal/kg).
5. Normalize variações de escrita: "Proteina bruta" e "Proteína Bruta" são o mesmo nutriente.
`;

function montarPromptTexto(texto) {
  return `
Você é um especialista em nutrição animal. Extraia todos os nutrientes do texto abaixo,
proveniente de um rótulo de produto animal.

A seção pode se chamar: "Níveis de Garantia", "Informação Nutricional", "Composição Garantida", etc.

Retorne APENAS um objeto JSON válido, sem texto antes ou depois, sem blocos de código markdown:

{
  "nomeAlimento": "nome do produto se encontrado, ou null",
  "nutrientes": [
    {
      "nome": "nome do nutriente sem (mín.) ou (máx.)",
      "valor": 0.00,
      "unidade": "g/kg"
    }
  ]
}

Regras:
1. Se valores forem por 100g, multiplique APENAS O VALOR NUMÉRICO por 10 para converter para por kg. Nunca altere a unidade (mg continua mg, g continua g). Exemplo: 635mg/100g → valor 6350, unidade "mg".
2. Se a unidade for %, mantenha como % (não converta).
3. Não invente valores — use apenas o que está no texto.
4. Inclua todos os nutrientes encontrados.

Texto:
${texto.slice(0, 20000)}
`;
}

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
              { text: PROMPT_VISAO },
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
      operacao:      'parse_composicao_visao',
      modelo:        'gemini-2.5-flash',
      provedor:      'google',
      promptTexto:   PROMPT_VISAO,
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
      operacao:      'parse_composicao_texto',
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
      const prompt         = montarPromptTexto(text);
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
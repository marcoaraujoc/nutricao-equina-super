const fs = require('fs');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const pdfParse = require('pdf-parse');

// ==========================
// OCR MELHORADO
// ==========================
async function extrairTextoDaImagem(filePath) {
  try {
    const processedBuffer = await sharp(filePath)
      .rotate()
      .grayscale()
      .normalize()
      .sharpen()
      .threshold(160)
      .resize({ width: 3200 })
      .toBuffer();

    const tempPath = filePath + '_processed.png';
    fs.writeFileSync(tempPath, processedBuffer);

    const worker = await createWorker('por+eng', 1, { logger: () => {} });
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,()/-%°µ ',
    });

    const { data: { text } } = await worker.recognize(tempPath);
    await worker.terminate();
    fs.unlinkSync(tempPath);

    return text || '';
  } catch (error) {
    console.error('[Parser] Erro OCR:', error);
    return '';
  }
}

// ==========================
// PROMPT MAIS FORTE
// ==========================
function montarPrompt(texto) {
  return `
Você é um especialista em extração de rótulos nutricionais.

Extraia TODOS os nutrientes da seção "NÍVEIS DE GARANTIA" ou equivalente.

Responda **EXATAMENTE** neste formato, sem introdução, sem explicação, sem texto extra:

NÍVEIS DE GARANTIA:
- Umidade (máx.) 130 g/kg
- Proteína bruta (mín.) 140 g/kg
- Vitamina B12 (mín.) 22 mcg/kg
- Arginina (mín.) 206 g/kg
- ...

Texto da imagem:
${texto.slice(0, 25000)}
`;
}

// ==========================
// CHAMADA GEMINI 2.5 FLASH
// ==========================
async function chamarGemini(prompt) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2000,
        }
      })
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini Error: ${err}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text.trim();
}

// ==========================
// PARSER MAIS TOLERANTE
// ==========================
async function parseRespostaLLM(textoLLM) {
  console.log('\n=== RESPOSTA BRUTA DO GEMINI ===');
  console.log(textoLLM);
  console.log('================================\n');

  const composicoes = [];
  const lines = textoLLM.split('\n');

  for (const line of lines) {
    // Regex mais flexível
    const match = line.match(/-\s*([A-ZÀ-Ú][A-ZÀ-Ú0-9\s\.\-\(\)]+?)\s*(\d+[.,]?\d*)\s*(.+)/i);
    if (match) {
      let nome = match[1].trim();
      const valor = parseFloat(match[2].replace(',', '.'));
      const unidade = match[3].trim();

      nome = nome.replace(/\s*\(?(mín\.?|máx\.?)\)?/i, '').trim();

      if (nome.length > 3 && valor > 0) {
        composicoes.push({
          alimentoNome: "Produto detectado",
          nutrienteNome: nome,
          valorPorKg: valor,
          unidadeDetectada: unidade,
          base: 'Seca'
        });
      }
    }
  }

  console.log(`[Parser] Extraídos ${composicoes.length} itens do Gemini`);

  if (composicoes.length === 0) {
    composicoes.push({
      alimentoNome: "Produto detectado",
      nutrienteNome: "Composição detectada",
      valorPorKg: 0,
      unidadeDetectada: "g/kg",
      base: 'Seca'
    });
  }

  return { composicoes };
}

// ==========================
// FUNÇÃO PRINCIPAL
// ==========================
module.exports = {
  async processarArquivo(filePath, mimetype = '') {
    const isPdf = mimetype === 'application/pdf' || filePath.toLowerCase().endsWith('.pdf');

    let texto = '';

    if (isPdf) {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      texto = data.text || '';
    } else {
      texto = await extrairTextoDaImagem(filePath);
    }

    const prompt = montarPrompt(texto);
    const respostaLLM = await chamarGemini(prompt);

    console.log('[ComposicaoParser] Gemini 2.5 Flash processou com sucesso');

    return parseRespostaLLM(respostaLLM);
  }
};
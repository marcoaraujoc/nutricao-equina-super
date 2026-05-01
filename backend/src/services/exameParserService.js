// backend/services/exameParserService.js
const fs = require('fs');
const pdfParse = require('pdf-parse');

async function extrairTextoPDF(fileBuffer) {
  const data = await pdfParse(fileBuffer);
  return data.text || '';
}

function montarPrompt(texto) {
  return `Você é um especialista em extração de laudos laboratoriais veterinários.

Primeiro, encontre a **data do exame** (data real da análise/coleta):
- Procure por palavras como: "Realizado em", "Data do Exame", "Data da Coleta", "Data de Realização", "Requisição", "Exame realizado", "Coleta".
- **Ignore completamente** qualquer data próxima de: "Nascimento", "Nasc", "Data de Nasc", "Aniversário", "Niver", "Data de Nascimento".

Depois, extraia **TODOS** os exames, incluindo:
- Cobre
- Relação Sódio/Potássio
- Qualquer outro nutriente que aparecer na tabela.

Retorne APENAS um JSON válido:

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

async function chamarGroq(prompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 1500
    })
  });

  if (!response.ok) throw new Error(await response.text());

  const data = await response.json();
  const text = data.choices[0].message.content.trim();

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Não encontrou JSON na resposta');

  return JSON.parse(jsonMatch[0]);
}

module.exports = {
  async processarExame(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const texto = await extrairTextoPDF(fileBuffer);
    const prompt = montarPrompt(texto);
    const parsed = await chamarGroq(prompt);
    return parsed;
  }
};
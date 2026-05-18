// backend/src/controllers/AudioController.js
// Recebe blob de áudio do frontend
// 1. Transcreve com Groq Whisper-large-v3 (áudio → texto)
// 2. Analisa com Groq LLM (texto → evolucaoTexto + acoes faturáveis)
// Chave Groq fica APENAS aqui — nunca exposta no browser

const fs   = require('fs');
const path = require('path');

// ─── Prompt de análise clínica ────────────────────────────────────────────────

const buildPrompt = (texto) => `
Você é um assistente clínico veterinário. Analise a nota clínica abaixo.
Retorne APENAS um JSON válido, sem markdown, sem texto adicional:

{
  "evolucaoTexto": "texto limpo e organizado para o prontuário",
  "acoes": [
    { "tipo": "MEDICAMENTO",    "descricao": "Amoxicilina 500mg 2x/dia 7 dias", "valor": 45.00 },
    { "tipo": "PROCEDIMENTO",   "descricao": "Curativo membro anterior direito", "valor": 80.00 },
    { "tipo": "EXAME",          "descricao": "Hemograma completo",               "valor": 120.00 },
    { "tipo": "ENCAMINHAMENTO", "descricao": "Ortopedia — suspeita de fratura",  "valor": 0.00  }
  ]
}

Regras:
- acoes deve conter APENAS itens explicitamente mencionados na nota
- Se não houver itens acionáveis, retorne acoes: []
- evolucaoTexto deve ser o texto organizado, sem repetições
- Tipos válidos: MEDICAMENTO, PROCEDIMENTO, EXAME, ENCAMINHAMENTO
- Valores devem ser estimativas em reais baseadas na tabela veterinária brasileira
- Nunca invente itens que não foram mencionados

Nota clínica:
${texto}
`.trim();

// ─── Transcrição via Groq Whisper ─────────────────────────────────────────────

async function transcreverComGroq(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName   = path.basename(filePath);

  // Groq Whisper aceita multipart/form-data
  const FormData = (await import('node-fetch')).default
    ? null
    : null; // node-fetch não é necessário — usamos fetch nativo do Node 18+

  const blob     = new Blob([fileBuffer], { type: 'audio/webm' });
  const formData = new globalThis.FormData();
  formData.append('file',  blob, fileName);
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'pt');
  formData.append('response_format', 'json');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body:    formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq Whisper error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.text?.trim() ?? '';
}

// ─── Análise via Groq LLM ─────────────────────────────────────────────────────

async function analisarComLLM(texto) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: buildPrompt(texto) }],
      temperature: 0.1,
      max_tokens:  800,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq LLM error ${response.status}: ${err}`);
  }

  const data  = await response.json();
  const raw   = data.choices[0].message.content.trim();
  const match = raw.match(/\{[\s\S]*\}/);

  if (!match) throw new Error('LLM não retornou JSON válido');

  const parsed = JSON.parse(match[0]);
  return {
    evolucaoTexto: parsed.evolucaoTexto ?? texto,
    acoes:         Array.isArray(parsed.acoes) ? parsed.acoes : [],
  };
}

// ─── Controller ───────────────────────────────────────────────────────────────

const AudioController = {

  /**
   * POST /api/clinica/audio/processar
   * Body: multipart/form-data { audio: Blob, contexto: string }
   * Resposta: { sucesso, dados: { textoTranscrito, evolucaoTexto, acoes } }
   */
  processar: async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        sucesso:  false,
        mensagem: 'Arquivo de áudio é obrigatório',
      });
    }

    const filePath = req.file.path;

    try {
      // Passo 1 — Whisper: áudio → texto
      const textoTranscrito = await transcreverComGroq(filePath);

      if (!textoTranscrito) {
        return res.status(422).json({
          sucesso:  false,
          mensagem: 'Nenhuma fala detectada no áudio. Tente novamente.',
        });
      }

      // Passo 2 — LLM: texto → evolucaoTexto + acoes
      const { evolucaoTexto, acoes } = await analisarComLLM(textoTranscrito);

      res.json({
        sucesso: true,
        dados:   { textoTranscrito, evolucaoTexto, acoes },
      });

    } catch (error) {
      console.error('AudioController.processar error:', error);
      res.status(500).json({
        sucesso:  false,
        mensagem: error.message ?? 'Erro ao processar áudio',
      });

    } finally {
      // Remove arquivo temporário do disco em qualquer caso
      try { fs.unlinkSync(filePath); } catch { /* ignora */ }
    }
  },

};

module.exports = AudioController;
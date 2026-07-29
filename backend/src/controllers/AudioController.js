// backend/src/controllers/AudioController.js
// Recebe blob de áudio do frontend:
//   1. Transcreve com Gemini (áudio → texto)
//   2. Analisa com Gemini (texto → evolucaoTexto + ações faturáveis)
// A chave da API fica APENAS no backend — nunca exposta no browser.
//
// NOTA: a rota /api/clinica/audio ainda não está montada em server.ts. O
// controller é mantido funcional para quando o fluxo de ditado longo for ligado.

const fs   = require('fs');
const path = require('path');

const { callAI, MODULOS_IA }   = require('../ai');
const { buildPrompt }          = require('../ai/prompts');
const { transcreverAudio }     = require('../ai/geminiClient');
const { logAiUsage }           = require('../services/aiLogger.service');
const { transcodeParaMp3, EXTS_INCOMPATIVEIS_SAFARI } = require('../lib/audioTranscode');

// ─── Transcrição via Gemini ───────────────────────────────────────────────────

async function transcrever(filePath, originalname, mimetypeOriginal, userId, empresaId) {
  const ext              = path.extname(originalname || '').toLowerCase();
  // WebM/Opus (gravação do app) e Ogg (WhatsApp) não são aceitos — converte p/ MP3.
  const precisaConverter = EXTS_INCOMPATIVEIS_SAFARI.has(ext) || !ext;
  const audioPath        = precisaConverter ? `${filePath}.mp3` : filePath;
  const mimeType         = precisaConverter ? 'audio/mp3' : (mimetypeOriginal || 'audio/mp3');

  if (precisaConverter) {
    await transcodeParaMp3(filePath, audioPath);
    try { fs.unlinkSync(filePath); } catch { /* ignora */ }
  }

  const inicio = Date.now();
  try {
    const buffer = fs.readFileSync(audioPath);
    const r      = await transcreverAudio(buffer, mimeType);

    await logAiUsage({
      operacao:         'transcricao_audio@v1',
      modulo:           MODULOS_IA.TRANSCRICAO,
      modelo:           r.modelo,
      provedor:         r.provedor,
      promptTexto:      '',
      respostaTexto:    r.text,
      tokensEntradaApi: r.tokensEntrada ?? undefined,
      tokensSaidaApi:   r.tokensSaida   ?? undefined,
      latenciaMs:       Date.now() - inicio,
      userId,
      empresaId,
      sucesso:          true,
    });

    return (r.text ?? '').trim();
  } finally {
    try { fs.unlinkSync(audioPath); } catch { /* ignora */ }
  }
}

// ─── Análise da nota clínica ──────────────────────────────────────────────────

async function analisarComLLM(texto, userId, empresaId) {
  const { operacaoVers, prompt } = buildPrompt('analise_nota_clinica', texto);

  const raw = await callAI({
    operacao:    operacaoVers,
    modulo:      MODULOS_IA.ATENDIMENTO,
    prompt,
    maxTokens:   800,
    temperature: 0.1,
    userId,
    empresaId,
  });

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Modelo não retornou JSON válido');

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

    const userId    = req.user?.id ?? null;
    const empresaId = req.empresaId ?? null;

    try {
      // Passo 1 — áudio → texto
      const textoTranscrito = await transcrever(
        req.file.path, req.file.originalname, req.file.mimetype, userId, empresaId,
      );

      if (!textoTranscrito) {
        return res.status(422).json({
          sucesso:  false,
          mensagem: 'Nenhuma fala detectada no áudio. Tente novamente.',
        });
      }

      // Passo 2 — texto → evolucaoTexto + acoes
      const { evolucaoTexto, acoes } = await analisarComLLM(textoTranscrito, userId, empresaId);

      res.json({
        sucesso: true,
        dados:   { textoTranscrito, evolucaoTexto, acoes },
      });

    } catch (error) {
      // Garante a limpeza mesmo se a falha for antes do finally do transcrever
      try { fs.unlinkSync(req.file.path); } catch { /* ignora */ }
      console.error('AudioController.processar error:', error);
      res.status(500).json({
        sucesso:  false,
        mensagem: error.message ?? 'Erro ao processar áudio',
      });
    }
  },

};

module.exports = AudioController;

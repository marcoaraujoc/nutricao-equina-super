// backend/src/controllers/DocumentoChatController.js
// Chat da Central de Documentos. Controller enxuto: valida a entrada, chama o
// service e devolve — a regra (acervo, validação da resposta do modelo) vive em
// `services/documentoLLMService.js`.
'use strict';

const { conversar } = require('../services/documentoLLMService');

const MAX_MENSAGEM = 2000;

const DocumentoChatController = {

  // POST /api/documentos/chat  { conversa[], templateId?, blocos? }
  conversar: async (req, res, next) => {
    try {
      const conversa = Array.isArray(req.body?.conversa)
        ? req.body.conversa
            .filter(m => m && typeof m.texto === 'string')
            .map(m => ({ papel: m.papel === 'assistente' ? 'assistente' : 'usuario', texto: m.texto.slice(0, MAX_MENSAGEM) }))
        : [];

      if (conversa.length === 0) {
        return res.status(400).json({ sucesso: false, error: 'Envie uma mensagem.', code: 'CONVERSA_VAZIA' });
      }

      const dados = await conversar(req, {
        conversa,
        templateId: req.body?.templateId ?? null,
        blocos:     Array.isArray(req.body?.blocos) ? req.body.blocos : null,
      });
      return res.json({ sucesso: true, dados });
    } catch (err) {
      // Estouro de plano de IA vira 429 no error handler global de server.ts — este
      // controller tem try/catch próprio, então precisa REPASSAR (§7 do CLAUDE.md);
      // engolir aqui devolveria um 500 genérico e esconderia o motivo real.
      if (err?.code === 'IA_QUOTA_EXCEDIDA') return next(err);
      console.error('Erro no chat de documentos:', err);
      return res.status(502).json({
        sucesso: false, code: 'IA_INDISPONIVEL',
        error: 'Não foi possível falar com a IA agora. Tente de novo em instantes.',
      });
    }
  },
};

module.exports = DocumentoChatController;

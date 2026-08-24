// backend/src/controllers/FaturaPublicaController.js
//
// Rota PÚBLICA (sem `authenticate`) do link de fatura — ver
// lib/faturaLinkPublico.js para o modelo de segurança completo (token de 64
// caracteres, capability URL pura, escopo de plataforma no RLS).
'use strict';

const { abrirLink, obterResumo } = require('../lib/faturaLinkPublico');

const FaturaPublicaController = {

  // GET /api/fatura-publica/:token/resumo — dados estruturados para o
  // CABEÇALHO da página pública (clínica, cliente, animal, status, total).
  // É esta rota, chamada uma vez por visita, que conta como "acesso" (grava
  // ACESSO_PUBLICO e incrementa o contador do link).
  resumo: async (req, res) => {
    const token = String(req.params.token ?? '');
    try {
      const resultado = await obterResumo({ token, ip: req.ip });
      if (!resultado.ok) return res.status(resultado.status).json(resultado.corpo);
      return res.json({ dados: resultado.dados });
    } catch (err) {
      console.error('FaturaPublicaController.resumo:', err);
      return res.status(500).json({ mensagem: 'Erro ao carregar a fatura.' });
    }
  },

  // GET /api/fatura-publica/:token
  // Sucesso: o CORPO da resposta É o PDF (Content-Type: application/pdf).
  // Falha: JSON com a mensagem (link não encontrado / expirado / revogado).
  abrir: async (req, res) => {
    const token = String(req.params.token ?? '');
    try {
      const resultado = await abrirLink({ req, res, token });
      if (resultado.jaRespondido) return; // enviarArquivo já escreveu a resposta
      return res.status(resultado.status).json(resultado.corpo);
    } catch (err) {
      console.error('FaturaPublicaController.abrir:', err);
      if (!res.headersSent) return res.status(500).json({ mensagem: 'Erro ao abrir a fatura.' });
    }
  },
};

module.exports = FaturaPublicaController;

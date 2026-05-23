'use strict';

const express              = require('express');
const router               = express.Router();
const { authenticate }     = require('../middlewares/auth');
const { validarCRMV, statusIndice } = require('../services/crmvService');
const { executarScraping } = require('../services/crmvScraperService');

// GET /api/crmv/validar?crmv=12345/SP — valida contra o índice local
router.get('/validar', authenticate, async (req, res) => {
  const { crmv } = req.query;
  if (!crmv) return res.status(400).json({ sucesso: false, mensagem: 'crmv é obrigatório' });

  try {
    const resultado = await validarCRMV(crmv);
    res.json({ sucesso: true, dados: resultado });
  } catch (err) {
    console.error('Erro ao validar CRMV:', err);
    res.json({ sucesso: true, dados: { valido: null, motivo: 'erro_interno' } });
  }
});

// GET /api/crmv/status — informações do índice (última sincronização, total)
router.get('/status', authenticate, async (_req, res) => {
  try {
    res.json({ sucesso: true, dados: await statusIndice() });
  } catch {
    res.status(500).json({ sucesso: false, mensagem: 'Erro ao consultar status do índice' });
  }
});

// POST /api/crmv/sincronizar — dispara scraping manual (apenas ADMIN)
// A resposta é imediata; o scraping roda em background.
router.post('/sincronizar', authenticate, async (req, res) => {
  const tipo = (req.user?.userType ?? req.user?.role ?? '').toUpperCase();
  if (tipo !== 'ADMIN') {
    return res.status(403).json({ sucesso: false, mensagem: 'Acesso restrito a administradores' });
  }

  res.json({ sucesso: true, mensagem: 'Sincronização iniciada em background. Pode levar várias horas.' });

  executarScraping().catch(err =>
    console.error('[CRMV] Erro no scraping manual:', err.message)
  );
});

module.exports = router;
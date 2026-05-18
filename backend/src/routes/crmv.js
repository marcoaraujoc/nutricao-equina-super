// backend/src/routes/crmv.js
const express          = require('express');
const router           = express.Router();
const { authenticate } = require('../middlewares/auth');
const { validarCRMV }  = require('../services/crmvService');

router.get('/validar', authenticate, async (req, res) => {
  const { crmv } = req.query;
  if (!crmv) return res.status(400).json({ sucesso: false, mensagem: 'crmv é obrigatório' });

  try {
    const resultado = await validarCRMV(crmv);
    res.json({ sucesso: true, dados: resultado });
  } catch (err) {
    console.error('Erro ao validar CRMV:', err);
    // Nunca retorna erro — deixa o frontend continuar
    res.json({ sucesso: true, dados: { valido: null, motivo: 'cfmv_indisponivel' } });
  }
});

module.exports = router;
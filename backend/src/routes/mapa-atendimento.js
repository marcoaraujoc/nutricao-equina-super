// backend/src/routes/mapa-atendimento.js
const express = require('express');
const router  = express.Router();
const { authenticate }         = require('../middlewares/auth');
const { checkPermission }      = require('../middlewares/permissao.middleware');
const MapaAtendimentoController = require('../controllers/MapaAtendimentoController');

// GET /api/mapa-atendimento/resumo?data=YYYY-MM-DD&localizacaoId=X&veterinarioId=Y
router.get(
  '/resumo',
  authenticate,
  checkPermission('dashboard.geral.ler', 'LEITURA'),
  MapaAtendimentoController.resumo,
);

module.exports = router;

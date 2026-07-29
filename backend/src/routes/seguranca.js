// backend/src/routes/seguranca.js
// Configuração GLOBAL de segurança da plataforma — exclusiva do ADMIN.
// Não é configuração de empresa (essa vive em /api/equipes/configuracoes):
// o que se define aqui vale para todos os tenants.
'use strict';

const express = require('express');
const router  = express.Router();

const { authenticate, authorize } = require('../middlewares/auth');
const SegurancaController = require('../controllers/SegurancaController');

router.get('/config', authenticate, authorize('ADMIN'), SegurancaController.obter);
router.put('/config', authenticate, authorize('ADMIN'), SegurancaController.salvar);

module.exports = router;

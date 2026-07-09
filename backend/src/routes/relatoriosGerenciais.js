// backend/src/routes/relatoriosGerenciais.js
'use strict';

const express = require('express');
const router  = express.Router();

const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');
const { gerencial }       = require('../controllers/RelatorioGerencialController');

// GET /api/relatorios/gerencial — todos os blocos do módulo Relatórios
router.get('/gerencial', authenticate, checkPermission('relatorios.gerencial.ler', 'LEITURA'), gerencial);

module.exports = router;

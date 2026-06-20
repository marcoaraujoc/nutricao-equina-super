// backend/src/routes/dashboard.js
'use strict';

const express = require('express');
const router  = express.Router();

const { authenticate }        = require('../middlewares/auth');
const { checkPermission }     = require('../middlewares/permissao.middleware');
const { stats }               = require('../controllers/DashboardController');

// GET /api/dashboard/stats
router.get('/stats', authenticate, checkPermission('dashboard.geral.ler', 'LEITURA'), stats);

module.exports = router;

// backend/src/routes/relatoriosGerenciais.js
'use strict';

const express = require('express');
const router  = express.Router();

const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');
const { gerencial }       = require('../controllers/RelatorioGerencialController');
const Relatorios          = require('../controllers/RelatoriosController');
const AnaliseFinanceira   = require('../controllers/AnaliseFinanceiraController');

const perm = checkPermission('relatorios.gerencial.ler', 'LEITURA');

// GET /api/relatorios/gerencial — cards de governança (legado)
router.get('/gerencial',    authenticate, perm, gerencial);

// IA Financeira — análise gerencial do período (rota literal antes de /financeiro)
router.get('/financeiro/analise-ia', authenticate, perm, AnaliseFinanceira.analisar);

// Relatórios por categoria
router.get('/financeiro',   authenticate, perm, Relatorios.financeiro);
router.get('/atendimento',  authenticate, perm, Relatorios.atendimento);
router.get('/cadastro',     authenticate, perm, Relatorios.cadastro);
router.get('/farmacia',     authenticate, perm, Relatorios.farmacia);
router.get('/orcamentos',   authenticate, perm, Relatorios.orcamentos);

module.exports = router;

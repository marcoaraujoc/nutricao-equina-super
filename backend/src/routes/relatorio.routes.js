// backend/src/routes/relatorio.routes.js
const express = require('express');
const RelatorioController = require('../controllers/relatorio.controller');
const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

const router = express.Router();

router.get('/animal/:animalId', authenticate, checkPermission('nutricao.relatorios.ler', 'LEITURA'), RelatorioController.gerarPorAnimal);

module.exports = router;
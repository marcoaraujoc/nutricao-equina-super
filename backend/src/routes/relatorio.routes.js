const express = require('express');
const router = express.Router();
const relatorioController = require('../controllers/relatorio.controller');

// Rota principal
router.get('/animal/:animalId', relatorioController.gerarRelatorio);

module.exports = router;
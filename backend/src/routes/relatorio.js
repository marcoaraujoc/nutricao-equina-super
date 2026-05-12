// backend/src/routes/relatorio.routes.js
const express = require('express');
const RelatorioController = require('../controllers/relatorio.controller');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.get('/animal/:animalId', authenticate, RelatorioController.gerarPorAnimal);

module.exports = router;
// backend/src/routes/relatorio.routes.js
const express = require('express');
const RelatorioController = require('../controllers/relatorio.controller');
const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');
const { exigirAcessoAnimal } = require('../middlewares/animalAcesso.middleware');

const router = express.Router();

// O relatório expõe peso, plano e dieta do paciente — exige acesso ao animal.
router.get('/animal/:animalId', authenticate, checkPermission('nutricao.relatorios.ler', 'LEITURA'), exigirAcessoAnimal(), RelatorioController.gerarPorAnimal);

module.exports = router;
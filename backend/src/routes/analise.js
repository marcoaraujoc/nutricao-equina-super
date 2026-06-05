const express = require('express');
const controller = require('../controllers/AnaliseController');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

const router = express.Router();

router.get('/:animalId', authenticate, checkPermission('nutricao.dietas.ler', 'LEITURA'), controller.calcularBalanço);

module.exports = router;

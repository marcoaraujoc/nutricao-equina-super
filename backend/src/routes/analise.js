const express = require('express');
const controller = require('../controllers/AnaliseController');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');
const { exigirAcessoAnimal } = require('../middlewares/animalAcesso.middleware');

const router = express.Router();

// O :animalId é o recurso — sem o guard, qualquer id da plataforma respondia.
router.get('/:animalId', authenticate, checkPermission('nutricao.dietas.ler', 'LEITURA'), exigirAcessoAnimal(), controller.calcularBalanço);

module.exports = router;

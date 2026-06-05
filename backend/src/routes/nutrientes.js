const express = require('express');
const nutrientesController = require('../controllers/NutrientesController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.get('/',     authenticate, nutrientesController.listar);
router.post('/',    authenticate, nutrientesController.criar);
router.get('/:id',  authenticate, nutrientesController.obterPorId);
router.put('/:id',  authenticate, nutrientesController.atualizar);
router.delete('/:id', authenticate, nutrientesController.excluir);

module.exports = router;

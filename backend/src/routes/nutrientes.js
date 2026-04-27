const express = require('express');
const nutrientesController = require('../controllers/NutrientesController');

const router = express.Router();

router.get('/', nutrientesController.listar);
router.post('/', nutrientesController.criar);
router.get('/:id', nutrientesController.obterPorId);
router.put('/:id', nutrientesController.atualizar);
router.delete('/:id', nutrientesController.excluir);

module.exports = router;
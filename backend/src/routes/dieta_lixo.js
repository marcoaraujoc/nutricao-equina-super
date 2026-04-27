const express = require('express');
const dietaController = require('../controllers/DietaController');

const router = express.Router();

router.get('/', dietaController.listar);
router.post('/', dietaController.criar);
router.get('/:id', dietaController.obterPorId);
router.put('/:id', dietaController.atualizar);
router.delete('/:id', dietaController.excluir);

module.exports = router;
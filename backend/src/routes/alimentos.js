const express = require('express');
const alimentoController = require('../controllers/AlimentoController');

const router = express.Router();

router.get('/', alimentoController.listar);
router.post('/', alimentoController.criar);
router.get('/:id', alimentoController.obterPorId);
router.put('/:id', alimentoController.atualizar);
router.delete('/:id', alimentoController.excluir);

module.exports = router;
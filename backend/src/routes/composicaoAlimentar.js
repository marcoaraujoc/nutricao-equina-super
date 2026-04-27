const express = require('express');
const composicaoController = require('../controllers/ComposicaoAlimentarController');

const router = express.Router();

router.get('/', composicaoController.listar);
router.post('/', composicaoController.criar);
router.get('/:id', composicaoController.obterPorId);
router.put('/:id', composicaoController.atualizar);
router.delete('/:id', composicaoController.excluir);

module.exports = router;
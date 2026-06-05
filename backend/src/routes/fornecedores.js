'use strict';

const express                = require('express');
const FornecedorController   = require('../controllers/FornecedorController');
const { authenticate }       = require('../middlewares/auth');

const router = express.Router();

router.get   ('/',           authenticate, FornecedorController.listar);
router.post  ('/',           authenticate, FornecedorController.criar);
router.get   ('/:id',        authenticate, FornecedorController.obterPorId);
router.put   ('/:id',        authenticate, FornecedorController.atualizar);
router.patch ('/:id/toggle', authenticate, FornecedorController.toggleAtivo);
router.delete('/:id',        authenticate, FornecedorController.excluir);

module.exports = router;

'use strict';

const express                = require('express');
const FornecedorController   = require('../controllers/FornecedorController');
const { authenticate }       = require('../middlewares/auth');

const router = express.Router();

router.get   ('/tipos',       authenticate, FornecedorController.listarTipos);
router.get   ('/',            authenticate, FornecedorController.listar);
router.post  ('/',            authenticate, FornecedorController.criar);
router.get   ('/:id',         authenticate, FornecedorController.obterPorId);
router.put   ('/:id',         authenticate, FornecedorController.atualizar);
router.patch ('/:id/toggle',  authenticate, FornecedorController.toggleAtivo);

module.exports = router;

'use strict';

const express                = require('express');
const FornecedorController   = require('../controllers/FornecedorController');
const { authenticate }       = require('../middlewares/auth');
const { checkPermission }    = require('../middlewares/permissao.middleware');

const router = express.Router();

router.get   ('/tipos',       authenticate, checkPermission('cadastro.fornecedor.ler',    'LEITURA'), FornecedorController.listarTipos);
router.get   ('/',            authenticate, checkPermission('cadastro.fornecedor.ler',    'LEITURA'), FornecedorController.listar);
router.post  ('/',            authenticate, checkPermission('cadastro.fornecedor.criar',   'PROPRIO'), FornecedorController.criar);
router.get   ('/:id',         authenticate, checkPermission('cadastro.fornecedor.ler',    'LEITURA'), FornecedorController.obterPorId);
router.put   ('/:id',         authenticate, checkPermission('cadastro.fornecedor.editar',  'PROPRIO'), FornecedorController.atualizar);
router.patch ('/:id/toggle',  authenticate, checkPermission('cadastro.fornecedor.ativar',  'PROPRIO'), FornecedorController.toggleAtivo);

module.exports = router;

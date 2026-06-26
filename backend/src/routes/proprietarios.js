'use strict';

const express                  = require('express');
const ProprietarioController   = require('../controllers/ProprietarioController');
const { authenticate }         = require('../middlewares/auth');
const { checkPermission }      = require('../middlewares/permissao.middleware');

const router = express.Router();

router.get   ('/',           authenticate, checkPermission('cadastro.proprietario.ler',    'LEITURA'), ProprietarioController.listar);
router.post  ('/',           authenticate, checkPermission('cadastro.proprietario.criar',   'PROPRIO'), ProprietarioController.criar);
router.get   ('/:id',        authenticate, checkPermission('cadastro.proprietario.ler',    'LEITURA'), ProprietarioController.obterPorId);
router.put   ('/:id',        authenticate, checkPermission('cadastro.proprietario.editar',  'PROPRIO'), ProprietarioController.atualizar);
router.patch ('/:id/toggle', authenticate, checkPermission('cadastro.proprietario.ativar',  'PROPRIO'), ProprietarioController.toggleAtivo);
router.delete('/:id',        authenticate, checkPermission('cadastro.proprietario.deletar', 'PROPRIO'), ProprietarioController.removerDaEmpresa);

module.exports = router;

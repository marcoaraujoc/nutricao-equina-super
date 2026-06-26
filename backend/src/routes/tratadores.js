'use strict';

const express            = require('express');
const TratadorController = require('../controllers/TratadorController');
const { authenticate }   = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

const router = express.Router();

router.get   ('/',           authenticate, checkPermission('cadastro.tratador.ler',    'LEITURA'), TratadorController.listar);
router.post  ('/',           authenticate, checkPermission('cadastro.tratador.criar',   'PROPRIO'), TratadorController.criar);
router.get   ('/:id',        authenticate, checkPermission('cadastro.tratador.ler',    'LEITURA'), TratadorController.obterPorId);
router.put   ('/:id',        authenticate, checkPermission('cadastro.tratador.editar',  'PROPRIO'), TratadorController.atualizar);
router.patch ('/:id/toggle', authenticate, checkPermission('cadastro.tratador.ativar',  'PROPRIO'), TratadorController.toggleAtivo);

module.exports = router;

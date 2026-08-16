'use strict';

const express               = require('express');
const PrestadorController   = require('../controllers/PrestadorController');
const { authenticate }      = require('../middlewares/auth');
const { checkPermission }   = require('../middlewares/permissao.middleware');

const router = express.Router();

router.get   ('/tipos',       authenticate, checkPermission('cadastro.prestador.ler',    'LEITURA'), PrestadorController.listarTipos);
router.get   ('/',            authenticate, checkPermission('cadastro.prestador.ler',    'LEITURA'), PrestadorController.listar);
router.post  ('/',            authenticate, checkPermission('cadastro.prestador.criar',   'PROPRIO'), PrestadorController.criar);
router.get   ('/:id',         authenticate, checkPermission('cadastro.prestador.ler',    'LEITURA'), PrestadorController.obterPorId);
router.put   ('/:id',         authenticate, checkPermission('cadastro.prestador.editar',  'PROPRIO'), PrestadorController.atualizar);
router.patch ('/:id/toggle',  authenticate, checkPermission('cadastro.prestador.ativar',  'PROPRIO'), PrestadorController.toggleAtivo);

module.exports = router;

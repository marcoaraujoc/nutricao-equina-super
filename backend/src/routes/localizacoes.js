'use strict';

const express                      = require('express');
const LocalizacaoAnimalController  = require('../controllers/LocalizacaoAnimalController');
const { authenticate }             = require('../middlewares/auth');
const { checkPermission }          = require('../middlewares/permissao.middleware');

const router = express.Router();

// Rota de tipos: antes de /:id para não ser capturada como parâmetro
router.get   ('/tipos',       authenticate, checkPermission('cadastro.localizacao.ler',   'LEITURA'), LocalizacaoAnimalController.listarTipos);

router.get   ('/',            authenticate, checkPermission('cadastro.localizacao.ler',   'LEITURA'), LocalizacaoAnimalController.listar);
router.post  ('/',            authenticate, checkPermission('cadastro.localizacao.criar',  'LEITURA'), LocalizacaoAnimalController.criar);
router.get   ('/:id',         authenticate, checkPermission('cadastro.localizacao.ler',   'LEITURA'), LocalizacaoAnimalController.obterPorId);
router.put   ('/:id',         authenticate, checkPermission('cadastro.localizacao.editar', 'PROPRIO'), LocalizacaoAnimalController.atualizar);
router.patch ('/:id/toggle',  authenticate, checkPermission('cadastro.localizacao.ativar', 'PROPRIO'), LocalizacaoAnimalController.toggleAtivo);

module.exports = router;

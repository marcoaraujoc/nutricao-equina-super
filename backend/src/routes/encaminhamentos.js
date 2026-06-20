// backend/src/routes/encaminhamentos.js
'use strict';

const express                   = require('express');
const router                    = express.Router();
const EncaminhamentoController  = require('../controllers/EncaminhamentoController');
const { authenticate }          = require('../middlewares/auth');
const { checkPermission }       = require('../middlewares/permissao.middleware');

// Literais ANTES de /:id para evitar conflito de parâmetro
router.get('/prestadores/:animalId', authenticate, checkPermission('atendimento.encaminhamentos.criar',   'PROPRIO'), EncaminhamentoController.listarPrestadores);
router.get('/animal/:animalId',      authenticate, checkPermission('atendimento.encaminhamentos.ler',     'LEITURA'), EncaminhamentoController.listarPorAnimal);
router.get('/:id',                   authenticate, checkPermission('atendimento.encaminhamentos.ler',     'LEITURA'), EncaminhamentoController.obterPorId);
router.post('/',                     authenticate, checkPermission('atendimento.encaminhamentos.criar',   'PROPRIO'), EncaminhamentoController.criar);
router.patch('/:id/status',          authenticate, checkPermission('atendimento.encaminhamentos.editar',  'PROPRIO'), EncaminhamentoController.atualizarStatus);
router.put('/:id',                   authenticate, checkPermission('atendimento.encaminhamentos.editar',  'PROPRIO'), EncaminhamentoController.atualizar);
router.delete('/:id',                authenticate, checkPermission('atendimento.encaminhamentos.deletar', 'PROPRIO'), EncaminhamentoController.excluir);

module.exports = router;

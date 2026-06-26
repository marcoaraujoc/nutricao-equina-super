// backend/src/routes/clinica-exames.js  — montado em /api/clinica/exames
'use strict';

const express                  = require('express');
const router                   = express.Router();
const ExameClinicoController   = require('../controllers/ExameClinicoController');
const { authenticate }         = require('../middlewares/auth');
const { checkPermission }      = require('../middlewares/permissao.middleware');

router.get('/animal/:animalId',   authenticate, checkPermission('atendimento.exames.ler',       'LEITURA'), ExameClinicoController.listarPorAnimal);
router.get('/:id',                authenticate, checkPermission('atendimento.exames.ler',       'LEITURA'), ExameClinicoController.obterPorId);
router.post('/',                  authenticate, checkPermission('atendimento.exames.criar',      'PROPRIO'), ExameClinicoController.criar);
router.put('/:id',                authenticate, checkPermission('atendimento.exames.editar',     'PROPRIO'), ExameClinicoController.atualizar);
router.patch('/:id/finalizar',    authenticate, checkPermission('atendimento.exames.finalizar',  'PROPRIO'), ExameClinicoController.finalizar);
router.delete('/:id',             authenticate, checkPermission('atendimento.exames.deletar',    'PROPRIO'), ExameClinicoController.excluir);

module.exports = router;

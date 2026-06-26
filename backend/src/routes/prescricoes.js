// backend/src/routes/prescricoes.js
'use strict';

const express                    = require('express');
const router                     = express.Router();
const PrescricaoController       = require('../controllers/PrescricaoController');
const PrescricaoGrupoController  = require('../controllers/PrescricaoGrupoController');
const { authenticate }           = require('../middlewares/auth');
const { checkPermission }        = require('../middlewares/permissao.middleware');

// ── Grupos (nova API de prescrição por documento) ─────────────────────────────
// Literais ANTES de /:id para evitar conflito de parâmetro
router.get('/grupos/execucao',            authenticate, checkPermission('atendimento.prescricoes.ler',     'LEITURA'), PrescricaoGrupoController.listarParaExecucao);
router.get('/grupos/animal/:animalId',    authenticate, checkPermission('atendimento.prescricoes.ler',     'LEITURA'), PrescricaoGrupoController.listarPorAnimal);
router.get('/grupos/:id',                 authenticate, checkPermission('atendimento.prescricoes.ler',     'LEITURA'), PrescricaoGrupoController.obterPorId);
router.post('/grupos',                    authenticate, checkPermission('atendimento.prescricoes.criar',   'PROPRIO'), PrescricaoGrupoController.criar);
router.post('/grupos/:id/itens',          authenticate, checkPermission('atendimento.prescricoes.editar',  'PROPRIO'), PrescricaoGrupoController.adicionarItem);
router.put('/grupos/:id/itens/:itemId',   authenticate, checkPermission('atendimento.prescricoes.editar',  'PROPRIO'), PrescricaoGrupoController.atualizarItem);
router.delete('/grupos/:id/itens/:itemId', authenticate, checkPermission('atendimento.prescricoes.deletar', 'PROPRIO'), PrescricaoGrupoController.removerItem);
router.post('/grupos/:id/finalizar',      authenticate, checkPermission('atendimento.prescricoes.finalizar', 'PROPRIO'), PrescricaoGrupoController.finalizar);
router.post('/grupos/:id/cancelar',       authenticate, checkPermission('atendimento.prescricoes.finalizar', 'PROPRIO'), PrescricaoGrupoController.cancelar);
router.post('/grupos/:id/executar',       authenticate, checkPermission('atendimento.prescricoes.editar',  'PROPRIO'), PrescricaoGrupoController.executar);

// ── Legacy (individual items — backward compat) ───────────────────────────────
router.post('/finalizar/:animalId', authenticate, checkPermission('atendimento.prescricoes.finalizar', 'PROPRIO'), PrescricaoController.finalizarTodas);
router.post('/finalizar-uma/:id',   authenticate, checkPermission('atendimento.prescricoes.finalizar', 'PROPRIO'), PrescricaoController.finalizarUma);
router.get('/animal/:animalId',     authenticate, checkPermission('atendimento.prescricoes.ler',     'LEITURA'), PrescricaoController.listarPorAnimal);
router.post('/',                    authenticate, checkPermission('atendimento.prescricoes.criar',   'PROPRIO'), PrescricaoController.criar);
router.put('/:id',                  authenticate, checkPermission('atendimento.prescricoes.editar',  'PROPRIO'), PrescricaoController.atualizar);
router.delete('/:id',               authenticate, checkPermission('atendimento.prescricoes.deletar', 'PROPRIO'), PrescricaoController.excluir);

module.exports = router;
// backend/src/routes/prescricoes.js
'use strict';

const express                    = require('express');
const router                     = express.Router();
const PrescricaoController       = require('../controllers/PrescricaoController');
const PrescricaoGrupoController  = require('../controllers/PrescricaoGrupoController');
const { authenticate }           = require('../middlewares/auth');

// ── Grupos (nova API de prescrição por documento) ─────────────────────────────
// Literais ANTES de /:id para evitar conflito de parâmetro
router.get('/grupos/execucao',            authenticate, PrescricaoGrupoController.listarParaExecucao);
router.get('/grupos/animal/:animalId',    authenticate, PrescricaoGrupoController.listarPorAnimal);
router.get('/grupos/:id',                 authenticate, PrescricaoGrupoController.obterPorId);
router.post('/grupos',                    authenticate, PrescricaoGrupoController.criar);
router.post('/grupos/:id/itens',          authenticate, PrescricaoGrupoController.adicionarItem);
router.put('/grupos/:id/itens/:itemId',   authenticate, PrescricaoGrupoController.atualizarItem);
router.delete('/grupos/:id/itens/:itemId', authenticate, PrescricaoGrupoController.removerItem);
router.post('/grupos/:id/finalizar',      authenticate, PrescricaoGrupoController.finalizar);
router.post('/grupos/:id/cancelar',       authenticate, PrescricaoGrupoController.cancelar);
router.post('/grupos/:id/executar',       authenticate, PrescricaoGrupoController.executar);

// ── Legacy (individual items — backward compat) ───────────────────────────────
router.post('/finalizar/:animalId', authenticate, PrescricaoController.finalizarTodas);
router.post('/finalizar-uma/:id',   authenticate, PrescricaoController.finalizarUma);
router.get('/animal/:animalId',     authenticate, PrescricaoController.listarPorAnimal);
router.post('/',                    authenticate, PrescricaoController.criar);
router.put('/:id',                  authenticate, PrescricaoController.atualizar);
router.delete('/:id',               authenticate, PrescricaoController.excluir);

module.exports = router;
// backend/src/routes/agenda.js — montado em /api/clinica
// Histórico unificado + agendamentos do animal (tela AnimalDetail)
'use strict';

const express                 = require('express');
const router                  = express.Router();
const HistoricoController     = require('../controllers/HistoricoController');
const AgendamentoController   = require('../controllers/AgendamentoController');
const { authenticate }        = require('../middlewares/auth');

// Acesso por animal é validado nos controllers via verificarAcessoAnimal
// (cobre PROPRIETARIO, equipe, vínculo direto do vet e designação de prestador)
router.get('/historico/animal/:animalId',     authenticate, HistoricoController.listarPorAnimal);

router.get('/agendamentos/animal/:animalId',  authenticate, AgendamentoController.listarPorAnimal);
router.post('/agendamentos',                  authenticate, AgendamentoController.criar);
router.patch('/agendamentos/:id/status',      authenticate, AgendamentoController.atualizarStatus);
router.delete('/agendamentos/:id',            authenticate, AgendamentoController.excluir);

module.exports = router;

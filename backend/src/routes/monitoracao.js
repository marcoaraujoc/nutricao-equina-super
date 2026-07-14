// backend/src/routes/monitoracao.js — Config de alertas de cron + Monitoração (ADMIN)
'use strict';

const router = require('express').Router();
const { authenticate } = require('../middlewares/auth');
const ctrl = require('../controllers/MonitoracaoController');

router.use(authenticate);

router.get('/config',     ctrl.getConfig);      // config de alertas (ADMIN)
router.put('/config',     ctrl.salvarConfig);
router.get('/execucoes',  ctrl.listarExecucoes); // histórico dia|semana|mes

// Agenda (horário) das tarefas — reagendamento dinâmico
router.get('/agendas',        ctrl.listarAgendas);
router.put('/agendas/:chave', ctrl.reagendar);

module.exports = router;

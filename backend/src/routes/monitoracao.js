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

// Execução MANUAL, com rastro passo a passo. ADMIN DA PLATAFORMA apenas (gate no
// controller) — o job varre TODAS as empresas, não só a de quem clicou.
// ⚠️ Roda a tarefa de verdade: grava no banco e dispara envios.
router.post('/agendas/:chave/executar', ctrl.executarAgora);

module.exports = router;

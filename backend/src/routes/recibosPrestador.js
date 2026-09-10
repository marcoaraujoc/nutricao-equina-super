// backend/src/routes/recibosPrestador.js
// Recibo de pagamento ao PRESTADOR (2026-09-08).
//
// Gate `financeiro.recibos.*` — slug PRÓPRIO, não reaproveita `financeiro.faturas.*`.
// POR QUÊ: a fatura é o que a clínica COBRA do cliente; o recibo é o que ela PAGA ao
// prestador, e são decisões separadas na prática — a secretaria que emite fatura não
// necessariamente vê a remuneração de quem presta serviço. Reaproveitar o slug daria
// acesso à folha de pagamento de terceiros a todo mundo que fatura.
'use strict';

const express = require('express');
const ctrl    = require('../controllers/ReciboPrestadorController');
const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

const router = express.Router();

// Rota literal ANTES de qualquer `/:id` (não há nenhum hoje — mantido por hábito,
// que é o que evita a armadilha 1 quando alguém acrescentar um).
router.get('/emitente', authenticate, checkPermission('financeiro.recibos.ler', 'LEITURA'), ctrl.emitente);
router.get('/',         authenticate, checkPermission('financeiro.recibos.ler', 'LEITURA'), ctrl.listar);

module.exports = router;

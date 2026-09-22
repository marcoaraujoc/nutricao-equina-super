'use strict';
// Financeiro > PAGAMENTOS — prefixo /api/financeiro/contas-pagar
//
// O outro lado do balcão da fatura: o que a clínica DEVE ao fornecedor e ao
// prestador. Ver o cabeçalho de `ContaPagarController`.
//
// ⚠️ Slug PRÓPRIO (`financeiro.pagamentos.*`), não uma ação de `financeiro.faturas`:
// a fatura é o que a clínica COBRA do cliente; esta tela mostra o que ela PAGA a
// terceiros — inclusive a remuneração de quem executa procedimento. Reaproveitar o
// slug daria acesso à folha de pagamento de terceiros a todo mundo que fatura. Mesma
// decisão de `financeiro.recibos.*`, em 2026-09-08.

const express = require('express');
const ContaPagarController = require('../controllers/ContaPagarController');
const { authenticate }     = require('../middlewares/auth');
const { checkPermission }  = require('../middlewares/permissao.middleware');

const router = express.Router();

// Literais ANTES de /:id (armadilha 1).
router.get   ('/credores',        authenticate, checkPermission('financeiro.pagamentos.ler',    'LEITURA'), ContaPagarController.listarCredores);
router.post  ('/lancar',          authenticate, checkPermission('financeiro.pagamentos.lancar', 'PROPRIO'), ContaPagarController.lancar);
router.patch ('/itens/:itemId',   authenticate, checkPermission('financeiro.pagamentos.lancar', 'PROPRIO'), ContaPagarController.atualizarItem);
router.delete('/itens/:itemId',   authenticate, checkPermission('financeiro.pagamentos.lancar', 'PROPRIO'), ContaPagarController.removerItem);
router.get   ('/',                authenticate, checkPermission('financeiro.pagamentos.ler',    'LEITURA'), ContaPagarController.listar);
router.patch ('/:id/status',      authenticate, checkPermission('financeiro.pagamentos.pagar',  'PROPRIO'), ContaPagarController.alterarStatus);

module.exports = router;

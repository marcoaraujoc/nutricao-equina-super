// backend/src/routes/fatura.js

const express = require('express');
const router  = express.Router();
const Ctrl    = require('../controllers/FaturaController');
const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

// Listagem e consulta por proprietário
router.get('/proprietarios',                   authenticate, checkPermission('financeiro.faturas.ler',    'LEITURA'), Ctrl.listarProprietarios);
router.get('/proprietario/:proprietarioId',    authenticate, checkPermission('financeiro.faturas.ler',    'LEITURA'), Ctrl.obterFaturaProprietario);

// Itens
router.post('/:faturaId/itens',  authenticate, checkPermission('financeiro.faturas.criar',  'PROPRIO'), Ctrl.adicionarItem);
router.put('/itens/:itemId',     authenticate, checkPermission('financeiro.faturas.editar', 'PROPRIO'), Ctrl.atualizarItem);
router.delete('/itens/:itemId',  authenticate, checkPermission('financeiro.faturas.editar', 'EQUIPE'),  Ctrl.removerItem);

// Status da fatura
router.patch('/:faturaId/status', authenticate, checkPermission('financeiro.faturas.editar', 'EQUIPE'), Ctrl.atualizarStatus);

// Legado
router.get('/animal/:animalId',   authenticate, checkPermission('financeiro.faturas.ler',    'LEITURA'), Ctrl.obterFaturaAberta);

module.exports = router;
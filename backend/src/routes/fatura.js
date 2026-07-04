// backend/src/routes/fatura.js

const express = require('express');
const router  = express.Router();
const Ctrl    = require('../controllers/FaturaController');
const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

// Listagem e consulta por proprietário
router.get('/proprietarios',                   authenticate, checkPermission('financeiro.faturas.ler',    'LEITURA'), Ctrl.listarProprietarios);
router.get('/proprietario/:proprietarioId',    authenticate, checkPermission('financeiro.faturas.ler',    'LEITURA'), Ctrl.obterFaturaProprietario);
router.get('/proprietario/:proprietarioId/logo-empresa', authenticate, checkPermission('financeiro.faturas.ler', 'LEITURA'), Ctrl.obterLogoEmpresaProprietario);

// Itens
router.post('/:faturaId/itens',  authenticate, checkPermission('financeiro.faturas.criar',  'PROPRIO'), Ctrl.adicionarItem);
router.put('/itens/:itemId',     authenticate, checkPermission('financeiro.faturas.editar', 'PROPRIO'), Ctrl.atualizarItem);
router.delete('/itens/:itemId',  authenticate, checkPermission('financeiro.faturas.editar', 'EQUIPE'),  Ctrl.removerItem);

// Fechamento de fatura (adiciona assistência mensal + status FECHADA)
router.patch('/:faturaId/fechar', authenticate, checkPermission('financeiro.faturas.fechar', 'PROPRIO'), Ctrl.fecharFatura);

// Status da fatura (uso geral: PAGA, ABERTA, CANCELADA)
router.patch('/:faturaId/status', authenticate, checkPermission('financeiro.faturas.editar', 'EQUIPE'), Ctrl.atualizarStatus);

// Legado
router.get('/animal/:animalId',   authenticate, checkPermission('financeiro.faturas.ler',    'LEITURA'), Ctrl.obterFaturaAberta);

module.exports = router;
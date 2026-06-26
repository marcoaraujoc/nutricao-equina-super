// backend/src/routes/farmacia.js
'use strict';

const express           = require('express');
const router            = express.Router();
const EstoqueController = require('../controllers/EstoqueController');
const { authenticate }  = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

// Movimentos (rotas estáticas antes das parametrizadas)
router.get('/estoque/movimentos/:id', authenticate, checkPermission('farmacia.movimentacoes.ler', 'LEITURA'), EstoqueController.listarMovimentos);

// CRUD de estoque por clínica
router.get('/estoque',         authenticate, checkPermission('farmacia.estoque.ler',    'LEITURA'), EstoqueController.listar);
router.get('/estoque/:id',     authenticate, checkPermission('farmacia.estoque.ler',    'LEITURA'), EstoqueController.obterPorId);
router.post('/estoque',        authenticate, checkPermission('farmacia.estoque.criar',   'PROPRIO'), EstoqueController.criar);
router.put('/estoque/:id',     authenticate, checkPermission('farmacia.estoque.editar',  'PROPRIO'), EstoqueController.atualizar);
router.delete('/estoque/:id',  authenticate, checkPermission('farmacia.estoque.deletar', 'PROPRIO'), EstoqueController.excluir);
router.patch('/estoque/:id/ajuste', authenticate, checkPermission('farmacia.estoque.editar', 'PROPRIO'), EstoqueController.ajustarEstoque);

module.exports = router;

// backend/src/routes/farmacia.js
'use strict';

const express           = require('express');
const router            = express.Router();
const EstoqueController = require('../controllers/EstoqueController');
const { authenticate }  = require('../middlewares/auth');

// rotas estáticas antes das parametrizadas
router.get('/estoque/movimentos/:id', authenticate, EstoqueController.listarMovimentos);

// CRUD de estoque por clínica
router.get('/estoque',         authenticate, EstoqueController.listar);
router.get('/estoque/:id',     authenticate, EstoqueController.obterPorId);
router.post('/estoque',        authenticate, EstoqueController.criar);
router.put('/estoque/:id',     authenticate, EstoqueController.atualizar);
router.delete('/estoque/:id',  authenticate, EstoqueController.excluir);
router.patch('/estoque/:id/ajuste', authenticate, EstoqueController.ajustarEstoque);

module.exports = router;
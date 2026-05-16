// backend/src/routes/users.js
'use strict';

const express = require('express');
const UserAdminController = require('../controllers/UserAdminController');
const { authenticate, authorize } = require('../middlewares/auth');

const router = express.Router();

// Todas as rotas exigem autenticação + perfil ADMIN
router.get('/',              authenticate, authorize('ADMIN'), UserAdminController.listar);
router.post('/',             authenticate, authorize('ADMIN'), UserAdminController.criar);
router.get('/:id',           authenticate, authorize('ADMIN'), UserAdminController.obterPorId);
router.put('/:id',           authenticate, authorize('ADMIN'), UserAdminController.atualizar);
router.patch('/:id/toggle',  authenticate, authorize('ADMIN'), UserAdminController.toggleAtivo);
router.delete('/:id',        authenticate, authorize('ADMIN'), UserAdminController.excluir);

module.exports = router;
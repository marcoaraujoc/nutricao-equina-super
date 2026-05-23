'use strict';

const express = require('express');
const UserController      = require('../controllers/UserController');
const UserAdminController = require('../controllers/UserAdminController');
const { authenticate, authorize } = require('../middlewares/auth');

const router = express.Router();

// Self-management (qualquer usuário autenticado)
router.get   ('/me',        authenticate, UserController.getMe);
router.put   ('/me',        authenticate, UserController.updateMe);
router.patch ('/me/senha',  authenticate, UserController.alterarSenha);

// Admin CRUD (somente ADMIN)
router.get   ('/',             authenticate, authorize('ADMIN'), UserAdminController.listar);
router.post  ('/',             authenticate, authorize('ADMIN'), UserAdminController.criar);
router.get   ('/:id',          authenticate, authorize('ADMIN'), UserAdminController.obterPorId);
router.put   ('/:id',          authenticate, authorize('ADMIN'), UserAdminController.atualizar);
router.patch ('/:id/toggle',   authenticate, authorize('ADMIN'), UserAdminController.toggleAtivo);
router.delete('/:id',          authenticate, authorize('ADMIN'), UserAdminController.excluir);

module.exports = router;
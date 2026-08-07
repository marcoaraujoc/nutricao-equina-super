// backend/src/routes/planos.js — CRUD de planos do SaaS. Só ADMIN da plataforma.
'use strict';

const express = require('express');
const PlanoController = require('../controllers/PlanoController');
const { authenticate, authorize } = require('../middlewares/auth');

const router = express.Router();

router.get   ('/',           authenticate, authorize('ADMIN'), PlanoController.listar);
router.post  ('/',           authenticate, authorize('ADMIN'), PlanoController.criar);
router.put   ('/:id',        authenticate, authorize('ADMIN'), PlanoController.atualizar);
router.patch ('/:id/toggle', authenticate, authorize('ADMIN'), PlanoController.toggle);

module.exports = router;

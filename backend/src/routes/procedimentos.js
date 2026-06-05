// backend/src/routes/procedimentos.js
// Catálogo global de procedimentos — gerenciado exclusivamente pelo ADMIN.
// GET / e GET /:id ficam acessíveis a usuários autenticados (busca em prescrições).
// POST, PUT, DELETE requerem userType === 'ADMIN'.
'use strict';

const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/ProcedimentoController');
const { authenticate } = require('../middlewares/auth');

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso restrito a administradores do sistema.' });
  }
  next();
};

router.get('/',    authenticate, ctrl.listar);
router.get('/:id', authenticate, ctrl.obterPorId);
router.post('/',   authenticate, requireAdmin, ctrl.criar);
router.put('/:id', authenticate, requireAdmin, ctrl.atualizar);
router.delete('/:id', authenticate, requireAdmin, ctrl.excluir);

module.exports = router;

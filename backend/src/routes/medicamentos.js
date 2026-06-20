// backend/src/routes/medicamentos.js
// Catálogo global de medicamentos — gerenciado exclusivamente pelo ADMIN.
// GET / e GET /:id ficam acessíveis a usuários autenticados (busca em prescrições).
// POST, PUT, DELETE requerem userType === 'ADMIN'.
'use strict';

const express               = require('express');
const router                = express.Router();
const MedicamentoController = require('../controllers/MedicamentoController');
const { authenticate }      = require('../middlewares/auth');

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso restrito a administradores do sistema.' });
  }
  next();
};

// Rotas literais ANTES de /:id para evitar conflito de parâmetro
router.get('/vacinas',  authenticate, MedicamentoController.listarVacinas);
router.get('/especies', authenticate, MedicamentoController.listarEspecies);

router.get('/',       authenticate, MedicamentoController.listar);
router.get('/:id',    authenticate, MedicamentoController.obterPorId);
router.post('/',      authenticate, requireAdmin, MedicamentoController.criar);
router.put('/:id',    authenticate, requireAdmin, MedicamentoController.atualizar);
router.delete('/:id', authenticate, requireAdmin, MedicamentoController.excluir);

module.exports = router;

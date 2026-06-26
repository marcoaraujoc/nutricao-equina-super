// src/routes/alimentos.js
// Catálogo de alimentos — ADMIN gerencia; outros usuários só consultam (usado em dropdowns de dieta)

const express = require('express');
const AlimentoController = require('../controllers/AlimentoController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

const soAdmin = (req, res, next) => {
  if (req.user?.userType !== 'ADMIN') return res.status(403).json({ error: 'Acesso restrito a administradores do sistema.' });
  next();
};

router.get('/',     authenticate, AlimentoController.listar);
router.post('/',    authenticate, soAdmin, AlimentoController.criar);
router.get('/:id',  authenticate, AlimentoController.obterPorId);
router.put('/:id',  authenticate, soAdmin, AlimentoController.atualizar);
router.delete('/:id', authenticate, soAdmin, AlimentoController.excluir);

module.exports = router;

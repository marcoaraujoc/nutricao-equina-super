// src/routes/nutrientes.js
// Catálogo de nutrientes — ADMIN gerencia; outros usuários só consultam (usado em dropdowns de exame/dieta)

const express = require('express');
const nutrientesController = require('../controllers/NutrientesController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

const soAdmin = (req, res, next) => {
  if (req.user?.userType !== 'ADMIN') return res.status(403).json({ error: 'Acesso restrito a administradores do sistema.' });
  next();
};

router.get('/',     authenticate, nutrientesController.listar);
router.post('/',    authenticate, soAdmin, nutrientesController.criar);
router.get('/:id',  authenticate, nutrientesController.obterPorId);
router.put('/:id',  authenticate, soAdmin, nutrientesController.atualizar);
router.delete('/:id', authenticate, soAdmin, nutrientesController.excluir);

module.exports = router;

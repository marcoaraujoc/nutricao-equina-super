// src/routes/alimentos.js

const express = require('express');
const AlimentoController = require('../controllers/AlimentoController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.get('/',     authenticate, AlimentoController.listar);
router.post('/',    authenticate, AlimentoController.criar);
router.get('/:id',  authenticate, AlimentoController.obterPorId);
router.put('/:id',  authenticate, AlimentoController.atualizar);
router.delete('/:id', authenticate, AlimentoController.excluir);

module.exports = router;
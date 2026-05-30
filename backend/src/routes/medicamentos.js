// backend/src/routes/medicamentos.js
'use strict';

const express                = require('express');
const router                 = express.Router();
const MedicamentoController  = require('../controllers/MedicamentoController');
const { authenticate }       = require('../middlewares/auth');

router.get('/',     authenticate, MedicamentoController.listar);
router.get('/:id',  authenticate, MedicamentoController.obterPorId);
router.post('/',    authenticate, MedicamentoController.criar);
router.put('/:id',  authenticate, MedicamentoController.atualizar);
router.delete('/:id', authenticate, MedicamentoController.excluir);

module.exports = router;
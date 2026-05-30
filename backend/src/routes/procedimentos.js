'use strict';

const express    = require('express');
const router     = express.Router();
const ctrl       = require('../controllers/ProcedimentoController');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

router.get('/',    ctrl.listar);
router.get('/:id', ctrl.obterPorId);
router.post('/',   ctrl.criar);
router.put('/:id', ctrl.atualizar);
router.delete('/:id', ctrl.excluir);

module.exports = router;
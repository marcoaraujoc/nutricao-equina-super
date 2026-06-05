'use strict';

const express                  = require('express');
const ProprietarioController   = require('../controllers/ProprietarioController');
const { authenticate }         = require('../middlewares/auth');

const router = express.Router();

router.get   ('/',           authenticate, ProprietarioController.listar);
router.post  ('/',           authenticate, ProprietarioController.criar);
router.get   ('/:id',        authenticate, ProprietarioController.obterPorId);
router.put   ('/:id',        authenticate, ProprietarioController.atualizar);
router.patch ('/:id/toggle', authenticate, ProprietarioController.toggleAtivo);
router.delete('/:id',        authenticate, ProprietarioController.excluir);

module.exports = router;

'use strict';

const express            = require('express');
const TratadorController = require('../controllers/TratadorController');
const { authenticate }   = require('../middlewares/auth');

const router = express.Router();

router.get   ('/',           authenticate, TratadorController.listar);
router.post  ('/',           authenticate, TratadorController.criar);
router.get   ('/:id',        authenticate, TratadorController.obterPorId);
router.put   ('/:id',        authenticate, TratadorController.atualizar);
router.patch ('/:id/toggle', authenticate, TratadorController.toggleAtivo);

module.exports = router;

'use strict';

const express                      = require('express');
const LocalizacaoAnimalController  = require('../controllers/LocalizacaoAnimalController');
const { authenticate }             = require('../middlewares/auth');

const router = express.Router();

// Rota de tipos: antes de /:id para não ser capturada como parâmetro
router.get   ('/tipos',       authenticate, LocalizacaoAnimalController.listarTipos);

router.get   ('/',            authenticate, LocalizacaoAnimalController.listar);
router.post  ('/',            authenticate, LocalizacaoAnimalController.criar);
router.get   ('/:id',         authenticate, LocalizacaoAnimalController.obterPorId);
router.put   ('/:id',         authenticate, LocalizacaoAnimalController.atualizar);
router.patch ('/:id/toggle',  authenticate, LocalizacaoAnimalController.toggleAtivo);

module.exports = router;

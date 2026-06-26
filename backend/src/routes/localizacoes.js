'use strict';

const express                      = require('express');
const LocalizacaoAnimalController  = require('../controllers/LocalizacaoAnimalController');
const { authenticate }             = require('../middlewares/auth');
const { checkPermission }          = require('../middlewares/permissao.middleware');

const router = express.Router();

// Apenas ADMIN pode editar/inativar localizações (controller também valida, mas a rota reforça)
const soAdmin = (req, res, next) => {
  if (req.user?.userType !== 'ADMIN') return res.status(403).json({ error: 'Acesso restrito a administradores do sistema.' });
  next();
};

// Rota de tipos: antes de /:id para não ser capturada como parâmetro
router.get   ('/tipos',       authenticate, checkPermission('cadastro.localizacao.ler',   'LEITURA'), LocalizacaoAnimalController.listarTipos);

router.get   ('/',            authenticate, checkPermission('cadastro.localizacao.ler',   'LEITURA'), LocalizacaoAnimalController.listar);
router.post  ('/',            authenticate, checkPermission('cadastro.localizacao.criar',  'LEITURA'), LocalizacaoAnimalController.criar);
router.get   ('/:id',         authenticate, checkPermission('cadastro.localizacao.ler',   'LEITURA'), LocalizacaoAnimalController.obterPorId);
router.put   ('/:id',         authenticate, soAdmin, LocalizacaoAnimalController.atualizar);
router.patch ('/:id/toggle',  authenticate, soAdmin, LocalizacaoAnimalController.toggleAtivo);

module.exports = router;

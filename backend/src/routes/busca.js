// backend/src/routes/busca.js — montado em /api/busca
// Busca global do header (paciente + atendimento + agenda).
'use strict';

const express = require('express');
const router  = express.Router();
const BuscaGlobalController = require('../controllers/BuscaGlobalController');
const { authenticate } = require('../middlewares/auth');
const { resolverContextoPermissao } = require('../middlewares/permissao.middleware');

// Sem checkPermission de propósito: a busca atravessa três módulos e gateá-la por um
// slug único barraria quem tem acesso só a um deles. O contexto (equipe/cargo) é
// resolvido aqui e o gate real é POR GRUPO dentro do controller (getNivelEfetivo).
const comContexto = async (req, _res, next) => {
  try {
    await resolverContextoPermissao(req);
    next();
  } catch (err) { next(err); }
};

router.get('/', authenticate, comContexto, BuscaGlobalController.buscar);

module.exports = router;

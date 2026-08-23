// backend/src/routes/exportacao.js — montado em /api/admin/exportacao
// Administração > Exportação de prontuário. Sem checkPermission de slug único —
// o gate é "sou gestor da empresa ativa (ou ADMIN)?", resolvido dentro do
// controller (mesmo padrão de AuditController.listar). `resolverContextoPermissao`
// só popula req.equipeId/req.membroCargo (necessários para buildAnimalScopeWhere),
// sem nunca responder 403 sozinho — mesmo padrão de routes/busca.js.
'use strict';

const express = require('express');
const router  = express.Router();
const ExportacaoController = require('../controllers/ExportacaoController');
const { authenticate } = require('../middlewares/auth');
const { resolverContextoPermissao } = require('../middlewares/permissao.middleware');

const comContexto = async (req, _res, next) => {
  try {
    await resolverContextoPermissao(req);
    next();
  } catch (err) { next(err); }
};

router.get('/animais',  authenticate, comContexto, ExportacaoController.listarAnimais);
router.post('/gerar',   authenticate, comContexto, ExportacaoController.gerar);

module.exports = router;

// src/routes/veterinarios.js
'use strict';

const express               = require('express');
const VeterinarioController = require('../controllers/VeterinarioController');
const { authenticate }      = require('../middlewares/auth');

const router = express.Router();
router.get('/proprietarios', authenticate, VeterinarioController.listarProprietarios);
router.get('/',                   authenticate, VeterinarioController.listar);
router.get('/perfil',             authenticate, VeterinarioController.obterPerfil);
router.put('/perfil',             authenticate, VeterinarioController.atualizarPerfil);
router.get('/meus-animais',       authenticate, VeterinarioController.meusAnimais);
router.get('/solicitacoes',       authenticate, VeterinarioController.listarSolicitacoes);
router.post('/solicitacoes',      authenticate, VeterinarioController.solicitarVinculo);
router.patch('/solicitacoes/:id', authenticate, VeterinarioController.responderSolicitacao);

module.exports = router;

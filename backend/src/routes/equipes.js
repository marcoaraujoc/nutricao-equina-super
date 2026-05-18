// src/routes/equipes.js
'use strict';

const express          = require('express');
const EquipeController = require('../controllers/EquipeController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

// ─── Empresas ──────────────────────────────────────────────────────────────
router.post('/empresas', authenticate, EquipeController.criarEmpresa);
router.get('/empresas',  authenticate, EquipeController.listarEmpresas);

// ─── Convites (rotas fixas — devem vir antes de /:equipeId) ──────────────
router.post('/convites',               authenticate, EquipeController.convidarMembro);
router.get('/convite/:token',                        EquipeController.verificarConvite);
router.post('/convite/:token/aceitar', authenticate, EquipeController.aceitarConvite);

// ─── Membros fixos (devem vir antes de /:equipeId/membros) ───────────────
router.get('/membros',               authenticate, EquipeController.listarMembros);
router.post('/membros',              authenticate, EquipeController.adicionarMembro);
router.put('/membros/:id',           authenticate, EquipeController.atualizarMembro);
router.patch('/membros/:id/toggle',  authenticate, EquipeController.toggleMembro);
router.delete('/membros/:membroId',  authenticate, EquipeController.removerMembro);

// ─── Equipes ───────────────────────────────────────────────────────────────
router.post('/',                   authenticate, EquipeController.criarEquipe);
router.get('/:equipeId/membros',   authenticate, EquipeController.listarMembrosPorEquipe);

module.exports = router;
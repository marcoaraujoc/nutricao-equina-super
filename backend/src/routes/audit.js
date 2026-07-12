const express = require('express');
const controller = require('../controllers/AuditController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.post('/log', controller.registrar);
// Tela de Auditoria (módulo Geral) — ADMIN: global; GESTOR/dono: empresa ativa
router.get('/logs', authenticate, controller.listar);

module.exports = router;

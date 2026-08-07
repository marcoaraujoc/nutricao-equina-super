const express = require('express');
const controller = require('../controllers/AuditController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

// 🔴 `POST /log` foi REMOVIDA em 2026-08-05.
//
// Ela era PÚBLICA (sem `authenticate`) e montava a linha de auditoria com `userId`,
// `userName`, `email`, `action` e `empresaId` vindos do CORPO da requisição: qualquer um
// na internet podia injetar registro atribuindo qualquer ação a qualquer pessoa, em
// qualquer empresa — numa tabela cujo valor inteiro é ser inquestionável.
//
// Quem grava LOGIN/LOGOUT agora é o SERVIDOR, com a identidade que ele mesmo autenticou:
// `registrarAcesso` (lib/auditoria.js), chamado em `emitirSessao`, no `GoogleController`
// e no `logout`. NÃO reabrir esta rota: escrita de auditoria não se aceita do cliente.
//
// Tela de Auditoria (módulo Geral) — ADMIN: global; GESTOR/dono: empresa ativa
router.get('/logs', authenticate, controller.listar);

module.exports = router;

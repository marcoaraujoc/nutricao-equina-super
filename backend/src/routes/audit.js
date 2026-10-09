const express = require('express');
const controller = require('../controllers/AuditController');
const { authenticate } = require('../middlewares/auth');
const escopoPlataformaSeAdmin = require('../middlewares/escopoPlataforma');

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
// 🔴 `escopoPlataformaSeAdmin` (2026-10-09): `tb_audit_logs` tem RLS forçado, e o ADMIN
// sem empresa no contexto via ZERO registros — a tela dizia "todas as empresas" e vinha
// vazia. Pior: LOGIN/LOGOUT nasce SEM empresa (a rota de login não passa pelo
// `authenticate`), e linha sem empresa só aparece em escopo de plataforma. O middleware
// confere o papel em runtime: para o gestor é passagem direta e o tenant continua valendo.
router.get('/logs', authenticate, escopoPlataformaSeAdmin, controller.listar);

module.exports = router;

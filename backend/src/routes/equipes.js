// src/routes/equipes.js
'use strict';

const express             = require('express');
const EquipeController    = require('../controllers/EquipeController');
const PermissaoController = require('../controllers/PermissaoController');
const { authenticate }    = require('../middlewares/auth');
const validate            = require('../middlewares/validate');
const { criarEmpresaRules, convidarMembroRules } = require('../validators/equipe.validators');

const router = express.Router();

// =============================================================================
// ROTAS FIXAS (sem parâmetro dinâmico) — DEVEM VIR ANTES de /:equipeId
// =============================================================================

// ─── Empresas ─────────────────────────────────────────────────────────────────
router.post('/empresas', authenticate, criarEmpresaRules, validate, EquipeController.criarEmpresa);
router.get ('/empresas', authenticate, EquipeController.listarEmpresas);

// ─── Setup inicial (cria empresa + equipe em uma transação) ──────────────────
router.post('/setup',  authenticate, EquipeController.setup);

// ─── Equipe ativa do usuário logado ───────────────────────────────────────────
router.get('/minha',   authenticate, EquipeController.getMinhaEquipe);

// ─── Convites (rotas fixas) ────────────────────────────────────────────────────
router.get   ('/convites',              authenticate, EquipeController.listarConvites);
router.post  ('/convites',              authenticate, convidarMembroRules, validate, EquipeController.convidarMembro);
router.post  ('/convites/auto-aceitar',  authenticate, EquipeController.autoAceitarConvites);
router.post  ('/convites/recusar-meus',  authenticate, EquipeController.recusarMeusConvites);
router.delete('/convites/:conviteId',   authenticate, EquipeController.removerConvite);
router.get ('/convite/:token',                               EquipeController.verificarConvite);
router.post('/convite/:token/aceitar',         authenticate, EquipeController.aceitarConvite);
router.post('/convite/:token/recusar',         authenticate, EquipeController.recusarConvite);

// ─── Permissoes do usuario logado ──────────────────────────────────────────────
router.get   ('/minhas-permissoes',  authenticate, EquipeController.minhasPermissoes);

// ─── Membros (rotas fixas) ─────────────────────────────────────────────────────
router.get   ('/membros',            authenticate, EquipeController.listarMembros);
router.post  ('/membros',            authenticate, EquipeController.adicionarMembro);
router.put   ('/membros/:id',        authenticate, EquipeController.atualizarMembro);
router.patch ('/membros/:id/toggle', authenticate, EquipeController.toggleMembro);
router.delete('/membros/:membroId',  authenticate, EquipeController.removerMembro);

// ─── Criar equipe avulsa ───────────────────────────────────────────────────────
router.post('/', authenticate, EquipeController.criarEquipe);

// =============================================================================
// ROTAS COM PARÂMETRO /:equipeId — DEVEM VIR POR ÚLTIMO
// =============================================================================

router.get   ('/:equipeId/membros',                    authenticate, EquipeController.listarMembrosPorEquipe);
router.delete('/:equipeId/membros/:alvoUserId',        authenticate, EquipeController.removerMembro);
router.patch ('/:equipeId/membros/:alvoUserId/cargo',  authenticate, EquipeController.alterarCargo);
router.delete('/:equipeId/convites/:conviteId',        authenticate, EquipeController.cancelarConvite);
router.get   ('/:equipeId/permissoes/:membroUserId',   authenticate, PermissaoController.getPermissoesMembro);
router.put   ('/:equipeId/permissoes/:membroUserId',   authenticate, PermissaoController.atualizarPermissoes);
router.get   ('/:equipeId/proprietarios',              authenticate, PermissaoController.getPermissoesProprietarios);
router.put   ('/:equipeId/proprietarios/:alvoUserId',  authenticate, PermissaoController.atualizarPermissoesProprietario);
router.get   ('/:equipeId/auditoria',                  authenticate, PermissaoController.getAuditoria);
router.get   ('/:equipeId/perfis',                     authenticate, PermissaoController.getPerfisByEquipe);
router.get   ('/:equipeId/perfis/:cargo',              authenticate, PermissaoController.getMatrizPorCargo);
router.put   ('/:equipeId/perfis/:cargo',              authenticate, PermissaoController.salvarMatrizPorCargo);

module.exports = router;
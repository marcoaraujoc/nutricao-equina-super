// src/routes/equipes.js
'use strict';

const express             = require('express');
const multer              = require('multer');
const path                = require('path');
const EquipeController    = require('../controllers/EquipeController');
const PermissaoController = require('../controllers/PermissaoController');
const { authenticate }    = require('../middlewares/auth');
const validate            = require('../middlewares/validate');
const { criarEmpresaRules, convidarMembroRules } = require('../validators/equipe.validators');

const router = express.Router();

// ─── Configuração do Multer para o logotipo (memoryStorage — mesmo padrão de animais.js) ─
const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype));
  },
});

// =============================================================================
// ROTAS FIXAS (sem parâmetro dinâmico) — DEVEM VIR ANTES de /:equipeId
// =============================================================================

// ─── Empresas ─────────────────────────────────────────────────────────────────
router.post('/empresas', authenticate, criarEmpresaRules, validate, EquipeController.criarEmpresa);
router.get ('/empresas', authenticate, EquipeController.listarEmpresas);

// ─── Contextos ativos do usuário (seletor de perfil/empresa do Sidebar) ───────
router.get('/meus-contextos', authenticate, EquipeController.meusContextos);

// ─── Configurações (logotipo + dia de fechamento de fatura) ──────────────────
router.get('/configuracoes', authenticate, EquipeController.obterConfiguracao);
router.put('/configuracoes', authenticate, uploadLogo.single('logo'), EquipeController.salvarConfiguracao);

// ─── Setup inicial (cria empresa + equipe em uma transação) ──────────────────
router.post('/setup',  authenticate, EquipeController.setup);

// ─── Equipe ativa do usuário logado ───────────────────────────────────────────
router.get('/minha',             authenticate, EquipeController.getMinhaEquipe);
router.get('/minhas-especies',   authenticate, EquipeController.getMinhasEspecies);

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

// ─── Inclusão direta de membro (sem fluxo de convite) ─────────────────────────
router.post('/incluir-membro', authenticate, EquipeController.incluirMembroDireto);

// ─── Membros (rotas fixas) ─────────────────────────────────────────────────────
router.get   ('/membros',            authenticate, EquipeController.listarMembros);
router.post  ('/membros',            authenticate, EquipeController.adicionarMembro);
router.put   ('/membros/:id',        authenticate, EquipeController.atualizarMembro);
router.patch ('/membros/:id/toggle', authenticate, EquipeController.toggleMembro);
router.delete('/membros/:membroId',  authenticate, EquipeController.removerMembro);

// ─── Criar equipe avulsa ───────────────────────────────────────────────────────
router.post('/', authenticate, EquipeController.criarEquipe);

// ─── Convite ADMIN → Gestor (cria empresa+equipe pelo CNPJ) ───────────────────
router.post('/admin/convidar-gestor',  authenticate, EquipeController.convidarGestorAdmin);
router.get ('/admin/todas-empresas',  authenticate, EquipeController.listarTodasEmpresasAdmin);

// ─── Permissões globais por UserType (somente ADMIN) ─────────────────────────
router.get('/admin/global/usertype/:userType', authenticate, EquipeController.getMatrizGlobalUserType);
router.put('/admin/global/usertype/:userType', authenticate, EquipeController.salvarMatrizGlobalUserType);

// Espécies por equipe / empresa (literais — antes de /:equipeId)
router.get('/empresa/:empresaId/especies', authenticate, EquipeController.getEspeciesEmpresa);

// =============================================================================
// ROTAS COM PARÂMETRO /:equipeId — DEVEM VIR POR ÚLTIMO (já declaradas abaixo)
// ─── ADMIN: remover gestor da equipe e desativar conta ────────────────────────

// =============================================================================
// ROTAS COM PARÂMETRO /:equipeId — DEVEM VIR POR ÚLTIMO
// =============================================================================

router.get   ('/:equipeId/especies',                   authenticate, EquipeController.getEspeciesEquipe);
router.get   ('/:equipeId/fornecedores',               authenticate, EquipeController.getFornecedoresPorEquipe);
router.get   ('/:equipeId/prestadores/:userId/designacoes',           authenticate, EquipeController.getDesignacoesPrestador);
router.post  ('/:equipeId/prestadores/:userId/designacoes',           authenticate, EquipeController.addDesignacaoPrestador);
router.delete('/:equipeId/prestadores/:userId/designacoes/:animalId', authenticate, EquipeController.removeDesignacaoPrestador);
router.patch ('/:equipeId/nome',                        authenticate, EquipeController.renomearEquipe);
router.delete('/:equipeId/gestor/:userId',               authenticate, EquipeController.removerGestorAdmin);
router.post  ('/:equipeId/convidar',                   authenticate, EquipeController.convidarParaEquipe);
router.get   ('/:equipeId/membros',                    authenticate, EquipeController.listarMembrosPorEquipe);
router.delete('/:equipeId/membros/:alvoUserId',        authenticate, EquipeController.removerMembro);
router.patch ('/:equipeId/membros/:alvoUserId/cargo',  authenticate, EquipeController.alterarCargo);
router.patch ('/:equipeId/membros/:alvoUserId/cargos', authenticate, EquipeController.alterarCargos);
router.delete('/:equipeId/convites/:conviteId',        authenticate, EquipeController.cancelarConvite);
router.get   ('/:equipeId/permissoes/:membroUserId',   authenticate, PermissaoController.getPermissoesMembro);
router.put   ('/:equipeId/permissoes/:membroUserId',   authenticate, PermissaoController.atualizarPermissoes);
router.get   ('/:equipeId/proprietarios',              authenticate, PermissaoController.getPermissoesProprietarios);
router.put   ('/:equipeId/proprietarios/:alvoUserId',  authenticate, PermissaoController.atualizarPermissoesProprietario);
router.get   ('/:equipeId/auditoria',                  authenticate, PermissaoController.getAuditoria);
router.get   ('/:equipeId/perfis',                     authenticate, PermissaoController.getPerfisByEquipe);
router.post  ('/:equipeId/perfis',                     authenticate, PermissaoController.criarPerfil);
router.get   ('/:equipeId/perfis/:cargo',              authenticate, PermissaoController.getMatrizPorCargo);
router.put   ('/:equipeId/perfis/:cargo',              authenticate, PermissaoController.salvarMatrizPorCargo);
router.delete('/:equipeId/perfis/:cargo',              authenticate, PermissaoController.deletarPerfil);

module.exports = router;
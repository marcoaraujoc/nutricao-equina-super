// src/routes/equipes.js
'use strict';

const express             = require('express');
const multer              = require('multer');
const path                = require('path');
const EquipeController    = require('../controllers/EquipeController');
const PermissaoController = require('../controllers/PermissaoController');
const { authenticate, authorize } = require('../middlewares/auth');
// Gate do CONTROLE DE ACESSO nas acoes sobre membros (ativar/inativar, desbloquear).
const { checkPermission } = require('../middlewares/permissao.middleware');
const { tenantRls }       = require('../middlewares/tenantRls');
const validate            = require('../middlewares/validate');
const { criarGestorRules, convidarMembroRules } = require('../validators/equipe.validators');

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
// Criação restrita ao ADMIN da plataforma (modelo 2026-08-17): ADMIN cria só o
// GESTOR (dados básicos + plano) — a empresa nasce com identidade em branco, e é o
// próprio gestor quem a completa em Cadastro da Empresa (routes/empresas.js).
router.post ('/gestores',             authenticate, authorize('ADMIN'), criarGestorRules, validate, EquipeController.criarGestor);
router.get  ('/empresas',             authenticate, EquipeController.listarEmpresas);
// ADMIN inativa/reativa a empresa (governa o acesso via Empresa.status). Editar a
// identidade da empresa (nome/documento/endereço/espécies) é ato do GESTOR — ver
// EmpresaCadastroController.salvar (`PUT /empresas/cadastro`).
router.patch('/empresas/:id/status',  authenticate, authorize('ADMIN'), EquipeController.alterarStatusEmpresa);

// ─── Contextos ativos do usuário (seletor de perfil/empresa do Sidebar) ───────
router.get('/meus-contextos', authenticate, EquipeController.meusContextos);

// ─── Configurações (logotipo + dia de fechamento de fatura) ──────────────────
router.get('/configuracoes', authenticate, EquipeController.obterConfiguracao);
// ⚠️ `tenantRls` REENTRA no contexto do tenant logo APÓS o multer (mesmo padrão de
// routes/animais.js) — o multer intercala parsing de stream (busboy) entre o
// `authenticate` (que carimba o tenant) e o controller, e isso pode fazer o
// `AsyncLocalStorage` do tenant não sobreviver até o controller. Sem isto, o upload do
// logo (tb_midia_arquivos) cai em "new row violates row-level security policy" mesmo
// com `req.empresaId` correto.
router.put('/configuracoes', authenticate, uploadLogo.single('logo'), tenantRls, EquipeController.salvarConfiguracao);

// WhatsApp da clínica (Evolution API) — GESTOR/dono do contexto ativo.
// Antes de /:equipeId para o literal não virar parâmetro.
const WhatsappController = require('../controllers/WhatsappController');
router.get('/whatsapp/status',       authenticate, WhatsappController.status);
router.post('/whatsapp/conectar',    authenticate, WhatsappController.conectar);
router.post('/whatsapp/reconectar',  authenticate, WhatsappController.reconectar);
router.post('/whatsapp/desconectar', authenticate, WhatsappController.desconectar);
// Expediente de atendimento — leitura por qualquer membro (Agendamento)
router.get('/horario-atendimento', authenticate, EquipeController.obterHorarioAtendimento);
// Logotipo da empresa do contexto ativo — leitura por qualquer membro (Sidebar/branding)
router.get('/logo', authenticate, EquipeController.obterLogo);
// Espécies atendidas pela empresa — leitura por qualquer membro (Cadastro Pessoal do convidado)
router.get('/especies-atendidas', authenticate, EquipeController.obterEspeciesAtendidas);

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
// ATIVAR/INATIVAR membro — a permissão vem do CONTROLE DE ACESSO, coluna ALTERAR do
// módulo Equipe (`equipe.membros.editar`). Até 2026-08-25 esta rota tinha só
// `authenticate`: QUALQUER usuário logado podia inativar qualquer membro, inclusive de
// outra empresa — e sem deixar de funcionar, então nada denunciava o buraco.
// Padrão do sistema (CLAUDE.md, armadilha 28): o RBAC decide SE a pessoa executa a
// ação; a regra de negócio, no controller, decide SOBRE QUEM.
router.patch ('/membros/:id/toggle', authenticate, checkPermission('equipe.membros.editar', 'LEITURA'), EquipeController.toggleMembro);
router.delete('/membros/:membroId',  authenticate, EquipeController.removerMembro);
// Desbloqueia conta travada por senha errada (lib/bloqueioLogin.js). O gate do
// Controle de Acesso decide SE a pessoa mexe em membros; QUEM ela pode desbloquear é
// regra de negócio da lib (gestor destrava a equipe dele; conta de gestor só o ADMIN).
// ⚠️ A lib consulta o banco em vez de confiar em `req.membroCargo` — assim a regra
// continua correta mesmo se esta rota um dia perder o middleware.
router.post  ('/membros/:userId/desbloquear', authenticate, checkPermission('equipe.membros.editar', 'LEITURA'), EquipeController.desbloquearMembro);

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
// Lote ANTES da rota simples não é necessário (paths distintos), mas fica junto dela.
router.post  ('/:equipeId/prestadores/:userId/designacoes/lote',      authenticate, EquipeController.addDesignacoesPrestadorLote);
router.post  ('/:equipeId/prestadores/:userId/designacoes',           authenticate, EquipeController.addDesignacaoPrestador);
router.delete('/:equipeId/prestadores/:userId/designacoes/:animalId', authenticate, EquipeController.removeDesignacaoPrestador);
// Sem :animalId = revoga todo o acesso vigente do prestador ("Remover todos").
router.delete('/:equipeId/prestadores/:userId/designacoes',           authenticate, EquipeController.removeTodasDesignacoesPrestador);
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
// backend/src/routes/animais.js
'use strict';

const express          = require('express');
const multer           = require('multer');
const path             = require('path');
const { authenticate }                        = require('../middlewares/auth.js');
const { tenantRls }                           = require('../middlewares/tenantRls');
const { checkPermission }                     = require('../middlewares/permissao.middleware');
const animalController                        = require('../controllers/AnimalController');
const validate                                = require('../middlewares/validate');
const { createAnimalRules, animalIdParam }    = require('../validators/animal.validators');

const router = express.Router();

// ─── Configuração do Multer (memoryStorage — StorageProvider decide o destino) ─
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype));
  },
});

// ─── Rotas literais ANTES das rotas com parâmetros (:id) ─────────────────────
// CRÍTICO: Express processa rotas na ordem de registro.
// "buscar-por-nome" deve vir ANTES de "/:id",
// caso contrário o Express interpreta "buscar-por-nome" como o valor de :id.

// GET  /api/animais/buscar-por-nome?nome=X       → busca animal por nome (vet)
router.get('/buscar-por-nome', authenticate, animalController.buscarPorNome);

// GET  /api/animais/verificar-baia?baia=&local=&localizacaoId=&animalId=  → checagem em
// tempo de preenchimento do formulário (somente leitura; a validação definitiva segue no
// POST/PUT). O checkPermission NÃO é opcional aqui: além de autorizar a leitura, é ele
// que popula `req.membroCargo`, do qual buildAnimalScopeWhere depende.
router.get('/verificar-baia', authenticate, checkPermission('animais.ler', 'LEITURA'), animalController.verificarBaia);



// ─── Rotas CRUD ───────────────────────────────────────────────────────────────

// GET  /api/animais         → listar animais (filtrado por perfil)
// ⚠️ `injectTenant` foi REMOVIDO daqui (2026-08-17) — ele reatribuía `req.empresaId`
// pela equipe mais RECENTE do usuário, ignorando o contexto ativo (x-empresa-id/
// x-equipe-id) que o `authenticate` já resolveu corretamente. Sob RLS fail-closed
// (fase 7c), esse valor tardio diverge do `app.empresa_id` já carimbado na sessão do
// Postgres pelo `authenticate` — toda escrita cai em "new row violates row-level
// security policy". Ver CLAUDE.md §12/multi-tenancy: `req.empresaId` já vem pronto
// do `authenticate`; não reatribuir depois dele.
router.get('/',     authenticate, checkPermission('animais.ler', 'LEITURA'), animalController.listar);

// POST /api/animais         → criar animal (com upload de foto opcional)
// ⚠️ `tenantRls` REENTRA no contexto do tenant logo APÓS o multer (2026-08-17) — o
// multer intercala parsing de stream (busboy) entre o `authenticate` (que carimba o
// tenant) e o controller, e há evidência (logs `$allOperations` do Prisma mostrando
// `temStore:false` numa requisição cujo `req.empresaId` estava correto) de que essa
// intercalação pode fazer o `AsyncLocalStorage` do tenant não sobreviver até o
// controller. Reentrar aqui, o mais perto possível do uso, fecha a janela.
router.post('/',    authenticate, checkPermission('animais.criar', 'EQUIPE'), upload.single('foto'), tenantRls, createAnimalRules, validate, animalController.criar);

// GET  /api/animais/:id     → obter animal por ID
router.get('/:id',  authenticate, checkPermission('animais.ler', 'LEITURA'), animalIdParam, validate, animalController.obterPorId);

// GET  /api/animais/:id/logo-empresa → logo da empresa/equipe do animal (relatórios/impressões)
router.get('/:id/logo-empresa', authenticate, checkPermission('animais.ler', 'LEITURA'), animalIdParam, validate, animalController.obterLogoEmpresa);

// PUT  /api/animais/:id     → atualizar animal (com upload de foto opcional)
router.put('/:id',  authenticate, checkPermission('animais.editar', 'EQUIPE'), upload.single('foto'), tenantRls, animalIdParam, validate, animalController.atualizar);

// DELETE /api/animais/:id   → excluir animal
router.delete('/:id', authenticate, checkPermission('animais.deletar', 'EQUIPE'), animalIdParam, validate, animalController.excluir);

// PATCH /api/animais/:id/inativar → paciente vira somente leitura (motivo obrigatório)
router.patch('/:id/inativar', authenticate, checkPermission('animais.ativar', 'PROPRIO'), animalIdParam, validate, animalController.inativar);

// PATCH /api/animais/:id/ativar   → reverte a inativação — SEMPRE gestor/admin
// (checkPermission só popula o contexto/req.membroCargo; o gate real é no controller)
router.patch('/:id/ativar', authenticate, checkPermission('animais.ativar', 'PROPRIO'), animalIdParam, validate, animalController.ativar);



// ⚠️ ROTAS DE VÍNCULO REMOVIDAS na fase 3 do multi-tenancy
// (docs/MULTI-TENANCY-PLANO.md §6). Não existem mais vínculos nem aprovações entre
// veterinário, proprietário e empresa: o acesso ao paciente vem de ele pertencer à
// EMPRESA. Não reabrir estas rotas.

module.exports = router;
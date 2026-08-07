// backend/src/routes/animais.js
'use strict';

const express          = require('express');
const multer           = require('multer');
const path             = require('path');
const { authenticate }                        = require('../middlewares/auth.js');
const { injectTenant }                        = require('../middlewares/tenant');
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
router.get('/',     authenticate, checkPermission('animais.ler', 'LEITURA'), injectTenant, animalController.listar);

// POST /api/animais         → criar animal (com upload de foto opcional)
router.post('/',    authenticate, checkPermission('animais.criar', 'EQUIPE'), injectTenant, upload.single('foto'), createAnimalRules, validate, animalController.criar);

// GET  /api/animais/:id     → obter animal por ID
router.get('/:id',  authenticate, checkPermission('animais.ler', 'LEITURA'), animalIdParam, validate, animalController.obterPorId);

// GET  /api/animais/:id/logo-empresa → logo da empresa/equipe do animal (relatórios/impressões)
router.get('/:id/logo-empresa', authenticate, checkPermission('animais.ler', 'LEITURA'), animalIdParam, validate, animalController.obterLogoEmpresa);

// PUT  /api/animais/:id     → atualizar animal (com upload de foto opcional)
router.put('/:id',  authenticate, checkPermission('animais.editar', 'EQUIPE'), upload.single('foto'), animalIdParam, validate, animalController.atualizar);

// DELETE /api/animais/:id   → excluir animal
router.delete('/:id', authenticate, checkPermission('animais.deletar', 'EQUIPE'), animalIdParam, validate, animalController.excluir);



// ⚠️ ROTAS DE VÍNCULO REMOVIDAS na fase 3 do multi-tenancy
// (docs/MULTI-TENANCY-PLANO.md §6). Não existem mais vínculos nem aprovações entre
// veterinário, proprietário e empresa: o acesso ao paciente vem de ele pertencer à
// EMPRESA. Não reabrir estas rotas.

module.exports = router;
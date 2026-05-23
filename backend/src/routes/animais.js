// backend/src/routes/animais.js
'use strict';

const express          = require('express');
const multer           = require('multer');
const path             = require('path');
const { authenticate }                        = require('../middlewares/auth.js');
const { injectTenant }                        = require('../middlewares/tenant');
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
// "buscar-por-nome" e "proprietario/aprovar" devem vir ANTES de "/:id",
// caso contrário o Express interpreta "buscar-por-nome" como o valor de :id.

// GET  /api/animais/buscar-por-nome?nome=X       → busca animal por nome (vet)
router.get('/buscar-por-nome', authenticate, animalController.buscarPorNome);

// GET  /api/animais/minhas-solicitacoes           → solicitações dos animais do proprietário (polling)
router.get('/minhas-solicitacoes', authenticate, animalController.minhasSolicitacoes);

// POST /api/animais/proprietario/aprovar    → proprietário aprova/recusa vínculo (pública)
router.post('/proprietario/aprovar', animalController.proprietarioAprovar);

// POST /api/animais/vincular-vet           → cria vínculo ACEITO direto (vet p/ si mesmo)
router.post('/vincular-vet', authenticate, animalController.vincularVet);

// ─── Rotas CRUD ───────────────────────────────────────────────────────────────

// GET  /api/animais         → listar animais (filtrado por perfil)
router.get('/',     authenticate, injectTenant, animalController.listar);

// POST /api/animais         → criar animal (com upload de foto opcional)
router.post('/',    authenticate, injectTenant, upload.single('foto'), createAnimalRules, validate, animalController.criar);

// GET  /api/animais/:id     → obter animal por ID
router.get('/:id',  authenticate, animalIdParam, validate, animalController.obterPorId);

// PUT  /api/animais/:id     → atualizar animal (com upload de foto opcional)
router.put('/:id',  authenticate, upload.single('foto'), animalIdParam, validate, animalController.atualizar);

// DELETE /api/animais/:id   → excluir animal
router.delete('/:id', authenticate, animalIdParam, validate, animalController.excluir);

// DELETE /api/animais/:id/desvincular-vet → vet se remove do animal
router.delete('/:id/desvincular-vet', authenticate, animalController.desvincularVet);

// DELETE /api/animais/:id/cancelar-solicitacao → proprietário cancela solicitação pendente
router.delete('/:id/cancelar-solicitacao', authenticate, animalController.cancelarSolicitacao);

module.exports = router;
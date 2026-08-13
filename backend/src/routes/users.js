'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const UserController      = require('../controllers/UserController');
const UserAdminController = require('../controllers/UserAdminController');
const { authenticate, authorize } = require('../middlewares/auth');
const { tenantRls }       = require('../middlewares/tenantRls');

const router = express.Router();

// Foto do cadastro pessoal — memoryStorage (quem decide o destino é o StorageProvider).
// Valida extensão E mimetype: mimetype sozinho é declarado pelo cliente.
const uploadFoto = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const permitido = /jpeg|jpg|png|webp/;
    cb(null, permitido.test(path.extname(file.originalname).toLowerCase()) && permitido.test(file.mimetype));
  },
});

// Self-management (qualquer usuário autenticado)
router.get   ('/me',                authenticate, UserController.getMe);
router.get   ('/buscar-proprietario', authenticate, UserController.buscarProprietarioPorEmail);
router.put   ('/me',        authenticate, UserController.updateMe);
// Rotas literais mais específicas ANTES das genéricas (/me/foto antes de /:id)
// ⚠️ `tenantRls` REENTRA no contexto do tenant logo APÓS o multer — ver comentário em
// routes/animais.js. Sem isto, salvar a foto cai em RLS mesmo com req.empresaId correto.
router.put   ('/me/foto',   authenticate, uploadFoto.single('foto'), tenantRls, UserController.salvarFotoMe);
router.delete('/me/foto',   authenticate, UserController.salvarFotoMe);
router.patch ('/me/senha',  authenticate, UserController.alterarSenha);

// Admin CRUD (somente ADMIN)
router.get   ('/',             authenticate, authorize('ADMIN'), UserAdminController.listar);
router.post  ('/',             authenticate, authorize('ADMIN'), UserAdminController.criar);
router.get   ('/:id',          authenticate, authorize('ADMIN'), UserAdminController.obterPorId);
router.put   ('/:id',          authenticate, authorize('ADMIN'), UserAdminController.atualizar);
router.patch ('/:id/toggle',   authenticate, authorize('ADMIN'), UserAdminController.toggleAtivo);
router.delete('/:id',          authenticate, authorize('ADMIN'), UserAdminController.excluir);

module.exports = router;
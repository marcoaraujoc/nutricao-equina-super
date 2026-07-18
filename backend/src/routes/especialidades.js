const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const EspecialidadeController = require('../controllers/EspecialidadeController');

// Catálogo de especialidades por espécie — leitura para qualquer usuário autenticado
// (usado no Cadastro Pessoal, Novo Fornecedor e Novo Membro).
router.get('/especies', authenticate, EspecialidadeController.listarEspecies);
router.get('/', authenticate, EspecialidadeController.listar);

module.exports = router;

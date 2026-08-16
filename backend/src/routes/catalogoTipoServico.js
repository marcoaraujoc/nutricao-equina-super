// backend/src/routes/catalogoTipoServico.js — prefixo /api/cadastro/tipos-servico
'use strict';

const express = require('express');
const router  = express.Router();
const CatalogoTipoServicoController = require('../controllers/CatalogoTipoServicoController');
const { authenticate } = require('../middlewares/auth');

// Leitura sem slug próprio — mesmo padrão de /especialidades: catálogo auxiliar
// de formulário, baixa sensibilidade (só nomes de tipo). O gate de ESCRITA
// (quem pode ensinar um tipo novo) é feito dentro do controller, pela mesma
// permissão de criar fornecedor/prestador — a categoria só é conhecida em
// runtime, no body.
router.get ('/', authenticate, CatalogoTipoServicoController.listar);
router.post('/', authenticate, CatalogoTipoServicoController.criar);

module.exports = router;

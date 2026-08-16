// backend/src/routes/midia.js — prefixo /api/midia
//
// Substitui o `express.static('/uploads')`. A autorização é POR ARQUIVO (dono do
// binário: animal ou empresa), resolvida no controller — não há slug único que
// sirva, porque a mesma rota entrega foto de paciente, laudo, logo e foto de perfil.
//
// `authenticate` cobre a rota inteira: `<img src="/api/midia/...">` é requisição
// same-origin, então o cookie HttpOnly de sessão viaja normalmente e a imagem
// carrega sem nenhuma mudança no frontend.
'use strict';

const express          = require('express');
const router           = express.Router();
const MidiaController  = require('../controllers/MidiaController');
const { authenticate } = require('../middlewares/auth');

router.get('/:chave/preview', authenticate, MidiaController.visualizarDocx);
router.get('/:chave', authenticate, MidiaController.baixar);

module.exports = router;

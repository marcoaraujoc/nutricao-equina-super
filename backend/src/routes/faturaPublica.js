// backend/src/routes/faturaPublica.js
//
// Link público de fatura (envio por WhatsApp/e-mail — ver
// lib/faturaLinkPublico.js). SEM `authenticate` de propósito: é aberto por
// quem recebeu o link, que não tem sessão no S2Vet. A autorização aqui é o
// TOKEN opaco de 64 caracteres, nunca o login. Cai sob o rate limiter geral
// de `/api` (server.ts) igual qualquer outra rota.
'use strict';

const express = require('express');
const router = express.Router();
const FaturaPublicaController = require('../controllers/FaturaPublicaController');

router.get('/:token', FaturaPublicaController.abrir);

module.exports = router;

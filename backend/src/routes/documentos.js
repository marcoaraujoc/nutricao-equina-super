// backend/src/routes/documentos.js
// Envio genérico de documento (HTML → PDF) por WhatsApp/e-mail — ver
// controllers/DocumentoCompartilharController.js. Só `authenticate`, mesmo
// padrão de POST /dietas/compartilhar e POST /orcamentos/:id/enviar-whatsapp:
// quem chama já teve acesso ao dado que virou o HTML lá na tela de origem.
'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const DocumentoCompartilharController = require('../controllers/DocumentoCompartilharController');

router.post('/whatsapp', authenticate, DocumentoCompartilharController.whatsapp);
router.post('/email',    authenticate, DocumentoCompartilharController.email);

module.exports = router;

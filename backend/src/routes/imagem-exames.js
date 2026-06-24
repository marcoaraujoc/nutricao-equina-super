'use strict';
// Rotas do catálogo de exames de diagnóstico por imagem — prefixo /api/clinica/imagem-exames

const express                  = require('express');
const router                   = express.Router();
const ImagemExameController    = require('../controllers/ImagemExameController');
const { authenticate }         = require('../middlewares/auth');

// Literais antes de /:grupoId
router.get('/grupos',                    authenticate, ImagemExameController.listarGrupos);
router.get('/grupos/:grupoId/itens',     authenticate, ImagemExameController.listarItensPorGrupo);

module.exports = router;

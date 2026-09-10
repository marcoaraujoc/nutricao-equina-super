'use strict';
// Rotas do catálogo de exames de diagnóstico por imagem — prefixo /api/clinica/imagem-exames

const express                  = require('express');
const router                   = express.Router();
const ImagemExameController    = require('../controllers/ImagemExameController');
const { authenticate }         = require('../middlewares/auth');

// ⚠️ Literais ANTES de /:grupoId (armadilha 1 do CLAUDE.md).

// Catálogo UNIFICADO (exame de imagem como procedimento, 2026-09-09)
router.get('/categorias',   authenticate, ImagemExameController.listarCategorias);
router.get('/prestadores',  authenticate, ImagemExameController.listarPrestadores);
router.get('/exames',       authenticate, ImagemExameController.listarExamesPorCategoria);

// Catálogo ANTIGO — atende a base que ainda não rodou o seed 005.
router.get('/grupos',                    authenticate, ImagemExameController.listarGrupos);
router.get('/grupos/:grupoId/itens',     authenticate, ImagemExameController.listarItensPorGrupo);

module.exports = router;

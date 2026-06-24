'use strict';
// Rotas do catálogo de laboratórios e exames — prefixo /api/clinica/laboratorios

const express                    = require('express');
const router                     = express.Router();
const LaboratorioExameController = require('../controllers/LaboratorioExameController');
const { authenticate }           = require('../middlewares/auth');

// Rotas literais ANTES de /:id
router.get('/grupos-todos',          authenticate, LaboratorioExameController.listarGruposTodos);
router.get('/itens-todos',           authenticate, LaboratorioExameController.listarItensTodosPorNomeGrupo);
router.get('/grupos/:grupoId/itens', authenticate, LaboratorioExameController.listarItensPorGrupo);
router.get('/:id/grupos',            authenticate, LaboratorioExameController.listarGruposPorLab);
router.get('/',                      authenticate, LaboratorioExameController.listarLaboratorios);

module.exports = router;

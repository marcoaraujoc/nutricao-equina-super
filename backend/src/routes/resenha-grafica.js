/**
 * resenha-grafica.js
 *
 * Registrado em server.ts como:
 *   app.use('/api/animais/:animalId/resenha', authenticate, resenhaGraficaRoutes);
 *
 * mergeParams é necessário porque animalId vem do path pai.
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

const ResenhaGraficaController = require('../controllers/ResenhaGraficaController');

// Escrita controlada pela matriz RBAC (animais.resenha.editar — seed: GESTOR FULL,
// VETERINARIO EQUIPE, demais NENHUM). Nenhuma checagem de userType aqui; ADMIN
// tem bypass no próprio checkPermission.
// IMPORTANTE: /marcacoes deve vir ANTES de /:vista para não ser capturado como parâmetro
router.get('/marcacoes', authenticate, ResenhaGraficaController.listarMarcacoes);
router.get('/:vista',    authenticate, ResenhaGraficaController.buscarPorVista);
router.put('/:vista',    authenticate, checkPermission('animais.resenha.editar', 'PROPRIO'), ResenhaGraficaController.salvarPorVista);

module.exports = router;

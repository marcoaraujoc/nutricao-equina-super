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

const ResenhaGraficaController = require('../controllers/ResenhaGraficaController');

// IMPORTANTE: /marcacoes deve vir ANTES de /:vista para não ser capturado como parâmetro
router.get('/marcacoes', authenticate, ResenhaGraficaController.listarMarcacoes);
router.get('/:vista',    authenticate, ResenhaGraficaController.buscarPorVista);
router.put('/:vista',    authenticate, ResenhaGraficaController.salvarPorVista);

module.exports = router;

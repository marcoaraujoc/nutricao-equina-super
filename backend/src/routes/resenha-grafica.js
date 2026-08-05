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
const { exigirAcessoAnimal } = require('../middlewares/animalAcesso.middleware');

const ResenhaGraficaController = require('../controllers/ResenhaGraficaController');

// Escrita controlada pela matriz RBAC (animais.resenha.editar — seed: GESTOR FULL,
// VETERINARIO EQUIPE, demais NENHUM). Nenhuma checagem de userType aqui; ADMIN
// tem bypass no próprio checkPermission.
//
// ISOLAMENTO ENTRE EMPRESAS: o `animalId` vem do path pai (mergeParams) e NUNCA era
// conferido — nem na escrita, que tinha o slug mas não o dono do paciente. `exigirAcessoAnimal`
// fecha os três verbos; os GETs ganharam também o slug de leitura, que não tinham.
// IMPORTANTE: /marcacoes deve vir ANTES de /:vista para não ser capturado como parâmetro
router.get('/marcacoes', authenticate, checkPermission('animais.ler', 'LEITURA'), exigirAcessoAnimal(), ResenhaGraficaController.listarMarcacoes);
router.get('/:vista',    authenticate, checkPermission('animais.ler', 'LEITURA'), exigirAcessoAnimal(), ResenhaGraficaController.buscarPorVista);
router.put('/:vista',    authenticate, checkPermission('animais.resenha.editar', 'PROPRIO'), exigirAcessoAnimal(), ResenhaGraficaController.salvarPorVista);

module.exports = router;

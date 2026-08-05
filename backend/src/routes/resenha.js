const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');
const { exigirAcessoAnimal } = require('../middlewares/animalAcesso.middleware');
const ResenhaController = require('../controllers/ResenhaController');

// A resenha é a identificação do PACIENTE (sinais, marcas, genealogia): sem os dois
// middlewares abaixo estas rotas tinham apenas `authenticate`, e qualquer usuário
// autenticado lia — e sobrescrevia — a resenha de qualquer animal da plataforma.
// Slugs: leitura acompanha `animais.ler`; a escrita usa o mesmo `animais.resenha.editar`
// já adotado pela resenha gráfica.
router.get('/animal/:animalId', authenticate, checkPermission('animais.ler', 'LEITURA'), exigirAcessoAnimal(), ResenhaController.obterPorAnimal);
router.post('/',               authenticate, checkPermission('animais.resenha.editar', 'PROPRIO'), exigirAcessoAnimal({ de: 'body' }), ResenhaController.salvar);

module.exports = router;

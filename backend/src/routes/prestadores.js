'use strict';

const express               = require('express');
const PrestadorController   = require('../controllers/PrestadorController');
const { authenticate }      = require('../middlewares/auth');
const { checkPermission }   = require('../middlewares/permissao.middleware');

const router = express.Router();

// ⚠️ Rotas LITERAIS antes de `/:id` — senão o Express lê "por-email" como id (armadilha 1).
router.get   ('/por-email',   authenticate, checkPermission('cadastro.prestador.ler',    'LEITURA'), PrestadorController.buscarPorEmail);
router.get   ('/tipos',       authenticate, checkPermission('cadastro.prestador.ler',    'LEITURA'), PrestadorController.listarTipos);
router.get   ('/',            authenticate, checkPermission('cadastro.prestador.ler',    'LEITURA'), PrestadorController.listar);
router.post  ('/',            authenticate, checkPermission('cadastro.prestador.criar',   'PROPRIO'), PrestadorController.criar);
router.get   ('/:id',         authenticate, checkPermission('cadastro.prestador.ler',    'LEITURA'), PrestadorController.obterPorId);
router.put   ('/:id',         authenticate, checkPermission('cadastro.prestador.editar',  'PROPRIO'), PrestadorController.atualizar);
router.patch ('/:id/toggle',  authenticate, checkPermission('cadastro.prestador.ativar',  'PROPRIO'), PrestadorController.toggleAtivo);

// "Gerenciar Acesso" — autorização de pacientes pelo CADASTRO (com ou sem login).
// Mesmo slug de alterar o prestador: quem mantém o cadastro decide quem ele atende.
router.get   ('/:id/designacoes',           authenticate, checkPermission('cadastro.prestador.editar', 'PROPRIO'), PrestadorController.listarDesignacoes);
router.post  ('/:id/designacoes/lote',      authenticate, checkPermission('cadastro.prestador.editar', 'PROPRIO'), PrestadorController.concederDesignacoes);
router.delete('/:id/designacoes/:animalId', authenticate, checkPermission('cadastro.prestador.editar', 'PROPRIO'), PrestadorController.revogarDesignacao);
router.delete('/:id/designacoes',           authenticate, checkPermission('cadastro.prestador.editar', 'PROPRIO'), PrestadorController.revogarDesignacao);

module.exports = router;

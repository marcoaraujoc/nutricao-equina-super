// backend/src/routes/veterinarios.js
'use strict';

const express               = require('express');
const VeterinarioController = require('../controllers/VeterinarioController');
const { authenticate }      = require('../middlewares/auth');
const { checkPermission }   = require('../middlewares/permissao.middleware');

const router = express.Router();

// ── ROTA PÚBLICA — aprovação via email (sem authenticate) ─────────────────────
// DEVE vir antes de /solicitacoes/:id para não colidir com o param
router.get('/solicitacoes/responder-email', VeterinarioController.responderViaEmail);

// ── Rotas autenticadas ────────────────────────────────────────────────────────
// Lista os CLIENTES da empresa ativa — mesmo dado do Cadastro de Clientes, logo o
// mesmo slug. Sem isto a rota ficava só com `authenticate` e qualquer perfil (inclusive
// PROPRIETARIO e FORNECEDOR) baixava a lista de clientes.
router.get('/proprietarios',         authenticate, checkPermission('cadastro.proprietario.ler', 'LEITURA'), VeterinarioController.listarProprietarios);
router.get('/',                      authenticate, VeterinarioController.listar);
router.get('/perfil',                authenticate, VeterinarioController.obterPerfil);
router.put('/perfil',                authenticate, VeterinarioController.atualizarPerfil);
router.get('/meus-animais',          authenticate, VeterinarioController.meusAnimais);
router.get('/solicitacoes/pendentes',authenticate, VeterinarioController.listarPendentes);
router.get('/solicitacoes',          authenticate, VeterinarioController.listarSolicitacoes);
router.post('/solicitacoes',         authenticate, VeterinarioController.solicitarVinculo);
router.patch('/solicitacoes/:id',    authenticate, VeterinarioController.responderSolicitacao);
router.post('/solicitar-vinculo',    authenticate, VeterinarioController.solicitarVinculoVet);

module.exports = router;
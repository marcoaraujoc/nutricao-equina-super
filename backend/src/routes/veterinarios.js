// backend/src/routes/veterinarios.js
'use strict';

const express               = require('express');
const VeterinarioController = require('../controllers/VeterinarioController');
const { authenticate }      = require('../middlewares/auth');
const { checkPermission }   = require('../middlewares/permissao.middleware');

const router = express.Router();

// ── ROTA PÚBLICA — aprovação via email (sem authenticate) ─────────────────────

// ── Rotas autenticadas ────────────────────────────────────────────────────────
// Lista os CLIENTES da empresa ativa — mesmo dado do Cadastro de Clientes, logo o
// mesmo slug. Sem isto a rota ficava só com `authenticate` e qualquer perfil (inclusive
// PROPRIETARIO e FORNECEDOR) baixava a lista de clientes.
router.get('/proprietarios',         authenticate, checkPermission('cadastro.proprietario.ler', 'LEITURA'), VeterinarioController.listarProprietarios);
router.get('/',                      authenticate, VeterinarioController.listar);
router.get('/perfil',                authenticate, VeterinarioController.obterPerfil);
router.put('/perfil',                authenticate, VeterinarioController.atualizarPerfil);
// O checkPermission NÃO é decorativo aqui: além de autorizar a leitura, é ele que
// popula `req.membroCargo`, de que `buildAnimalScopeWhere` depende para distinguir
// gestor de prestador. Mesmo gate de `GET /api/animais`, que lista o mesmo dado.
router.get('/meus-animais',          authenticate, checkPermission('animais.ler', 'LEITURA'), VeterinarioController.meusAnimais);

// ⚠️ ROTAS DE VÍNCULO REMOVIDAS na fase 3 do multi-tenancy
// (docs/MULTI-TENANCY-PLANO.md §6). Não existem mais vínculos nem aprovações entre
// veterinário, proprietário e empresa: o acesso ao paciente vem de ele pertencer à
// EMPRESA. Não reabrir estas rotas.

module.exports = router;
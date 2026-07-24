// backend/src/routes/procedimentos.js
// Catálogo global de procedimentos — gerenciado exclusivamente pelo ADMIN.
// GET / e GET /:id ficam acessíveis a usuários autenticados (busca em prescrições).
// POST, PUT, DELETE requerem userType === 'ADMIN'.
'use strict';

const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/ProcedimentoController');
const cadastro = require('../controllers/ProcedimentoCadastroController');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

const requireAdmin = (req, res, next) => {
  if (req.user?.userType !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso restrito a administradores do sistema.' });
  }
  next();
};

// ── Cadastro > Procedimentos (por especialidade + preços/combos da empresa) ──
// Rotas literais ANTES de /:id (Express interpretaria como id).
// Controle de acesso: as ESCRITAS (valor/combo) usam o slug cadastro.procedimento.*.
// Os GETs ficam livres (só authenticate) porque também alimentam os seletores de
// procedimentos/combos do Orçamento e da Prescrição — mesmo padrão dos demais dropdowns.
router.get('/especialidades-minhas',        authenticate, cadastro.especialidadesMinhas);
router.get('/cadastro/lista',               authenticate, cadastro.listarComValores);
router.put('/cadastro/valor/:procedimentoId', authenticate, checkPermission('cadastro.procedimento.editar', 'PROPRIO'), cadastro.definirValor);
router.get('/cadastro/combos',              authenticate, cadastro.listarCombos);
router.post('/cadastro/combos',             authenticate, checkPermission('cadastro.procedimento.criar',   'PROPRIO'), cadastro.criarCombo);
router.put('/cadastro/combos/:id',          authenticate, checkPermission('cadastro.procedimento.editar',  'PROPRIO'), cadastro.atualizarCombo);
router.delete('/cadastro/combos/:id',       authenticate, checkPermission('cadastro.procedimento.deletar', 'PROPRIO'), cadastro.excluirCombo);

router.get('/',    authenticate, ctrl.listar);
router.get('/:id', authenticate, ctrl.obterPorId);
router.post('/',   authenticate, requireAdmin, ctrl.criar);
router.put('/:id', authenticate, requireAdmin, ctrl.atualizar);
router.delete('/:id', authenticate, requireAdmin, ctrl.excluir);

module.exports = router;

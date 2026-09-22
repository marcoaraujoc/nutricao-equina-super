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
// Cadastro do procedimento DA CLÍNICA (2026-09-18) — LITERAL, antes de `/:id`.
// ⚠️ Gate de `cadastro.procedimento.criar`, NÃO `requireAdmin`: o que nasce aqui é a
// linha da EMPRESA. O `POST /` lá embaixo continua ADMIN-only porque escreve no
// catálogo GLOBAL, que vale para todas as clínicas.
router.post('/cadastro/proprio', authenticate, checkPermission('cadastro.procedimento.criar', 'PROPRIO'), cadastro.criarProprio);

// ── Prestador × procedimento (2026-09-08) ───────────────────────────────────
// Vários prestadores podem executar o MESMO procedimento com valores diferentes.
// Os GETs ficam livres (só authenticate) pelo mesmo motivo dos demais: alimentam
// também o seletor de prestador da tela de PRESCRIÇÃO. As ESCRITAS são do gestor
// (o controller confere `isGestorDaEmpresa`) + o slug de cadastro.
router.get   ('/cadastro/prestadores',                      authenticate, cadastro.listarPrestadoresDaEmpresa);
router.get   ('/cadastro/prestadores-do-procedimento',      authenticate, cadastro.prestadoresDoProcedimento);
router.put   ('/cadastro/prestador/:procedimentoId',        authenticate, checkPermission('cadastro.procedimento.editar',  'PROPRIO'), cadastro.definirPrestador);
router.delete('/cadastro/prestador/:procedimentoId/:vinculoId', authenticate, checkPermission('cadastro.procedimento.editar', 'PROPRIO'), cadastro.removerPrestador);

router.get('/cadastro/combos',              authenticate, cadastro.listarCombos);
router.post('/cadastro/combos',             authenticate, checkPermission('cadastro.procedimento.criar',   'PROPRIO'), cadastro.criarCombo);
router.put('/cadastro/combos/:id',          authenticate, checkPermission('cadastro.procedimento.editar',  'PROPRIO'), cadastro.atualizarCombo);
router.patch('/cadastro/combos/:id/toggle', authenticate, checkPermission('cadastro.procedimento.deletar', 'PROPRIO'), cadastro.toggleCombo);

router.get('/',    authenticate, ctrl.listar);
router.get('/:id', authenticate, ctrl.obterPorId);
router.post('/',   authenticate, requireAdmin, ctrl.criar);
router.put('/:id', authenticate, requireAdmin, ctrl.atualizar);
router.delete('/:id', authenticate, requireAdmin, ctrl.excluir);

module.exports = router;

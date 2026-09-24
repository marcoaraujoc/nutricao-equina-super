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
// ALTERAR e ATIVAR/INATIVAR o procedimento da clínica (2026-09-22) — o par que a tela
// passou a oferecer no mesmo formato de Cadastro > Produtos.
// ⚠️ LITERAIS, e por isso ANTES do `router.put('/:id')` lá embaixo (armadilha 1): com
//    a ordem invertida o Express casaria `/cadastro` como valor de `:id`.
// ⚠️ O toggle reusa o slug de `deletar`: inativar É a exclusão lógica deste cadastro,
//    e quem pode tirá-lo da frente é quem pode reativá-lo — slug novo faria o gestor
//    configurar duas permissões para um par de ações que é um só. Mesma decisão de
//    `routes/produtos.js`.
router.put('/cadastro/proprio/:id', authenticate, checkPermission('cadastro.procedimento.editar', 'PROPRIO'), cadastro.atualizarProprio);
router.patch('/cadastro/proprio/:id/toggle', authenticate, checkPermission('cadastro.procedimento.deletar', 'PROPRIO'), cadastro.toggleAtivoProprio);
// EXCLUIR DE VEZ o procedimento da clínica (2026-09-23) — só quando ele nunca foi
// usado; o controller responde 409 `PROCEDIMENTO_EM_USO` quando foi.
// ⚠️ MESMO slug do inativar, de propósito: são as duas formas de tirar o cadastro da
//    frente, e separá-las faria o gestor configurar duas permissões para uma decisão só
//    — além de permitir o absurdo de quem pode APAGAR não poder inativar.
// ⚠️ LITERAL, e por isso antes do `router.delete('/:id')` lá embaixo (armadilha 1).
router.delete('/cadastro/proprio/:id', authenticate, checkPermission('cadastro.procedimento.deletar', 'PROPRIO'), cadastro.excluirProprio);

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

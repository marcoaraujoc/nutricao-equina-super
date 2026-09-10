// src/routes/alimentos.js
// Catálogo de alimentos — ADMIN gerencia; outros usuários só consultam (usado em dropdowns de dieta)

const express = require('express');
const AlimentoController = require('../controllers/AlimentoController');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

const router = express.Router();

// 🔴 CATÁLOGO MISTO desde 2026-09-09 (migration 20261004000000): a clínica cadastra,
// edita e EXCLUI o que é dela; a linha do sistema (empresa_id nulo) continua sendo só
// do ADMIN da plataforma — quem decide isso é o controller
// (`lib/catalogoNutricional.js#bloqueioDeEscrita`), não a rota.
//
// ⚠️ Os GETs seguem apenas autenticados, de propósito: o catálogo alimenta os dropdowns
// de Dieta, Relatório Nutricional e Análise NRC. Um slug de leitura esvaziaria essas
// telas para quem não o tivesse — e o RLS já recorta o que cada empresa enxerga.

router.get('/',     authenticate, AlimentoController.listar);
router.post('/',    authenticate, checkPermission('nutricao.catalogo.criar', 'PROPRIO'), AlimentoController.criar);
router.get('/:id',  authenticate, AlimentoController.obterPorId);
router.put('/:id',  authenticate, checkPermission('nutricao.catalogo.editar', 'PROPRIO'), AlimentoController.atualizar);
router.delete('/:id', authenticate, checkPermission('nutricao.catalogo.deletar', 'PROPRIO'), AlimentoController.excluir);

module.exports = router;

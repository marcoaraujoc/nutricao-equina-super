// src/routes/nutrientes.js
// Catálogo de nutrientes — ADMIN gerencia; outros usuários só consultam (usado em dropdowns de exame/dieta)

const express = require('express');
const nutrientesController = require('../controllers/NutrientesController');
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

router.get('/',     authenticate, nutrientesController.listar);
router.post('/',    authenticate, checkPermission('nutricao.catalogo.criar', 'PROPRIO'), nutrientesController.criar);
router.get('/:id',  authenticate, nutrientesController.obterPorId);
router.put('/:id',  authenticate, checkPermission('nutricao.catalogo.editar', 'PROPRIO'), nutrientesController.atualizar);
router.delete('/:id', authenticate, checkPermission('nutricao.catalogo.deletar', 'PROPRIO'), nutrientesController.excluir);

module.exports = router;

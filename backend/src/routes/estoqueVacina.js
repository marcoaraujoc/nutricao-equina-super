// routes/estoqueVacina.js — estoque de lotes de vacinas por clínica
'use strict';

const router = require('express').Router();
const { authenticate } = require('../middlewares/auth');
const ctrl = require('../controllers/EstoqueVacinaController');

router.use(authenticate);

// Catálogo auxiliar (dropdowns do formulário e catálogo com estoque)
router.get('/fabricantes',        ctrl.listarFabricantes);
router.get('/vacinas',            ctrl.listarVacinasPorFabricante);
router.get('/catalogo',           ctrl.listarCatalogoComEstoque);
router.get('/lotes-disponiveis',  ctrl.listarLotesDisponiveisPorMed);

// CRUD de lotes
router.get('/',    ctrl.listar);
router.post('/',   ctrl.criar);
router.put('/:id', ctrl.atualizar);
router.delete('/:id', ctrl.excluir);

module.exports = router;

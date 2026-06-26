// routes/estoqueVacina.js — estoque de lotes de vacinas por clínica
'use strict';

const router = require('express').Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');
const ctrl = require('../controllers/EstoqueVacinaController');

router.use(authenticate);

// Catálogo auxiliar (dropdowns do formulário e catálogo com estoque)
router.get('/fabricantes',        checkPermission('vacina.estoque.ler', 'LEITURA'), ctrl.listarFabricantes);
router.get('/vacinas',            checkPermission('vacina.estoque.ler', 'LEITURA'), ctrl.listarVacinasPorFabricante);
router.get('/catalogo',           checkPermission('vacina.estoque.ler', 'LEITURA'), ctrl.listarCatalogoComEstoque);
router.get('/lotes-disponiveis',  checkPermission('vacina.estoque.ler', 'LEITURA'), ctrl.listarLotesDisponiveisPorMed);

// CRUD de lotes
router.get('/',    checkPermission('vacina.estoque.ler',    'LEITURA'), ctrl.listar);
router.post('/',   checkPermission('vacina.estoque.criar',   'PROPRIO'), ctrl.criar);
router.put('/:id', checkPermission('vacina.estoque.editar',  'PROPRIO'), ctrl.atualizar);
router.delete('/:id', checkPermission('vacina.estoque.deletar', 'PROPRIO'), ctrl.excluir);

module.exports = router;

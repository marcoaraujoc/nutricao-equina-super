// routes/vacinaClinica.js — registro clínico de vacinas
const router = require('express').Router();
const { authenticate } = require('../middlewares/auth');
const ctrl = require('../controllers/VacinaClinicaController');

router.use(authenticate);

// Catálogo (para dropdown clínico)
router.get('/catalogo',                       ctrl.listarCatalogoAtivo);
router.get('/lotes-disponiveis/:vacinaId',    ctrl.listarLotesDisponiveis);

// Aplicações por animal
router.get('/animal/:animalId',               ctrl.listarPorAnimal);
router.post('/',                              ctrl.registrar);
router.delete('/:id',                         ctrl.excluir);

module.exports = router;

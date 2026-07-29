// routes/vacinaClinica.js — registro clínico de vacinas
const router = require('express').Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');
const ctrl = require('../controllers/VacinaClinicaController');

router.use(authenticate);

// Catálogo (suporte para dropdowns — não exige permissão específica, só autenticação)
router.get('/catalogo',                       ctrl.listarCatalogoAtivo);
router.get('/lotes-disponiveis/:vacinaId',    ctrl.listarLotesDisponiveis);

// Vacinas FINALIZADAS aguardando aplicação — tela de Execução de Prescrição (plantão)
router.get('/para-execucao',                  checkPermission('enfermagem.prescricao.ler',      'LEITURA'), ctrl.listarParaExecucao);

// Aplicações por animal
router.get('/animal/:animalId',               checkPermission('atendimento.vacinas.ler',    'LEITURA'), ctrl.listarPorAnimal);
router.post('/',                              checkPermission('atendimento.vacinas.criar',   'PROPRIO'), ctrl.registrar);
router.get('/:id',                            checkPermission('atendimento.vacinas.ler',    'LEITURA'), ctrl.obterPorId);
router.patch('/:id/finalizar',                checkPermission('atendimento.vacinas.finalizar', 'PROPRIO'), ctrl.finalizar);
router.patch('/:id/executar',                 checkPermission('enfermagem.prescricao.executar', 'PROPRIO'), ctrl.executar);
router.delete('/:id',                         checkPermission('atendimento.vacinas.deletar', 'PROPRIO'), ctrl.excluir);

module.exports = router;

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
// Vacinas EXECUTADAS hoje — faixa "Histórico — executadas hoje" da mesma tela
router.get('/executadas-hoje',                checkPermission('enfermagem.prescricao.ler',      'LEITURA'), ctrl.listarExecutadasHoje);

// Aplicações por animal
router.get('/animal/:animalId',               checkPermission('atendimento.vacinas.ler',    'LEITURA'), ctrl.listarPorAnimal);
router.post('/',                              checkPermission('atendimento.vacinas.criar',   'PROPRIO'), ctrl.registrar);
router.get('/:id',                            checkPermission('atendimento.vacinas.ler',    'LEITURA'), ctrl.obterPorId);
router.put('/:id',                            checkPermission('atendimento.vacinas.editar', 'PROPRIO'), ctrl.atualizar);
router.patch('/:id/finalizar',                checkPermission('atendimento.vacinas.finalizar', 'PROPRIO'), ctrl.finalizar);
router.patch('/:id/executar',                 checkPermission('enfermagem.prescricao.executar', 'PROPRIO'), ctrl.executar);
router.delete('/:id',                         checkPermission('atendimento.vacinas.deletar', 'PROPRIO'), ctrl.excluir);

// Cancelar a vacina PELO PLANTÃO (/execucao-prescricao). MESMO controller do cancelar da
// tela de Vacina — logo, mesma regra: justificativa obrigatória, estorno do item de fatura
// e das doses do lote, e auditoria. Só o SLUG muda, pelo mesmo motivo do
// `cancelar-plantao` da prescrição: quem opera o plantão não tem — nem deveria ter — a
// permissão de quem prescreve (`atendimento.vacinas.deletar`).
router.delete('/:id/cancelar-plantao',        checkPermission('enfermagem.prescricao.deletar', 'PROPRIO'), ctrl.excluir);

module.exports = router;

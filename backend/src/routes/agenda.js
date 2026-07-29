// backend/src/routes/agenda.js — montado em /api/clinica
// Histórico unificado + agendamentos do animal (tela AnimalDetail)
'use strict';

const express                 = require('express');
const router                  = express.Router();
const HistoricoController         = require('../controllers/HistoricoController');
const AgendamentoController       = require('../controllers/AgendamentoController');
const ResumoAtendimentoController = require('../controllers/ResumoAtendimentoController');
const { authenticate }        = require('../middlewares/auth');
const { checkPermission }     = require('../middlewares/permissao.middleware');

// Acesso por animal é validado nos controllers via verificarAcessoAnimal
// (cobre PROPRIETARIO, equipe, vínculo direto do vet e designação de prestador)
// /resumo deve vir ANTES de /:animalId para não ser capturado como parâmetro
router.get('/historico/animal/:animalId/resumo', authenticate, HistoricoController.resumirPorAnimal);
router.get('/historico/animal/:animalId',        authenticate, HistoricoController.listarPorAnimal);

// Resumo consolidado de atendimentos por IA (persistido; append só com evento novo)
router.get('/resumo-atendimento/animal/:animalId',             authenticate, ResumoAtendimentoController.obter);
router.post('/resumo-atendimento/animal/:animalId/atualizar',  authenticate, ResumoAtendimentoController.atualizar);

// /agendamentos (sem parâmetro) deve vir ANTES de /agendamentos/animal/:id
// /agendamentos/interpretar deve vir ANTES de /agendamentos (evita ambiguidade)
router.post('/agendamentos/interpretar',      authenticate, checkPermission('atendimento.agendamentos.criar', 'PROPRIO'), AgendamentoController.interpretarVoz);
router.get('/agendamentos',                   authenticate, checkPermission('atendimento.agendamentos.ler',   'LEITURA'), AgendamentoController.listarGlobal);
// Ocupação GLOBAL do profissional no dia (todas as empresas) — antes de /animal/:id
router.get('/agendamentos/ocupacao',          authenticate, checkPermission('atendimento.agendamentos.ler',   'LEITURA'), AgendamentoController.ocupacaoDoDia);
router.get('/agendamentos/animal/:animalId',  authenticate, checkPermission('atendimento.agendamentos.ler',   'LEITURA'), AgendamentoController.listarPorAnimal);
router.post('/agendamentos',                  authenticate, checkPermission('atendimento.agendamentos.criar',  'PROPRIO'), AgendamentoController.criar);
router.patch('/agendamentos/transferir-dia',  authenticate, checkPermission('atendimento.agendamentos.editar', 'PROPRIO'), AgendamentoController.transferirDia);
// Assumir o atendimento de outro veterinário da equipe — literal ANTES de /:id.
// Nível PROPRIO basta: a regra de "qualquer veterinário assume" é validada no controller
// (é um puxar para si, não a edição do agendamento alheio).
router.patch('/agendamentos/:id/assumir',     authenticate, checkPermission('atendimento.agendamentos.editar', 'PROPRIO'), AgendamentoController.assumir);
router.patch('/agendamentos/:id/status',      authenticate, checkPermission('atendimento.agendamentos.editar', 'PROPRIO'), AgendamentoController.atualizarStatus);
router.patch('/agendamentos/:id',             authenticate, checkPermission('atendimento.agendamentos.editar', 'PROPRIO'), AgendamentoController.atualizar);
router.delete('/agendamentos/:id',            authenticate, checkPermission('atendimento.agendamentos.deletar','PROPRIO'), AgendamentoController.excluir);

module.exports = router;

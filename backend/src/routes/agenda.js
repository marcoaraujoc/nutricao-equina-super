// backend/src/routes/agenda.js — montado em /api/clinica
// Histórico unificado + agendamentos do animal (tela AnimalDetail)
'use strict';

const express                 = require('express');
const router                  = express.Router();
const HistoricoController     = require('../controllers/HistoricoController');
const AgendamentoController   = require('../controllers/AgendamentoController');
const { authenticate }        = require('../middlewares/auth');
const { checkPermission }     = require('../middlewares/permissao.middleware');

// Acesso por animal é validado nos controllers via verificarAcessoAnimal
// (cobre PROPRIETARIO, equipe, vínculo direto do vet e designação de prestador)
// /resumo deve vir ANTES de /:animalId para não ser capturado como parâmetro
router.get('/historico/animal/:animalId/resumo', authenticate, HistoricoController.resumirPorAnimal);
router.get('/historico/animal/:animalId',        authenticate, HistoricoController.listarPorAnimal);

// /agendamentos (sem parâmetro) deve vir ANTES de /agendamentos/animal/:id
// /agendamentos/interpretar deve vir ANTES de /agendamentos (evita ambiguidade)
router.post('/agendamentos/interpretar',      authenticate, checkPermission('atendimento.agendamentos.criar', 'PROPRIO'), AgendamentoController.interpretarVoz);
router.get('/agendamentos',                   authenticate, checkPermission('atendimento.agendamentos.ler',   'LEITURA'), AgendamentoController.listarGlobal);
router.get('/agendamentos/animal/:animalId',  authenticate, checkPermission('atendimento.agendamentos.ler',   'LEITURA'), AgendamentoController.listarPorAnimal);
router.post('/agendamentos',                  authenticate, checkPermission('atendimento.agendamentos.criar',  'PROPRIO'), AgendamentoController.criar);
router.patch('/agendamentos/transferir-dia',  authenticate, checkPermission('atendimento.agendamentos.editar', 'PROPRIO'), AgendamentoController.transferirDia);
router.patch('/agendamentos/:id/status',      authenticate, checkPermission('atendimento.agendamentos.editar', 'PROPRIO'), AgendamentoController.atualizarStatus);
router.patch('/agendamentos/:id',             authenticate, checkPermission('atendimento.agendamentos.editar', 'PROPRIO'), AgendamentoController.atualizar);
router.delete('/agendamentos/:id',            authenticate, checkPermission('atendimento.agendamentos.deletar','PROPRIO'), AgendamentoController.excluir);

module.exports = router;

const express = require('express');
const { PlanoDietaController, DietaItemController } = require('../controllers/DietaController');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

const router = express.Router();

// =============================================================================
// PLANOS DE DIETA — /api/dietas/planos/...
// =============================================================================

// Listar planos de um animal (suporta ?ativo=true|false)
router.get('/planos/animal/:animalId', authenticate, checkPermission('nutricao.dietas.ler', 'LEITURA'), PlanoDietaController.listarPorAnimal);

// Buscar planos por nome ou status — /api/dietas/planos/animal/:animalId/buscar?q=&ativo=
router.get('/planos/animal/:animalId/buscar', authenticate, checkPermission('nutricao.dietas.ler', 'LEITURA'), PlanoDietaController.buscar);

// Obter um plano com seus itens
router.get('/planos/:id', authenticate, checkPermission('nutricao.dietas.ler', 'LEITURA'), PlanoDietaController.obterPorId);

// Criar plano
router.post('/planos', authenticate, checkPermission('nutricao.dietas.criar', 'PROPRIO'), PlanoDietaController.criar);

// Atualizar nome do plano
router.put('/planos/:id', authenticate, checkPermission('nutricao.dietas.editar', 'PROPRIO'), PlanoDietaController.atualizar);

// Ativar / Desativar plano
router.patch('/planos/:id/toggle', authenticate, checkPermission('nutricao.dietas.editar', 'EQUIPE'), PlanoDietaController.toggleAtivo);

// Excluir plano (e seus itens em cascata)
router.delete('/planos/:id', authenticate, checkPermission('nutricao.dietas.editar', 'EQUIPE'), PlanoDietaController.excluir);

// =============================================================================
// ITENS DA DIETA — /api/dietas/...
// =============================================================================

// Listar todos os itens de um animal (compatibilidade com código existente)
router.get('/animal/:animalId', authenticate, checkPermission('nutricao.dietas.ler', 'LEITURA'), DietaItemController.listarPorAnimal);

// Listar itens de um plano específico
router.get('/plano/:planoDietaId/itens', authenticate, checkPermission('nutricao.dietas.ler', 'LEITURA'), DietaItemController.listarPorPlano);

// Obter item por ID
router.get('/:id', authenticate, checkPermission('nutricao.dietas.ler', 'LEITURA'), DietaItemController.obterPorId);

// Criar item
router.post('/', authenticate, checkPermission('nutricao.dietas.criar', 'PROPRIO'), DietaItemController.criarItem);

// Atualizar item
router.put('/:id', authenticate, checkPermission('nutricao.dietas.editar', 'PROPRIO'), DietaItemController.atualizarItem);

// Excluir item
router.delete('/:id', authenticate, checkPermission('nutricao.dietas.editar', 'EQUIPE'), DietaItemController.excluirItem);

module.exports = router;
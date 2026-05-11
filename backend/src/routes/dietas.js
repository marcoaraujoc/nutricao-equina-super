const express = require('express');
const { PlanoDietaController, DietaItemController } = require('../controllers/DietaController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

// =============================================================================
// PLANOS DE DIETA — /api/dietas/planos/...
// =============================================================================

// Listar planos de um animal (suporta ?ativo=true|false)
router.get('/planos/animal/:animalId', authenticate, PlanoDietaController.listarPorAnimal);

// Buscar planos por nome ou status — /api/dietas/planos/animal/:animalId/buscar?q=&ativo=
router.get('/planos/animal/:animalId/buscar', authenticate, PlanoDietaController.buscar);

// Obter um plano com seus itens
router.get('/planos/:id', authenticate, PlanoDietaController.obterPorId);

// Criar plano
router.post('/planos', authenticate, PlanoDietaController.criar);

// Atualizar nome do plano
router.put('/planos/:id', authenticate, PlanoDietaController.atualizar);

// Ativar / Desativar plano
router.patch('/planos/:id/toggle', authenticate, PlanoDietaController.toggleAtivo);

// Excluir plano (e seus itens em cascata)
router.delete('/planos/:id', authenticate, PlanoDietaController.excluir);

// =============================================================================
// ITENS DA DIETA — /api/dietas/...
// =============================================================================

// Listar todos os itens de um animal (compatibilidade com código existente)
router.get('/animal/:animalId', authenticate, DietaItemController.listarPorAnimal);

// Listar itens de um plano específico
router.get('/plano/:planoDietaId/itens', authenticate, DietaItemController.listarPorPlano);

// Obter item por ID
router.get('/:id', authenticate, DietaItemController.obterPorId);

// Criar item
router.post('/', authenticate, DietaItemController.criarItem);

// Atualizar item
router.put('/:id', authenticate, DietaItemController.atualizarItem);

// Excluir item
router.delete('/:id', authenticate, DietaItemController.excluirItem);

module.exports = router;
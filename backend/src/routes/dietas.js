const express = require('express');
const DietaController = require('../controllers/DietaController');

const router = express.Router();

// === ROTAS DA TELA DE DIETA v2.3 ===
router.get('/animal/:animalId', DietaController.listarPorAnimal);     // Lista dieta do animal
router.post('/item', DietaController.criarItem);                     // + Adicionar Novo Alimento
router.put('/:id', DietaController.atualizarItem);                   // Alterar item
router.delete('/:id', DietaController.excluirItem);                  // Excluir item

// === ROTAS ANTIGAS (mantidas para compatibilidade) ===
router.get('/', DietaController.listar); // se existir no controller

module.exports = router;
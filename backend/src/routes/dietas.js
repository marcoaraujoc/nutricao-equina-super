const express = require('express');
const DietaController = require('../controllers/DietaController');

const router = express.Router();

router.get('/animal/:animalId', DietaController.listarPorAnimal);
router.get('/:id', DietaController.obterPorId);           // ← ADICIONADA
router.post('/', DietaController.criarItem);
router.put('/:id', DietaController.atualizarItem);
router.delete('/:id', DietaController.excluirItem);

module.exports = router;
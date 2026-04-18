const express = require('express');
const controller = require('../controllers/DietaController');
const router = express.Router();
router.get('/:animalId', controller.listarPorAnimal);
router.post('/', controller.criar);
module.exports = router;

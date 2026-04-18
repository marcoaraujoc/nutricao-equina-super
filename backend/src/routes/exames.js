const express = require('express');
const controller = require('../controllers/ExameController');
const router = express.Router();
router.get('/:animalId', controller.listarPorAnimal);
router.post('/', controller.criar);
module.exports = router;

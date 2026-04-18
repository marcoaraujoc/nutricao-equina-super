const express = require('express');
const animalController = require('../controllers/AnimalController');

const router = express.Router();

router.get('/', animalController.listar);
router.post('/', animalController.criar);

module.exports = router;

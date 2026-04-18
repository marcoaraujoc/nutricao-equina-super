const express = require('express');
const controller = require('../controllers/AnaliseController');
const router = express.Router();
router.get('/:animalId', controller.calcularBalanço);
module.exports = router;

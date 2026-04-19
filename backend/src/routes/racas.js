const express = require('express');
const router = express.Router();
const racaController = require('../controllers/RacaController');

router.get('/', racaController.getAll);

module.exports = router;
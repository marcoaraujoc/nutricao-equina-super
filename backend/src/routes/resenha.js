const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const ResenhaController = require('../controllers/ResenhaController');

router.get('/animal/:animalId', authenticate, ResenhaController.obterPorAnimal);
router.post('/',               authenticate, ResenhaController.salvar);

module.exports = router;

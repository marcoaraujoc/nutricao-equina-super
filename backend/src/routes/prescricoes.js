// backend/src/routes/prescricoes.js

const express              = require('express');
const router               = express.Router();
const PrescricaoController = require('../controllers/PrescricaoController');
const { authenticate }     = require('../middlewares/auth');

// Rotas estáticas antes das parametrizadas
router.post('/finalizar/:animalId', authenticate, PrescricaoController.finalizarTodas);
router.get('/animal/:animalId',     authenticate, PrescricaoController.listarPorAnimal);

// CRUD
router.post('/',    authenticate, PrescricaoController.criar);
router.put('/:id',  authenticate, PrescricaoController.atualizar);
router.delete('/:id', authenticate, PrescricaoController.excluir);

module.exports = router;
// backend/src/routes/fatura.js

const express = require('express');
const router  = express.Router();
const FaturaController = require('../controllers/FaturaController');
const { authenticate } = require('../middlewares/auth');

router.get('/animal/:animalId',    authenticate, FaturaController.obterFaturaAberta);
router.post('/:faturaId/itens',    authenticate, FaturaController.adicionarItem);
router.delete('/itens/:itemId',    authenticate, FaturaController.removerItem);
router.patch('/:faturaId/fechar',  authenticate, FaturaController.fecharFatura);

module.exports = router;
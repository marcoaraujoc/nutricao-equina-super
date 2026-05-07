const express = require('express');
const multer = require('multer');
const composicaoController = require('../controllers/ComposicaoAlimentarController');

const router = express.Router();

const upload = multer({ dest: 'uploads/composicoes/' });

// === ROTAS EXISTENTES (mantidas intactas) ===
router.get('/', composicaoController.listar);
router.post('/', composicaoController.criar);
router.get('/:id', composicaoController.obterPorId);
router.put('/:id', composicaoController.atualizar);
router.delete('/:id', composicaoController.excluir);

// === NOVA ROTA (única adição) ===
router.post('/analisar-llm', upload.single('arquivo'), composicaoController.analisarLLM);

module.exports = router;
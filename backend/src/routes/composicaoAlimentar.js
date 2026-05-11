const express = require('express');
const multer = require('multer');
const composicaoController = require('../controllers/ComposicaoAlimentarController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

const upload = multer({ dest: 'uploads/composicoes/' });

// ── Rotas estáticas ANTES de /:id para evitar conflito de params ────
router.get('/',                authenticate, composicaoController.listar);
router.post('/',               authenticate, composicaoController.criar);

router.post(
  '/analisar-llm',
  authenticate,
  upload.single('arquivo'),
  composicaoController.analisarLLM
);

router.post(
  '/importar-completo',
  authenticate,
  composicaoController.importarCompleto
);

// ── Rotas com parâmetro ─────────────────────────────────────────────
router.get('/:id',    authenticate, composicaoController.obterPorId);
router.put('/:id',    authenticate, composicaoController.atualizar);
router.delete('/:id', authenticate, composicaoController.excluir);

module.exports = router;
// src/routes/composicaoAlimentar.js
// Composições alimentares — ADMIN gerencia (incluindo LLM e importação); outros só consultam

const express = require('express');
const multer = require('multer');
const composicaoController = require('../controllers/ComposicaoAlimentarController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

const upload = multer({ dest: 'uploads/composicoes/' });

const soAdmin = (req, res, next) => {
  if (req.user?.userType !== 'ADMIN') return res.status(403).json({ error: 'Acesso restrito a administradores do sistema.' });
  next();
};

// ── Rotas estáticas ANTES de /:id para evitar conflito de params ────
router.get('/',                authenticate, composicaoController.listar);
router.post('/',               authenticate, soAdmin, composicaoController.criar);

// analisar-llm é somente extração (não persiste) — disponível para todos os autenticados
router.post(
  '/analisar-llm',
  authenticate,
  upload.single('arquivo'),
  composicaoController.analisarLLM
);

router.post(
  '/importar-completo',
  authenticate,
  soAdmin,
  composicaoController.importarCompleto
);

// ── Rotas com parâmetro ─────────────────────────────────────────────
router.get('/:id',    authenticate, composicaoController.obterPorId);
router.put('/:id',    authenticate, soAdmin, composicaoController.atualizar);
router.delete('/:id', authenticate, soAdmin, composicaoController.excluir);

module.exports = router;

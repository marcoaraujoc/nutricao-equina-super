// src/routes/composicaoAlimentar.js
// Composições alimentares — ADMIN gerencia (incluindo LLM e importação); outros só consultam

const express = require('express');
const multer = require('multer');
const composicaoController = require('../controllers/ComposicaoAlimentarController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

// Limite de tamanho + filtro de tipo. O parser (composicaoParserService) só lê PDF
// (texto) e imagem (visão); sem o `fileFilter` qualquer binário era gravado no disco,
// e sem `limits` um autenticado podia encher o disco com um upload gigante (DoS).
// `dest` gera nome aleatório sem `originalname` — não há path traversal.
function fileFilterComposicao(_req, file, cb) {
  if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
    return cb(null, true);
  }
  const err = new Error(`Formato não suportado: "${file.originalname || file.mimetype}". Envie PDF ou imagem.`);
  err.status = 415;
  err.code   = 'FORMATO_ARQUIVO_NAO_SUPORTADO';
  cb(err);
}

const upload = multer({
  dest: 'uploads/composicoes/',
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: fileFilterComposicao,
});

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

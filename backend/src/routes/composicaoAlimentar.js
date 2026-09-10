// src/routes/composicaoAlimentar.js
// Composições alimentares — ADMIN gerencia (incluindo LLM e importação); outros só consultam

const express = require('express');
const multer = require('multer');
const composicaoController = require('../controllers/ComposicaoAlimentarController');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

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

// 🔴 CATÁLOGO MISTO desde 2026-09-09 (migration 20261004000000): a clínica cadastra,
// edita e EXCLUI o que é dela; a linha do sistema (empresa_id nulo) continua sendo só
// do ADMIN da plataforma — quem decide isso é o controller
// (`lib/catalogoNutricional.js#bloqueioDeEscrita`), não a rota.
//
// ⚠️ Os GETs seguem apenas autenticados, de propósito: o catálogo alimenta os dropdowns
// de Dieta, Relatório Nutricional e Análise NRC. Um slug de leitura esvaziaria essas
// telas para quem não o tivesse — e o RLS já recorta o que cada empresa enxerga.

// ── Rotas estáticas ANTES de /:id para evitar conflito de params ────
router.get('/',                authenticate, composicaoController.listar);
router.post('/',               authenticate, checkPermission('nutricao.catalogo.criar', 'PROPRIO'), composicaoController.criar);

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
  checkPermission('nutricao.catalogo.criar', 'PROPRIO'),
  composicaoController.importarCompleto
);

// ── Rotas com parâmetro ─────────────────────────────────────────────
router.get('/:id',    authenticate, composicaoController.obterPorId);
router.put('/:id',    authenticate, checkPermission('nutricao.catalogo.editar', 'PROPRIO'), composicaoController.atualizar);
router.delete('/:id', authenticate, checkPermission('nutricao.catalogo.deletar', 'PROPRIO'), composicaoController.excluir);

module.exports = router;

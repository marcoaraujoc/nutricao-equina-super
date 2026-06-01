// backend/src/routes/evolucao.js

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

const EvolucaoController              = require('../controllers/EvolucaoController');
const { authenticate }                = require('../middlewares/auth');
const { injectTenant }                = require('../middlewares/tenant');
const { checkPermission }             = require('../middlewares/permissao.middleware');
const { interpretarEvolucao }         = require('../services/clinicaLLMService');
const validate                        = require('../middlewares/validate');
const { criarEvolucaoRules,
        evolucaoIdParam }             = require('../validators/evolucao.validators');

// ─── Multer: áudio (transcrição Whisper) ─────────────────────────────────────
const uploadAudio = multer({ dest: 'uploads/audio_tmp/' });

// ─── Multer: mídia de evolução (imagens, vídeos, áudios) ─────────────────────
const MIDIA_DIR = 'uploads/evolucoes/';
if (!fs.existsSync(MIDIA_DIR)) fs.mkdirSync(MIDIA_DIR, { recursive: true });

const uploadMidia = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MIDIA_DIR),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 11)}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image|video|audio)\//;
    cb(null, allowed.test(file.mimetype));
  },
});

// ─── Rotas estáticas ANTES das parametrizadas ─────────────────────────────────

// Interpretar texto com LLM → extrai ações clínicas + título
router.post('/interpretar', authenticate, async (req, res) => {
  const { texto } = req.body;
  if (!texto || !texto.trim()) {
    return res.status(400).json({ sucesso: false, mensagem: 'texto é obrigatório' });
  }
  try {
    const resultado = await interpretarEvolucao(texto);
    res.json({ sucesso: true, dados: resultado });
  } catch (error) {
    console.error('Erro ao interpretar evolução (não crítico):', error);
    res.json({ sucesso: true, dados: { acoes: [], titulo: '' } }); // degradação graciosa
  }
});

// Transcrever áudio com Whisper (utilitário — não altera dados diretamente)
router.post('/transcrever', authenticate, checkPermission('atendimento.evolucoes.criar', 'PROPRIO'), uploadAudio.single('audio'), EvolucaoController.transcrever);

// Listas
router.get('/responsaveis/:animalId', authenticate, checkPermission('atendimento.evolucoes.ler', 'LEITURA'), EvolucaoController.listarResponsaveis);
router.get('/animal/:animalId',       authenticate, checkPermission('atendimento.evolucoes.ler', 'LEITURA'), injectTenant, EvolucaoController.listarPorAnimal);

// ─── Rotas parametrizadas ─────────────────────────────────────────────────────

router.get('/:id',      authenticate, checkPermission('atendimento.evolucoes.ler',     'LEITURA'), injectTenant, evolucaoIdParam, validate, EvolucaoController.obterPorId);
router.post('/',        authenticate, checkPermission('atendimento.evolucoes.criar',   'PROPRIO'), injectTenant, criarEvolucaoRules, validate, EvolucaoController.criar);
router.put('/:id',      authenticate, checkPermission('atendimento.evolucoes.editar',  'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.atualizar);
router.delete('/:id',   authenticate, checkPermission('atendimento.evolucoes.deletar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.excluir);

// Ações de patch
router.patch('/:id/cancelar', authenticate, checkPermission('atendimento.evolucoes.deletar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.cancelar);
router.patch('/:id/aprovar',  authenticate, checkPermission('atendimento.evolucoes.editar',  'EQUIPE'),  evolucaoIdParam, validate, EvolucaoController.aprovar);
router.patch('/:id/titulo',   authenticate, checkPermission('atendimento.evolucoes.editar',  'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.salvarTitulo);

// Mídias
router.post('/:id/midias',              authenticate, checkPermission('atendimento.evolucoes.criar',   'PROPRIO'), evolucaoIdParam, validate, uploadMidia.single('midia'), EvolucaoController.adicionarMidia);
router.delete('/:id/midias/:midiaId',   authenticate, checkPermission('atendimento.evolucoes.deletar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.removerMidia);

module.exports = router;
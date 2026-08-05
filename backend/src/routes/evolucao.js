// backend/src/routes/evolucao.js

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const router  = express.Router();

const EvolucaoController              = require('../controllers/EvolucaoController');
const { authenticate }                = require('../middlewares/auth');
// Teto de tamanho do sistema (150 MB) — fonte única em src/storage.
const { TETO_ARQUIVO_BYTES }          = require('../storage');
const { injectTenant }                = require('../middlewares/tenant');
const { checkPermission }             = require('../middlewares/permissao.middleware');
const { interpretarEvolucao }         = require('../services/clinicaLLMService');
const validate                        = require('../middlewares/validate');
const { criarEvolucaoRules,
        evolucaoIdParam }             = require('../validators/evolucao.validators');

// ─── Multer: áudio (transcrição via Gemini) ──────────────────────────────────
const uploadAudio = multer({ dest: 'uploads/audio_tmp/' });

// ─── Multer: mídia de evolução (imagens, vídeos, áudios) ─────────────────────
const MIDIA_DIR = 'uploads/evolucoes/';
if (!fs.existsSync(MIDIA_DIR)) fs.mkdirSync(MIDIA_DIR, { recursive: true });

// Extensões permitidas para mídia clínica. SVG/HTML são deliberadamente excluídos
// (vetor de XSS armazenado quando servidos via /uploads).
const MIDIA_EXT_PERMITIDAS = /\.(jpe?g|png|gif|webp|mp4|webm|ogg|mov|m4v|mp3|wav|m4a|aac)$/i;
const MIDIA_MIME_PERMITIDOS = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|ogg|quicktime|x-m4v)|audio\/(mpeg|mp3|webm|ogg|wav|mp4|x-m4a|aac))$/i;

const uploadMidia = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MIDIA_DIR),
    filename:    (_req, file, cb) => {
      // Só reaproveita a extensão se ela estiver na whitelist; nunca usa o nome do
      // usuário no arquivo final (evita path traversal e extensões maliciosas).
      const extRaw = path.extname(file.originalname).toLowerCase();
      const ext = MIDIA_EXT_PERMITIDAS.test(extRaw) ? extRaw : '';
      // crypto.randomBytes → URL impossível de enumerar (capability URL).
      cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`);
    },
  }),
  // Teto do sistema (150 MB). O multer recusa ANTES de ler o corpo inteiro; o
  // DbStorageProvider repete a checagem como rede de segurança para toda rota.
  limits: { fileSize: TETO_ARQUIVO_BYTES },
  fileFilter: (_req, file, cb) => {
    // Valida mimetype declarado E extensão — o mimetype sozinho é falsificável pelo cliente.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, MIDIA_MIME_PERMITIDOS.test(file.mimetype) && MIDIA_EXT_PERMITIDAS.test(ext));
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
    const resultado = await interpretarEvolucao(texto, req.user?.id ?? null, null, req.empresaId ?? null);
    res.json({ sucesso: true, dados: resultado });
  } catch (error) {
    console.error('Erro ao interpretar evolução (não crítico):', error);
    res.json({ sucesso: true, dados: { acoes: [], titulo: '' } }); // degradação graciosa
  }
});

// Transcrever áudio com Gemini (utilitário — não altera dados diretamente)
router.post('/transcrever', authenticate, checkPermission('atendimento.evolucoes.criar', 'PROPRIO'), uploadAudio.single('audio'), EvolucaoController.transcrever);

// Listas
router.get('/responsaveis/:animalId', authenticate, checkPermission('atendimento.evolucoes.ler', 'LEITURA'), EvolucaoController.listarResponsaveis);
router.get('/animal/:animalId',       authenticate, checkPermission('atendimento.evolucoes.ler', 'LEITURA'), injectTenant, EvolucaoController.listarPorAnimal);

// ─── Rotas parametrizadas ─────────────────────────────────────────────────────

router.get('/:id',      authenticate, checkPermission('atendimento.evolucoes.ler',     'LEITURA'), injectTenant, evolucaoIdParam, validate, EvolucaoController.obterPorId);
router.get('/:id/relatorio-atendimento', authenticate, checkPermission('atendimento.evolucoes.ler', 'LEITURA'), injectTenant, evolucaoIdParam, validate, EvolucaoController.relatorioAtendimento);
router.put('/:id/resumo-ia', authenticate, checkPermission('atendimento.evolucoes.editar', 'PROPRIO'), injectTenant, evolucaoIdParam, validate, EvolucaoController.salvarResumoIa);
router.post('/',        authenticate, checkPermission('atendimento.evolucoes.criar',   'PROPRIO'), injectTenant, criarEvolucaoRules, validate, EvolucaoController.criar);
router.put('/:id',      authenticate, checkPermission('atendimento.evolucoes.editar',  'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.atualizar);
router.delete('/:id',   authenticate, checkPermission('atendimento.evolucoes.deletar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.excluir);

// Ações de patch
router.patch('/:id/cancelar', authenticate, checkPermission('atendimento.evolucoes.deletar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.cancelar);
router.patch('/:id/aprovar',  authenticate, checkPermission('atendimento.evolucoes.finalizar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.aprovar);
// Assumir a evolução em andamento de outro profissional. Nível PROPRIO basta: é um
// "puxar para si" (o assumidor passa a ser o autor), não a edição do registro alheio
// — a regra é validada no controller, igual ao assumir da agenda.
router.patch('/:id/assumir',  authenticate, checkPermission('atendimento.evolucoes.editar', 'PROPRIO'), injectTenant, evolucaoIdParam, validate, EvolucaoController.assumir);
router.patch('/:id/titulo',   authenticate, checkPermission('atendimento.evolucoes.editar',  'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.salvarTitulo);

// Mídias
router.post('/:id/midias',              authenticate, checkPermission('atendimento.evolucoes.criar',   'PROPRIO'), evolucaoIdParam, validate, uploadMidia.single('midia'), EvolucaoController.adicionarMidia);
router.delete('/:id/midias/:midiaId',   authenticate, checkPermission('atendimento.evolucoes.deletar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.removerMidia);

module.exports = router;
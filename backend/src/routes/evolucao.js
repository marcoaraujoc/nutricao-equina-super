// backend/src/routes/evolucao.js

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const router  = express.Router();

const EvolucaoController              = require('../controllers/EvolucaoController');
const { authenticate }                = require('../middlewares/auth');
const { tenantRls }                   = require('../middlewares/tenantRls');
// Teto de tamanho do sistema (150 MB) — fonte única em src/storage.
const { TETO_ARQUIVO_BYTES }          = require('../storage');
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
// ⚠️ `tenantRls` REENTRA no contexto do tenant logo APÓS o multer (mesmo padrão de
// routes/animais.js) — o parsing de stream do multer pode fazer o `AsyncLocalStorage`
// do tenant não sobreviver até o controller (o log de uso de IA grava `empresaId`).
router.post('/transcrever', authenticate, checkPermission('atendimento.evolucoes.criar', 'PROPRIO'), uploadAudio.single('audio'), tenantRls, EvolucaoController.transcrever);

// Listas
router.get('/responsaveis/:animalId', authenticate, checkPermission('atendimento.evolucoes.ler', 'LEITURA'), EvolucaoController.listarResponsaveis);
// ⚠️ `injectTenant` foi REMOVIDO desta rota e das demais abaixo (2026-08-17) — ele
// reatribuía `req.empresaId` pela equipe mais RECENTE do usuário, ignorando o
// contexto ativo (x-empresa-id/x-equipe-id) que o `authenticate` já resolveu. Sob RLS
// fail-closed (fase 7c) esse valor tardio diverge do `app.empresa_id` já carimbado na
// sessão do Postgres pelo `authenticate` — a escrita cai em "new row violates row-level
// security policy". Ver CLAUDE.md §12/multi-tenancy.
router.get('/animal/:animalId',       authenticate, checkPermission('atendimento.evolucoes.ler', 'LEITURA'), EvolucaoController.listarPorAnimal);

// ─── Rotas parametrizadas ─────────────────────────────────────────────────────

router.get('/:id',      authenticate, checkPermission('atendimento.evolucoes.ler',     'LEITURA'), evolucaoIdParam, validate, EvolucaoController.obterPorId);
router.get('/:id/relatorio-atendimento', authenticate, checkPermission('atendimento.evolucoes.ler', 'LEITURA'), evolucaoIdParam, validate, EvolucaoController.relatorioAtendimento);
router.put('/:id/resumo-ia', authenticate, checkPermission('atendimento.evolucoes.editar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.salvarResumoIa);
router.post('/',        authenticate, checkPermission('atendimento.evolucoes.criar',   'PROPRIO'), criarEvolucaoRules, validate, EvolucaoController.criar);
router.put('/:id',      authenticate, checkPermission('atendimento.evolucoes.editar',  'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.atualizar);
router.delete('/:id',   authenticate, checkPermission('atendimento.evolucoes.deletar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.excluir);

// Ações de patch
router.patch('/:id/cancelar', authenticate, checkPermission('atendimento.evolucoes.deletar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.cancelar);
router.patch('/:id/aprovar',  authenticate, checkPermission('atendimento.evolucoes.finalizar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.aprovar);
// Assumir a evolução em andamento de outro profissional. Nível PROPRIO basta: é um
// "puxar para si" (o assumidor passa a ser o autor), não a edição do registro alheio
// — a regra é validada no controller, igual ao assumir da agenda.
router.patch('/:id/assumir',  authenticate, checkPermission('atendimento.evolucoes.editar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.assumir);
router.patch('/:id/titulo',   authenticate, checkPermission('atendimento.evolucoes.editar',  'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.salvarTitulo);
// Título por IA + ações clínicas, chamada DEPOIS de finalizar (o "Finalizar" deixou de
// esperar o Gemini — ver o comentário em EvolucaoController.tituloIa). Uma só chamada
// de IA: grava o título e devolve as sugestões de encaminhamento.
router.post('/:id/titulo-ia', authenticate, checkPermission('atendimento.evolucoes.editar',  'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.tituloIa);

// Mídias
// ⚠️ `tenantRls` REENTRA no contexto do tenant logo APÓS o multer — ver comentário em
// routes/animais.js. Sem isto, gravar a mídia cai em "new row violates row-level
// security policy" mesmo com `req.empresaId` correto.
router.post('/:id/midias',              authenticate, checkPermission('atendimento.evolucoes.criar',   'PROPRIO'), evolucaoIdParam, validate, uploadMidia.single('midia'), tenantRls, EvolucaoController.adicionarMidia);
router.delete('/:id/midias/:midiaId',   authenticate, checkPermission('atendimento.evolucoes.deletar', 'PROPRIO'), evolucaoIdParam, validate, EvolucaoController.removerMidia);

module.exports = router;
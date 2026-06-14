// backend/src/routes/exames.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path   = require('path');
const crypto = require('crypto');
const exameController = require('../controllers/ExameController');
const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

// memoryStorage para upload persistente — StorageProvider decide o destino
const upload = multer({ storage: multer.memoryStorage() });

// diskStorage apenas para análise LLM (exameParserService precisa do path)
const uploadTemp = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, 'uploads/exames/'),
    // Nunca usa originalname no nome final (path traversal via `../`); só extensão limpa.
    filename:    (_req, file, cb) => {
      const extRaw = path.extname(file.originalname || '').toLowerCase();
      const ext = /^\.[a-z0-9]{1,8}$/.test(extRaw) ? extRaw : '';
      cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`);
    },
  }),
});

// Rotas existentes
router.get('/animal/:animalId', authenticate, checkPermission('atendimento.exames.ler',     'LEITURA'), exameController.getExamesByAnimal);
router.post('/',                authenticate, checkPermission('atendimento.exames.criar',   'PROPRIO'), upload.single('arquivo'), exameController.create);
router.post('/analisar-llm',    authenticate, checkPermission('atendimento.exames.criar',   'PROPRIO'), uploadTemp.single('arquivo'), exameController.analisarLLM);
router.delete('/:id',           authenticate, checkPermission('atendimento.exames.deletar', 'PROPRIO'), exameController.delete);
router.put('/:id',              authenticate, checkPermission('atendimento.exames.editar',  'PROPRIO'), exameController.update);

// Removemos a rota PUT por enquanto (não estamos usando edição ainda)
module.exports = router;
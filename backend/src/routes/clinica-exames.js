// backend/src/routes/clinica-exames.js  — montado em /api/clinica/exames
'use strict';

const express                  = require('express');
const router                   = express.Router();
const multer                   = require('multer');
const path                     = require('path');
const crypto                   = require('crypto');
const ExameClinicoController   = require('../controllers/ExameClinicoController');
const { authenticate }         = require('../middlewares/auth');
const { checkPermission }      = require('../middlewares/permissao.middleware');

// diskStorage: o exameParserService (LLM) precisa do path do arquivo; nome final
// imprevisível e sem originalname (evita path traversal), como em routes/exames.js.
const uploadResultado = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, 'uploads/exames/'),
    filename:    (_req, file, cb) => {
      const extRaw = path.extname(file.originalname || '').toLowerCase();
      const ext = /^\.[a-z0-9]{1,8}$/.test(extRaw) ? extRaw : '';
      cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`);
    },
  }),
});

router.get('/animal/:animalId',   authenticate, checkPermission('atendimento.exames.ler',       'LEITURA'), ExameClinicoController.listarPorAnimal);
router.get('/:id',                authenticate, checkPermission('atendimento.exames.ler',       'LEITURA'), ExameClinicoController.obterPorId);
router.post('/',                  authenticate, checkPermission('atendimento.exames.criar',      'PROPRIO'), ExameClinicoController.criar);
router.put('/:id',                authenticate, checkPermission('atendimento.exames.editar',     'PROPRIO'), ExameClinicoController.atualizar);
router.patch('/:id/finalizar',    authenticate, checkPermission('atendimento.exames.finalizar',  'PROPRIO'), ExameClinicoController.finalizar);
// CARREGAR RESULTADO — entra por atendimento.exames.ler (popula contexto p/ o bypass do
// gestor); o gate REAL do resultado (exames.laboratorial.*/exames.imagem.*) é no controller.
router.patch('/:id/resultado',    authenticate, checkPermission('atendimento.exames.ler',       'LEITURA'), uploadResultado.array('arquivos', 20), ExameClinicoController.salvarResultado);
router.delete('/:id',             authenticate, checkPermission('atendimento.exames.deletar',    'PROPRIO'), ExameClinicoController.excluir);

module.exports = router;

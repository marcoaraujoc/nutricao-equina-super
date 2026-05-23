// backend/src/routes/exames.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const exameController = require('../controllers/ExameController');

// memoryStorage para upload persistente — StorageProvider decide o destino
const upload = multer({ storage: multer.memoryStorage() });

// diskStorage apenas para análise LLM (exameParserService precisa do path)
const uploadTemp = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, 'uploads/exames/'),
    filename:    (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
});

// Rotas existentes
router.get('/animal/:animalId', exameController.getExamesByAnimal);
router.post('/', upload.single('arquivo'), exameController.create);
router.post('/analisar-llm', uploadTemp.single('arquivo'), exameController.analisarLLM);
router.delete('/:id', exameController.delete);
router.put('/:id', exameController.update);   // ← adicione esta linha

// Removemos a rota PUT por enquanto (não estamos usando edição ainda)
module.exports = router;
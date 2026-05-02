// backend/src/routes/exames.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const exameController = require('../controllers/ExameController');

// Configuração do Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/exames/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Rotas existentes
router.get('/animal/:animalId', exameController.getExamesByAnimal);
router.post('/', upload.single('arquivo'), exameController.create);
router.post('/analisar-llm', upload.single('arquivo'), exameController.analisarLLM);
router.delete('/:id', exameController.delete);
router.put('/:id', exameController.update);   // ← adicione esta linha

// Removemos a rota PUT por enquanto (não estamos usando edição ainda)
module.exports = router;
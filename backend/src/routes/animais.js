const express = require('express');
const multer = require('multer');
const animalController = require('../controllers/AnimalController');

const router = express.Router();

// Configuração do multer direto nas rotas (mais confiável)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = require('path').join(__dirname, '../../uploads');
    const fs = require('fs');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + require('path').extname(file.originalname));
  }
});

const upload = multer({ storage });

// Rotas
router.get('/', animalController.listar);
router.get('/:id', animalController.obterPorId);
router.delete('/:id', animalController.excluir);

// Rotas com upload de foto
router.post('/', upload.single('foto'), animalController.criar);
router.put('/:id', upload.single('foto'), animalController.atualizar);

module.exports = router;
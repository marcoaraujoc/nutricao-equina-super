const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../middlewares/auth.js');   // ← importante

const animalController = require('../controllers/AnimalController');

const router = express.Router();

// 🔥 Protege todas as rotas
router.use(authenticate);

// Configuração do multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Rotas
router.get('/', animalController.listar);
router.get('/:id', animalController.obterPorId);
router.delete('/:id', animalController.excluir);

router.post('/vincular-vet', animalController.vincularVet);
router.post('/', upload.single('foto'), animalController.criar);
router.put('/:id', upload.single('foto'), animalController.atualizar);

module.exports = router;
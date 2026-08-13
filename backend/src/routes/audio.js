// backend/src/routes/audio.js

const express        = require('express');
const multer         = require('multer');
const path           = require('path');
const fs             = require('fs');
const router         = express.Router();
const AudioController = require('../controllers/AudioController');
const { authenticate } = require('../middlewares/auth');
const { tenantRls }    = require('../middlewares/tenantRls');

// ─── Diretório temporário para uploads de áudio ───────────────────────────────

const UPLOAD_DIR = path.join(__dirname, '../../uploads/audio_tmp');

// Cria o diretório se não existir
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ─── Multer — armazena temporariamente em disco ───────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const timestamp = Date.now();
    const ext       = path.extname(file.originalname) || '.webm';
    cb(null, `audio_${timestamp}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'];
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não suportado: ${file.mimetype}`));
    }
  },
});

// ─── Rota ─────────────────────────────────────────────────────────────────────

// ⚠️ `tenantRls` REENTRA no contexto do tenant logo APÓS o multer — ver comentário em
// routes/animais.js.
router.post(
  '/processar',
  authenticate,
  upload.single('audio'),
  tenantRls,
  AudioController.processar,
);

module.exports = router;
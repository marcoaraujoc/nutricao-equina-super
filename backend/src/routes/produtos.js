const express = require('express');
const controller = require('../controllers/ProdutoController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

// `Produto` é catálogo GLOBAL (não tem empresaId): o que uma empresa cria aqui aparece
// para todas. A escrita, portanto, é do ADMIN da plataforma — antes bastava estar
// autenticado para incluir linha no catálogo que todo mundo enxerga.
// GET fica livre porque alimenta dropdowns (mesmo padrão de alimentos/nutrientes).
const soAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN' && req.user?.userType !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso restrito a administradores do sistema.' });
  }
  next();
};

router.get('/',  authenticate, controller.listar);
router.post('/', authenticate, soAdmin, controller.criar);

module.exports = router;

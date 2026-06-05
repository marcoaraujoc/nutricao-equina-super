const express = require('express');
const controller = require('../controllers/ProdutoController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.get('/',  authenticate, controller.listar);
router.post('/', authenticate, controller.criar);

module.exports = router;

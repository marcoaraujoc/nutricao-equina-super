// routes/vacinaAdmin.js — catálogo de vacinas + lotes (ADMIN only)
const router = require('express').Router();
const { authenticate } = require('../middlewares/auth');
const ctrl = require('../controllers/VacinaAdminController');

const soAdmin = (req, res, next) => {
  if (req.user?.userType !== 'ADMIN') return res.status(403).json({ error: 'Acesso restrito ao ADMIN' });
  next();
};

router.use(authenticate, soAdmin);

// Catálogo
router.get('/',           ctrl.listarVacinas);
router.post('/',          ctrl.criarVacina);
router.put('/:id',        ctrl.atualizarVacina);
router.patch('/:id/toggle', ctrl.toggleVacina);

// Lotes por vacina
router.get('/:vacinaId/lotes',  ctrl.listarLotes);
router.post('/:vacinaId/lotes', ctrl.criarLote);
router.put('/lotes/:id',        ctrl.atualizarLote);
router.patch('/lotes/:id/inativar', ctrl.inativarLote);

module.exports = router;

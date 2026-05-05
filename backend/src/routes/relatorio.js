const express = require('express');
const router = express.Router();

// Teste mínimo - sem depender do controller
router.get('/relatorio/:animalId', (req, res) => {
  res.json({ message: '✅ Rota de relatório funcionando (teste mínimo)' });
});

module.exports = router;
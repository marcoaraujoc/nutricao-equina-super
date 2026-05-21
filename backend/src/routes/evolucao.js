// backend/src/routes/evolucao.js

const express = require('express');
const router  = express.Router();
const EvolucaoController       = require('../controllers/EvolucaoController');
const { authenticate }         = require('../middlewares/auth');
const { interpretarEvolucao }  = require('../services/clinicaLLMService');

// Rota específica ANTES das parametrizadas
router.post('/interpretar', authenticate, async (req, res) => {
  const { texto } = req.body;
  if (!texto || !texto.trim()) {
    return res.status(400).json({ sucesso: false, mensagem: 'texto é obrigatório' });
  }
  try {
    const resultado = await interpretarEvolucao(texto);
    res.json({ sucesso: true, dados: resultado });
  } catch (error) {
    console.error('Erro ao interpretar evolução (não crítico):', error);
    res.json({ sucesso: true, dados: { acoes: [] } }); // degradação graciosa
  }
});

router.get('/animal/:animalId', authenticate, EvolucaoController.listarPorAnimal);
router.get('/:id',             authenticate, EvolucaoController.obterPorId);
router.post('/',               authenticate, EvolucaoController.criar);
router.put('/:id',             authenticate, EvolucaoController.atualizar);
router.delete('/:id',          authenticate, EvolucaoController.excluir);
router.patch('/:id/aprovar',   authenticate, EvolucaoController.aprovar);

module.exports = router;
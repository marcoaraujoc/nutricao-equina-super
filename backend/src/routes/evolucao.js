// backend/src/routes/evolucao.js

const express = require('express');
const router  = express.Router();
const EvolucaoController                    = require('../controllers/EvolucaoController');
const { authenticate }                        = require('../middlewares/auth');
const { injectTenant }                        = require('../middlewares/tenant');
const { interpretarEvolucao }                 = require('../services/clinicaLLMService');
const validate                                = require('../middlewares/validate');
const { criarEvolucaoRules, evolucaoIdParam } = require('../validators/evolucao.validators');

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

router.get('/animal/:animalId', authenticate, injectTenant, EvolucaoController.listarPorAnimal);
router.get('/:id',             authenticate, injectTenant, evolucaoIdParam, validate, EvolucaoController.obterPorId);
router.post('/',               authenticate, injectTenant, criarEvolucaoRules, validate, EvolucaoController.criar);
router.put('/:id',             authenticate, evolucaoIdParam, validate, EvolucaoController.atualizar);
router.delete('/:id',          authenticate, evolucaoIdParam, validate, EvolucaoController.excluir);
router.patch('/:id/aprovar',   authenticate, evolucaoIdParam, validate, EvolucaoController.aprovar);

module.exports = router;
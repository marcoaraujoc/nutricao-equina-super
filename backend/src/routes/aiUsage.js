// src/routes/aiUsage.js

const express = require('express');
const AiUsageController = require('../controllers/AiUsageController');
const { authenticate, authorize } = require('../middlewares/auth');

const router = express.Router();

// Todas as rotas exigem autenticação
// resumo e projeção: qualquer usuário autenticado
// log recente e por modelo: apenas ADMIN
router.get('/resumo',          authenticate, AiUsageController.resumo);
router.get('/evolucao-diaria', authenticate, AiUsageController.evolucaoDiaria);
router.get('/por-modelo',      authenticate, authorize('ADMIN'), AiUsageController.porModelo);
router.get('/log-recente',     authenticate, authorize('ADMIN'), AiUsageController.logRecente);
router.get('/projecao-mensal', authenticate, AiUsageController.projecaoMensal);

// Metering por cliente (empresa) + plano de consumo — ADMIN.
// Rota literal antes de /planos/:empresaId para o Express não confundir os paths.
router.get('/por-empresa',          authenticate, authorize('ADMIN'), AiUsageController.porEmpresa);
router.get('/planos/:empresaId',    authenticate, authorize('ADMIN'), AiUsageController.obterPlano);
router.put('/planos/:empresaId',    authenticate, authorize('ADMIN'), AiUsageController.salvarPlano);

module.exports = router;


// ─── Registrar em server.js ───────────────────────────────────────────────────
// Adicionar as duas linhas abaixo no server.js, junto com as outras rotas:

// const aiUsageRoutes = require('./routes/aiUsage');
// app.use('/api/ai-usage', aiUsageRoutes);
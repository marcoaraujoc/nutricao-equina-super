// src/routes/aiUsage.js

const express = require('express');
const AiUsageController = require('../controllers/AiUsageController');
const { authenticate, authorize } = require('../middlewares/auth');
// FASE 7c — o ADMIN precisa de escopo de PLATAFORMA para ler `tb_ai_usage_logs`, que tem
// RLS. Sem isto o painel /ai-usage aparece VAZIO para ele (medido: 0 de 26 registros).
// O middleware checa o papel em runtime: para quem não é ADMIN é passagem direta, e o
// tenant da requisição continua valendo — inclusive em /resumo, que é aberto a todos.
const escopoPlataformaSeAdmin = require('../middlewares/escopoPlataforma');

const router = express.Router();

// Todas as rotas exigem autenticação
// resumo e projeção: qualquer usuário autenticado
// log recente e por modelo: apenas ADMIN
router.get('/resumo',          authenticate, escopoPlataformaSeAdmin, AiUsageController.resumo);
router.get('/evolucao-diaria', authenticate, escopoPlataformaSeAdmin, AiUsageController.evolucaoDiaria);
router.get('/por-modelo',      authenticate, authorize('ADMIN'), escopoPlataformaSeAdmin, AiUsageController.porModelo);
router.get('/log-recente',     authenticate, authorize('ADMIN'), escopoPlataformaSeAdmin, AiUsageController.logRecente);
router.get('/projecao-mensal', authenticate, escopoPlataformaSeAdmin, AiUsageController.projecaoMensal);

// Metering por cliente (empresa) + plano de consumo — ADMIN.
// Rota literal antes de /planos/:empresaId para o Express não confundir os paths.
router.get('/por-empresa',          authenticate, authorize('ADMIN'), escopoPlataformaSeAdmin, AiUsageController.porEmpresa);
router.get('/planos/:empresaId',    authenticate, authorize('ADMIN'), escopoPlataformaSeAdmin, AiUsageController.obterPlano);
router.put('/planos/:empresaId',    authenticate, authorize('ADMIN'), escopoPlataformaSeAdmin, AiUsageController.salvarPlano);

module.exports = router;


// ─── Registrar em server.js ───────────────────────────────────────────────────
// Adicionar as duas linhas abaixo no server.js, junto com as outras rotas:

// const aiUsageRoutes = require('./routes/aiUsage');
// app.use('/api/ai-usage', aiUsageRoutes);
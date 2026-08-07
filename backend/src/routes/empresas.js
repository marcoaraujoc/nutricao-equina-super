// backend/src/routes/empresas.js — cadastro do ASSINANTE e assinatura do plano
//
// Fase 2 do multi-tenancy. Separado de `equipes.js` de propósito: lá estão as
// preferências operacionais da clínica (logo, fechamento, expediente); aqui está a
// identidade de quem assina o SaaS e o plano contratado.

const router = require('express').Router();
const { authenticate, authorize } = require('../middlewares/auth');
const escopoPlataformaSeAdmin = require('../middlewares/escopoPlataforma');
const ctrl = require('../controllers/EmpresaCadastroController');

router.use(authenticate);

// GESTOR / dono da empresa ATIVA. O gate fino é no controller (`empresaDoGestorNoContexto`),
// que exige dono ou cargo GESTOR **naquela** empresa — sem cair em outra (armadilha 36-b).
router.get('/cadastro', ctrl.obter);
router.put('/cadastro', ctrl.salvar);

// Catálogo de planos — leitura liberada a qualquer autenticado: o gestor precisa ver o
// nome do plano dele. Não expõe nada sensível.
router.get('/planos', ctrl.listarPlanos);

// ⚠️ Atribuir plano, mudar situação comercial e SUSPENDER empresa são atos do ADMIN da
// PLATAFORMA. Se o gestor pudesse, a empresa suspensa se reativaria sozinha.
// ⚠️ FASE 7c — o ADMIN grava a assinatura de OUTRA empresa, e `tb_assinaturas_empresa`
// tem RLS: sem escopo de plataforma o `WITH CHECK` recusaria a escrita. É a segunda (e
// última) tabela de ADMIN sob policy — a outra é `tb_ai_usage_logs`.
router.put('/:empresaId/assinatura', authorize('ADMIN'), escopoPlataformaSeAdmin, ctrl.salvarAssinatura);

module.exports = router;

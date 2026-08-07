// backend/src/middlewares/escopoPlataforma.js
//
// FASE 7c — abre o ESCOPO DE PLATAFORMA para o ADMIN, nas poucas telas que comparam
// clínicas por natureza.
//
// ⚠️ POR QUE ISTO PRECISA EXISTIR: com o RLS fail-closed, `app_empresa_id() IS NULL` faz
// a policy virar `empresa_id = NULL` — que nunca é verdade. O ADMIN da plataforma, que
// normalmente não tem empresa de contexto, passaria a ver ZERO em telas que deveriam
// mostrar o consolidado. Medido: `/ai-usage` (consumo de IA por empresa) devolvia 0 de
// 26 registros.
//
// 🔴 SUPERFÍCIE MÍNIMA, DE PROPÓSITO. Só DUAS tabelas de ADMIN têm RLS:
//   `tb_ai_usage_logs`  — consumo de IA por empresa
//   `tb_assinaturas_empresa` — assinatura/plano por empresa
// Monitoração, catálogo de planos e a lista de empresas são CONTROL PLANE: nem passam
// por policy, e portanto NÃO precisam deste middleware.
//
// ⚠️ Aplicar isto num router que não seja ADMIN-only anula o isolamento daquele router
// INTEIRO — inclusive de rotas que hoje nem leem tabela de tenant, mas podem passar a
// ler amanhã. Por isso ele **checa o papel em runtime** em vez de confiar em quem o
// montou: mesmo que alguém o coloque num router aberto por engano, só o ADMIN da
// plataforma entra em escopo de plataforma; todos os demais seguem no tenant deles.
//
// ⚠️ NÃO usar em cron: os 8 jobs de tenant PERCORREM as empresas (`paraCadaEmpresa`) —
// precisam varrer clínica a clínica, não ler todas de uma vez.
'use strict';

const { comEscopoPlataforma } = require('../lib/prismaTenant');

/**
 * Roda o restante do pipeline em escopo de PLATAFORMA — mas só se o usuário for ADMIN
 * da plataforma. Para qualquer outro, é passagem direta e o tenant da requisição
 * continua valendo.
 *
 * ⚠️ `role`/`userTypeGlobal`, NUNCA o `userType` do contexto: este último é o tipo NA
 * EMPRESA ATIVA (armadilha 36-e do CLAUDE.md) e pode virar VETERINARIO/GESTOR conforme
 * o vínculo — usá-lo aqui daria escopo de plataforma a quem é gestor de uma clínica.
 */
function escopoPlataformaSeAdmin(req, _res, next) {
  const ehAdminPlataforma = req.user?.role === 'ADMIN'
                         || req.user?.userTypeGlobal === 'ADMIN';
  if (!ehAdminPlataforma) return next();
  return comEscopoPlataforma(() => next());
}

module.exports = escopoPlataformaSeAdmin;
module.exports.escopoPlataformaSeAdmin = escopoPlataformaSeAdmin;

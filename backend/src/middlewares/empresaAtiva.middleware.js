// src/middlewares/empresaAtiva.middleware.js
//
// FAIL-CLOSED do multi-tenant.
//
// O padrão espalhado pelos agregadores é `...(empresaId ? { empresaId } : {})`: quando
// o contexto NÃO resolve, o filtro simplesmente SOME e a consulta vira GLOBAL. Não é
// hipótese remota — `req.empresaId` fica nulo para quem não tem vínculo de equipe nem
// empresa própria (vet autônomo, convite ainda pendente, sessão restaurada antes do
// contexto carregar). Nesses casos relatórios, estoque e faturamento passavam a somar
// TODAS as clínicas num painel só.
//
// Regra: sem empresa resolvida não há o que mostrar. Só o ADMIN da plataforma enxerga
// o consolidado — ele é o dono do catálogo global e do metering.
//
// Uso (depois do authenticate e do checkPermission, que é quem popula req.empresaId):
//   router.get('/financeiro', authenticate, perm, exigirEmpresaAtiva, Ctrl.financeiro)
'use strict';

function ehAdminPlataforma(req) {
  return req.user?.role === 'ADMIN' || req.user?.userType === 'ADMIN';
}

function exigirEmpresaAtiva(req, res, next) {
  if (req.empresaId || ehAdminPlataforma(req)) return next();
  return res.status(400).json({
    error: 'Nenhuma empresa ativa no contexto. Selecione a empresa para continuar.',
    code:  'SEM_EMPRESA_ATIVA',
  });
}

/**
 * Escopo de CATÁLOGO (linhas globais + as da empresa).
 *
 * Substitui o `...(empresaId ? { OR: [{ empresaId }, { empresaId: null }] } : {})`:
 * sem empresa aquele spread virava `{}` e entregava o catálogo privado de TODAS as
 * clínicas. Sem empresa, o correto é ver apenas o global.
 */
function escopoCatalogoEmpresa(empresaId) {
  const id = empresaId ? Number(empresaId) : null;
  return id
    ? { OR: [{ empresaId: id }, { empresaId: null }] }
    : { empresaId: null };
}

module.exports = { exigirEmpresaAtiva, ehAdminPlataforma, escopoCatalogoEmpresa };

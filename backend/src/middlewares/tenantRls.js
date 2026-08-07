// backend/src/middlewares/tenantRls.js
//
// FASE 7b DO MULTI-TENANCY — declara o tenant da requisição.
//
// Roda DEPOIS do `authenticate` (que resolve `req.empresaId` a partir do JWT + dos
// headers `x-empresa-id`/`x-equipe-id`) e envolve o resto do pipeline num contexto de
// `AsyncLocalStorage`. A partir daí, toda operação de banco feita por qualquer
// controller sai com `app.empresa_id` carimbado — sem que nenhum deles precise saber
// disso (ver `lib/prismaTenant.js`).
//
// ⚠️ NÃO abre transação. A transação é por OPERAÇÃO (ou por `$transaction` que o código
// já use). Envolver a requisição inteira seria manter uma transação aberta durante
// chamadas ao Gemini e envios de e-mail — 9 dos 60 controllers fazem I/O externo dentro
// do handler, e uma chamada de IA leva de 5 a 30 segundos.
//
// ⚠️ `req.empresaId` NULO é legítimo e não é erro: ADMIN de plataforma, rota pública,
// usuário sem empresa resolvida. Nesse caso nada é carimbado e a operação passa direto.
// Enquanto o escape da policy existir (fase 6), isso enxerga tudo; quando ele sair
// (7c), passará a enxergar nada — que é o comportamento fail-closed desejado, e o
// motivo de as três telas de ADMIN precisarem de `comEscopoPlataforma` antes disso.
'use strict';

const { comEmpresa } = require('../lib/prismaTenant');

function tenantRls(req, _res, next) {
  // `next()` é chamado DENTRO do contexto: tudo que vier depois no pipeline — inclusive
  // os handlers assíncronos — herda o tenant.
  return comEmpresa(req.empresaId ?? null, () => next());
}

module.exports = tenantRls;
module.exports.tenantRls = tenantRls;

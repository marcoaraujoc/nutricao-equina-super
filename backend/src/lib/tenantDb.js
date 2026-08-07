// backend/src/lib/tenantDb.js
//
// FASE 6 DO MULTI-TENANCY — carimba o tenant na transação para o RLS enxergar.
//
// ════════════════════════════════════════════════════════════════════════════
// POR QUE NÃO É UMA EXTENSÃO `$allModels` (o desenho original NÃO funcionava)
// ════════════════════════════════════════════════════════════════════════════
//
// O plano original (§4) propunha uma extensão que envolvesse CADA operação em
// `prisma.$transaction([set_config, query])`. A revisão crítica (§13.1/13.2) mostrou
// que aquilo quebra de duas formas, e as duas são estruturais:
//
//  1. TRANSAÇÃO ANINHADA — há 77 `$transaction` em 20 arquivos. Dentro de um
//     `$transaction(async tx => …)` já aberto (o padrão de `faturaUtils`, da auditoria
//     e de toda a execução de prescrição), envolver cada operação abriria uma SEGUNDA
//     transação, em OUTRA conexão. A variável setada na interna não vale para a
//     externa — o RLS devolveria zero linha —, e a interna pode esperar um lock que a
//     externa segura: deadlock. Prisma não suporta transação aninhada; portanto isto
//     não é otimização, é requisito.
//
//  2. SQL CRU — há 98 `$queryRawUnsafe`/`$executeRawUnsafe` em 23 arquivos, e uma
//     extensão de `$allModels` **não os intercepta**. Pior: o SQL cru aqui não é
//     exceção, é padrão documentado (CLAUDE.md) para colunas que o client não conhece.
//     Parte deles lê TENANT PLANE — `anexarFlagEmGrupos` bate em `tb_prescricoes`.
//
// ── O DESENHO QUE FUNCIONA ──────────────────────────────────────────────────
// Interceptar o INÍCIO DA TRANSAÇÃO, não cada operação. `comTenant()` abre UMA
// transação, roda `set_config` UMA vez, e entrega o `tx` para o trabalho. Tudo que
// usar aquele `tx` — model, raw, aninhado — está coberto, porque é a MESMA conexão.
//
// É explícito de propósito. Uma extensão "mágica" que às vezes cobre e às vezes não
// é pior do que nenhuma: dá a sensação de proteção sem a proteção.
'use strict';

/** Nome da variável de sessão lida pelas policies (`schs2vet.app_empresa_id()`). */
const VAR_TENANT = 'app.empresa_id';

// ⚠️ Resolução PREGUIÇOSA do client. `./prisma` é TypeScript, e um `require` no topo
// quebra o jest (babel não transpila o .ts). Resolver na primeira chamada mantém o
// módulo carregável em teste, e `usarClient()` permite injetar um client real —
// necessário porque estes testes falam com o banco de verdade, não com um mock.
let _client = null;
function client() {
  // ⚠️ `prismaSemTenant`, NÃO o default. O default é o client ESTENDIDO (fase 7b), que
  // carimba o tenant sozinho — e aqui a transação e o `set_config` são gerenciados à
  // mão. Usar o estendido empilharia os dois mecanismos.
  if (!_client) _client = require('./prisma').prismaSemTenant;
  return _client;
}
/** Injeta o client (testes). Passar `null` volta ao singleton da aplicação. */
function usarClient(c) { _client = c; }

/**
 * Roda `fn(tx)` dentro de uma transação com o tenant carimbado.
 *
 * @param {number|null} empresaId  empresa do contexto; `null`/ausente = SEM tenant
 *   (cron, ADMIN de plataforma). Enquanto o escape da fase 6 existir, isso significa
 *   "vê tudo" — na fase 7 significará "vê nada", e é por isso que passar `undefined`
 *   por engano tem de ser tratado como bug, não como conveniência.
 * @param {(tx: import('@prisma/client').Prisma.TransactionClient) => Promise<T>} fn
 * @param {{ timeout?: number, maxWait?: number }} [opcoes]
 * @returns {Promise<T>}
 * @template T
 */
async function comTenant(empresaId, fn, opcoes = {}) {
  const valor = empresaId == null ? '' : String(Number(empresaId));

  return client().$transaction(async (tx) => {
    // ⚠️ O terceiro argumento `true` é o que torna a variável LOCAL À TRANSAÇÃO.
    // Sem ele a variável fica na SESSÃO — e como o Prisma usa um POOL, a conexão
    // volta ao pool com o tenant da requisição anterior grudado. A próxima
    // requisição, de outra clínica, herdaria aquele valor. É o modo mais silencioso
    // de vazar dado entre empresas que este desenho permite; nunca remover o `true`.
    await tx.$executeRawUnsafe(`SELECT set_config('${VAR_TENANT}', $1, true)`, valor);
    return fn(tx);
  }, opcoes);
}

/** Açúcar para o caso comum: tenant vem do request já resolvido pelo `authenticate`. */
function comTenantDoRequest(req, fn, opcoes) {
  return comTenant(req?.empresaId ?? null, fn, opcoes);
}

/**
 * Confere, DENTRO de uma transação, qual tenant está valendo.
 * Existe para os testes e para depurar "por que esta consulta voltou vazia?" —
 * a resposta quase sempre é "a transação não passou por `comTenant`".
 */
async function tenantAtual(tx) {
  const r = await tx.$queryRawUnsafe(
    `SELECT NULLIF(current_setting('${VAR_TENANT}', true), '')::int AS empresa_id`);
  return r[0]?.empresa_id ?? null;
}

module.exports = { comTenant, comTenantDoRequest, tenantAtual, usarClient, VAR_TENANT };

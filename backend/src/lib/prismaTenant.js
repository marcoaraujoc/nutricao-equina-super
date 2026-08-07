// backend/src/lib/prismaTenant.js
//
// FASE 7b DO MULTI-TENANCY — o tenant chega ao banco SEM tocar em 60 controllers.
//
// ════════════════════════════════════════════════════════════════════════════
// POR QUE NÃO É UM MIDDLEWARE QUE ENVOLVE A REQUISIÇÃO
// ════════════════════════════════════════════════════════════════════════════
//
// A saída óbvia — abrir uma transação no início da requisição e fechá-la no fim —
// **foi descartada por medição**: 9 dos 60 controllers fazem I/O EXTERNO dentro do
// handler (11 chamadas de IA, 13 envios de e-mail). Uma chamada ao Gemini leva de 5 a
// 30 segundos; a transação ficaria aberta o tempo todo, segurando uma conexão do pool
// e locks. Com poucas requisições simultâneas o pool acaba.
//
// Regra que vale aqui e nos crons: **transação envolve trabalho de BANCO, não a
// requisição inteira, e nunca I/O de rede.**
//
// ════════════════════════════════════════════════════════════════════════════
// O QUE FOI MEDIDO SOBRE AS EXTENSÕES DO PRISMA (e corrige o §13.2 do plano)
// ════════════════════════════════════════════════════════════════════════════
//
//   1. A extensão **PROPAGA para dentro de `$transaction`** — `$allOperations` dispara
//      também para as operações feitas no `tx`. Confirma o §13.1: envolver cada
//      operação numa transação própria ANINHARIA quando já se está numa.
//
//   2. **SQL CRU É INTERCEPTADO** por `$allOperations` (chega com `model: undefined`).
//      O §13.2 afirmava que a extensão não alcançava raw query — não é o caso. As 98
//      chamadas de `$queryRawUnsafe`/`$executeRawUnsafe` passam por aqui.
//
// Com isso, dá para cobrir tudo — desde que se saiba se JÁ existe uma transação aberta.
// Quem responde isso é o `AsyncLocalStorage`: o override de `$transaction` marca a
// flag, e o interceptador de operação avulsa a consulta antes de decidir.
//
// ════════════════════════════════════════════════════════════════════════════
// AS TRÊS SITUAÇÕES
// ════════════════════════════════════════════════════════════════════════════
//
//   (a) SEM tenant no contexto  → passa direto. É o cron (que usa `comTenant`
//       explicitamente), o script e a rota pública. Enquanto o escape da policy
//       existir, isso vê tudo; depois do 7c, vê nada — e é esse o objetivo.
//
//   (b) COM tenant, JÁ numa transação → passa direto: o `set_config` já foi feito uma
//       vez, no início dela, e vale para todas as operações da mesma conexão.
//
//   (c) COM tenant, operação AVULSA → abre uma transação MÍNIMA (set_config + a
//       operação). Curta por construção: uma consulta, sem I/O externo dentro.
'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const VAR_TENANT = 'app.empresa_id';
const VAR_PLATAFORMA = 'app.plataforma';

/** Contexto da requisição: `{ empresaId, plataforma, emTransacao }`. */
const contexto = new AsyncLocalStorage();

/** Empresa do contexto corrente (null = sem tenant declarado). */
const tenantAtual = () => contexto.getStore()?.empresaId ?? null;

/** Está em escopo de PLATAFORMA (leitura cross-tenant do ADMIN)? */
const ehPlataforma = () => contexto.getStore()?.plataforma === true;

/**
 * Roda `fn` com o tenant declarado. Tudo que acontecer dentro — inclusive em callbacks
 * assíncronos — enxerga esse tenant, sem precisar passá-lo de função em função.
 *
 * 🔴 O `async` + `await` AQUI NÃO É ENFEITE. `PrismaPromise` é PREGUIÇOSA: `db.animal
 * .count()` não executa nada até ser aguardada. Com o callback síncrono
 * (`contexto.run(store, () => db.animal.count())`), o `run` retornava a promise ainda
 * não iniciada, o contexto do ALS saía de escopo, e só então a consulta rodava — já sem
 * tenant nenhum.
 *
 * O sintoma foi exatamente o mais perigoso: nenhum erro. As empresas 31 e 42 viam as 29
 * linhas cada uma (o total do banco) enquanto o `$transaction` e o SQL cru isolavam
 * certo. Aparência de isolamento, sem isolamento.
 */
function comEmpresa(empresaId, fn) {
  return contexto.run({ empresaId: empresaId ?? null, plataforma: false, emTransacao: false },
    async () => fn());
}

/**
 * ESCOPO DE PLATAFORMA — leitura cross-tenant, para o ADMIN da plataforma.
 *
 * 🔴 É O ÚNICO CAMINHO que enxerga mais de uma empresa. Use com parcimônia e SEMPRE
 * atrás de um gate de `role === 'ADMIN'`: quem chamar isto vê o dado de todas as
 * clínicas.
 *
 * Existe porque, sem o escape, `app_empresa_id() IS NULL` faz a policy virar
 * `empresa_id = NULL` — que nunca é verdade. Sem um segundo sinal EXPLÍCITO, o ADMIN
 * passaria a não ver nada nas telas que comparam clínicas.
 *
 * ⚠️ Superfície real: só DUAS tabelas de ADMIN têm RLS — `tb_ai_usage_logs` (consumo de
 * IA por empresa) e `tb_assinaturas_empresa`. Monitoração, planos e a lista de empresas
 * são control plane e nem passam por policy. Ou seja, isto não é um bypass geral: é uma
 * chave para dois relatórios.
 *
 * ⚠️ NÃO usar em cron. Os 8 jobs de tenant percorrem as empresas com `paraCadaEmpresa`
 * — precisam VARRER as clínicas, não LER todas de uma vez (ver `lib/cronTenant.js`).
 */
function comEscopoPlataforma(fn) {
  return contexto.run({ empresaId: null, plataforma: true, emTransacao: false },
    async () => fn());
}

const sqlSetConfig = `SELECT set_config('${VAR_TENANT}', $1, true)`;
const sqlSetPlataforma = `SELECT set_config('${VAR_PLATAFORMA}', 'on', true)`;

/** Carimba na transação o sinal do contexto: a empresa OU o escopo de plataforma. */
async function carimbar(tx, store) {
  if (store.plataforma) return tx.$executeRawUnsafe(sqlSetPlataforma);
  return tx.$executeRawUnsafe(sqlSetConfig, String(store.empresaId));
}

/**
 * Aplica a extensão de tenant a um PrismaClient.
 *
 * ⚠️ Devolve um client NOVO (extensões do Prisma são imutáveis). Quem usar o client
 * original continua SEM tenant — por isso `lib/prisma` deve exportar o estendido.
 */
function comTenantAutomatico(base) {
  const estendido = base.$extends({
    client: {
      /**
       * ⚠️ `$transaction` é interceptado para carimbar o tenant UMA VEZ, no início.
       * É o ponto que o §13.1 exigia: interceptar o INÍCIO da transação, não cada
       * operação. Sem isto, as 77 `$transaction` do código rodariam sem tenant.
       */
      async $transaction(...args) {
        const store = contexto.getStore();
        const empresaId = store?.empresaId ?? null;

        // Sem tenant declarado, ou já dentro de uma transação nossa: comportamento original.
        if ((empresaId == null && !store?.plataforma) || store?.emTransacao) {
          return base.$transaction(...args);
        }

        const [primeiro, opcoes] = args;

        // Forma de ARRAY (`$transaction([op1, op2])`): as promises já foram criadas
        // ANTES de chegar aqui, então não há como injetar o `set_config` na frente
        // delas. Cada uma já passou pelo interceptador de operação avulsa e ganhou a
        // sua própria transação com tenant — o que é correto, só não é atômico entre
        // elas. Registrado porque é uma diferença real de comportamento.
        if (Array.isArray(primeiro)) return base.$transaction(...args);

        return base.$transaction(async (tx) => {
          await carimbar(tx, store);
          // Marca a flag para que as operações DENTRO não abram transação própria.
          return contexto.run({ ...store, emTransacao: true }, () => primeiro(tx));
        }, opcoes);
      },
    },

    query: {
      /**
       * Toda operação — de modelo E de SQL cru (que chega com `model: undefined`).
       */
      async $allOperations({ model, args, query, operation }) {
        const store = contexto.getStore();
        const empresaId = store?.empresaId ?? null;

        // (a) sem tenant  ·  (b) já numa transação com o tenant carimbado
        if ((empresaId == null && !store?.plataforma) || store?.emTransacao) return query(args);

        // `$transaction` é tratado no componente `client` acima — não reentrar aqui.
        if (operation === '$transaction') return query(args);

        // (c) operação AVULSA: transação mínima, só para carregar o tenant.
        //
        // 🔴 A OPERAÇÃO É REEMITIDA NO `tx` — **não** se chama `query(args)` aqui.
        //
        // Esta linha é a diferença entre isolar e fingir que isola. `query(args)`
        // executa a operação no CLIENT ORIGINAL, que pega OUTRA conexão do pool: o
        // `set_config` iria para uma conexão e a consulta para outra, e o RLS não veria
        // tenant nenhum. Medido antes de descobrir: com `query(args)`, as empresas 31 e
        // 42 viam as 29 linhas cada uma — o total. Nenhum erro, nenhum aviso; só a
        // aparência de isolamento.
        //
        // Reemitir em `tx[modelo][operacao]` garante a MESMA conexão do `set_config`.
        return base.$transaction(async (tx) => {
          await carimbar(tx, store);

          // SQL cru (`model` indefinido): `args` é o array de argumentos posicionais
          // (`['SELECT …', p1, p2]`), então vai espalhado.
          if (!model) return tx[operation](...(Array.isArray(args) ? args : [args]));

          // Modelo: o Prisma entrega 'Animal' e a propriedade do client é 'animal'.
          const prop = model.charAt(0).toLowerCase() + model.slice(1);
          return tx[prop][operation](args);
        });
      },
    },
  });

  return estendido;
}

module.exports = {
  comTenantAutomatico, comEmpresa, comEscopoPlataforma,
  tenantAtual, ehPlataforma, VAR_TENANT, VAR_PLATAFORMA, contexto,
};

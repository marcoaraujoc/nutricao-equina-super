// backend/src/__tests__/prismaTenant.test.js
//
// FASE 7b — o tenant chega ao banco pelos QUATRO caminhos que o código usa.
//
// Estes testes existem por causa de duas armadilhas que passaram no olho e só
// apareceram medindo. As duas produzem o MESMO sintoma: nenhum erro, e o isolamento
// simplesmente não acontece.
//
//   1. `query(args)` dentro de `$allOperations` executa a operação no CLIENT ORIGINAL,
//      que pega OUTRA conexão do pool — o `set_config` vai para uma e a consulta para
//      outra. A operação precisa ser REEMITIDA no `tx`.
//
//   2. `PrismaPromise` é PREGUIÇOSA. Com o callback de `comEmpresa` síncrono, o `run`
//      devolvia a promise ainda não iniciada, o contexto do ALS saía de escopo e a
//      consulta rodava sem tenant.
//
// Em ambos os casos a soma por tenant dava MUITO MAIS que o total da tabela (cada
// empresa via tudo). É por isso que a asserção central aqui é **partição exata**:
// somar o que cada empresa enxerga tem de dar exatamente o total.

require('dotenv').config();

const ehCI = !!process.env.CI;
const temBanco = !!process.env.DATABASE_URL;
if (!temBanco && ehCI) {
  throw new Error('DATABASE_URL ausente em CI — o gate de tenant não pode ser pulado.');
}
const d = temBanco ? describe : describe.skip;

d('prismaTenant — o tenant chega ao banco', () => {
  const { PrismaClient } = require('@prisma/client');
  const { comTenantAutomatico, comEmpresa, comEscopoPlataforma, tenantAtual } = require('../lib/prismaTenant');

  const base = new PrismaClient();
  const db = comTenantAutomatico(base);

  let esperado = {};   // empresaId → nº de animais
  let total = 0;

  beforeAll(async () => {
    // ⚠️ O baseline vai por ESCOPO DE PLATAFORMA. Depois da fase 7c o RLS é
    // fail-closed e o `FORCE` alcança até o dono: leitura sem contexto devolve
    // ZERO, e o teste passaria a comparar tudo contra zero — verde sem provar nada.
    total = await comEscopoPlataforma(() => db.animal.count());
    const rows = await comEscopoPlataforma(() => db.$queryRawUnsafe(
      `SELECT "empresaId" AS e, COUNT(*)::int AS n FROM schs2vet.tb_animais GROUP BY 1`));
    esperado = Object.fromEntries(rows.map(r => [r.e, Number(r.n)]));
  });

  afterAll(async () => { await base.$disconnect(); });

  test('há mais de uma empresa com animais (senão o teste não prova nada)', () => {
    expect(Object.keys(esperado).length).toBeGreaterThan(1);
  });

  test('operação de MODELO avulsa enxerga só a empresa do contexto', async () => {
    for (const [e, n] of Object.entries(esperado)) {
      expect(await comEmpresa(Number(e), () => db.animal.count())).toBe(n);
    }
  });

  test('SQL CRU avulso enxerga só a empresa do contexto', async () => {
    for (const [e, n] of Object.entries(esperado)) {
      const r = await comEmpresa(Number(e), () =>
        db.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM schs2vet.tb_animais'));
      expect(Number(r[0].n)).toBe(n);
    }
  });

  test('dentro de $transaction o tenant vale para todas as operações', async () => {
    const [e, n] = Object.entries(esperado)[0];
    const r = await comEmpresa(Number(e), () => db.$transaction(async (tx) => ({
      modelo: await tx.animal.count(),
      raw: Number((await tx.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM schs2vet.tb_animais'))[0].n),
      // o `set_config` foi feito UMA vez, no início da transação
      tenant: (await tx.$queryRawUnsafe(
        `SELECT NULLIF(current_setting('app.empresa_id', true), '')::int AS t`))[0].t,
    })));
    expect(r.modelo).toBe(n);
    expect(r.raw).toBe(n);
    expect(r.tenant).toBe(Number(e));
  });

  test('consulta com include/join respeita o tenant', async () => {
    for (const [e, n] of Object.entries(esperado)) {
      const linhas = await comEmpresa(Number(e), () =>
        db.animal.findMany({ include: { especie: true } }));
      expect(linhas).toHaveLength(n);
    }
  });

  test('PARTIÇÃO EXATA — a soma por tenant é o total, nunca mais', async () => {
    // É esta a asserção que pegou as duas armadilhas: com qualquer uma delas presente,
    // cada empresa via a tabela inteira e a soma explodia (232 numa tabela de 29).
    let soma = 0;
    for (const e of Object.keys(esperado)) {
      soma += await comEmpresa(Number(e), () => db.animal.count());
    }
    expect(soma).toBe(total);
  });

  test('sem tenant declarado, `tenantAtual()` é null e nada é carimbado', async () => {
    expect(tenantAtual()).toBeNull();
    // Com o escape da fase 6 ainda ativo isto vê tudo; na fase 7c passará a ver nada.
    // A asserção é sobre o CONTEXTO, não sobre a policy — para o teste não quebrar
    // quando o escape sair.
    await comEmpresa(null, async () => { expect(tenantAtual()).toBeNull(); });
  });

  test('o tenant do contexto é visível dentro de `comEmpresa`', async () => {
    const [e] = Object.keys(esperado);
    await comEmpresa(Number(e), async () => { expect(tenantAtual()).toBe(Number(e)); });
  });
});

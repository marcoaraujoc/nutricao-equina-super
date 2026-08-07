// backend/src/__tests__/rlsCanario.test.js
//
// FASE 6 — prova que o RLS canário ISOLA DE VERDADE.
//
// Estes testes falam com o BANCO. Sem `DATABASE_URL` eles são pulados localmente,
// mas em CI (`process.env.CI`) a ausência é FALHA — senão o gate vira decoração:
// bastaria a variável sumir para o pipeline ficar verde sem ter testado nada.
//
// O que se prova aqui, e por que cada um importa:
//   1. `FORCE ROW LEVEL SECURITY` está ligado — sem ele o dono da tabela (que é o
//      usuário da aplicação) ignora todas as policies e o resto é teatro;
//   2. leitura isolada por empresa, com `$transaction` (§13.1);
//   3. leitura isolada por empresa, com SQL CRU (§13.2 — o furo do desenho original);
//   4. `WITH CHECK` recusa escrita cruzada;
//   5. UPDATE cruzado não alcança linha alheia;
//   6. a variável de tenant NÃO VAZA entre transações (é o risco do pool);
//   7. o escape temporário da fase 6 ainda existe — documentado, para que a fase 7
//      não o esqueça.

// O jest não carrega o `.env` sozinho — sem isto `DATABASE_URL` fica indefinida e a
// suíte se auto-pula, dando um verde que não testou nada.
require('dotenv').config();

const ehCI = !!process.env.CI;
const temBanco = !!process.env.DATABASE_URL;

if (!temBanco && ehCI) {
  throw new Error('DATABASE_URL ausente em CI — o gate de RLS não pode ser pulado.');
}

const d = temBanco ? describe : describe.skip;

d('RLS canário — tb_movimentos_estoque', () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const { comTenant, tenantAtual, usarClient } = require('../lib/tenantDb');
  const { comTenantAutomatico, comEscopoPlataforma } = require('../lib/prismaTenant');
  // ⚠️ Toda leitura de VERIFICAÇÃO precisa declarar escopo: depois da fase 7c o RLS
  // é fail-closed e alcança o dono da tabela. Sem isto o baseline vem vazio e as
  // asserções comparariam zero com zero.
  const plat = comTenantAutomatico(prisma);
  const lerTudo = (sql, ...p) => comEscopoPlataforma(() => plat.$queryRawUnsafe(sql, ...p));
  // `lib/prisma` é TypeScript e o jest não o transpila — injeta-se o client real.
  usarClient(prisma);

  const TABELA = 'schs2vet.tb_movimentos_estoque';
  let porEmpresa = [];

  beforeAll(async () => {
    porEmpresa = await lerTudo(`
      SELECT e."empresaId" AS empresa, COUNT(*)::int AS n
      FROM ${TABELA} m
      JOIN schs2vet.tb_estoque_clinica e ON e.id = m."estoqueId"
      WHERE e."empresaId" IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC`);
  });

  afterAll(async () => { await prisma.$disconnect(); });

  test('1. a tabela tem RLS ENABLE **e** FORCE', async () => {
    const [r] = await lerTudo(`
      SELECT relrowsecurity AS habilitado, relforcerowsecurity AS forcado
      FROM pg_class WHERE oid = '${TABELA}'::regclass`);
    expect(r.habilitado).toBe(true);
    // ⚠️ O FORCE é o que faz o RLS valer para o DONO da tabela — e a aplicação
    // conecta como o dono. Sem ele, `habilitado` seria true e nada filtraria.
    expect(r.forcado).toBe(true);
  });

  test('1b. existe policy com USING e WITH CHECK', async () => {
    const [p] = await lerTudo(`
      SELECT qual IS NOT NULL AS tem_using, with_check IS NOT NULL AS tem_check
      FROM pg_policies
      WHERE schemaname='schs2vet' AND tablename='tb_movimentos_estoque'`);
    expect(p?.tem_using).toBe(true);
    // Sem WITH CHECK dá para INSERIR no tenant alheio: a leitura volta vazia, mas a
    // linha fica lá contaminando o saldo do outro.
    expect(p?.tem_check).toBe(true);
  });

  test('2. cada empresa lê apenas as próprias linhas (via $transaction)', async () => {
    expect(porEmpresa.length).toBeGreaterThan(1);   // com 1 empresa o teste não prova nada
    for (const { empresa, n } of porEmpresa) {
      const visto = await comTenant(empresa, async (tx) => {
        const [r] = await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${TABELA}`);
        return Number(r.n);
      });
      expect(visto).toBe(Number(n));
    }
  });

  test('3. o tenant vale também para SQL CRU dentro da transação (§13.2)', async () => {
    const alvo = porEmpresa[0];
    await comTenant(alvo.empresa, async (tx) => {
      expect(await tenantAtual(tx)).toBe(Number(alvo.empresa));
      const linhas = await tx.$queryRawUnsafe(`SELECT id FROM ${TABELA}`);
      expect(linhas).toHaveLength(Number(alvo.n));
    });
  });

  test('4. WITH CHECK recusa INSERT no estoque de outra empresa', async () => {
    const [a, b] = porEmpresa;
    const [estoqueDeB] = await lerTudo(`
      SELECT e.id FROM schs2vet.tb_estoque_clinica e WHERE e."empresaId" = $1 LIMIT 1`, b.empresa);

    await expect(
      comTenant(a.empresa, (tx) => tx.$executeRawUnsafe(
        `INSERT INTO ${TABELA} ("estoqueId", tipo, quantidade, motivo, "createdAt")
         VALUES ($1,'AJUSTE',1,'TESTE_INVASAO',now())`, estoqueDeB.id)),
    ).rejects.toThrow(/row-level security/i);

    const [sobrou] = await lerTudo(
      `SELECT COUNT(*)::int AS n FROM ${TABELA} WHERE motivo = 'TESTE_INVASAO'`);
    expect(Number(sobrou.n)).toBe(0);
  });

  test('5. UPDATE cruzado não alcança linha de outra empresa', async () => {
    const [a, b] = porEmpresa;
    const [linhaDeB] = await lerTudo(`
      SELECT m.id FROM ${TABELA} m
      JOIN schs2vet.tb_estoque_clinica e ON e.id = m."estoqueId"
      WHERE e."empresaId" = $1 LIMIT 1`, b.empresa);

    const afetadas = await comTenant(a.empresa, (tx) => tx.$executeRawUnsafe(
      `UPDATE ${TABELA} SET motivo = 'TESTE_INVASAO' WHERE id = $1`, linhaDeB.id));
    expect(afetadas).toBe(0);
  });

  test('6. o tenant NÃO VAZA de uma transação para a seguinte (risco do pool)', async () => {
    // `set_config(..., true)` é local à transação. Se alguém remover esse `true`, a
    // variável fica na SESSÃO e volta ao pool grudada na conexão — a próxima
    // requisição, de OUTRA clínica, herdaria o tenant. Este teste é o que pega isso.
    const alvo = porEmpresa[0];
    await comTenant(alvo.empresa, async (tx) => { await tenantAtual(tx); });

    const [depois] = await lerTudo(
      `SELECT NULLIF(current_setting('app.empresa_id', true), '') AS v`);
    expect(depois.v).toBeNull();
  });

  test('7. FAIL-CLOSED — sem contexto declarado NÃO se vê NADA (fase 7c)', async () => {
    // ✅ O escape da fase 6 SAIU. Este teste era o oposto — documentava que, sem tenant,
    // ainda se via tudo — e previa a própria obsolescência: "quando a fase 7 remover o
    // escape, ESTE TESTE PASSA A FALHAR, e é esse o sinal".
    //
    // A inversão é o coração da fase 7c: contexto ausente PERMITIA, agora NEGA. Todo
    // caminho que esquecer de declarar o escopo quebra alto, em vez de vazar calado.
    const { PrismaClient } = require('@prisma/client');
    const cru = new PrismaClient();   // sem escopo nenhum
    try {
      const [r] = await cru.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${TABELA}`);
      expect(Number(r.n)).toBe(0);
    } finally {
      await cru.$disconnect();
    }

    // E o escopo de PLATAFORMA continua enxergando tudo — é o único caminho que atravessa
    // clínicas, e existe justamente para o ADMIN não ficar cego com o fail-closed.
    const [tudo] = await lerTudo(`SELECT COUNT(*)::int AS n FROM ${TABELA}`);
    const total = porEmpresa.reduce((s, x) => s + Number(x.n), 0);
    expect(Number(tudo.n)).toBe(total);
  });
});

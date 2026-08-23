// backend/src/__tests__/rlsCrossTenant.test.js
//
// TC-011 do "S2Vet Plano de Testes.csv" — "Row Level Security bloqueia cross-tenant
// no banco":
//
//   "1) Executar consulta com tenant_id A, porém sessão com app.empresa_id setado
//    para B" → esperado: RLS impede o retorno de linhas de outro tenant.
//
// DIFERENÇA para `rlsCanario.test.js` (que já prova RLS na canária
// tb_movimentos_estoque): lá a query NÃO filtra por tenant nenhum — é o RLS sozinho
// que decide o que volta. Aqui a QUERY PEDE EXPLICITAMENTE o tenant_id de OUTRA
// empresa (`WHERE "empresaId" = <A>` com a sessão carimbada para B) — é o cenário de
// alguém tentando furar o isolamento pela própria consulta, não só esquecendo de
// filtrar. Sem RLS isso devolveria as linhas de A; com RLS, devolve vazio mesmo a
// query estando "correta" do ponto de vista do SQL.
//
// Cobre também a observação do próprio caso de teste: "validar uma requisição
// autenticada SEM app.empresa_id setado (deve retornar vazio, nunca 'tudo')".
//
// Roda contra o banco de verdade — pulado sem DATABASE_URL localmente, obrigatório
// em CI (mesma exigência de `rlsCanario.test.js`).

require('dotenv').config();

const ehCI     = !!process.env.CI;
const temBanco = !!process.env.DATABASE_URL;

if (!temBanco && ehCI) {
  throw new Error('DATABASE_URL ausente em CI — o gate de RLS não pode ser pulado.');
}

const d = temBanco ? describe : describe.skip;

d('TC-011 — RLS bloqueia consulta cross-tenant no banco', () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const { comTenant, usarClient } = require('../lib/tenantDb');
  const { comTenantAutomatico, comEscopoPlataforma } = require('../lib/prismaTenant');
  // Mesma ressalva de `rlsCanario.test.js`: depois da fase 7c o RLS é fail-closed e
  // alcança o dono da tabela — toda leitura de VERIFICAÇÃO precisa declarar escopo,
  // senão o baseline vem vazio e as asserções comparam zero com zero.
  const plat    = comTenantAutomatico(prisma);
  const lerTudo = (sql, ...p) => comEscopoPlataforma(() => plat.$queryRawUnsafe(sql, ...p));
  usarClient(prisma);

  afterAll(async () => { await prisma.$disconnect(); });

  // ── tb_animais — TENANT DIRETO, coluna "empresaId" (camelCase quotada) ─────────
  describe('tb_animais', () => {
    let a;
    let b;

    beforeAll(async () => {
      const linhas = await lerTudo(`
        SELECT "empresaId" AS empresa, COUNT(*)::int AS n
        FROM schs2vet.tb_animais
        WHERE "empresaId" IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 2`);
      [a, b] = linhas;
    });

    test('sessão em B, consulta pedindo explicitamente tenant_id A → 0 linhas', async () => {
      if (!a || !b) return; // ambiente sem 2 empresas com animal — nada a provar aqui
      const linhas = await comTenant(Number(b.empresa), (tx) =>
        tx.$queryRawUnsafe('SELECT id FROM schs2vet.tb_animais WHERE "empresaId" = $1', Number(a.empresa)));
      expect(linhas).toHaveLength(0);
    });

    test('controle: a MESMA sessão, filtrando pelo PRÓPRIO tenant, traz as linhas certas', async () => {
      if (!a || !b) return;
      const linhas = await comTenant(Number(b.empresa), (tx) =>
        tx.$queryRawUnsafe('SELECT id FROM schs2vet.tb_animais WHERE "empresaId" = $1', Number(b.empresa)));
      expect(linhas.length).toBe(Number(b.n));
    });

    test('sem NENHUM contexto declarado, a mesma consulta cross-tenant também não retorna nada (fail-closed)', async () => {
      if (!a) return;
      const cru = new PrismaClient(); // client cru, sem comTenant nenhum por cima
      try {
        const linhas = await cru.$queryRawUnsafe(
          'SELECT id FROM schs2vet.tb_animais WHERE "empresaId" = $1', Number(a.empresa));
        expect(linhas).toHaveLength(0);
      } finally {
        await cru.$disconnect();
      }
    });
  });

  // ── tb_faturas — TENANT DIRETO, coluna "empresa_id" (snake_case quotada) ───────
  // Confirma que o mesmo mecanismo vale independente da grafia da coluna — ver
  // CLAUDE.md, armadilha 41: nem toda tabela tem @map para camelCase→snake_case.
  describe('tb_faturas', () => {
    let a;
    let b;

    beforeAll(async () => {
      const linhas = await lerTudo(`
        SELECT "empresa_id" AS empresa, COUNT(*)::int AS n
        FROM schs2vet.tb_faturas
        WHERE "empresa_id" IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 2`);
      [a, b] = linhas;
    });

    test('sessão em B, consulta pedindo explicitamente tenant_id A → 0 linhas', async () => {
      if (!a || !b) return;
      const linhas = await comTenant(Number(b.empresa), (tx) =>
        tx.$queryRawUnsafe('SELECT id FROM schs2vet.tb_faturas WHERE "empresa_id" = $1', Number(a.empresa)));
      expect(linhas).toHaveLength(0);
    });
  });

  // ── WITH CHECK — sessão em B não consegue GRAVAR um registro atribuído a A ─────
  // TC-011 fala em "consulta" (leitura), mas o mesmo mecanismo (USING) protege a
  // leitura; o WITH CHECK é a metade que protege a ESCRITA. tb_tratadores é simples
  // o bastante (poucas colunas obrigatórias) para testar isso sem depender de FKs
  // de outras tabelas.
  test('WITH CHECK: sessão em B não consegue INSERIR um registro com empresa_id de A', async () => {
    const [a] = await lerTudo(`
      SELECT "empresa_id" AS empresa FROM schs2vet.tb_tratadores
      WHERE "empresa_id" IS NOT NULL LIMIT 1`);
    const [b] = await lerTudo(`
      SELECT "empresa_id" AS empresa FROM schs2vet.tb_tratadores
      WHERE "empresa_id" IS NOT NULL AND "empresa_id" != $1 LIMIT 1`, a?.empresa ?? -1);
    if (!a || !b) return; // sem 2 empresas com tratador cadastrado no ambiente

    await expect(
      comTenant(Number(b.empresa), (tx) => tx.$executeRawUnsafe(
        `INSERT INTO schs2vet.tb_tratadores (nome, "empresa_id", ativo)
         VALUES ('TESTE_INVASAO_TC011', $1, true)`, Number(a.empresa))),
    ).rejects.toThrow(/row-level security/i);

    const [sobrou] = await lerTudo(
      `SELECT COUNT(*)::int AS n FROM schs2vet.tb_tratadores WHERE nome = 'TESTE_INVASAO_TC011'`);
    expect(Number(sobrou.n)).toBe(0);
  });
});

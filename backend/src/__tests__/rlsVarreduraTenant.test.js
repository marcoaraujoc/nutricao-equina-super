// backend/src/__tests__/rlsVarreduraTenant.test.js
//
// VARREDURA DE ISOLAMENTO — a premissa multi-tenant, tabela por tabela.
//
// "Ninguém de uma empresa pode ver ou fazer algo em outra empresa, independente de ser
// membro de equipe, animal, tratador, etc." Esta é a premissa fundacional do produto, e
// até aqui ela era garantida por DOIS gates que, juntos, ainda deixavam uma fresta:
//
//   `tenancyRls.test.js`    → prova COBERTURA: toda tabela de tenant tem RLS habilitado,
//                             forçado e com policy. Não olha o que a policy DIZ.
//   `rlsCrossTenant.test.js`→ prova COMPORTAMENTO, mas em DUAS tabelas de amostra
//                             (`tb_animais` e `tb_faturas`), as duas de tenant DIRETO.
//
// A fresta: uma policy ERRADA passa nos dois. Uma tabela cujo tenant vem VIA PAI (o
// caso de `tb_membros_equipe`, que chega à empresa por `tb_equipes`) tem um `EXISTS`
// com join escrito pelo gerador — join no campo errado continua sendo "uma policy", e
// o gate de cobertura fica verde enquanto o isolamento está aberto.
//
// O QUE ESTE TESTE FAZ, sem precisar conhecer o caminho de tenancy de cada tabela:
// lista os ids de cada tabela em escopo de PLATAFORMA, depois lista os ids visíveis
// DENTRO de cada empresa, e exige que os conjuntos sejam DISJUNTOS. Uma linha que
// aparece para duas empresas é, por definição, vazamento — não importa se o tenant dela
// é direto, via pai ou via avô.
//
// ⚠️ Por que id-a-id e não contagem: contagem esconde compensação (a policy pode
// esconder 3 linhas próprias e mostrar 3 alheias, e o total bate). O conjunto de ids
// não tem como mentir.
//
// Roda contra o banco de verdade — pulado sem DATABASE_URL localmente, obrigatório em CI
// (mesma exigência de `rlsCanario.test.js` e `rlsCrossTenant.test.js`).

require('dotenv').config();

const ehCI     = !!process.env.CI;
const temBanco = !!process.env.DATABASE_URL;

if (!temBanco && ehCI) {
  throw new Error('DATABASE_URL ausente em CI — o gate de RLS não pode ser pulado.');
}

const d = temBanco ? describe : describe.skip;

d('RLS — varredura de isolamento em TODAS as tabelas de tenant', () => {
  // ⚠️ `PrismaClient` cru, NÃO `lib/prisma` — aquele é TypeScript e o babel do jest
  // deste projeto não o transpila (mesma razão do `rlsCrossTenant.test.js`).
  // `comTenant` carimba o tenant DENTRO de uma transação, que é como a aplicação faz:
  // variável de sessão voltaria ao pool grudada na conexão e contaminaria a próxima.
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const { comTenant, usarClient } = require('../lib/tenantDb');
  const { comTenantAutomatico, comEscopoPlataforma } = require('../lib/prismaTenant');
  const plat    = comTenantAutomatico(prisma);
  const semTenant = (sql) => comTenant(null, (tx) => tx.$queryRawUnsafe(sql));
  const comEmpresa = (id, sql) => comTenant(Number(id), (tx) => tx.$queryRawUnsafe(sql));
  const naPlataforma = (sql) => comEscopoPlataforma(() => plat.$queryRawUnsafe(sql));
  usarClient(prisma);

  afterAll(async () => { await prisma.$disconnect(); });

  // 🔴 DUAS COISAS PARECIDAS QUE SIGNIFICAM O OPOSTO — a distinção que sustenta o resto
  // deste arquivo:
  //
  //   `empresa_id IS NULL`      → a LINHA é global (catálogo de medicamento, marca do
  //                               produto). Aparecer para todas as empresas é o
  //                               comportamento correto.
  //   `app_empresa_id() IS NULL`→ a SESSÃO não tem tenant → vê TUDO. É o escape da
  //                               fase 6, removido na 7c, e nunca pode voltar.
  //
  // Confundir as duas foi o que quase me fez classificar `tb_medicamento_especies`
  // como vazamento: a policy dela herda do pai `tb_medicamentos` o `OR empresa_id IS
  // NULL`, que é o catálogo global de 4.878 itens.
  // ⚠️ `"empresaId"` E `empresa_id`: o schema MISTURA camelCase e snake_case na coluna
  // de tenant (o próprio `lib/tenancyMap.js` mantém `COLS_EMPRESA` com as duas formas).
  // Casar só uma delas fez esta varredura acusar as 5.192 localizações do catálogo
  // global como vazamento — falso positivo que, num gate de segurança, custa mais caro
  // que um falso negativo: ensina a ignorar o vermelho.
  const ADMITE_LINHA_GLOBAL = /"?empresa_?[Ii]d"?\s+IS\s+NULL|publico\s*=\s*true/i;
  const ESCAPE_DE_SESSAO    = /app_empresa_id\(\)\s+IS\s+NULL/i;

  // Tabelas cuja policy ADMITE linha global: "visível em duas empresas" ali é o
  // desenho, não falha. Derivado da policy REAL em vez de lista fixa — lista fixa
  // envelhece calada, e o custo de envelhecer aqui é pular uma tabela de tenant.
  let compartilhaPorDesign = new Set();

  let tabelas  = [];
  let empresas = [];
  let policies = [];

  beforeAll(async () => {
    // Tabelas com RLS LIGADO, direto do catálogo do Postgres — não da lista do
    // `tenancyMap`. Se alguém criar uma tabela de tenant e esquecer de classificá-la,
    // é o `tenancyRls.test.js` que pega; aqui o que interessa é o comportamento REAL
    // de tudo que hoje diz estar protegido.
    tabelas = (await naPlataforma(`
      SELECT c.relname AS tabela
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'schs2vet' AND c.relkind = 'r' AND c.relrowsecurity = true
      ORDER BY c.relname`)).map(r => r.tabela);

    // ⚠️ Empresas LIMITADAS de propósito. A varredura é O(tabelas × empresas) e cada
    // par abre uma transação: com todas as empresas ela sozinha disputava o pool com as
    // outras suítes de RLS e a corrida completa ficava INTERMITENTE. Gate de segurança
    // que falha às vezes é pior que gate nenhum — ensina a re-rodar até o verde.
    // Três empresas já provam disjunção (o vazamento do `tb_matriz_perfis` apareceu no
    // primeiro par); mais empresas custam tempo sem aumentar o poder de detecção.
    const MAX_EMPRESAS = 3;
    empresas = (await naPlataforma(
      `SELECT id FROM schs2vet.tb_empresas ORDER BY id LIMIT ${MAX_EMPRESAS}`)).map(r => Number(r.id));

    policies = await naPlataforma(
      `SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname = 'schs2vet'`);

    compartilhaPorDesign = new Set(
      policies.filter(p => ADMITE_LINHA_GLOBAL.test(`${p.qual ?? ''} ${p.with_check ?? ''}`))
              .map(p => p.tablename),
    );
  }, 60000);

  test('🔴 nenhuma policy reintroduz o escape de sessão da fase 6', () => {
    // `app_empresa_id() IS NULL` fazia toda requisição SEM empresa resolvida enxergar a
    // base inteira. A fase 7c o removeu, mas o gerador de policies é reexecutado a cada
    // tabela nova — e o escape voltaria SEM erro, sem teste vermelho e sem sintoma
    // visível: a aplicação seguiria funcionando, só que sem isolamento.
    const comEscape = policies
      .filter(p => ESCAPE_DE_SESSAO.test(`${p.qual ?? ''} ${p.with_check ?? ''}`))
      .map(p => `${p.tablename} / ${p.policyname}`);
    expect(comEscape).toEqual([]);
  });

  test('há tabelas com RLS e empresas suficientes para a varredura ser conclusiva', () => {
    expect(tabelas.length).toBeGreaterThan(0);
    // Menos de 2 empresas torna QUALQUER teste de cross-tenant vacuamente verde — o
    // pior estado possível para um gate de segurança: passa sem ter medido nada.
    expect(empresas.length).toBeGreaterThanOrEqual(2);
  });

  test('🔴 toda policy VIA PAI correlaciona com a linha protegida', () => {
    // ESTE é o gate que cobre a tabela VAZIA. A varredura de dados abaixo não prova
    // nada onde não há linha (15 tabelas nesta base), e é justamente aí que um defeito
    // de policy passaria despercebido até a primeira clínica usar a funcionalidade.
    // Aqui a verificação é ESTRUTURAL: lê só o catálogo do Postgres, não depende de
    // massa de teste, e vale igual para tabela cheia e para tabela recém-criada.
    //
    // A REGRA: uma policy de tenant VIA PAI é um `EXISTS` que sobe até a empresa. Para
    // que ele FILTRE a linha (em vez de só perguntar "existe algo no pai?"), o
    // predicado precisa CITAR a tabela protegida — é essa citação que correlaciona a
    // subconsulta com a linha sendo avaliada.
    //
    // Foi exatamente o que faltou em `tb_matriz_perfis` (2026-08-25): o predicado dizia
    // `p0."equipeId" = p0."equipeId"` e nunca mencionava `tb_matriz_perfis` — sempre
    // verdadeiro, tabela inteira liberada para todas as empresas, WITH CHECK incluído.
    // A causa foi a coluna da tabela protegida sair SEM qualificação e o pai ter uma
    // coluna de mesmo nome: o escopo interno do EXISTS capturou a referência.
    //
    // ⚠️ O Postgres normaliza a expressão em `pg_policies`, então mesmo a forma nua
    // aparece qualificada QUANDO resolve para a tabela protegida. É por isso que a
    // ausência do nome é sinal confiável de correlação perdida.
    const semCorrelacao = policies
      .filter(p => {
        const txt = `${p.qual ?? ''} ${p.with_check ?? ''}`;
        return txt.toUpperCase().includes('EXISTS') && !txt.includes(`${p.tablename}.`);
      })
      .map(p => `${p.tablename} / ${p.policyname}`);
    expect(semCorrelacao).toEqual([]);
  });

  test('🔴 nenhuma linha é visível por DUAS empresas diferentes', async () => {
    const vazamentos = [];
    const semDados   = [];

    for (const tabela of tabelas) {
      if (compartilhaPorDesign.has(tabela)) continue;

      // `id` é a PK em todo o schema (Prisma `@id @default(autoincrement())`). Tabela
      // sem `id` é registrada e pulada em vez de derrubar a varredura inteira — some
      // do relatório, não some em silêncio.
      let totalPlataforma;
      try {
        totalPlataforma = await naPlataforma(`SELECT id FROM schs2vet."${tabela}" LIMIT 5000`);
      } catch {
        semDados.push(`${tabela} (sem coluna id)`);
        continue;
      }
      if (totalPlataforma.length === 0) { semDados.push(tabela); continue; }

      // De qual empresa cada id é visível. Duas empresas para o mesmo id = vazamento.
      const donoDoId = new Map();
      for (const empresaId of empresas) {
        const visiveis = await comEmpresa(empresaId, `SELECT id FROM schs2vet."${tabela}" LIMIT 5000`);
        for (const { id } of visiveis) {
          const chave = String(id);
          if (donoDoId.has(chave) && donoDoId.get(chave) !== empresaId) {
            vazamentos.push(`${tabela}: id ${chave} visível nas empresas ${donoDoId.get(chave)} E ${empresaId}`);
          } else {
            donoDoId.set(chave, empresaId);
          }
        }
      }
    }

    if (semDados.length) {
      // Não é falha: tabela vazia não prova nem desmente isolamento. Mas fica DITO —
      // uma varredura que cala sobre o que não mediu vira falsa sensação de cobertura.
      // ⚠️ Estas tabelas NÃO ficam descobertas: quem responde por elas é o gate
      // ESTRUTURAL acima ("toda policy VIA PAI correlaciona"), que lê o catálogo e não
      // depende de massa de teste. Esta varredura confirma o COMPORTAMENTO onde há
      // dado; o gate estrutural é a garantia onde não há.
      process.stdout.write(`\n  [varredura] sem dados para medir (${semDados.length}): ${semDados.join(', ')}\n`);
      process.stdout.write('  [varredura] cobertas pelo gate estrutural de correlação.\n');
    }
    expect(vazamentos).toEqual([]);
  }, 300000);

  test('🔴 sem tenant nenhum, TODA tabela de tenant devolve zero (fail-closed)', async () => {
    // O escape `app_empresa_id() IS NULL` foi removido na fase 7c. Se ele voltar em
    // alguma policy, é AQUI que aparece — e o sintoma sem este teste seria o oposto do
    // esperado: uma requisição sem empresa resolvida enxergando a base inteira.
    const comEscape = [];

    for (const tabela of tabelas) {
      if (compartilhaPorDesign.has(tabela)) continue;
      let linhas;
      try {
        linhas = await semTenant(`SELECT id FROM schs2vet."${tabela}" LIMIT 1`);
      } catch {
        continue; // sem coluna id — já reportado no teste acima
      }
      if (linhas.length > 0) comExcecao(comEscape, tabela);
    }

    expect(comEscape).toEqual([]);
  }, 300000);

  function comExcecao(lista, tabela) {
    lista.push(`${tabela} devolveu linha SEM tenant declarado`);
  }
});

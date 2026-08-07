// backend/scripts/gerarPoliciesRls.js
//
// FASE 7 DO MULTI-TENANCY — gera o SQL das policies a partir da FONTE ÚNICA
// (`src/lib/tenancyMap.js`), a mesma que o `inventarioTenancy.js` usa.
//
// SOMENTE LEITURA do banco: lê o catálogo para descobrir colunas e FKs e IMPRIME SQL.
// Não aplica nada — a saída vira uma migration, que é revisada antes de rodar.
//
//   node scripts/gerarPoliciesRls.js > /caminho/migration.sql
//
// ── AS TRÊS FORMAS DE POLICY ────────────────────────────────────────────────
//
//  (1) TENANT DIRETO — a tabela tem `empresa_id`:
//        empresa_id = app_empresa_id()
//
//  (2) CATÁLOGO MISTO — parte global, parte da empresa:
//        empresa_id = app_empresa_id() OR <predicado de linha global>
//      ⚠️ O `USING` é permissivo (lê o global), mas o `WITH CHECK` é ESTRITO: a clínica
//      só ESCREVE o que é dela. Sem essa assimetria, qualquer empresa editaria o
//      catálogo compartilhado — e a alteração apareceria para todas as outras.
//
//  (3) TENANT VIA PAI — herda por FK; subconsulta pelo caminho DECLARADO:
//        EXISTS (SELECT 1 FROM <pai> WHERE <pai>.id = <fk> AND <pai>.empresa_id = …)
//      🔴 UM caminho por tabela — `CAMINHO_EXPLICITO[t]` é uma STRING. Não existe
//      "rota alternativa", e isso é estrutural, não convenção: ver o comentário em
//      `tenancyMap.js`. Rota alternativa quebrava dos dois lados — na policy virava
//      `OR` (linha visível para duas empresas) e no inventário MASCARAVA ÓRFÃ (dizia
//      "tem dono" sobre linha que a policy não enxerga).
//
// ⚠️ TODAS levam o escape `app_empresa_id() IS NULL OR …` enquanto a fase 7 não
// terminar. Ele é o que permite ligar o RLS sem quebrar cron, ADMIN e as 98 chamadas de
// SQL cru que ainda não passam por `comTenant`. **Enquanto existir, protege só quem
// passa pelo caminho instrumentado.** Removê-lo é o último passo (7c).
'use strict';

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const {
  CONTROL_PLANE, CATALOGO_GLOBAL, CATALOGO_MISTO,
  CONTROL_PLANE_COM_EMPRESA, CAMINHO_EXPLICITO, NAO_SERVE_DE_PONTE, COLS_EMPRESA,
} = require('../src/lib/tenancyMap');

const prisma = new PrismaClient();
const SCHEMA = 'schs2vet';
const q = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);

const FN = `"${SCHEMA}"."app_empresa_id"()`;
// Escopo de PLATAFORMA (ADMIN cross-tenant). Substitui o escape `IS NULL` da fase 6.
const PLAT = `"${SCHEMA}"."app_plataforma"()`;

(async () => {
  const tabelas = (await q(
    `SELECT table_name AS nome FROM information_schema.tables
      WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name`, SCHEMA))
    .map(r => r.nome);

  const colsRows = await q(
    `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema=$1`, SCHEMA);
  const colunas = new Map();
  for (const r of colsRows) {
    if (!colunas.has(r.t)) colunas.set(r.t, []);
    colunas.get(r.t).push(r.c);
  }

  const fkRows = await q(
    `SELECT tc.table_name AS t, kcu.column_name AS c, ccu.table_name AS alvo, ccu.column_name AS calvo
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
      WHERE tc.table_schema=$1 AND tc.constraint_type='FOREIGN KEY'`, SCHEMA);
  const fks = new Map();
  for (const r of fkRows) {
    if (!fks.has(r.t)) fks.set(r.t, []);
    fks.get(r.t).push({ coluna: r.c, alvo: r.alvo, colunaAlvo: r.calvo });
  }

  const colEmp = (t) => (colunas.get(t) ?? []).find(c => COLS_EMPRESA.includes(c)) ?? null;
  const tenantDireto = new Set(tabelas.filter(colEmp));

  // Cadeia até a tabela que tem `empresa_id`, seguindo o caminho DECLARADO.
  const cadeiaDe = (t, col, visitadas = new Set()) => {
    const fk = (fks.get(t) ?? []).find(f => f.coluna === col);
    if (!fk || visitadas.has(fk.alvo)) return null;
    const passo = { coluna: col, alvo: fk.alvo, colunaAlvo: fk.colunaAlvo };
    if (tenantDireto.has(fk.alvo)) return [passo];
    visitadas.add(fk.alvo);
    const proxima = CAMINHO_EXPLICITO[fk.alvo];
    if (proxima) {
      const resto = cadeiaDe(fk.alvo, proxima, visitadas);
      if (resto) return [passo, ...resto];
    }
    return null;
  };

  /**
   * Subconsulta aninhada que traduz uma cadeia de saltos em predicado SQL.
   *
   * ⚠️ A coluna da PRÓPRIA tabela vai SEM qualificação. Dentro de uma policy não existe
   * alias para a tabela protegida — ela é o contexto implícito da expressão. Qualificar
   * com um alias inventado (`t."col"`) faz o `CREATE POLICY` falhar com
   * `missing FROM-clause entry for table "t"`. Só os PAIS, que entram por subconsulta,
   * ganham alias (`p0`, `p1`, …).
   */
  const predicadoDaCadeia = (cadeia) => {
    // Monta de trás para a frente: o último salto é quem compara com a empresa.
    let expr = null;
    for (let i = cadeia.length - 1; i >= 0; i--) {
      const p = cadeia[i];
      const condicao = i === cadeia.length - 1
        ? `p${i}."${colEmp(p.alvo)}" = ${FN}`
        : expr;
      const ladoFilho = i === 0 ? `"${p.coluna}"` : `p${i - 1}."${p.coluna}"`;
      expr = `EXISTS (SELECT 1 FROM "${SCHEMA}"."${p.alvo}" p${i} ` +
             `WHERE p${i}."${p.colunaAlvo}" = ${ladoFilho} AND ${condicao})`;
    }
    return expr;
  };

  const linhas = [];
  const pular = [];

  for (const t of tabelas) {
    if (t === '_prisma_migrations') continue;
    const ce = colEmp(t);

    let usando = null, checando = null, classe = null;

    if (CATALOGO_MISTO.has(t)) {
      const pred = CATALOGO_MISTO.get(t);
      const global = pred ? `("${ce}" IS NULL AND (${pred}))` : `"${ce}" IS NULL`;
      classe   = 'CATÁLOGO MISTO';
      usando   = `"${ce}" = ${FN} OR ${global}`;
      // ESTRITO: lê o global, mas só escreve o próprio.
      checando = `"${ce}" = ${FN}`;
    } else if (CONTROL_PLANE.has(t) || CONTROL_PLANE_COM_EMPRESA.has(t) || CATALOGO_GLOBAL.has(t)) {
      pular.push(`${t} (control plane / catálogo global — sem RLS por decisão)`);
      continue;
    } else if (ce) {
      classe   = 'TENANT DIRETO';
      usando   = `"${ce}" = ${FN}`;
      checando = usando;
    } else {
      // UM caminho, sempre — `CAMINHO_EXPLICITO[t]` é uma STRING, não uma lista.
      // A estrutura é que impede a ambiguidade; não há o que escolher aqui.
      const cadeia = CAMINHO_EXPLICITO[t] ? cadeiaDe(t, CAMINHO_EXPLICITO[t]) : null;
      if (!cadeia) { pular.push(`${t} (sem caminho até a empresa — PENDENTE de decisão)`); continue; }
      classe   = `TENANT VIA PAI (${cadeia.map(p => p.alvo).join('→')})`;
      usando   = predicadoDaCadeia(cadeia);
      checando = usando;
    }

    linhas.push(
      `-- ${t} — ${classe}\n` +
      `ALTER TABLE "${SCHEMA}"."${t}" ENABLE ROW LEVEL SECURITY;\n` +
      `ALTER TABLE "${SCHEMA}"."${t}" FORCE  ROW LEVEL SECURITY;\n` +
      `DROP POLICY IF EXISTS "tenant_${t}" ON "${SCHEMA}"."${t}";\n` +
      `CREATE POLICY "tenant_${t}" ON "${SCHEMA}"."${t}"\n` +
      // 🔴 FASE 7c — o escape `app_empresa_id() IS NULL OR …` SAIU.
      // Agora só há dois caminhos, ambos EXPLÍCITOS: o tenant declarado, ou o escopo de
      // PLATAFORMA (`comEscopoPlataforma`, gate de ADMIN). Contexto ausente = vê NADA.
      // É a inversão que fecha a fase: antes a ausência PERMITIA, agora NEGA.
      `  USING (${PLAT} OR (${usando}))\n` +
      `  WITH CHECK (${PLAT} OR (${checando}));\n`);
  }

  console.log(linhas.join('\n'));
  console.error(`\n-- ${linhas.length} tabela(s) com policy gerada`);
  console.error(`-- ${pular.length} pulada(s):`);
  pular.forEach(p => console.error(`--   ${p}`));

  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERRO:', e.message); await prisma.$disconnect(); process.exit(1); });

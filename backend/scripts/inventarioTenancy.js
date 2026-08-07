// backend/scripts/inventarioTenancy.js
//
// FASE 0 do plano de multi-tenancy (docs/MULTI-TENANCY-PLANO.md): inventário do schema.
//
// SOMENTE LEITURA. Não cria, não altera e não apaga nada — só consulta catálogo do
// PostgreSQL (information_schema / pg_constraint) e faz COUNT. Pode rodar em produção.
//
//   node backend/scripts/inventarioTenancy.js            → tabela no console
//   node backend/scripts/inventarioTenancy.js --md       → markdown (para colar no plano)
//
// POR QUE ELE EXISTE: classificar as tabelas "no olho" ou por grep no schema.prisma erra
// nos dois sentidos — conta como órfã a tabela escopada por `equipeId` ou por FK ao pai, e
// deixa passar a que só cita `empresaId` num nome de relação. Antes de ligar RLS é preciso
// saber, tabela por tabela e com número: quem é tenant, quem herda o tenant do pai, quem é
// catálogo global e quantas linhas ficariam SEM dono no backfill.

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const { comTenantAutomatico, comEscopoPlataforma } = require('../src/lib/prismaTenant');
// ⚠️ FASE 7c — o RLS agora é FAIL-CLOSED, e o `FORCE` alcança até o DONO das tabelas.
// Script de manutenção que não declarar escopo enxerga ZERO linha: o inventário chegou a
// acusar '32 de 32 órfãs' em tb_movimentos_estoque porque o LEFT JOIN no pai voltava
// vazio. Manutenção lê a base inteira por definição — escopo de PLATAFORMA, explícito.
const prisma = comTenantAutomatico(new PrismaClient());
const SCHEMA = 'schs2vet';
const MD = process.argv.includes('--md');

// ⚠️ A classificação MORA EM `src/lib/tenancyMap.js` desde a fase 7 — o gerador de
// policies precisa exatamente do mesmo mapa, e duas cópias divergiriam na primeira
// correção, deixando uma tabela sem policy sem o inventário perceber.
const {
  CONTROL_PLANE, CATALOGO_GLOBAL, CATALOGO_MISTO,
  CONTROL_PLANE_COM_EMPRESA, LEGADO_CONHECIDO, CAMINHO_EXPLICITO, NAO_SERVE_DE_PONTE,
  COLS_EMPRESA, COLS_EQUIPE,
} = require('../src/lib/tenancyMap');

const q = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);
const num = (v) => (typeof v === 'bigint' ? Number(v) : v);

async function tabelas() {
  const rows = await q(
    `SELECT table_name AS nome
       FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      ORDER BY table_name`, SCHEMA);
  return rows.map(r => r.nome);
}

async function colunasPorTabela() {
  const rows = await q(
    `SELECT table_name AS tabela, column_name AS coluna, is_nullable AS nulavel
       FROM information_schema.columns
      WHERE table_schema = $1`, SCHEMA);
  const mapa = new Map();
  for (const r of rows) {
    if (!mapa.has(r.tabela)) mapa.set(r.tabela, []);
    mapa.get(r.tabela).push({ nome: r.coluna, nulavel: r.nulavel === 'YES' });
  }
  return mapa;
}

/** FKs de cada tabela: [{ coluna, tabelaAlvo, colunaAlvo }] */
async function fksPorTabela() {
  const rows = await q(
    `SELECT tc.table_name        AS tabela,
            kcu.column_name      AS coluna,
            ccu.table_name       AS tabela_alvo,
            ccu.column_name      AS coluna_alvo
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema = $1 AND tc.constraint_type = 'FOREIGN KEY'`, SCHEMA);
  const mapa = new Map();
  for (const r of rows) {
    if (!mapa.has(r.tabela)) mapa.set(r.tabela, []);
    mapa.get(r.tabela).push({ coluna: r.coluna, tabelaAlvo: r.tabela_alvo, colunaAlvo: r.coluna_alvo });
  }
  return mapa;
}

const colEmpresa = (colunas) => colunas?.find(c => COLS_EMPRESA.includes(c.nome)) ?? null;
const colEquipe  = (colunas) => colunas?.find(c => COLS_EQUIPE.includes(c.nome))  ?? null;

async function contar(tabela, where = '') {
  const [r] = await q(`SELECT count(*)::int AS n FROM ${SCHEMA}."${tabela}" ${where}`);
  return num(r.n);
}

(async () => comEscopoPlataforma(async () => {
  const nomes   = await tabelas();
  const colunas = await colunasPorTabela();
  const fks     = await fksPorTabela();

  // 1º passo: quem tem a coluna de empresa (tenant direto)
  const tenantDireto = new Set(nomes.filter(t => colEmpresa(colunas.get(t))));

  // 2º passo: quem chega à empresa POR QUALQUER NÚMERO DE SALTOS de FK (fecho
  // transitivo, até estabilizar). Um salto só não basta: `tb_exame_clinico_resultado_itens`
  // → `tb_exames_clinicos` → `tb_animais` são DOIS saltos, e com o limite de 1 a neta
  // aparecia como "sem caminho até a empresa" — órfã que não é. O caminho registrado é
  // o que o backfill vai percorrer, então guarda-se a cadeia inteira.
  //
  // ⚠️ Duas correções de 2026-08-06:
  //   (a) o caminho DECLARADO em CAMINHO_EXPLICITO vence a inferência — sempre;
  //   (b) a inferência NÃO atravessa control plane nem catálogo global
  //       (NAO_SERVE_DE_PONTE), senão "resolve" pelo `users.empresa_id` legado.
  const caminho = new Map();   // tabela → { coluna, tabelaAlvo, saltos, cadeia }
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const t of nomes) {
      if (tenantDireto.has(t) || caminho.has(t) || CAMINHO_EXPLICITO[t]) continue;
      for (const fk of fks.get(t) ?? []) {
        if (fk.tabelaAlvo === t) continue;                       // auto-relação não leva a lugar nenhum
        if (NAO_SERVE_DE_PONTE.has(fk.tabelaAlvo)) continue;     // (b)
        const alvoDireto = tenantDireto.has(fk.tabelaAlvo);
        const alvoVia    = caminho.get(fk.tabelaAlvo);
        if (!alvoDireto && !alvoVia) continue;
        caminho.set(t, {
          coluna:     fk.coluna,
          tabelaAlvo: fk.tabelaAlvo,
          saltos:     alvoDireto ? 1 : alvoVia.saltos + 1,
          cadeia:     alvoDireto ? [fk.tabelaAlvo] : [fk.tabelaAlvo, ...alvoVia.cadeia],
        });
        mudou = true;
        break;
      }
    }
  }

  // ── Caminho DECLARADO → cadeia de saltos até uma tabela com coluna de empresa ──
  // Segue a FK informada e continua subindo até achar quem tem `empresa_id`.
  const cadeiaDe = (tabela, colunaFk, visitadas = new Set()) => {
    const fk = (fks.get(tabela) ?? []).find(f => f.coluna === colunaFk);
    if (!fk || visitadas.has(fk.tabelaAlvo)) return null;
    const passo = { coluna: colunaFk, alvo: fk.tabelaAlvo, colunaAlvo: fk.colunaAlvo };
    if (tenantDireto.has(fk.tabelaAlvo)) return [passo];
    visitadas.add(fk.tabelaAlvo);
    // Sobe pelo caminho declarado do pai; na falta, pelo inferido.
    const proxCols = CAMINHO_EXPLICITO[fk.tabelaAlvo]
      ? [CAMINHO_EXPLICITO[fk.tabelaAlvo]]
      : (caminho.has(fk.tabelaAlvo) ? [caminho.get(fk.tabelaAlvo).coluna] : []);
    for (const c of proxCols) {
      const resto = cadeiaDe(fk.tabelaAlvo, c, visitadas);
      if (resto) return [passo, ...resto];
    }
    return null;
  };

  for (const [t, coluna] of Object.entries(CAMINHO_EXPLICITO)) {
    if (!nomes.includes(t) || tenantDireto.has(t)) continue;
    // UM caminho, sempre. Ver o comentário em tenancyMap.js: rota alternativa mascarava
    // órfã — o inventário dizia 'tem dono' sobre linha que a policy não enxerga.
    const cadeias = [cadeiaDe(t, coluna)].filter(Boolean);
    if (cadeias.length) {
      const p = cadeias[0];
      caminho.set(t, {
        coluna:     p[0].coluna,
        tabelaAlvo: p[0].alvo,
        saltos:     p.length,
        cadeia:     p.map(s => s.alvo),
        declarado:  true,
        cadeias,                      // TODAS as rotas — a linha só é órfã se nenhuma resolver
      });
    }
  }

  /**
   * Conta as linhas que NÃO chegam a uma empresa seguindo o caminho até o fim.
   *
   * ⚠️ É AQUI que estava o segundo erro: o script perguntava só se a COLUNA LOCAL era
   * nula. Uma FK preenchida apontando para um pai SEM empresa passava por "com dono".
   * Agora o teste percorre a cadeia com LEFT JOIN e olha a empresa NO FIM dela.
   */
  const contarSemDono = async (tabela, rotas) => {
    const joins = [];
    const condicoes = [];
    rotas.forEach((cadeia, i) => {
      let anterior = 't';
      cadeia.forEach((passo, j) => {
        const alias = `r${i}_${j}`;
        joins.push(`LEFT JOIN ${SCHEMA}."${passo.alvo}" ${alias} ` +
                   `ON ${alias}."${passo.colunaAlvo}" = ${anterior}."${passo.coluna}"`);
        anterior = alias;
      });
      const fim = `r${i}_${cadeia.length - 1}`;
      const ce  = colEmpresa(colunas.get(cadeia[cadeia.length - 1].alvo));
      condicoes.push(`${fim}."${ce.nome}" IS NULL`);
    });
    const [r] = await q(
      `SELECT count(*)::int AS n FROM ${SCHEMA}."${tabela}" t ${joins.join(' ')} ` +
      `WHERE ${condicoes.join(' AND ')}`);
    return num(r.n);
  };

  const linhas = [];
  for (const t of nomes) {
    const cols  = colunas.get(t) ?? [];
    const total = await contar(t);
    const ce    = colEmpresa(cols);
    const cq    = colEquipe(cols);

    let classe, detalhe, semDono = null;

    // ⚠️ A lista fixa NÃO pode calar a evidência. `tb_localizacoes_animal` estava em
    // CATALOGO_GLOBAL e tem `empresaId` com 5.192 linhas globais + 7 de empresa: é
    // catálogo MISTO, e a classificação na mão escondia isso. Agora, quando a tabela
    // fixada tem coluna de empresa, ela é denunciada em vez de aceita em silêncio.
    if (CATALOGO_MISTO.has(t)) {
      // `empresa_id IS NULL` aqui é a LINHA GLOBAL — desde que satisfaça o predicado.
      // O que NÃO satisfaz continua sendo contado como órfã.
      classe  = 'CATALOGO MISTO';
      const pred    = CATALOGO_MISTO.get(t);
      const semEmp  = ce ? await contar(t, `WHERE "${ce.nome}" IS NULL`) : 0;
      const globais = !ce ? 0
        : pred ? await contar(t, `WHERE "${ce.nome}" IS NULL AND (${pred})`) : semEmp;
      detalhe = `${globais} global(is) + ${total - semEmp} de empresa`;
      semDono = semEmp - globais;     // nulo que NÃO é global legítimo = órfã
    }
    else if ((CONTROL_PLANE.has(t) || CATALOGO_GLOBAL.has(t)) && ce && !CONTROL_PLANE_COM_EMPRESA.has(t)) {
      classe  = 'CONFLITO';
      detalhe = `classificada na mão, mas TEM ${ce.nome} — revisar`;
    }
    else if (CONTROL_PLANE.has(t))     { classe = 'CONTROL PLANE'; detalhe = 'sem RLS'; }
    else if (CATALOGO_GLOBAL.has(t))   { classe = 'CATALOGO';      detalhe = 'global, sem RLS'; }
    else if (ce) {
      classe  = 'TENANT DIRETO';
      detalhe = `${ce.nome}${ce.nulavel ? ' (nulável)' : ''}`;
      // ⚠️ DUAS formas de ser órfã aqui, e a segunda passou despercebida até a fase 7:
      //   (a) `empresa_id IS NULL` — nunca teve dono;
      //   (b) `empresa_id` PREENCHIDO apontando para uma empresa que **não existe mais**.
      //
      // (b) só aparece em tabela SEM FK para `tb_empresas`. Parte é por decisão
      // (`tb_audit_logs`/`tb_ai_usage_logs` — "o log sobrevive à exclusão da empresa"),
      // parte é falta de FK mesmo. Sob RLS a diferença some: a linha fica invisível
      // para TODO tenant, porque não existe empresa com aquele id para casar.
      //
      // Foi assim que 28 linhas em 5 tabelas escaparam de um inventário que declarava
      // "ZERO ÓRFÃOS": ele perguntava só (a). Quem denunciou foi a soma por tenant não
      // fechar com o total.
      const nulos = ce.nulavel && total > 0 ? await contar(t, `WHERE "${ce.nome}" IS NULL`) : 0;
      const quebrados = total > 0
        ? await contar(t,
            `x LEFT JOIN ${SCHEMA}."tb_empresas" e ON e.id = x."${ce.nome}" ` +
            `WHERE x."${ce.nome}" IS NOT NULL AND e.id IS NULL`)
        : 0;
      if (quebrados) detalhe += ` · ${quebrados} p/ empresa inexistente`;
      semDono = nulos + quebrados;
    }
    else if (caminho.has(t)) {
      const fk = caminho.get(t);
      classe  = 'TENANT VIA PAI';
      // O `*` marca o caminho DECLARADO — o que o backfill da fase 5 vai usar.
      detalhe = `${fk.declarado ? '*' : ''}${fk.coluna} → ${fk.cadeia.join(' → ')}`;
      // Órfã de verdade = não chega a empresa por NENHUMA das rotas.
      // Para o caminho inferido a cadeia é remontada por `cadeiaDe`, porque ela pode
      // ter mais de um salto e o teste precisa percorrê-la INTEIRA.
      const rotas = fk.cadeias ?? [cadeiaDe(t, fk.coluna)].filter(Boolean);
      semDono = total > 0 && rotas.length ? await contarSemDono(t, rotas) : 0;
    }
    else if (cq) { classe = 'VIA EQUIPE'; detalhe = `${cq.nome} → equipe → empresa`; }
    else         { classe = 'PENDENTE';   detalhe = 'sem caminho até a empresa — DECIDIR'; }

    linhas.push({ tabela: t, total, classe, detalhe, semDono });
  }

  const ordem = ['CONFLITO', 'PENDENTE', 'TENANT DIRETO', 'TENANT VIA PAI', 'VIA EQUIPE',
                 'CATALOGO MISTO', 'CATALOGO', 'CONTROL PLANE'];
  linhas.sort((a, b) =>
    ordem.indexOf(a.classe) - ordem.indexOf(b.classe) || b.total - a.total || a.tabela.localeCompare(b.tabela));

  const resumo = {};
  for (const l of linhas) resumo[l.classe] = (resumo[l.classe] ?? 0) + 1;

  if (MD) {
    console.log(`# Inventário de tenancy — ${SCHEMA}\n`);
    console.log(`Gerado em ${new Date().toISOString()} · ${linhas.length} tabelas\n`);
    console.log('| Tabela | Linhas | Classe | Chave / caminho | Sem dono |');
    console.log('|---|---:|---|---|---:|');
    for (const l of linhas) {
      console.log(`| \`${l.tabela}\` | ${l.total} | ${l.classe} | ${l.detalhe} | ${l.semDono ?? '—'} |`);
    }
  } else {
    console.log(`\nINVENTÁRIO DE TENANCY — ${SCHEMA} (${linhas.length} tabelas)\n`);
    console.log('TABELA'.padEnd(38) + 'LINHAS'.padStart(7) + '  ' + 'CLASSE'.padEnd(15) + 'CHAVE / CAMINHO'.padEnd(34) + 'SEM DONO');
    console.log('-'.repeat(110));
    for (const l of linhas) {
      console.log(
        l.tabela.padEnd(38) +
        String(l.total).padStart(7) + '  ' +
        l.classe.padEnd(15) +
        l.detalhe.padEnd(34) +
        (l.semDono == null ? '—' : String(l.semDono)));
    }
    console.log('-'.repeat(110));
    console.log('RESUMO:', Object.entries(resumo).map(([k, v]) => `${k}=${v}`).join('  '));
    // ⚠️ REGRA DO PRODUTO: **não pode existir registro órfão.** Linha de CATÁLOGO MISTO
    // (global, compartilhada) NÃO é órfã e por isso nem chega aqui — ela tem dono: é de
    // todos. Órfã é a linha de uma tabela de TENANT que não chega a empresa nenhuma.
    const travam = linhas.filter(l => l.semDono > 0);
    if (!travam.length) {
      console.log('\n✅ ZERO REGISTROS ÓRFÃOS — toda linha de tabela de tenant chega a uma empresa.');
    } else {
      console.log(`\n🔴 ${travam.length} tabela(s) COM REGISTRO ÓRFÃO — precisam ser resolvidas ANTES do NOT NULL:`);
      for (const l of travam) {
        const nota = LEGADO_CONHECIDO[l.tabela] ? `  ← ${LEGADO_CONHECIDO[l.tabela]}` : '';
        console.log(`   ${l.tabela}: ${l.semDono} de ${l.total}${nota}`);
      }
    }
    const pend = linhas.filter(l => l.classe === 'PENDENTE');
    if (pend.length) {
      console.log(`\n⚠️  ${pend.length} tabela(s) PENDENTE(S) de classificação humana:`);
      for (const l of pend) console.log(`   ${l.tabela} (${l.total} linhas)`);
    }
  }

  await prisma.$disconnect();
}))().catch(async (e) => {
  console.error('Falha no inventário:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});

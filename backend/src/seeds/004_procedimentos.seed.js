/**
 * Seed 004 — Catálogo de Procedimentos Veterinários
 *
 * Lê procedimentos_vet.csv e popula tb_procedimentos_vet via SQL raw
 * (upsert por codigo). Usa SQL raw para garantir que o campo especie
 * seja gravado mesmo com o Prisma client desatualizado.
 *
 * Executar: node backend/seed.js
 */

const fs = require('fs');

const CSV_PATH = 'C:\\Users\\marco\\Downloads\\procedimentos_vet.csv';

function parseLine(line) {
  const vals = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; }
    else { cur += ch; }
  }
  vals.push(cur);
  return vals;
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  const headers = parseLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
    return obj;
  });
}

function boolVal(val) {
  if (!val || val === '') return false;
  return val.toUpperCase() === 'TRUE' || val === '1';
}

function floatVal(val) {
  if (!val || val === '') return null;
  const n = parseFloat(val.replace(',', '.'));
  return isNaN(n) ? null : n;
}

function intVal(val) {
  if (!val || val === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function str(val) {
  return (val && val !== '') ? val : null;
}

async function seedProcedimentos(prisma) {
  if (!fs.existsSync(CSV_PATH)) {
    console.log(`  ⚠️  Seed procedimentos ignorado — arquivo não encontrado: ${CSV_PATH}`);
    return;
  }

  const content = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(content);

  let count = 0;

  for (const row of rows) {
    if (!row.codigo || !row.nome) continue;

    await prisma.$executeRawUnsafe(`
      INSERT INTO schs2vet.tb_procedimentos_vet
        (codigo, nome, "nomeAbreviado", descricao, categoria, especialidade,
         "tipoProcedimento", duracao, "requerAnestesia", "requerInternacao",
         risco, "valorCusto", "valorVenda", especie, ativo,
         "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW() AT TIME ZONE 'UTC',NOW() AT TIME ZONE 'UTC')
      ON CONFLICT (codigo) WHERE codigo IS NOT NULL DO UPDATE SET
        nome             = EXCLUDED.nome,
        "nomeAbreviado"  = EXCLUDED."nomeAbreviado",
        descricao        = EXCLUDED.descricao,
        categoria        = EXCLUDED.categoria,
        especialidade    = EXCLUDED.especialidade,
        "tipoProcedimento" = EXCLUDED."tipoProcedimento",
        duracao          = EXCLUDED.duracao,
        "requerAnestesia"  = EXCLUDED."requerAnestesia",
        "requerInternacao" = EXCLUDED."requerInternacao",
        risco            = EXCLUDED.risco,
        "valorCusto"     = EXCLUDED."valorCusto",
        "valorVenda"     = EXCLUDED."valorVenda",
        especie          = EXCLUDED.especie,
        ativo            = EXCLUDED.ativo,
        "updatedAt"      = NOW() AT TIME ZONE 'UTC'
    `,
      row.codigo,
      row.nome,
      str(row.nomeAbreviado),
      str(row.descricao),
      row.categoria || '',
      str(row.especialidade),
      str(row.tipoProcedimento),
      intVal(row.duracao),
      boolVal(row.requerAnestesia),
      boolVal(row.requerInternacao),
      str(row.risco),
      floatVal(row.valorCusto),
      floatVal(row.valorVenda),
      str(row.especie),
      row.ativo !== '' ? boolVal(row.ativo) : true,
    );

    count++;
  }

  console.log(`  ✓ Procedimentos veterinários: ${count} registros inseridos/atualizados`);
}

module.exports = seedProcedimentos;

/**
 * Seed 003 — Catálogo de Medicamentos
 *
 * Lê C:\Users\marco\Downloads\Apresentacao_Farmaceutica_Processada.csv e popula:
 *   tb_especies              — insere espécie se não existir (busca por nome)
 *   tb_medicamentos          — upsert por (nome, formaFarmaceutica, apresentacao)
 *   tb_medicamento_vias      — insere via se não existir para aquele medicamento
 *   tb_medicamento_especies  — vínculo N:N medicamento ↔ espécie (do campo especie do CSV)
 *
 * Executar: node backend/seed.js
 */

const fs = require('fs');

const CSV_PATH = 'C:\\Users\\marco\\Downloads\\Medicamento_Finalizado - Todos.csv';

// ---------------------------------------------------------------------------
// CSV parser — suporta campos entre aspas com vírgulas internas
// ---------------------------------------------------------------------------
function parseCsv(content) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const headers = splitLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (values[idx] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}

function splitLine(line) {
  const result = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// ---------------------------------------------------------------------------
// Seed principal — recebe a instância do PrismaClient
// ---------------------------------------------------------------------------
async function seed(prisma) {
  console.log('\n[003] Iniciando seed de medicamentos...');

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`[003] Arquivo não encontrado: ${CSV_PATH}`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  console.log(`[003] ${rows.length} linhas lidas do CSV`);

  // Reseta sequences para evitar conflito de ID quando rows foram inseridas com ID explícito
  await prisma.$executeRawUnsafe(
    `SELECT setval('schs2vet.tb_especies_id_seq', COALESCE((SELECT MAX(id) FROM schs2vet.tb_especies), 0))`
  );
  await prisma.$executeRawUnsafe(
    `SELECT setval('schs2vet.tb_medicamentos_id_seq', COALESCE((SELECT MAX(id) FROM schs2vet.tb_medicamentos), 0))`
  );
  await prisma.$executeRawUnsafe(
    `SELECT setval('schs2vet.tb_medicamento_vias_id_seq', COALESCE((SELECT MAX(id) FROM schs2vet.tb_medicamento_vias), 0))`
  );

  // Mapa de normalização plural → singular (evita recriar formas plurais no banco)
  const ESPECIE_SINGULAR = {
    equinos: 'Equino', bovinos: 'Bovino', caninos: 'Canino',
    felinos: 'Felino', répteis: 'Réptil', repteis: 'Réptil', reptil: 'Réptil',
  };
  const normalizarEspecie = (nome) => ESPECIE_SINGULAR[nome.trim().toLowerCase()] ?? nome.trim();

  // 1. Espécies — insere somente as que não existem (busca insensível a case) --
  const especiesNomes = new Set();
  for (const r of rows) {
    const e = (r.especie || '').trim();
    if (!e) continue;
    // "Bovinos e Equinos" → partes individuais, cada uma normalizada para singular
    e.split(' e ').forEach(p => { const n = normalizarEspecie(p); if (n) especiesNomes.add(n); });
  }

  let especiesNovas = 0;
  for (const nome of especiesNomes) {
    if (!nome) continue;
    const existe = await prisma.especie.findFirst({
      where: { nome: { equals: nome, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!existe) {
      await prisma.especie.create({ data: { nome } });
      especiesNovas++;
    }
  }
  console.log(`[003] Espécies novas inseridas: ${especiesNovas}`);

  // Mapa nome (case-insensitive) → id para as espécies já no banco
  const especiesDb = await prisma.$queryRawUnsafe(
    `SELECT id, lower(nome) as nome FROM schs2vet.tb_especies`
  );
  const especieIdMap = {};
  for (const e of especiesDb) especieIdMap[e.nome] = Number(e.id);

  // 2. Medicamentos, Vias e Espécies -----------------------------------------
  let medInserted  = 0;
  let medUpdated   = 0;
  let viasIns      = 0;
  let especiesLink = 0;

  for (const row of rows) {
    const nome              = (row.nome              || '').trim();
    const formaFarmaceutica = (row.formaFarmaceutica || '').trim();
    const apresentacao      = (row.apresentacao      || '').trim();
    const classificacao     = (row.classificacao     || '').trim() || null;
    const unidade           = (row.unidade           || '').trim();
    const viaRaw            = (row.viaAdministracao  || '').trim();
    const especieRaw        = (row.especie           || '').trim();
    const controlado        = (row.controlado        || '').trim() === 'Receita Controlada';

    if (!nome) continue;

    // Pula registros com nome maior que o limite do banco
    if (nome.length > 90) {
      console.warn(`[003] AVISO: nome muito longo (${nome.length} chars), pulado: "${nome.substring(0, 60)}..."`);
      continue;
    }

    // Upsert medicamento — unique: (nome, formaFarmaceutica, apresentacao)
    let medId;
    const existing = await prisma.medicamento.findFirst({
      where: { nome, formaFarmaceutica, apresentacao },
      select: { id: true },
    });

    if (existing) {
      await prisma.medicamento.update({
        where: { id: existing.id },
        data: { classificacao, unidade, controlado, updatedAt: new Date() },
      });
      medId = existing.id;
      medUpdated++;
    } else {
      const created = await prisma.medicamento.create({
        data: { nome, formaFarmaceutica, apresentacao, classificacao, unidade, controlado },
      });
      medId = created.id;
      medInserted++;
    }

    // Vias — split por "; " ou ";"
    if (viaRaw) {
      const vias = viaRaw.split(/;\s*/).map(v => v.trim()).filter(Boolean);
      for (const via of vias) {
        const viaExiste = await prisma.medicamentoVia.findFirst({
          where: { medicamentoId: medId, via },
          select: { id: true },
        });
        if (!viaExiste) {
          await prisma.medicamentoVia.create({ data: { medicamentoId: medId, via } });
          viasIns++;
        }
      }
    }

    // Espécies — split "Bovinos e Equinos" → normalizados para singular → lookup
    if (especieRaw) {
      const partes = especieRaw.split(' e ').map(p => normalizarEspecie(p).toLowerCase()).filter(Boolean);
      for (const parte of partes) {
        const especieId = especieIdMap[parte];
        if (!especieId) continue;
        // INSERT ... ON CONFLICT DO NOTHING (unique constraint garante idempotência)
        const inserted = await prisma.$executeRawUnsafe(
          `INSERT INTO schs2vet.tb_medicamento_especies ("medicamentoId", "especieId")
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          medId, especieId
        );
        if (inserted > 0) especiesLink++;
      }
    }
  }

  console.log(`[003] Medicamentos inseridos:   ${medInserted}`);
  console.log(`[003] Medicamentos atualizados: ${medUpdated}`);
  console.log(`[003] Vias inseridas:           ${viasIns}`);
  console.log(`[003] Vínculos espécie criados: ${especiesLink}`);
  console.log('[003] Seed de medicamentos concluído.\n');
}

// Execução standalone: node backend/src/seeds/003_medicamentos.seed.js
if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  seed(prisma)
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}

module.exports = seed;

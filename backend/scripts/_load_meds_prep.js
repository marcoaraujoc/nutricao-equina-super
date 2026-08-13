const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');

const DIR = 'D:\\Projetos\\nutricao-equina-super\\nutricao-equina-super\\ScriptsValidacao';
const FILES = {
  Equino: path.join(DIR, 'Corrigido_Arquivo_Medicmanto_Equino.csv'),
  Bovino: path.join(DIR, 'Corrigido_Arquivo_Medicmanto_Bovino.csv'),
};

function parseBool(v) {
  return String(v).trim().toLowerCase() === 'true';
}

function readCsv(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file)
      .pipe(csvParser())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

// Returns: { clean: Map(nome -> {attrs, vias:Set, especies:Set}), conflictNames: Set, rawRowsByName: Map(nome -> [{especie,...row}]) }
async function buildDataset() {
  const rawRowsByName = new Map();
  const bySpeciesAttrs = new Map(); // nome -> { Equino: attrs|null, Bovino: attrs|null, internalConflict: {Equino,Bovino} }
  const viasByName = new Map(); // nome -> Set(via)
  const especiesByName = new Map(); // nome -> Set(especie)

  for (const [especie, file] of Object.entries(FILES)) {
    const rows = await readCsv(file);
    for (const row of rows) {
      const nomeMed = (row['nome-2'] || '').trim();
      if (!nomeMed) continue;
      const attrs = {
        formaFarmaceutica: (row['formaFarmaceutica'] || '').trim(),
        unidade: (row['unidade'] || '').trim(),
        apresentacao: (row['apresentacao'] || '').trim(),
        controlado: parseBool(row['controlado']),
        classificacao: (row['classificacao'] || '').trim() || null,
      };
      const via = (row['via'] || '').trim();

      if (!rawRowsByName.has(nomeMed)) rawRowsByName.set(nomeMed, []);
      rawRowsByName.get(nomeMed).push({ especie, ...row });

      if (!bySpeciesAttrs.has(nomeMed)) bySpeciesAttrs.set(nomeMed, { Equino: null, Bovino: null, internalConflict: { Equino: false, Bovino: false } });
      const b = bySpeciesAttrs.get(nomeMed);
      if (!b[especie]) {
        b[especie] = attrs;
      } else {
        const a = b[especie];
        for (const k of Object.keys(attrs)) {
          if (a[k] !== attrs[k]) b.internalConflict[especie] = true;
        }
      }

      if (!viasByName.has(nomeMed)) viasByName.set(nomeMed, new Set());
      if (via) viasByName.get(nomeMed).add(via);

      if (!especiesByName.has(nomeMed)) especiesByName.set(nomeMed, new Set());
      especiesByName.get(nomeMed).add(especie);
    }
  }

  const clean = new Map();
  const conflictNames = new Set();
  const conflictReasons = new Map(); // nome -> [ {tipo, campo, equino, bovino} ]

  for (const nomeMed of rawRowsByName.keys()) {
    const b = bySpeciesAttrs.get(nomeMed);
    const { Equino, Bovino } = b;
    let isConflict = false;
    const reasons = [];

    if (b.internalConflict.Equino) { isConflict = true; reasons.push({ tipo: 'INTERNO', especie: 'Equino' }); }
    if (b.internalConflict.Bovino) { isConflict = true; reasons.push({ tipo: 'INTERNO', especie: 'Bovino' }); }

    let canonical = Equino || Bovino;
    if (Equino && Bovino) {
      for (const k of Object.keys(Equino)) {
        if (Equino[k] !== Bovino[k]) {
          isConflict = true;
          reasons.push({ tipo: 'CROSS_ESPECIE', campo: k, equino: Equino[k], bovino: Bovino[k] });
        }
      }
    }

    if (isConflict) {
      conflictNames.add(nomeMed);
      conflictReasons.set(nomeMed, reasons);
    } else {
      clean.set(nomeMed, {
        attrs: canonical,
        vias: viasByName.get(nomeMed),
        especies: especiesByName.get(nomeMed),
      });
    }
  }

  return { clean, conflictNames, rawRowsByName, conflictReasons };
}

module.exports = { buildDataset };

if (require.main === module) {
  buildDataset().then(({ clean, conflictNames }) => {
    console.log('Limpos (sem conflito):', clean.size);
    console.log('Em conflito:', conflictNames.size);
    console.log('Total:', clean.size + conflictNames.size);
  });
}

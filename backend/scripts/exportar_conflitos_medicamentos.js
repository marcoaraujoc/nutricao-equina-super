const fs = require('fs');
const path = require('path');
const { buildDataset } = require('./_load_meds_prep');

const OUT_FILE = 'D:\\Projetos\\nutricao-equina-super\\nutricao-equina-super\\ScriptsValidacao\\Conflitos_Medicamentos_Equino_Bovino.csv';

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function formatReasons(reasons) {
  return reasons
    .map((r) => {
      if (r.tipo === 'INTERNO') return `INTERNO(${r.especie}: linhas divergentes entre vias)`;
      return `CROSS_ESPECIE(${r.campo}: Equino="${r.equino}" x Bovino="${r.bovino}")`;
    })
    .join(' | ');
}

async function main() {
  const { conflictNames, rawRowsByName, conflictReasons } = await buildDataset();

  const header = [
    'especie',
    'nome-2',
    'formaFarmaceutica',
    'unidade',
    'apresentacao',
    'controlado',
    'classificacao',
    'via',
    'motivo_conflito',
  ];
  const lines = [header.join(',')];

  const nomesOrdenados = [...conflictNames].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  for (const nome of nomesOrdenados) {
    const rows = rawRowsByName.get(nome);
    const motivo = formatReasons(conflictReasons.get(nome));
    for (const row of rows) {
      lines.push(
        [
          row.especie,
          nome,
          row['formaFarmaceutica'],
          row['unidade'],
          row['apresentacao'],
          row['controlado'],
          row['classificacao'],
          row['via'],
          motivo,
        ]
          .map(csvEscape)
          .join(',')
      );
    }
  }

  fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');
  console.log('Medicamentos em conflito:', conflictNames.size);
  console.log('Linhas exportadas:', lines.length - 1);
  console.log('Arquivo gerado em:', OUT_FILE);
}

main().catch((e) => { console.error(e); process.exit(1); });

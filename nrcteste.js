/**
 * nrc-tester.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Automatiza o programa NRC 2007 e extrai todos os valores de nutrientes
 * para os casos de teste do plano de validação do S2Vet.
 *
 * INSTALAÇÃO:
 *   npm install puppeteer
 *
 * USO:
 *   node nrc-tester.js                     → roda todos os 45 testes
 *   node nrc-tester.js --bloco trabalho    → roda só o bloco "trabalho"
 *   node nrc-tester.js --caso TM2          → roda um caso específico
 *   node nrc-tester.js --visible           → abre o browser visível (debug)
 *
 * SAÍDA:
 *   nrc-results.json  → todos os valores brutos
 *   nrc-results.csv   → planilha para análise no Excel/Google Sheets
 * ─────────────────────────────────────────────────────────────────────────────
 */

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');

const NRC_URL = 'https://webassets.nationalacademies.org/nrh/';

// ─── Casos de teste ───────────────────────────────────────────────────────────
const TEST_CASES = [
  // BLOCO 1: Manutenção
  { id: 'M1',     bloco: 'manutencao', peso: 300, intake: '2.00', categoria: 'maintenance', sub: 'Average'      },
  { id: 'M2',     bloco: 'manutencao', peso: 400, intake: '2.00', categoria: 'maintenance', sub: 'Average'      },
  { id: 'M3',     bloco: 'manutencao', peso: 500, intake: '2.00', categoria: 'maintenance', sub: 'Average'      },
  { id: 'M4',     bloco: 'manutencao', peso: 600, intake: '2.00', categoria: 'maintenance', sub: 'Average'      },
  { id: 'M5',     bloco: 'manutencao', peso: 700, intake: '2.00', categoria: 'maintenance', sub: 'Average'      },
  { id: 'M_LOW',  bloco: 'manutencao', peso: 500, intake: '2.00', categoria: 'maintenance', sub: 'Low'          },
  { id: 'M_HIGH', bloco: 'manutencao', peso: 500, intake: '2.00', categoria: 'maintenance', sub: 'High'         },

  // BLOCO 2: Trabalho
  { id: 'TL1',  bloco: 'trabalho', peso: 400, intake: '2.00', categoria: 'working', sub: 'Light'    },
  { id: 'TL2',  bloco: 'trabalho', peso: 500, intake: '2.00', categoria: 'working', sub: 'Light'    },
  { id: 'TL3',  bloco: 'trabalho', peso: 650, intake: '2.00', categoria: 'working', sub: 'Light'    }, // ✓ confirmado
  { id: 'TM1',  bloco: 'trabalho', peso: 370, intake: '2.00', categoria: 'working', sub: 'Moderate' }, // ✓ confirmado
  { id: 'TM2',  bloco: 'trabalho', peso: 500, intake: '2.00', categoria: 'working', sub: 'Moderate' },
  { id: 'TM3',  bloco: 'trabalho', peso: 600, intake: '2.00', categoria: 'working', sub: 'Moderate' },
  { id: 'TH1',  bloco: 'trabalho', peso: 400, intake: '2.00', categoria: 'working', sub: 'Heavy'    },
  { id: 'TH2',  bloco: 'trabalho', peso: 500, intake: '2.00', categoria: 'working', sub: 'Heavy'    },
  { id: 'TH3',  bloco: 'trabalho', peso: 600, intake: '2.00', categoria: 'working', sub: 'Heavy'    },
  { id: 'TVH1', bloco: 'trabalho', peso: 400, intake: '2.00', categoria: 'working', sub: 'Intense'  },
  { id: 'TVH2', bloco: 'trabalho', peso: 500, intake: '2.00', categoria: 'working', sub: 'Intense'  },
  { id: 'TVH3', bloco: 'trabalho', peso: 600, intake: '2.00', categoria: 'working', sub: 'Intense'  },

  // BLOCO 3: Garanhão
  { id: 'G_NB_500', bloco: 'garanhao', peso: 500, intake: '2.00', categoria: 'stallion', sub: 'Non-Breeding' },
  { id: 'G_B_500',  bloco: 'garanhao', peso: 500, intake: '2.00', categoria: 'stallion', sub: 'Breeding'     },
  { id: 'G_NB_600', bloco: 'garanhao', peso: 600, intake: '2.00', categoria: 'stallion', sub: 'Non-Breeding' },
  { id: 'G_B_600',  bloco: 'garanhao', peso: 600, intake: '2.00', categoria: 'stallion', sub: 'Breeding'     },

  // BLOCO 4: Gestante
  { id: 'GP_E',   bloco: 'gestante', peso: 500, intake: '2.00', categoria: 'pregnant', sub: 'Early'     },
  { id: 'GP5',    bloco: 'gestante', peso: 500, intake: '2.00', categoria: 'pregnant', sub: '5 Months'  },
  { id: 'GP7',    bloco: 'gestante', peso: 500, intake: '2.00', categoria: 'pregnant', sub: '7 Months'  },
  { id: 'GP8',    bloco: 'gestante', peso: 500, intake: '2.00', categoria: 'pregnant', sub: '8 months'  },
  { id: 'GP9',    bloco: 'gestante', peso: 500, intake: '2.00', categoria: 'pregnant', sub: '9 months'  },
  { id: 'GP10',   bloco: 'gestante', peso: 500, intake: '2.00', categoria: 'pregnant', sub: '10 months' },
  { id: 'GP11',   bloco: 'gestante', peso: 500, intake: '2.00', categoria: 'pregnant', sub: '11 months' },
  { id: 'GP11_4', bloco: 'gestante', peso: 450, intake: '2.00', categoria: 'pregnant', sub: '11 months' },
  { id: 'GP11_6', bloco: 'gestante', peso: 600, intake: '2.00', categoria: 'pregnant', sub: '11 months' },

  // BLOCO 5: Lactante
  { id: 'L1',     bloco: 'lactante', peso: 500, intake: '2.50', categoria: 'lactating', sub: '1st month' },
  { id: 'L2',     bloco: 'lactante', peso: 500, intake: '2.50', categoria: 'lactating', sub: '2nd month' },
  { id: 'L3',     bloco: 'lactante', peso: 500, intake: '2.50', categoria: 'lactating', sub: '3rd month' },
  { id: 'L4',     bloco: 'lactante', peso: 500, intake: '2.25', categoria: 'lactating', sub: '4th month' },
  { id: 'L5',     bloco: 'lactante', peso: 500, intake: '2.25', categoria: 'lactating', sub: '5th month' },
  { id: 'L6',     bloco: 'lactante', peso: 500, intake: '2.00', categoria: 'lactating', sub: '6th month' },
  { id: 'L1_450', bloco: 'lactante', peso: 450, intake: '2.50', categoria: 'lactating', sub: '1st month' },
  { id: 'L1_600', bloco: 'lactante', peso: 600, intake: '2.50', categoria: 'lactating', sub: '1st month' },

  // BLOCO 6: Crescimento
  { id: 'C1', bloco: 'crescimento', peso: 200, pesoMaduro: 500, intake: '2.50', categoria: 'growing', sub: '5 Months',  workSub: 'None' },
  { id: 'C2', bloco: 'crescimento', peso: 280, pesoMaduro: 500, intake: '2.50', categoria: 'growing', sub: '12 Months', workSub: 'None' },
  { id: 'C3', bloco: 'crescimento', peso: 350, pesoMaduro: 500, intake: '2.25', categoria: 'growing', sub: '18 Months', workSub: 'None' },
  { id: 'C4', bloco: 'crescimento', peso: 420, pesoMaduro: 500, intake: '2.00', categoria: 'growing', sub: '24 Months', workSub: 'None' },
  { id: 'C5', bloco: 'crescimento', peso: 240, pesoMaduro: 600, intake: '2.50', categoria: 'growing', sub: '5 Months',  workSub: 'None' },
  { id: 'C6', bloco: 'crescimento', peso: 390, pesoMaduro: 600, intake: '2.25', categoria: 'growing', sub: '18 Months', workSub: 'None' },

  // BLOCO 7: Intake variável
  { id: 'I1', bloco: 'intake', peso: 500, intake: '1.50', categoria: 'maintenance', sub: 'Average' },
  { id: 'I3', bloco: 'intake', peso: 500, intake: '2.50', categoria: 'maintenance', sub: 'Average' },
  { id: 'I4', bloco: 'intake', peso: 500, intake: '3.00', categoria: 'maintenance', sub: 'Average' },
];

// ─── Mapa: categoria → seletor do radio ──────────────────────────────────────
const RADIO_VALUES = {
  maintenance: 'maint',
  stallion:    'stud',
  growing:     'grow',
  pregnant:    'preg',
  lactating:   'lact',
  working:     'work',
};

// ─── Extração de resultado ────────────────────────────────────────────────────
async function extractResults(page) {
  return page.evaluate(() => {
    const num = (s) => { const n = parseFloat(s); return isNaN(n) ? 0 : n; };

    // Procura linha "Animal Requirements" na tabela inferior
    const main = { DE:0, CP:0, Lys:0, Ca:0, P:0, Na:0, Cl:0, K:0 };
    document.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 9) {
        const label = cells[0]?.textContent?.trim().toLowerCase() ?? '';
        if (label.includes('requirement')) {
          main.DE  = num(cells[1]?.textContent);
          main.CP  = num(cells[2]?.textContent);
          main.Lys = num(cells[3]?.textContent);
          main.Ca  = num(cells[4]?.textContent);
          main.P   = num(cells[5]?.textContent);
          main.Na  = num(cells[6]?.textContent);
          main.Cl  = num(cells[7]?.textContent);
          main.K   = num(cells[8]?.textContent);
        }
      }
    });

    // "Other Nutrients" — varredura por texto
    const labels = {
      'Magnesium': 'Mg', 'Sulfur': 'S', 'Cobalt': 'Co', 'Copper': 'Cu',
      'Iodine': 'I', 'Iron': 'Fe', 'Manganese': 'Mn', 'Zinc': 'Zn',
      'Selenium': 'Se', 'Vitamin A': 'vitA', 'Vitamin D': 'vitD',
      'Vitamin E': 'vitE', 'Thiamin': 'tiamina', 'Riboflavin': 'riboflavina',
    };
    const other = {};
    document.querySelectorAll('td').forEach(cell => {
      const txt = cell.textContent.trim();
      Object.entries(labels).forEach(([label, key]) => {
        if (txt.startsWith(label) && !other[key]) {
          const next = cell.nextElementSibling;
          if (next) other[key] = num(next.textContent);
        }
      });
    });

    return { ...main, ...other };
  });
}

// ─── Executar um caso ─────────────────────────────────────────────────────────
async function runCase(page, tc) {
  process.stdout.write(`  ${tc.id.padEnd(12)} `);

  // --- peso maduro (mature weight)
  await page.$eval('input[name="mature_wt"]', (el, v) => {
    el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
  }, String(tc.peso));

  // --- peso atual (para crescimento)
  if (tc.pesoMaduro) {
    const actualSel = 'input[name="actual_wt"]';
    const exists = await page.$(actualSel);
    if (exists) {
      await page.$eval(actualSel, (el, v) => {
        el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
      }, String(tc.pesoMaduro));
    }
  }

  // --- intake level
  await page.select('select[name="intake"]', tc.intake);

  // --- radio categoria
  const radioVal = RADIO_VALUES[tc.categoria];
  await page.evaluate((val) => {
    const radios = document.querySelectorAll('input[type="radio"]');
    for (const r of radios) {
      if (r.value === val || r.name === val) {
        r.checked = true;
        r.dispatchEvent(new Event('click'));
        r.dispatchEvent(new Event('change'));
        break;
      }
    }
  }, radioVal);

  await new Promise(r => setTimeout(r, 400));

  // --- subcategoria
  const subSelectNames = {
    maintenance: 'maint_level',
    stallion:    'stud_level',
    growing:     'grow_age',
    pregnant:    'preg_month',
    lactating:   'lact_month',
    working:     'work_level',
  };
  const selName = subSelectNames[tc.categoria];
  if (selName) {
    await page.evaluate((name, val) => {
      const sel = document.querySelector(`select[name="${name}"]`);
      if (!sel) return;
      const opt = Array.from(sel.options).find(o =>
        o.text.trim().toLowerCase().includes(val.toLowerCase()) ||
        o.value.trim().toLowerCase().includes(val.toLowerCase())
      );
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
    }, selName, tc.sub);
  }

  // --- work level para growing
  if (tc.workSub) {
    await page.evaluate((val) => {
      const sel = document.querySelector('select[name="grow_work"]');
      if (!sel) return;
      const opt = Array.from(sel.options).find(o => o.text.trim() === val);
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
    }, tc.workSub);
  }

  await new Promise(r => setTimeout(r, 600));

  const res = await extractResults(page);

  process.stdout.write(
    `DE=${String(res.DE).padStart(5)} CP=${String(res.CP).padStart(4)} ` +
    `Ca=${String(res.Ca).padStart(4)} P=${String(res.P).padStart(4)} ` +
    `VitA=${String(res.vitA).padStart(6)}\n`
  );

  return {
    id: tc.id, bloco: tc.bloco, peso: tc.peso,
    categoria: tc.categoria, sub: tc.sub,
    intake: tc.intake,
    DMI: +(tc.peso * parseFloat(tc.intake) / 100).toFixed(2),
    ...res,
  };
}

// ─── CSV ──────────────────────────────────────────────────────────────────────
function toCSV(rows) {
  const headers = [
    'id','bloco','peso','categoria','sub','intake','DMI',
    'DE','CP','Lys','Ca','P','Na','Cl','K',
    'Mg','S','Co','Cu','I','Fe','Mn','Zn','Se',
    'vitA','vitD','vitE','tiamina','riboflavina',
  ];
  return [headers.join(','),
    ...rows.map(r => headers.map(h => r[h] ?? '').join(','))
  ].join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const args     = process.argv.slice(2);
  const visible  = args.includes('--visible');
  const blocoArg = args[args.indexOf('--bloco') + 1];
  const casoArg  = args[args.indexOf('--caso')  + 1];

  let casos = TEST_CASES;
  if (blocoArg) casos = casos.filter(c => c.bloco === blocoArg);
  if (casoArg)  casos = casos.filter(c => c.id    === casoArg);

  console.log(`\n🐴  NRC 2007 Tester — ${casos.length} caso(s)\n`);

  const browser = await puppeteer.launch({
    headless: visible ? false : 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 900 },
  });
  const page = await browser.newPage();

  console.log('Carregando calculadora NRC...');
  await page.goto(NRC_URL, { waitUntil: 'networkidle0', timeout: 30000 });
  console.log('✓ Pronta\n');
  console.log('  ID            DE    CP   Ca    P    VitA');
  console.log('  ' + '─'.repeat(52));

  const results = [];
  for (const tc of casos) {
    try {
      const r = await runCase(page, tc);
      results.push(r);
    } catch (err) {
      console.log(`  ${tc.id.padEnd(12)} ERRO: ${err.message}`);
      results.push({ id: tc.id, bloco: tc.bloco, erro: err.message });
    }
  }

  await browser.close();

  const jsonOut = path.join(__dirname, 'nrc-results.json');
  const csvOut  = path.join(__dirname, 'nrc-results.csv');
  fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  fs.writeFileSync(csvOut,  toCSV(results));

  const ok  = results.filter(r => !r.erro).length;
  const err = results.filter(r =>  r.erro).length;

  console.log(`\n${'─'.repeat(54)}`);
  console.log(`✅  ${ok} OK   ${err > 0 ? `❌ ${err} erro(s)` : ''}`);
  console.log(`   → ${jsonOut}`);
  console.log(`   → ${csvOut}\n`);

  // Validação rápida dos dois casos já confirmados
  const tm1 = results.find(r => r.id === 'TM1');
  if (tm1 && !tm1.erro) {
    const ok = Math.abs(tm1.DE - 17.25) < 0.1;
    console.log(`   Check TM1 (370kg mod): DE=${tm1.DE} ${ok ? '✓' : '✗ DIVERGE'}`);
  }
  const tl3 = results.find(r => r.id === 'TL3');
  if (tl3 && !tl3.erro) {
    const ok = Math.abs(tl3.DE - 25.97) < 0.1;
    console.log(`   Check TL3 (650kg lev): DE=${tl3.DE} ${ok ? '✓' : '✗ DIVERGE'}\n`);
  }
})();
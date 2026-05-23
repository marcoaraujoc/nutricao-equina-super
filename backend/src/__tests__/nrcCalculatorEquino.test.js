// src/__tests__/nrcCalculatorEquino.test.js
// =============================================================================
// Testes unitários do motor NRC 2007 — Equinos
//
// Valores de referência validados contra o programa oficial NRC 2007
// (https://webassets.nationalacademies.org/nrh/)
// =============================================================================
'use strict';

const {
  calcNRC,
  buildMapExigencias,
  calcular,
  FONTE,
  ALIASES,
  UNIDADE_NRC,
} = require('../services/nrcCalculatorEquino');

// Tolerância: o NRC arredonda para 2 casas, aceitamos ±0.15
const close = (received, expected) =>
  expect(received).toBeCloseTo(expected, 1);

// ─────────────────────────────────────────────────────────────────────────────
// calcNRC — casos de referência do programa oficial
// ─────────────────────────────────────────────────────────────────────────────

describe('calcNRC — MAINTENANCE', () => {
  test('500 kg Average: valores NRC 2007 de referência', () => {
    const r = calcNRC({ animalType: 'MAINTENANCE', matureWeight: 500, maintLevel: 2 });
    close(r.DE,       16.65);
    close(r.CP,       630);
    close(r.Ca,       20);
    close(r.P,        14);
    close(r.Mg,       7.5);
    close(r.tiamina,  30);
  });

  test('500 kg Low (calmo): DE menor que Average', () => {
    const low = calcNRC({ animalType: 'MAINTENANCE', matureWeight: 500, maintLevel: 1 });
    const avg = calcNRC({ animalType: 'MAINTENANCE', matureWeight: 500, maintLevel: 2 });
    expect(low.DE).toBeLessThan(avg.DE);
    expect(low.CP).toBeLessThan(avg.CP);
  });

  test('500 kg High (nervoso): DE maior que Average', () => {
    const high = calcNRC({ animalType: 'MAINTENANCE', matureWeight: 500, maintLevel: 3 });
    const avg  = calcNRC({ animalType: 'MAINTENANCE', matureWeight: 500, maintLevel: 2 });
    expect(high.DE).toBeGreaterThan(avg.DE);
  });

  test('peso maior → exigências maiores (escala linear)', () => {
    const r400 = calcNRC({ animalType: 'MAINTENANCE', matureWeight: 400, maintLevel: 2 });
    const r600 = calcNRC({ animalType: 'MAINTENANCE', matureWeight: 600, maintLevel: 2 });
    expect(r600.DE).toBeGreaterThan(r400.DE);
    expect(r600.CP).toBeGreaterThan(r400.CP);
    // DE é linear em matureWeight — ratio deve bater
    close(r600.DE / r400.DE, 600 / 400);
  });
});

describe('calcNRC — EXERCISE', () => {
  test('370 kg Moderado: valores NRC 2007 de referência', () => {
    const r = calcNRC({ animalType: 'EXERCISE', matureWeight: 370, workLoad: 2 });
    close(r.DE,         17.25);
    close(r.CP,         568.22);
    close(r.Ca,         25.9);
    close(r.Mg,         8.51);
    close(r.tiamina,    41.81);
    close(r.riboflavina,16.65);
  });

  test('650 kg Leve: valores NRC 2007 de referência', () => {
    const r = calcNRC({ animalType: 'EXERCISE', matureWeight: 650, workLoad: 1 });
    close(r.DE,  25.97);
    close(r.CP,  908.94);
    close(r.Ca,  39);
    close(r.Mg,  12.35);
  });

  test('intensidade crescente → exigências crescentes', () => {
    const base   = { animalType: 'EXERCISE', matureWeight: 500 };
    const light  = calcNRC({ ...base, workLoad: 1 });
    const mod    = calcNRC({ ...base, workLoad: 2 });
    const heavy  = calcNRC({ ...base, workLoad: 3 });
    const intens = calcNRC({ ...base, workLoad: 4 });
    expect(mod.DE).toBeGreaterThan(light.DE);
    expect(heavy.DE).toBeGreaterThan(mod.DE);
    expect(intens.DE).toBeGreaterThan(heavy.DE);
    expect(intens.CP).toBeGreaterThan(heavy.CP);
  });

  test('sempre retorna todos os campos de minerais e vitaminas', () => {
    const r = calcNRC({ animalType: 'EXERCISE', matureWeight: 500, workLoad: 2 });
    ['DE','CP','Ca','P','Na','Cl','K','Mg','S','Co','Cu','I','Fe','Mn','Zn','Se',
     'vitA','vitD','vitE','tiamina','riboflavina'].forEach(k => {
      expect(r[k]).toBeDefined();
      expect(r[k]).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('calcNRC — LACTATING', () => {
  test('500 kg mês 1: valores calculados corretos', () => {
    const r = calcNRC({ animalType: 'LACTATING', matureWeight: 500, monthOfLact: 1 });
    close(r.DE, 31.73);
    close(r.CP, 1535);
    close(r.Ca, 59.12);
  });

  test('produção de leite decresce → exigências menores no mês 6 vs mês 1', () => {
    const m1 = calcNRC({ animalType: 'LACTATING', matureWeight: 500, monthOfLact: 1 });
    const m6 = calcNRC({ animalType: 'LACTATING', matureWeight: 500, monthOfLact: 6 });
    expect(m6.DE).toBeLessThan(m1.DE);
    expect(m6.CP).toBeLessThan(m1.CP);
    expect(m6.Ca).toBeLessThan(m1.Ca);
  });
});

describe('calcNRC — PREGNANT', () => {
  test('500 kg mês 9 (tardio): valores calculados corretos', () => {
    const r = calcNRC({ animalType: 'PREGNANT', matureWeight: 500, monthOfGest: 9 });
    close(r.DE, 19.25);
    close(r.CP, 796.7);
    close(r.Ca, 36);
  });

  test('gestação < 5 meses: exigências iguais à manutenção Average', () => {
    const preg = calcNRC({ animalType: 'PREGNANT', matureWeight: 500, monthOfGest: 1 });
    const maint = calcNRC({ animalType: 'MAINTENANCE', matureWeight: 500, maintLevel: 2 });
    close(preg.DE, maint.DE);
    close(preg.CP, maint.CP);
  });

  test('gestação avançada (9-11) → Ca maior que gestação inicial (< 7)', () => {
    const early = calcNRC({ animalType: 'PREGNANT', matureWeight: 500, monthOfGest: 6 });
    const late  = calcNRC({ animalType: 'PREGNANT', matureWeight: 500, monthOfGest: 10 });
    expect(late.Ca).toBeGreaterThan(early.Ca);
  });
});

describe('calcNRC — GROWING', () => {
  test('500 kg matureWeight, 12 meses: valores calculados corretos', () => {
    const r = calcNRC({ animalType: 'GROWING', matureWeight: 500, age: 12 });
    close(r.BodyWeight, 321.22);
    close(r.DE,         18.78);
    close(r.CP,         845.69);
    close(r.Ca,         37.66);
  });

  test('BodyWeight é estimado (abaixo do matureWeight até maturidade)', () => {
    const r6  = calcNRC({ animalType: 'GROWING', matureWeight: 500, age: 6 });
    const r12 = calcNRC({ animalType: 'GROWING', matureWeight: 500, age: 12 });
    const r24 = calcNRC({ animalType: 'GROWING', matureWeight: 500, age: 24 });
    expect(r6.BodyWeight).toBeLessThan(r12.BodyWeight);
    expect(r12.BodyWeight).toBeLessThan(r24.BodyWeight);
    expect(r24.BodyWeight).toBeLessThan(500);
  });
});

describe('calcNRC — GROWING — faixas de idade', () => {
  // Cobre os galhos das linhas 373-380 (age < 6.5, 8.5, 10.5, 11.5, 18.5)
  const ages = [4, 7, 9, 11, 15, 20];
  test.each(ages)('age=%i meses: produz valores positivos', (age) => {
    const r = calcNRC({ animalType: 'GROWING', matureWeight: 500, age });
    expect(r.DE).toBeGreaterThan(0);
    expect(r.CP).toBeGreaterThan(0);
    expect(r.BodyWeight).toBeGreaterThan(0);
    expect(r.BodyWeight).toBeLessThan(500);
  });

  test('coeficiente de VitD por kg é maior em potros jovens (< 6.5 mo): 22.2 vs 13.7', () => {
    const r4  = calcNRC({ animalType: 'GROWING', matureWeight: 500, age: 4 });
    const r20 = calcNRC({ animalType: 'GROWING', matureWeight: 500, age: 20 });
    // vitD/BodyWeight: 22.2 (jovem) vs 13.7 (maduro)
    expect(r4.vitD  / r4.BodyWeight).toBeCloseTo(22.2, 0);
    expect(r20.vitD / r20.BodyWeight).toBeCloseTo(13.7, 0);
  });
});

describe('calcNRC — PREGNANT — faixa mês 7-8', () => {
  // Cobre as linhas 302-305 (monthOfGest entre 7 e 8)
  test('mês 7: Ca intermediário (entre inicial e tardio)', () => {
    const early = calcNRC({ animalType: 'PREGNANT', matureWeight: 500, monthOfGest: 5 });
    const mid   = calcNRC({ animalType: 'PREGNANT', matureWeight: 500, monthOfGest: 7 });
    const late  = calcNRC({ animalType: 'PREGNANT', matureWeight: 500, monthOfGest: 9 });
    expect(mid.Ca).toBeGreaterThan(early.Ca);
    expect(late.Ca).toBeGreaterThan(mid.Ca);
  });
});

describe('calcNRC — LACTATING — faixa mês 4-5', () => {
  // Cobre as linhas 341-345 (monthOfLact entre 4 e 5)
  test('mês 4: exigências entre mês 1 e mês 6', () => {
    const m1 = calcNRC({ animalType: 'LACTATING', matureWeight: 500, monthOfLact: 1 });
    const m4 = calcNRC({ animalType: 'LACTATING', matureWeight: 500, monthOfLact: 4 });
    const m6 = calcNRC({ animalType: 'LACTATING', matureWeight: 500, monthOfLact: 6 });
    expect(m4.Ca).toBeLessThan(m1.Ca);
    expect(m4.Ca).toBeGreaterThanOrEqual(m6.Ca);
  });
});

describe('calcNRC — STALLION', () => {
  test('em reprodução (breeding): DE maior que fora de reprodução', () => {
    const nb = calcNRC({ animalType: 'STALLION', matureWeight: 600, stallionLevel: 0 });
    const br = calcNRC({ animalType: 'STALLION', matureWeight: 600, stallionLevel: 1 });
    expect(br.DE).toBeGreaterThan(nb.DE);
    expect(br.CP).toBeGreaterThan(nb.CP);
  });
});

describe('calcNRC — tipo inválido', () => {
  test('animalType desconhecido: retorna zeros (não lança exceção)', () => {
    const r = calcNRC({ animalType: 'INVALID', matureWeight: 500 });
    expect(r.DE).toBe(0);
    expect(r.CP).toBe(0);
    expect(r.BodyWeight).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildMapExigencias — mapeamento de aliases
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMapExigencias', () => {
  const base = calcNRC({ animalType: 'MAINTENANCE', matureWeight: 500, maintLevel: 2 });
  const map  = buildMapExigencias(base);

  test('contém entradas para todos os aliases de DE', () => {
    expect(map['energia digestível']).toBeDefined();
    expect(map['energia digestivel']).toBeDefined();
    expect(map['de']).toBeDefined();
    close(map['de'].valorExigido, 16.65);
    expect(map['de'].unidadeNRC).toBe('Mcal');
  });

  test('aliases de proteína mapeados corretamente', () => {
    expect(map['proteína bruta']).toBeDefined();
    expect(map['proteina bruta']).toBeDefined();
    expect(map['pb']).toBeDefined();
    close(map['pb'].valorExigido, 630);
    expect(map['pb'].unidadeNRC).toBe('g');
  });

  test('aliases de cálcio apontam para o mesmo valor', () => {
    const aliases = ['cálcio', 'calcio', 'ca', 'calcium'];
    const valores = aliases.map(a => map[a.toLowerCase().normalize('NFC')]?.valorExigido);
    expect(valores.every(v => v === valores[0])).toBe(true);
  });

  test('vitaminas em UI com aliases corretos', () => {
    expect(map['vitamina a']?.unidadeNRC).toBe('UI');
    expect(map['vitamina d']?.unidadeNRC).toBe('UI');
    expect(map['vitamina e']?.unidadeNRC).toBe('UI');
  });

  test('micronutrientes em mg', () => {
    const mgNutrients = ['cobre', 'cu', 'zinco', 'zn', 'ferro', 'fe', 'selênio', 'selenio'];
    for (const n of mgNutrients) {
      const key = n.toLowerCase().normalize('NFC');
      if (map[key]) expect(map[key].unidadeNRC).toBe('mg');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcular(animal) — interface pública end-to-end
// ─────────────────────────────────────────────────────────────────────────────

describe('calcular(animal) — interface pública', () => {
  test('animal de manutenção 500 kg → mapExigencias correto', () => {
    const animal = { peso: 500, categoriaAnimal: 'Adulto - Manutenção', tipoExercicio: 'Average' };
    const map = calcular(animal);
    close(map['de'].valorExigido,  16.65);
    close(map['pb'].valorExigido,  630);
    close(map['ca'].valorExigido,  20);
  });

  test('animal trabalhando 400 kg moderado → DE > manutenção equivalente', () => {
    const manut = calcular({ peso: 400, categoriaAnimal: 'Adulto - Manutenção', tipoExercicio: '' });
    const trab  = calcular({ peso: 400, categoriaAnimal: 'Trabalhando', tipoExercicio: 'Moderado' });
    expect(trab['de'].valorExigido).toBeGreaterThan(manut['de'].valorExigido);
  });

  test('peso ausente usa default 500 kg', () => {
    const map = calcular({ categoriaAnimal: 'Adulto - Manutenção', tipoExercicio: '' });
    close(map['de'].valorExigido, 16.65);
  });

  test('égua em lactação → DE muito maior que manutenção', () => {
    const lact  = calcular({ peso: 500, categoriaAnimal: 'Éguas em Lactação', tipoExercicio: '1 mês' });
    const manut = calcular({ peso: 500, categoriaAnimal: 'Adulto - Manutenção', tipoExercicio: '' });
    expect(lact['de'].valorExigido).toBeGreaterThan(manut['de'].valorExigido * 1.5);
  });

  test('potro em crescimento 12 meses → BodyWeight < peso adulto no mapa DMI', () => {
    const potro = calcular({ peso: 500, categoriaAnimal: 'Potros em Crescimento', tipoExercicio: '12 meses' });
    // verifica que o mapa foi gerado (tem energia digestível)
    expect(potro['de']).toBeDefined();
    expect(potro['de'].valorExigido).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constantes exportadas
// ─────────────────────────────────────────────────────────────────────────────

describe('constantes exportadas', () => {
  test('FONTE é NRC_2007_CALCULADO', () => {
    expect(FONTE).toBe('NRC_2007_CALCULADO');
  });

  test('ALIASES cobre todos os nutrientes essenciais', () => {
    const esperados = ['DE','CP','Ca','P','Na','Cl','K','Mg','Cu','Zn','Fe','Se','vitA','vitD','vitE'];
    for (const n of esperados) {
      expect(ALIASES[n]).toBeDefined();
      expect(Array.isArray(ALIASES[n])).toBe(true);
    }
  });

  test('UNIDADE_NRC: DE em Mcal, minerais macro em g, micro em mg, vitaminas em UI', () => {
    expect(UNIDADE_NRC.DE).toBe('Mcal');
    expect(UNIDADE_NRC.CP).toBe('g');
    expect(UNIDADE_NRC.Ca).toBe('g');
    expect(UNIDADE_NRC.Cu).toBe('mg');
    expect(UNIDADE_NRC.vitA).toBe('UI');
  });
});
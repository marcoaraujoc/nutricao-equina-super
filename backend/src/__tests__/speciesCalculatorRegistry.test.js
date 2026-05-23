// src/__tests__/speciesCalculatorRegistry.test.js
'use strict';

const {
  getCalculator,
  listarEspeciesSuportadas,
} = require('../services/speciesCalculatorRegistry');

describe('getCalculator', () => {
  const nomes_equinos = [
    'Equino', 'Cavalo', 'Horse', 'Pony', 'Égua', 'Egua',
    'Potro', 'Burro', 'Muar', 'EQUINO', 'cavalo árabe',
  ];

  test.each(nomes_equinos)(
    'retorna calculadora para "%s"',
    (nome) => {
      const calc = getCalculator(nome);
      expect(calc).not.toBeNull();
      expect(typeof calc.calcular).toBe('function');
      expect(calc.FONTE).toBe('NRC_2007_CALCULADO');
    }
  );

  test('retorna null para espécie não suportada', () => {
    expect(getCalculator('Bovino')).toBeNull();
    expect(getCalculator('Felino')).toBeNull();
    expect(getCalculator('Cão')).toBeNull();
    expect(getCalculator('')).toBeNull();
    expect(getCalculator(null)).toBeNull();
  });

  test('busca é case-insensitive e ignora acentos parciais', () => {
    expect(getCalculator('CAVALO')).not.toBeNull();
    expect(getCalculator('  Equino  ')).not.toBeNull();
  });

  test('calculadora retornada produz mapExigencias válido', () => {
    const calc   = getCalculator('Equino');
    const animal = { peso: 500, categoriaAnimal: 'Adulto - Manutenção', tipoExercicio: '' };
    const map    = calc.calcular(animal);
    expect(map['de']).toBeDefined();
    expect(map['de'].valorExigido).toBeGreaterThan(0);
    expect(map['de'].unidadeNRC).toBe('Mcal');
  });
});

describe('listarEspeciesSuportadas', () => {
  test('retorna array com pelo menos uma entrada (equinos)', () => {
    const lista = listarEspeciesSuportadas();
    expect(Array.isArray(lista)).toBe(true);
    expect(lista.length).toBeGreaterThanOrEqual(1);
  });

  test('cada entrada tem campos termos (array) e fonte (string)', () => {
    const lista = listarEspeciesSuportadas();
    for (const item of lista) {
      expect(Array.isArray(item.termos)).toBe(true);
      expect(typeof item.fonte).toBe('string');
    }
  });

  test('equinos estão na lista', () => {
    const lista  = listarEspeciesSuportadas();
    const equino = lista.find(i => i.fonte === 'NRC_2007_CALCULADO');
    expect(equino).toBeDefined();
    expect(equino.termos).toContain('caval');
  });
});
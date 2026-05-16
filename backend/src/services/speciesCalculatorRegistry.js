// backend/src/services/speciesCalculatorRegistry.js
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Registry de calculadoras nutricionais por espécie
//
// Cada calculadora deve implementar:
//   calcular(animal) → { [nomeNutrienteNormalizado]: { valorExigido, unidadeNRC } }
//   FONTE            → string identificando a fonte (ex: 'NRC_2007_CALCULADO')
//
// Para adicionar nova espécie:
//   1. Criar `nrcCalculadoraXxx.js` na mesma pasta
//   2. Adicionar entrada em REGISTRY abaixo
// ─────────────────────────────────────────────────────────────────────────────

const equinoCalc = require('./nrcCalculatorEquino');

const REGISTRY = [
  {
    // Equinos: cavalos, éguas, potros, pôneis, burros, muares
    termos: ['equin', 'caval', 'horse', 'pony', 'poni', 'égua', 'egua', 'potro', 'burro', 'muar', 'asin'],
    calc:   equinoCalc,
  },
  // Futuro — descomentar quando implementado:
  // { termos: ['bovin', 'boi', 'vaca', 'cattle'], calc: require('./nrcCalculadoraBovino') },
  // { termos: ['canin', 'cao', 'cão', 'dog'],     calc: require('./nrcCalculadoraCanino')  },
  // { termos: ['felin', 'gato', 'cat'],            calc: require('./nrcCalculadoraFelino')  },
];

/**
 * Retorna a calculadora para a espécie informada.
 * @param {string} especieNome - nome da espécie (campo especie.nome do banco)
 * @returns {object|null} calculadora com método calcular(animal), ou null se não encontrada
 */
const getCalculator = (especieNome) => {
  const nome = (especieNome || '').toLowerCase().normalize('NFC').trim();
  for (const { termos, calc } of REGISTRY) {
    if (termos.some(t => nome.includes(t))) return calc;
  }
  return null; // null = usar tb_exigencias_nrc como fallback
};

/**
 * Lista todas as espécies suportadas por calculadoras dinâmicas
 */
const listarEspeciesSuportadas = () =>
  REGISTRY.map(r => ({ termos: r.termos, fonte: r.calc.FONTE }));

module.exports = { getCalculator, listarEspeciesSuportadas };
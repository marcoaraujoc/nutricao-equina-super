'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  // ⚠️ `dist/` guarda uma CÓPIA compilada dos testes, e sem esta linha o jest roda cada um
  // DUAS vezes — a fonte e o retrato do último build. Além de dobrar o tempo (e as
  // consultas ao banco), é armadilha: editar o teste em `src/` e ver a cópia velha de
  // `dist/` reprovando (ou, pior, passando) ensina o time a ignorar a suíte.
  // Vale em especial para o gate de tenancy, que precisa ser confiável para servir de trava.
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  collectCoverageFrom: [
    'src/services/nrcCalculatorEquino.js',
    'src/services/speciesCalculatorRegistry.js',
  ],
  coverageThreshold: {
    global: { lines: 80, functions: 80 },
  },
};
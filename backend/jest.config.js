'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/services/nrcCalculatorEquino.js',
    'src/services/speciesCalculatorRegistry.js',
  ],
  coverageThreshold: {
    global: { lines: 80, functions: 80 },
  },
};
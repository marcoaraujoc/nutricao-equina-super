// backend/src/__tests__/telasSobDemanda.test.js
//
// O que este arquivo protege: as telas do frontend são carregadas SOB DEMANDA
// (`React.lazy` no App.tsx, 2026-10-09) — o arquivo principal caiu de 3,3 MB para
// ~380 KB. Basta UM `import Tela from './pages/Tela'` estático no App.tsx para aquela
// tela (e tudo o que ela importa) voltar para o arquivo principal. Nada quebra: a tela
// funciona igual, só o primeiro acesso volta a ficar lento — por isso o gate.

'use strict';

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..', '..', '..', 'frontend', 'src');
const app  = fs.readFileSync(path.join(raiz, 'App.tsx'), 'utf8');
const main = fs.readFileSync(path.join(raiz, 'main.tsx'), 'utf8');

// Só o Login fica no arquivo principal: é a porta de entrada.
const EAGER_PERMITIDAS = ['Login'];

describe('telas carregadas sob demanda', () => {
  test('App.tsx não importa tela de forma estática (exceto o Login)', () => {
    const estaticas = [...app.matchAll(/^import\s+(\w+)\s+from\s+'\.\/pages\/[^']+';/gm)]
      .map(m => m[1])
      .filter(nome => !EAGER_PERMITIDAS.includes(nome));
    expect(estaticas).toEqual([]);
  });

  test('as telas usam React.lazy e as rotas ficam dentro de <Suspense>', () => {
    expect((app.match(/lazy\(\(\) => import\('\.\/pages\//g) || []).length).toBeGreaterThan(50);
    expect(app).toMatch(/<Suspense fallback=/);
  });

  test('main.tsx recarrega quando um arquivo de tela sumiu depois de um deploy', () => {
    expect(main).toMatch(/addEventListener\('vite:preloadError'/);
    // e com freio contra laço de reload
    expect(main).toMatch(/60_000/);
  });
});

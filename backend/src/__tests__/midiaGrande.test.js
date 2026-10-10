// ARQUIVO GRANDE NO BANCO (2026-10-09).
//
// Toda escrita/leitura avulsa passa pelo carimbo de tenant (lib/prismaTenant.js), que a
// embrulha numa transação com o timeout PADRÃO do Prisma: 5 s. Reproduzido contra o
// banco real: gravar um MP4 de 89 MB levou 6,7 s e morreu com "Transaction already
// closed ... timeout 5000 ms" — o anexo da evolução saía "Erro interno" e NUNCA entrava.
// Com transação própria de 90 s, os mesmos 89 MB gravaram em 8,6 s.
'use strict';

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
const { parseRange, FATIA_MAXIMA } = require('../lib/midiaEnvio');

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('gate — arquivo grande não roda na transação de 5 s', () => {
  test('🔴 o upload grava numa transação própria com prazo longo', () => {
    const src = ler('storage/DbStorageProvider.ts');
    expect(src).toMatch(/prisma\.\$transaction\(\(tx\) => tx\.midiaArquivo\.create\(/);
    expect(src).toMatch(/timeout:\s*90_000/);
  });

  test('o download completo (sem Range) também', () => {
    const src = ler('lib/midiaEnvio.js');
    expect(src).toMatch(/prisma\.\$transaction\(\(tx\) => tx\.midiaArquivo\.findUnique\(/);
  });
});

describe('parseRange — nenhuma resposta passa da fatia máxima', () => {
  const MB = 1024 * 1024;
  const total = 89 * MB;

  test('🔴 `bytes=0-` (primeiro pedido do player) devolve só a primeira fatia', () => {
    expect(parseRange('bytes=0-', total)).toEqual({ inicio: 0, fim: FATIA_MAXIMA - 1 });
  });

  test('o seek no meio continua funcionando, também limitado', () => {
    const r = parseRange(`bytes=${50 * MB}-`, total);
    expect(r.inicio).toBe(50 * MB);
    expect(r.fim - r.inicio + 1).toBe(FATIA_MAXIMA);
  });

  test('fim do arquivo não passa do tamanho', () => {
    expect(parseRange(`bytes=${total - 10}-`, total)).toEqual({ inicio: total - 10, fim: total - 1 });
  });

  test('faixa pequena pedida é servida exata', () => {
    expect(parseRange('bytes=0-1', total)).toEqual({ inicio: 0, fim: 1 });
  });

  test('sufixo (últimos N bytes) segue valendo', () => {
    expect(parseRange('bytes=-100', total)).toEqual({ inicio: total - 100, fim: total - 1 });
  });
});

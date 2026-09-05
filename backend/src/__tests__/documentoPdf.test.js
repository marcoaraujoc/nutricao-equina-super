// backend/src/__tests__/documentoPdf.test.js
//
// 🔴 O QUE ESTE ARQUIVO PROTEGE: o PDF que sai daqui precisa ser um `Buffer`.
//
// Defeito de 2026-09-05: a partir do Puppeteer 23, `page.pdf()` devolve
// `Uint8Array` — e `Uint8Array.prototype.toString('base64')` IGNORA o argumento e
// devolve os bytes separados por vírgula ("37,80,68,70,..."). Nada lança: cada
// consumidor recebe uma string plausível que não é base64 de coisa nenhuma. A
// Evolution recusava todo documento com 400 "Owned media must be a url or base64"
// e o anexo do e-mail saía corrompido — enquanto a tela dizia apenas "PDF baixado,
// anexe na conversa".
//
// É o tipo de defeito que só volta numa atualização de dependência, meses depois,
// e some de novo no meio de um fallback silencioso. Por isso mora num teste.
'use strict';

jest.mock('../lib/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

// Chromium de verdade custa segundos e nem sempre existe no CI. O que importa aqui
// é o CONTRATO: qualquer coisa que `page.pdf()` devolva sai daqui como Buffer.
// Prefixo `mock`: o babel-jest só permite a fábrica de `jest.mock` referenciar
// variáveis externas quando o nome começa por "mock" (guarda contra mock não
// inicializado — a fábrica roda antes das declarações do módulo).
const mockPagina = {
  setJavaScriptEnabled: jest.fn(),
  setRequestInterception: jest.fn(),
  on: jest.fn(),
  setContent: jest.fn(),
  pdf: jest.fn(),
};
const mockNavegador = { newPage: jest.fn(async () => mockPagina), close: jest.fn() };
jest.mock('puppeteer', () => ({ launch: jest.fn(async () => mockNavegador) }), { virtual: true });

const { htmlParaPdf } = require('../services/documentoWhatsappService');

// Assinatura de um PDF de verdade: "%PDF-1.4" → base64 começa com "JVBERi0x".
const BYTES_PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];

beforeEach(() => jest.clearAllMocks());

describe('htmlParaPdf devolve sempre um Buffer', () => {
  test('🔴 Uint8Array (Puppeteer ≥ 23) é normalizado — senão o base64 vira "37,80,68,..."', async () => {
    mockPagina.pdf.mockResolvedValue(Uint8Array.from(BYTES_PDF));

    const pdf = await htmlParaPdf('<html><body>x</body></html>');

    expect(Buffer.isBuffer(pdf)).toBe(true);
    // É ESTA linha que reprova o defeito: com Uint8Array cru daria "37,80,68,70,...".
    expect(pdf.toString('base64')).toBe('JVBERi0xLjQ=');
    expect(pdf.toString('base64')).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  test('Buffer (Puppeteer < 23) continua passando sem cópia desnecessária', async () => {
    const original = Buffer.from(BYTES_PDF);
    mockPagina.pdf.mockResolvedValue(original);

    const pdf = await htmlParaPdf('<html><body>x</body></html>');

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf).toBe(original);
  });

  test('o navegador é fechado mesmo quando a geração falha', async () => {
    // O Chromium é um PROCESSO: sem este `finally`, cada falha deixa um vazando.
    mockPagina.pdf.mockRejectedValue(new Error('boom'));

    await expect(htmlParaPdf('<html></html>')).rejects.toThrow('boom');
    expect(mockNavegador.close).toHaveBeenCalled();
  });
});

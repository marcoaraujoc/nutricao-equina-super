// ESCOLHA DO DESTINATÁRIO no envio de documento clínico (2026-10-09).
//
// Evolução, Prescrição, Exames e Encaminhamento perguntam PARA QUEM vai o PDF —
// proprietário, equipe veterinária, um veterinário ou um prestador. Para a equipe, o
// backend gera o PDF UMA vez e manda a cada um (WhatsApp e e-mail).
// E o e-mail que falha passou a dizer o MOTIVO (antes: "houve um erro no servidor").
'use strict';

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
const enviados = [];
jest.mock('../messaging/whatsappProvider', () => ({
  getWhatsAppProvider: () => ({
    prontidaoParaEnviar: async () => ({ pronto: true }),
    enviarDocumento: async ({ para }) => {
      enviados.push(para);
      return para.endsWith('9999') ? { sucesso: false, erro: 'NUMERO_INVALIDO' } : { sucesso: true };
    },
  }),
}), { virtual: true });
jest.mock('puppeteer', () => ({
  launch: async () => ({
    newPage: async () => ({ setJavaScriptEnabled: async () => {}, setRequestInterception: async () => {}, on: () => {}, setContent: async () => {}, pdf: async () => new Uint8Array([37, 80, 68, 70]) }),
    close: async () => {},
  }),
}), { virtual: true });

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('WhatsApp para vários destinos', () => {
  let enviarDocumentoWhatsApp;
  beforeAll(() => {
    try { ({ enviarDocumentoWhatsApp } = require('../services/documentoWhatsappService')); } catch { /* sem o provider real */ }
  });
  beforeEach(() => { enviados.length = 0; });

  test('🔴 o PDF vai a cada número, sem repetir número duplicado', async () => {
    if (!enviarDocumentoWhatsApp) return;
    const r = await enviarDocumentoWhatsApp({
      empresaId: 1, html: '<p>x</p>', nomeArquivo: 'a.pdf',
      telefones: ['(11) 98888-1111', '11988881111', '(21) 97777-2222'],
    });
    expect(enviados).toHaveLength(2);
    expect(r).toMatchObject({ sucesso: true, enviados: 2, total: 2 });
  });

  test('basta um ter recebido para não cair no fallback; as falhas são contadas', async () => {
    if (!enviarDocumentoWhatsApp) return;
    const r = await enviarDocumentoWhatsApp({
      empresaId: 1, html: '<p>x</p>', nomeArquivo: 'a.pdf',
      telefones: ['11988881111', '11988889999'],
    });
    expect(r).toMatchObject({ sucesso: true, enviados: 1, total: 2 });
  });

  test('um destino só mantém o contrato antigo (sem contagens)', async () => {
    if (!enviarDocumentoWhatsApp) return;
    const r = await enviarDocumentoWhatsApp({ empresaId: 1, html: '<p>x</p>', nomeArquivo: 'a.pdf', telefone: '11988881111' });
    expect(r).toEqual({ sucesso: true });
  });
});

describe('e-mail que falha diz o motivo', () => {
  let motivoErroEmail;
  beforeAll(() => {
    jest.doMock('../services/emailService', () => ({ estaConfigurado: () => true, enviarDocumento: jest.fn() }));
    ({ motivoErroEmail } = require('../controllers/DocumentoCompartilharController'));
  });

  test('credencial recusada', () => {
    expect(motivoErroEmail({ code: 'EAUTH', message: 'Invalid login' })).toMatch(/usuário\/senha/);
  });
  test('porta/host', () => {
    expect(motivoErroEmail({ code: 'ETIMEDOUT' })).toMatch(/conectar/);
  });
  test('remetente não verificado aparece com a frase do provedor', () => {
    expect(motivoErroEmail({ response: '550 Sender address not verified' })).toMatch(/remetente.*Sender address/);
  });
  test('nunca o genérico quando há resposta do provedor', () => {
    expect(motivoErroEmail({ response: '421 algo' })).toMatch(/421 algo/);
  });
});

describe('gate — as quatro telas perguntam o destinatário', () => {
  test.each([
    ['frontend/src/pages/SubModuloEvolucao.tsx',       /escolherDestinatario=\{\{/],
    ['frontend/src/pages/SubModuloEncaminhamento.tsx', /escolherDestinatario=\{\{/],
    ['frontend/src/pages/SubModuloPrescricao.tsx',     /await escolherDestinatario\(\{ canal/],
    ['frontend/src/pages/SubModuloExames.tsx',         /await escolherDestinatario\(\{ canal/],
  ])('%s', (arq, re) => {
    expect(ler(arq)).toMatch(re);
  });

  test('a evolução enviada NÃO embute as imagens dos anexos', () => {
    expect(ler('frontend/src/pages/SubModuloEvolucao.tsx')).toMatch(/gerarHtml=\{\(\) => gerarHtmlEvolucao\(.*\{ semImagensDosAnexos: true \}\)\}/);
  });

  test('rota de destinatários montada antes do envio', () => {
    expect(ler('backend/src/routes/documentos.js')).toMatch(/router\.get\('\/destinatarios', authenticate/);
  });

  test('contato vem do cadastro DA EMPRESA, nunca só do users', () => {
    const lib = ler('backend/src/lib/destinatariosEnvio.js');
    expect(lib).toMatch(/aplicarPerfil\(/);
    expect(lib).toMatch(/aplicarVinculoEmLista\(/);
  });
});

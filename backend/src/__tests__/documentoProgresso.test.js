// backend/src/__tests__/documentoProgresso.test.js
//
// 🔴 O QUE ESTE ARQUIVO PROTEGE: a barra de progresso do envio mostra PERCENTUAL
// REAL. Cada valor que chega à tela corresponde a um marco que aconteceu aqui —
// prontidão conferida, PDF gerado (com o tamanho medido), mensagem aceita. A
// alternativa seria preencher a barra por estimativa de relógio, o que produz um
// número bonito e falso; "nada de inventar valor" é regra do projeto.
//
// Também trava o CONTRATO ANTIGO: sem `Accept: application/x-ndjson` a rota
// continua devolvendo um JSON único. Quebrar isso silenciosamente deixaria todo
// consumidor que não pede stream lendo texto onde esperava objeto.
'use strict';

jest.mock('../lib/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
jest.mock('../services/documentoWhatsappService', () => ({
  enviarDocumentoWhatsApp: jest.fn(),
  htmlParaPdf: jest.fn(),
}));
jest.mock('../services/emailService', () => ({
  estaConfigurado: jest.fn(() => true),
  enviarDocumento: jest.fn(),
}));

const { enviarDocumentoWhatsApp, htmlParaPdf } = require('../services/documentoWhatsappService');
const emailService = require('../services/emailService');
const controller   = require('../controllers/DocumentoCompartilharController');

/** `res` falso que grava o que foi escrito, para inspecionar o NDJSON linha a linha. */
function resFalso() {
  const r = {
    chunks: [], statusCode: 200, headers: {}, encerrado: false, corpoJson: null,
    writableEnded: false,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    flushHeaders() {},
    write(c) { this.chunks.push(c); return true; },
    end() { this.encerrado = true; this.writableEnded = true; },
    json(o) { this.corpoJson = o; return this; },
  };
  return r;
}

const linhas = (res) => res.chunks.join('').trim().split('\n').filter(Boolean).map(JSON.parse);

const reqBase = (extra = {}) => ({
  body: { telefone: '21999998888', html: '<html></html>', nomeArquivo: 'doc.pdf', legenda: 'oi' },
  empresaId: 58, equipeId: 57, user: { id: 1 }, headers: {},
  on() { /* sem ouvinte por padrao */ }, ...extra,
});

beforeEach(() => jest.clearAllMocks());

describe('WhatsApp — progresso por marcos reais', () => {
  test('🔴 cada pct vem de um marco do serviço, e o veredito fecha o stream', async () => {
    // O serviço é quem sabe o que aconteceu: o controller só repassa.
    enviarDocumentoWhatsApp.mockImplementation(async ({ onProgresso }) => {
      onProgresso(15, 'Verificando o WhatsApp da clínica');
      onProgresso(25, 'Gerando o PDF');
      onProgresso(70, 'PDF pronto (48 KB)');
      onProgresso(85, 'Enviando ao WhatsApp');
      onProgresso(100, 'Enviado');
      return { sucesso: true };
    });

    const res = resFalso();
    await controller.whatsapp(reqBase({ headers: { accept: 'application/x-ndjson' } }), res);

    const ls = linhas(res);
    expect(ls.map(l => l.pct).filter(p => p !== undefined)).toEqual([5, 15, 25, 70, 85, 100]);
    // Nunca anda para trás: uma barra que recua é pior que uma que não anda.
    const pcts = ls.filter(l => l.tipo === 'progresso').map(l => l.pct);
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
    expect(ls.at(-1)).toEqual({ tipo: 'fim', sucesso: true, simulado: false });
    expect(res.encerrado).toBe(true);
    expect(res.headers['content-type']).toMatch('application/x-ndjson');
  });

  test('🔴 falha vai na linha `fim` COM motivo — o HTTP fica 200 e não carrega veredito', async () => {
    // O status é enviado junto do primeiro chunk e não pode mais ser trocado: quem
    // ler o código HTTP em vez da linha `fim` conclui "deu certo" numa falha.
    enviarDocumentoWhatsApp.mockResolvedValue({ sucesso: false, erro: 'DESCONECTADO' });

    const res = resFalso();
    await controller.whatsapp(reqBase({ headers: { accept: 'application/x-ndjson' } }), res);

    const fim = linhas(res).at(-1);
    expect(res.statusCode).toBe(200);
    expect(fim.sucesso).toBe(false);
    expect(fim.motivo).toMatch(/desconectado/i);
  });

  test('sem Accept ndjson, a resposta continua sendo o JSON único de sempre', async () => {
    enviarDocumentoWhatsApp.mockResolvedValue({ sucesso: true });

    const res = resFalso();
    await controller.whatsapp(reqBase(), res);

    expect(res.chunks).toHaveLength(0);
    expect(res.corpoJson).toEqual({ sucesso: true, simulado: false });
  });
});

describe('Cancelamento — o servidor precisa parar de verdade', () => {
  test('🔴 cliente que desiste ANTES do envio nao tem a mensagem entregue', async () => {
    // Sem esta consulta, "Cancelar" seria de fachada: o front pararia de esperar,
    // o PDF continuaria sendo gerado e o documento chegaria ao cliente com a tela
    // dizendo "cancelado".
    let entregue = false;
    enviarDocumentoWhatsApp.mockImplementation(async ({ cancelado }) => {
      // Cede o controle antes de consultar: no envio real, o clique em Cancelar cai
      // no meio dos segundos do Puppeteer, nunca no mesmo tick da chamada.
      await new Promise(r => setImmediate(r));
      if (cancelado()) return { sucesso: false, erro: 'CANCELADO' };
      entregue = true;
      return { sucesso: true };
    });

    const res = resFalso();
    const req = reqBase({ headers: { accept: 'application/x-ndjson' } });
    const ouvintes = {};
    req.on = (ev, fn) => { ouvintes[ev] = fn; };

    const p = controller.whatsapp(req, res);
    ouvintes.close?.();          // o usuario clicou em Cancelar: o socket fechou
    await p;

    expect(entregue).toBe(false);
    // Cliente ja foi embora — nao se escreve veredito num socket fechado.
    expect(linhas(res).some(l => l.tipo === 'fim')).toBe(false);
  });

  test('o fim NORMAL da resposta nao e confundido com desistencia', async () => {
    // `close` no request dispara tambem no fim normal; quem separa os dois e
    // `res.writableEnded`. Sem isso, TODO envio bem-sucedido viraria "cancelado".
    let viuCancelado = null;
    enviarDocumentoWhatsApp.mockImplementation(async ({ cancelado }) => {
      viuCancelado = cancelado();
      return { sucesso: true };
    });

    const res = resFalso();
    const req = reqBase({ headers: { accept: 'application/x-ndjson' } });
    const ouvintes = {};
    req.on = (ev, fn) => { ouvintes[ev] = fn; };

    await controller.whatsapp(req, res);
    res.writableEnded = true;    // a resposta terminou normalmente
    ouvintes.close?.();          // e so entao o socket fechou

    expect(viuCancelado).toBe(false);
    expect(linhas(res).at(-1).sucesso).toBe(true);
  });
});

describe('E-mail — mesmo contrato', () => {
  test('marca o PDF pronto com o tamanho REAL medido do buffer', async () => {
    htmlParaPdf.mockResolvedValue(Buffer.alloc(48 * 1024));
    emailService.enviarDocumento.mockResolvedValue(undefined);

    const res = resFalso();
    await controller.email({
      body: { email: 'a@b.com', assunto: 'x', corpo: 'y', html: '<html></html>', nomeArquivo: 'd.pdf' },
      empresaId: 58, user: { id: 1 }, headers: { accept: 'application/x-ndjson' },
    }, res);

    const ls = linhas(res);
    expect(ls.find(l => l.pct === 70).etapa).toBe('PDF pronto (48 KB)');
    expect(ls.at(-1)).toEqual({ tipo: 'fim', sucesso: true });
  });

  test('sem SMTP nao abre stream nenhum — barra que nasce e morre no mesmo instante e ruido', async () => {
    emailService.estaConfigurado.mockReturnValue(false);

    const res = resFalso();
    await controller.email({
      body: { email: 'a@b.com', html: '<html></html>', nomeArquivo: 'd.pdf' },
      empresaId: 58, user: { id: 1 }, headers: { accept: 'application/x-ndjson' },
    }, res);

    expect(res.chunks).toHaveLength(0);
    expect(res.corpoJson.code).toBe('EMAIL_NAO_CONFIGURADO');
  });
});

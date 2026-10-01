// backend/src/__tests__/whatsappProntidao.test.js
//
// 🔴 O QUE ESTE ARQUIVO PROTEGE (2026-09-30): antes de mandar um WhatsApp, a tela
// pergunta ao backend se o SERVIÇO da clínica está ativo (`GET /equipes/whatsapp/
// prontidao`). Duas coisas não podem regredir:
//   1. MULTI-TENANT — a empresa consultada é SEMPRE a do contexto autenticado
//      (`req.empresaId`); um `empresaId` no query/body é ignorado.
//   2. Serviço inativo responde `pronto: false` com a frase de ATIVAÇÃO, e o front
//      (utils/compartilharPdf.ts) para ali, sem gerar PDF nem abrir o plano B.
'use strict';

const fs   = require('fs');
const path = require('path');

const mockProntidao = jest.fn();
jest.mock('../messaging/whatsappProvider', () => ({
  getWhatsAppProvider: () => ({ prontidaoParaEnviar: mockProntidao }),
}));
jest.mock('../services/whatsappService', () => ({}));
jest.mock('../services/EvolutionService', () => ({ configurado: () => true }));
const mockEscopo = jest.fn();
jest.mock('../controllers/EquipeController', () => ({ resolverEscopoConfiguracao: (...a) => mockEscopo(...a) }));

const WhatsappController = require('../controllers/WhatsappController');

function chamar(req) {
  return new Promise((resolve) => {
    const res = { json: (b) => resolve(b), status() { return this; } };
    WhatsappController.prontidao(req, res);
  });
}

beforeEach(() => { jest.clearAllMocks(); mockEscopo.mockResolvedValue(null); });

test('consulta a empresa do CONTEXTO, nunca a do cliente', async () => {
  mockProntidao.mockResolvedValue({ pronto: true });
  const r = await chamar({ empresaId: 42, equipeId: null, query: { empresaId: 99 }, body: { empresaId: 99 }, user: { id: 1 } });
  expect(mockProntidao).toHaveBeenCalledWith({ empresaId: 42, equipeId: null });
  expect(r.dados).toMatchObject({ pronto: true, motivo: null, mensagem: null });
});

test('sem empresa no contexto: não consulta nada e responde não-pronto', async () => {
  const r = await chamar({ empresaId: null, user: { id: 1 } });
  expect(mockProntidao).not.toHaveBeenCalled();
  expect(r.dados.pronto).toBe(false);
  expect(r.dados.motivo).toBe('SEM_EMPRESA');
});

test.each(['NAO_PROVISIONADO', 'DESCONECTADO', 'AGUARDANDO_QR'])(
  'serviço %s → pronto:false com a frase de ATIVAÇÃO', async (motivo) => {
    mockProntidao.mockResolvedValue({ pronto: false, motivo });
    const r = await chamar({ empresaId: 42, user: { id: 1 } });
    expect(r.dados.pronto).toBe(false);
    expect(r.dados.motivo).toBe(motivo);
    expect(r.dados.mensagem).toMatch(/ativ/i);
    expect(r.dados.podeAtivar).toBe(false);
  });

test('gestor/dono recebe podeAtivar = true', async () => {
  mockProntidao.mockResolvedValue({ pronto: false, motivo: 'DESCONECTADO' });
  mockEscopo.mockResolvedValue({ empresaId: 42, equipeId: null });
  const r = await chamar({ empresaId: 42, user: { id: 1 } });
  expect(r.dados.podeAtivar).toBe(true);
});

test('falha ao consultar NÃO vira "pronto"', async () => {
  mockProntidao.mockRejectedValue(new Error('ECONNREFUSED'));
  const r = await chamar({ empresaId: 42, user: { id: 1 } });
  expect(r.dados.pronto).toBe(false);
  expect(r.dados.motivo).toBe('SERVIDOR_INDISPONIVEL');
});

test('o front confere o serviço ANTES de gerar o PDF / cair no plano B', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../frontend/src/utils/compartilharPdf.ts'), 'utf8');
  const corpo = src.slice(src.indexOf('export async function compartilharPdfWhatsApp'));
  const iServico = corpo.indexOf('verificarServicoWhatsApp()');
  expect(iServico).toBeGreaterThan(-1);
  expect(iServico).toBeLessThan(corpo.indexOf("postComProgresso('/documentos/whatsapp'"));
  expect(iServico).toBeLessThan(corpo.indexOf('baixarPdfNoNavegador('));
  const orc = fs.readFileSync(path.join(__dirname, '../../../frontend/src/pages/Orcamento.tsx'), 'utf8');
  const envio = orc.slice(orc.indexOf('const enviarWhatsApp = async'));
  expect(envio.indexOf('verificarServicoWhatsApp()')).toBeLessThan(envio.indexOf('enviar-whatsapp'));
});

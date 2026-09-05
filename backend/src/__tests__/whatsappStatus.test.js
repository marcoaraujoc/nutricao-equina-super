// backend/src/__tests__/whatsappStatus.test.js
//
// 🔴 O QUE ESTE ARQUIVO PROTEGE: "não sei" nunca pode se disfarçar de "conectado".
//
// Defeito relatado em 2026-09-05: com o servidor da Evolution DESLIGADO, a tela de
// Configurações mostrava a luz verde e "WhatsApp conectado". Causa: `obterStatus`
// tinha um `catch` que devolvia o último status GRAVADO no banco — e o último
// gravado é justamente `CONECTADO`. O estrago não era só cosmético:
// `prontidaoParaEnviar` (então `estaProntoParaEnviar`) comparava com 'CONECTADO',
// respondia SIM, e o envio de
// documento subia um Chromium para gerar o PDF inteiro antes de falhar.
//
// Este é o tipo de defeito que nenhum teste de tela pega: tudo "funciona",
// só que mente.

'use strict';

jest.mock('../lib/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
jest.mock('../lib/prisma', () => ({
  default: {
    $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn(),
    // `resolverEscopoClinica` (usado por sendMessage) lê a empresa pelo client
    // tipado; com CNPJ o escopo é a empresa e equipeId fica null.
    empresa: { findUnique: jest.fn() },
    equipe:  { findFirst: jest.fn() },
  },
}));
jest.mock('../services/EvolutionService', () => ({
  getStatus: jest.fn(), configurado: jest.fn(() => true),
  createInstance: jest.fn(), connect: jest.fn(), logout: jest.fn(), restart: jest.fn(),
  sendText: jest.fn(), sendMedia: jest.fn(),
}));

const prisma           = require('../lib/prisma').default;
const EvolutionService = require('../services/EvolutionService');
const whatsappService  = require('../services/whatsappService');

const CONFIG_CONECTADA = {
  id: 7, whatsapp: '11988887777', waInstance: 's2vet_e42',
  waStatus: 'CONECTADO', waStatusEm: new Date('2026-09-05T10:00:00Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$queryRawUnsafe.mockResolvedValue([CONFIG_CONECTADA]);
  prisma.$executeRawUnsafe.mockResolvedValue(1);
  prisma.empresa.findUnique.mockResolvedValue({ id: 42, cnpj: '12345678000199' });
});

describe('obterStatus — Evolution fora do ar', () => {
  test('🔴 NÃO devolve CONECTADO quando a Evolution não responde', async () => {
    EvolutionService.getStatus.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8080'));
    const r = await whatsappService.obterStatus(42, null);
    expect(r.status).toBe('SERVIDOR_INDISPONIVEL');
    expect(r.status).not.toBe('CONECTADO');
  });

  test('preserva o último status conhecido em `statusPersistido` (contexto, não promessa)', async () => {
    EvolutionService.getStatus.mockRejectedValue(new Error('timeout'));
    const r = await whatsappService.obterStatus(42, null);
    expect(r.statusPersistido).toBe('CONECTADO');
  });

  test('NÃO grava o estado degradado — a queda de 30s não apaga a sessão pareada', async () => {
    EvolutionService.getStatus.mockRejectedValue(new Error('timeout'));
    await whatsappService.obterStatus(42, null);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  test('resposta SEM estado também não vira CONECTADO', async () => {
    // Evolution respondeu, mas não sobre esta instância (removida do servidor).
    EvolutionService.getStatus.mockResolvedValue({});
    const r = await whatsappService.obterStatus(42, null);
    expect(r.status).toBe('SERVIDOR_INDISPONIVEL');
  });
});

describe('obterStatus — caminho normal', () => {
  test('estado ao vivo VENCE o persistido: open -> CONECTADO', async () => {
    EvolutionService.getStatus.mockResolvedValue({ instance: { state: 'open' } });
    const r = await whatsappService.obterStatus(42, null);
    expect(r.status).toBe('CONECTADO');
  });

  test('sessão caiu de verdade: close -> DESCONECTADO, e o banco é atualizado', async () => {
    EvolutionService.getStatus.mockResolvedValue({ instance: { state: 'close' } });
    const r = await whatsappService.obterStatus(42, null);
    expect(r.status).toBe('DESCONECTADO');
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled(); // sincroniza o persistido
  });

  test('connecting -> AGUARDANDO_QR', async () => {
    EvolutionService.getStatus.mockResolvedValue({ state: 'connecting' });
    const r = await whatsappService.obterStatus(42, null);
    expect(r.status).toBe('AGUARDANDO_QR');
  });

  test('sem instância provisionada -> NAO_PROVISIONADO, sem chamar a Evolution', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ id: 7, whatsapp: null, waInstance: null }]);
    const r = await whatsappService.obterStatus(42, null);
    expect(r.status).toBe('NAO_PROVISIONADO');
    expect(EvolutionService.getStatus).not.toHaveBeenCalled();
  });
});

describe('o envio respeita o estado real', () => {
  test('🔴 provider NÃO se diz pronto com a Evolution fora do ar — e DIZ o motivo', async () => {
    // É este `pronto: false` que impede o Puppeteer de gerar um PDF que não tem como
    // sair — e que preserva a janela de "user activation" do navegador para o
    // fallback manual (baixar o PDF + abrir o app). Ver utils/compartilharPdf.ts.
    // O `motivo` é o que faz a tela distinguir "a Evolution está fora" de "a clínica
    // nunca conectou o WhatsApp": sem ele os dois viravam o mesmo silêncio.
    EvolutionService.getStatus.mockRejectedValue(new Error('ECONNREFUSED'));
    process.env.WHATSAPP_PROVIDER = 'evolution';
    jest.resetModules();
    const { getWhatsAppProvider } = require('../messaging/whatsappProvider');
    const r = await getWhatsAppProvider().prontidaoParaEnviar({ empresaId: 42, equipeId: null });
    expect(r.pronto).toBe(false);
    expect(r.motivo).toBe('SERVIDOR_INDISPONIVEL');
  });

  test('sendMessage recusa com código PRÓPRIO — "reconecte" não resolveria', async () => {
    // `WHATSAPP_DESCONECTADO` manda o gestor ler um QR Code; sem servidor, não há
    // QR para gerar. São problemas diferentes e a tela precisa dizer qual é.
    EvolutionService.getStatus.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await whatsappService.sendMessage({ empresaId: 42, equipeId: null }, '11988887777', 'oi');
    expect(r.sucesso).toBe(false);
    expect(r.erro).toBe('WHATSAPP_SERVIDOR_INDISPONIVEL');
    expect(EvolutionService.sendText).not.toHaveBeenCalled();
  });
});

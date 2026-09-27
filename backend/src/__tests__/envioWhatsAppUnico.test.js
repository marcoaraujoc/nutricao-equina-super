'use strict';

/**
 * O WHATSAPP DA FATURA SAI POR UM COMPONENTE SÓ, E PARA UM DESTINO SÓ (2026-09-26).
 *
 * Defeito relatado: o fechamento em LOTE mandava o PDF anexado, e a fatura ABERTA e
 * a fatura POR PACIENTE abriam o WhatsApp do desktop sem anexo. Os três botões
 * chamavam a mesma função de envio — o que divergia era o TELEFONE: o lote usava o do
 * LOGIN (`users.phone`) e o painel o do CADASTRO da empresa. Cliente com o cadastro sem
 * telefone ficava sem destino no painel, e o envio caía no plano B em silêncio.
 */

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../storage', () => ({ storage: { upload: jest.fn() }, chaveDaUrl: () => null }), { virtual: true });
jest.mock('../services/documentoWhatsappService', () => ({ htmlParaPdf: jest.fn() }), { virtual: true });
jest.mock('../services/whatsappService', () => ({}), { virtual: true });
jest.mock('../services/emailService', () => ({}), { virtual: true });
jest.mock('../lib/notificationDispatch', () => ({ enfileirarEnvioFatura: jest.fn() }), { virtual: true });
jest.mock('../lib/faturaLinkPublico', () => ({ criarLink: jest.fn(), revogar: jest.fn() }), { virtual: true });

const fs = require('fs');
const path = require('path');
const { telefoneDeEnvio } = require('../controllers/FaturaController');

const raiz = path.join(__dirname, '..', '..', '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('telefoneDeEnvio — o destino do WhatsApp', () => {
  it('prefere o telefone do cadastro DESTA empresa', () => {
    expect(telefoneDeEnvio('(21) 99463-4063', '(21) 99432-8820')).toBe('(21) 99463-4063');
  });

  it('cadastro da empresa sem telefone cai no do login (o caso que abria o desktop)', () => {
    expect(telefoneDeEnvio(null, '(21) 99432-8820')).toBe('(21) 99432-8820');
    expect(telefoneDeEnvio('', '(21) 99432-8820')).toBe('(21) 99432-8820');
  });

  it('telefone incompleto não é destino', () => {
    expect(telefoneDeEnvio('123', '(21) 99432-8820')).toBe('(21) 99432-8820');
    expect(telefoneDeEnvio(null, null)).toBeNull();
  });
});

describe('gate estrutural — um componente, um critério', () => {
  it('a lista de clientes e o fechamento em lote usam o MESMO critério de telefone', () => {
    const src = semComentarios(ler('backend/src/controllers/FaturaController.js'));
    expect(src).toMatch(/telefoneEnvio:\s*telefoneDeEnvio\(/);
    expect(src).toMatch(/phone:\s*telefoneDeEnvio\(/);
    // o lote não pode voltar a mandar o telefone cru do login
    expect(src).not.toMatch(/phone:\s*fatura\.proprietario\.phone/);
  });

  it('a tela de Faturamento não chama mais o envio por WhatsApp à mão', () => {
    const src = semComentarios(ler('frontend/src/pages/Faturamento.tsx'));
    expect(src).not.toContain('enviarPdfWhatsAppComAviso');
    // painel da fatura + bloco do paciente
    expect((src.match(/<EnviarWhatsApp\b/g) ?? []).length).toBe(2);
    expect(src).toMatch(/telefoneWhatsApp = prop\.telefoneEnvio/);
  });

  it('CompartilharPdfBotoes (lote, prescrição, vacina…) manda o WhatsApp pelo componente', () => {
    const src = semComentarios(ler('frontend/src/components/CompartilharPdfBotoes.tsx'));
    expect(src).toContain('<EnviarWhatsApp');
    expect(src).not.toContain('enviarPdfWhatsAppComAviso');
  });
});

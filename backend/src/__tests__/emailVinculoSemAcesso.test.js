// 🔴 E-MAIL DO ANIMAL CADASTRADO × "Terá acesso ao sistema" (2026-09-27).
//
// Sem o acesso marcado, o cliente recebe SÓ o aviso de que o animal foi
// cadastrado: sem o botão "Acessar o S2Vet" e sem credenciais. Com o acesso
// marcado, o botão aparece; as credenciais só quando a conta nasceu agora.

const enviados = [];

jest.mock('../messaging/emailProvider', () => ({
  getEmailProvider: () => ({
    estaConfigurado: () => true,
    enviar: async (opts) => { enviados.push(opts); },
  }),
  remetente: () => 'teste@s2vet',
}));

const emailService = require('../services/emailService');

const base = {
  proprietarioEmail: 'cliente@exemplo.com',
  proprietarioNome:  'Cliente',
  animalNome:        'XPTO',
  vetNome:           'Vet',
};

beforeEach(() => { enviados.length = 0; });

describe('enviarVinculoInformativo', () => {
  it('sem acesso ao sistema: não tem botão de login nem credenciais', async () => {
    await emailService.enviarVinculoInformativo({ ...base, isNewUser: false, temAcesso: false });
    const { html, subject } = enviados[0];
    expect(html).not.toContain('Acessar o S2Vet');
    expect(html).not.toContain('/#/login');
    expect(html).not.toContain('Seus dados de acesso');
    expect(subject).toContain('XPTO foi cadastrado');
  });

  it('com acesso e usuário existente: tem o botão, sem credenciais', async () => {
    await emailService.enviarVinculoInformativo({ ...base, isNewUser: false, temAcesso: true });
    const { html } = enviados[0];
    expect(html).toContain('Acessar o S2Vet');
    expect(html).not.toContain('Seus dados de acesso');
  });

  it('com acesso e usuário novo: tem o botão e as credenciais', async () => {
    await emailService.enviarVinculoInformativo({
      ...base, isNewUser: true, senhaInicial: 'Senha#123', temAcesso: true,
    });
    const { html } = enviados[0];
    expect(html).toContain('Acessar o S2Vet');
    expect(html).toContain('Seus dados de acesso');
    expect(html).toContain('Senha#123');
  });
});

describe('AnimalController.criar repassa o checkbox ao e-mail', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(path.join(__dirname, '../controllers/AnimalController.js'), 'utf8');

  it('passa temAcesso = acessoSistemaConcedido', () => {
    expect(src).toMatch(/temAcesso:\s*acessoSistemaConcedido/);
  });

  it('credenciais só com acesso marcado E conta nova', () => {
    expect(src).toMatch(/enviarCredenciais\s*=\s*acessoSistemaConcedido\s*&&\s*isNewProprietario/);
  });
});

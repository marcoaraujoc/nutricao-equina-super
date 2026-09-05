// backend/src/__tests__/emailProvider.test.js
//
// O que este arquivo protege: a troca de provedor de e-mail (Gmail -> Brevo ->
// Resend) é feita por VARIÁVEL DE AMBIENTE, e o modo de quebrar isso é
// silencioso — o e-mail sai, mas com um "De:" que não existe (o login SMTP do
// Brevo), e o destinatário recebe no spam ou o provedor recusa. Nenhum teste de
// tela pega isso.

'use strict';

jest.mock('../lib/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

const {
  remetente, remetenteEmail, getEmailProvider,
  NodemailerEmailProvider, _resetProvider,
} = require('../messaging/emailProvider');

const ENV = { ...process.env };

function limparEnv() {
  for (const k of ['EMAIL_FROM', 'EMAIL_FROM_NAME', 'EMAIL_USER', 'EMAIL_PASS',
                   'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_PROVIDER', 'RESEND_API_KEY']) {
    delete process.env[k];
  }
}

beforeEach(() => { limparEnv(); _resetProvider(); });
afterAll(() => { process.env = ENV; });

describe('remetente — EMAIL_USER é credencial, EMAIL_FROM é o "De:"', () => {
  test('usa EMAIL_FROM quando definido', () => {
    process.env.EMAIL_USER = '9a1b2c001@smtp-brevo.com'; // login SMTP do Brevo
    process.env.EMAIL_FROM = 'contato@clinica.com.br';
    expect(remetenteEmail()).toBe('contato@clinica.com.br');
    expect(remetente()).toBe('"S2Vet" <contato@clinica.com.br>');
  });

  test('🔴 NUNCA usa o login SMTP como remetente quando há EMAIL_FROM', () => {
    // Este é o defeito que o campo veio evitar: o Brevo aceita a AUTENTICAÇÃO com
    // `...@smtp-brevo.com`, mas esse endereço não é caixa de e-mail nenhuma.
    process.env.EMAIL_USER = '9a1b2c001@smtp-brevo.com';
    process.env.EMAIL_FROM = 'contato@clinica.com.br';
    expect(remetente()).not.toContain('smtp-brevo.com');
  });

  test('sem EMAIL_FROM cai em EMAIL_USER — instalação Gmail existente não muda', () => {
    process.env.EMAIL_USER = 'clinica@gmail.com';
    expect(remetenteEmail()).toBe('clinica@gmail.com');
    expect(remetente()).toBe('"S2Vet" <clinica@gmail.com>');
  });

  test('EMAIL_FROM_NAME troca só o nome exibido', () => {
    process.env.EMAIL_FROM = 'contato@clinica.com.br';
    process.env.EMAIL_FROM_NAME = 'Clínica Equina';
    expect(remetente()).toBe('"Clínica Equina" <contato@clinica.com.br>');
  });

  test('o argumento vence o EMAIL_FROM_NAME (remetente por template)', () => {
    process.env.EMAIL_FROM = 'contato@clinica.com.br';
    process.env.EMAIL_FROM_NAME = 'Clínica Equina';
    expect(remetente('S2Vet Financeiro')).toBe('"S2Vet Financeiro" <contato@clinica.com.br>');
  });
});

describe('getEmailProvider — troca por env', () => {
  test('padrão é o SMTP (nodemailer)', () => {
    expect(getEmailProvider()).toBeInstanceOf(NodemailerEmailProvider);
  });

  test('provider desconhecido não derruba o processo — cai no SMTP', () => {
    process.env.EMAIL_PROVIDER = 'mandrill';
    expect(getEmailProvider()).toBeInstanceOf(NodemailerEmailProvider);
  });

  test('EMAIL_PROVIDER=resend sem a dependência instalada cai no SMTP, não quebra', () => {
    // O `resend` não está no package.json. Um throw aqui derrubaria o boot inteiro
    // do backend — e com ele o 2FA, as boas-vindas e o reset de senha — por causa
    // de um `npm install` esquecido no deploy.
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_teste';
    expect(() => getEmailProvider()).not.toThrow();
    expect(getEmailProvider()).toBeInstanceOf(NodemailerEmailProvider);
  });

  test('estaConfigurado do SMTP exige usuário E senha', () => {
    const p = new NodemailerEmailProvider();
    expect(p.estaConfigurado()).toBe(false);
    process.env.EMAIL_USER = 'x@y.com';
    expect(p.estaConfigurado()).toBe(false);
    process.env.EMAIL_PASS = 'senha';
    expect(p.estaConfigurado()).toBe(true);
  });

  test('enviar sem configuração lança EMAIL_NAO_CONFIGURADO (nunca finge que enviou)', async () => {
    const p = new NodemailerEmailProvider();
    await expect(p.enviar({ to: 'a@b.com', subject: 'x' }))
      .rejects.toMatchObject({ code: 'EMAIL_NAO_CONFIGURADO' });
  });
});

describe('gate estrutural — nada envia e-mail por fora do provider', () => {
  const fs   = require('fs');
  const path = require('path');

  // ⚠️ Sem tirar os comentários, os DOIS gates abaixo acusam os próprios comentários
  // que EXPLICAM a regra ("este arquivo tinha um nodemailer.createTransport…") —
  // e o teste vira ruído que se aprende a ignorar. Só código conta.
  const semComentarios = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const varrerFontes = (fn) => {
    const raiz = path.join(__dirname, '..');
    const achados = [];
    (function varrer(dir) {
      for (const nome of fs.readdirSync(dir)) {
        const p = path.join(dir, nome);
        if (fs.statSync(p).isDirectory()) { if (nome !== '__tests__') varrer(p); continue; }
        if (!/\.(js|ts)$/.test(nome)) continue;
        if (fn(semComentarios(fs.readFileSync(p, 'utf8')), p)) achados.push(path.relative(raiz, p));
      }
    })(raiz);
    return achados;
  };

  test('nenhum arquivo cria transporte SMTP próprio', () => {
    // `AuthController` tinha um `nodemailer.createTransport({ service: 'gmail' })`
    // só dele, e `service:'gmail'` IGNORA EMAIL_HOST: depois de migrar para o
    // Brevo, TUDO enviaria normal e só o "esqueci minha senha" falharia — no
    // fluxo em que a pessoa já está trancada para fora. Só o provider pode criar
    // transporte.
    const infratores = varrerFontes((src, p) =>
      !p.endsWith(path.join('messaging', 'emailProvider.js'))
      && /nodemailer\s*\.\s*createTransport/.test(src));
    expect(infratores).toEqual([]);
  });

  test('nenhum template usa EMAIL_USER como remetente', () => {
    const infratores = varrerFontes(src => /from:\s*[`'"].*EMAIL_USER/.test(src));
    expect(infratores).toEqual([]);
  });
});

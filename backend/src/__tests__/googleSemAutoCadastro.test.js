// backend/src/__tests__/googleSemAutoCadastro.test.js
//
// O que este arquivo protege: "Entrar com Google" NÃO cria conta. Só acessa o
// sistema quem foi cadastrado pelo ADMIN ou pelo gestor de uma empresa. O login
// Google criava um `users` novo para todo e-mail desconhecido, e como o usuário
// novo não tinha vínculo nenhum, `podeAcessarSistema` o deixava entrar — qualquer
// conta Google abria sessão. Quebra em SILÊNCIO: o login legítimo segue igual.

'use strict';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: { user: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() } },
}));
jest.mock('../lib/googleToken', () => ({ verificarAccessTokenGoogle: jest.fn() }));
jest.mock('../lib/auditoria', () => ({
  registrarAcesso: jest.fn(),
  registrarAcessoNegado: jest.fn(),
}));
jest.mock('../lib/usuarioEmpresa', () => ({ podeAcessarSistema: jest.fn().mockResolvedValue(true) }));

const prisma = require('../lib/prisma').default;
const { verificarAccessTokenGoogle } = require('../lib/googleToken');
const { registrarAcessoNegado } = require('../lib/auditoria');
const GoogleController = require('../controllers/GoogleController');

function resFalso() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

test('🔴 e-mail Google NÃO cadastrado é recusado e nenhuma conta é criada', async () => {
  verificarAccessTokenGoogle.mockResolvedValue({ email: 'estranho@gmail.com', nome: 'Estranho' });
  prisma.user.findFirst.mockResolvedValue(null);

  const res = resFalso();
  await GoogleController.login({ body: { access_token: 'tok' } }, res);

  expect(prisma.user.create).not.toHaveBeenCalled();
  expect(prisma.user.update).not.toHaveBeenCalled();
  expect(res.cookie).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith({ error: 'Acesso não Autorizado', code: 'USUARIO_NAO_CADASTRADO' });
  expect(registrarAcessoNegado).toHaveBeenCalled();
});

test('o nome vindo do Google não sobrescreve o cadastro de quem já existe', async () => {
  verificarAccessTokenGoogle.mockResolvedValue({ email: 'vet@clinica.com.br', nome: 'Nome do Google' });
  prisma.user.findFirst.mockResolvedValue({
    id: 7, email: 'vet@clinica.com.br', fullName: 'Nome do Cadastro', ativo: true,
    role: 'USER', userType: 'VETERINARIO',
  });
  prisma.user.update.mockResolvedValue({ sessionVersion: 1 });

  await GoogleController.login({ body: { access_token: 'tok' } }, resFalso());

  for (const [args] of prisma.user.update.mock.calls) {
    expect(args.data).not.toHaveProperty('fullName');
  }
});

test('gate estrutural: o controller não tem caminho de criação de usuário', () => {
  const fonte = require('fs').readFileSync(
    require('path').join(__dirname, '../controllers/GoogleController.js'), 'utf8',
  );
  expect(fonte).not.toMatch(/user\.create\s*\(/);
  expect(fonte).not.toMatch(/user\.upsert\s*\(/);
});

test('🔴 sem autocadastro: POST /auth/register não existe', () => {
  const fs = require('fs');
  const path = require('path');
  const rotas = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  expect(rotas).not.toMatch(/router\.post\(\s*['"]\/register['"]/);
  const UserController = require('../controllers/auth/UserController');
  expect(typeof UserController.register).toBe('undefined');
});

// backend/src/__tests__/auditoriaEventosDeAcesso.test.js
//
// O que este arquivo protege: eventos de ACESSO (login, logout, tentativa de acesso
// negado, abertura de link público) são SÓ da Auditoria do ADMIN. A auditoria da
// empresa mostra o que aconteceu com os dados dela. Quebra em SILÊNCIO: tirar o filtro
// não dá erro nenhum, só passa a mostrar ao gestor o rastro de login e as tentativas
// barradas.

'use strict';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    empresa:      { findFirst: jest.fn() },
    membroEquipe: { findFirst: jest.fn() },
    auditLog:     { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    animal:       { findMany: jest.fn().mockResolvedValue([]) },
    user:         { findMany: jest.fn().mockResolvedValue([]) },
  },
}));
jest.mock('../lib/usuarioEmpresa', () => ({ aplicarVinculoEmLista: jest.fn(async (l) => l) }));

const prisma = require('../lib/prisma').default;
const AuditController = require('../controllers/AuditController');
const { whereSomenteEventosDaEmpresa, CATEGORIAS_DE_ACESSO, ACOES_DE_ACESSO } = require('../lib/auditoria');

function resFalso() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const whereUsado = () => prisma.auditLog.findMany.mock.calls[0][0].where;

beforeEach(() => jest.clearAllMocks());

test('o filtro cobre login, logout, acesso negado e link público', () => {
  expect(ACOES_DE_ACESSO).toEqual(expect.arrayContaining(['LOGIN', 'LOGOUT']));
  expect(CATEGORIAS_DE_ACESSO).toEqual(expect.arrayContaining(['ACESSO_NEGADO', 'ACESSO_PUBLICO']));
});

test('⚠️ o filtro é NULL-safe: registro antigo da empresa sem categoria continua aparecendo', () => {
  // `categoria: { notIn }` sozinho esconderia EVOLUCAO_CRIADA/EDITADA/ASSUMIDA (categoria NULL).
  const w = whereSomenteEventosDaEmpresa();
  expect(w.AND[0].OR).toEqual(expect.arrayContaining([{ categoria: null }]));
});

test('🔴 gestor: a listagem tira os eventos de acesso', async () => {
  prisma.empresa.findFirst.mockResolvedValue({ id: 69 });
  await AuditController.listar(
    { user: { id: 233, userType: 'VETERINARIO' }, empresaId: 69, query: {} }, resFalso(),
  );
  const where = whereUsado();
  expect(where.empresaId).toBe(69);
  expect(where.AND).toEqual(whereSomenteEventosDaEmpresa().AND);
});

test('🔴 gestor pedindo a aba "Acesso negado" também não recebe nada de acesso', async () => {
  prisma.empresa.findFirst.mockResolvedValue({ id: 69 });
  await AuditController.listar(
    { user: { id: 233, userType: 'VETERINARIO' }, empresaId: 69, query: { categoria: 'ACESSO_NEGADO' } },
    resFalso(),
  );
  const where = whereUsado();
  expect(where.categoria).toBe('ACESSO_NEGADO');
  expect(where.AND).toEqual(whereSomenteEventosDaEmpresa().AND); // o AND anula o pedido
});

test('ADMIN: vê tudo, inclusive os eventos de acesso', async () => {
  await AuditController.listar({ user: { id: 1, userType: 'ADMIN' }, query: {} }, resFalso());
  expect(whereUsado().AND).toBeUndefined();
});

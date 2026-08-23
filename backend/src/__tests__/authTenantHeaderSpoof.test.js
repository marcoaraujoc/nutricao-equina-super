'use strict';

/**
 * TENTATIVA DE TROCAR DE TENANT PELO HEADER — `x-empresa-id`/`x-equipe-id`.
 *
 * Cenário: usuário autenticado no Tenant A manda, na MESMA sessão, o header do
 * Tenant B (que ele não pertence) tentando forçar `req.empresaId` para lá. Se
 * `authenticate` aceitasse o header sem validar o vínculo, isso seria um bypass
 * de tenant só trocando um header — nenhum RLS/checkPermission depois disso
 * salvaria, porque a requisição inteira roda com `req.empresaId` errado.
 *
 * `middlewares/auth.js` puxa `lib/prisma.ts` (TypeScript) na cadeia de require, que
 * o jest deste projeto não transpila — por isso é mockado, igual a
 * `autoriaAtendimento.test.js`. O que está sob teste é a REGRA de validação do
 * header (`validarEquipeContexto`/`validarEmpresaContexto`, privadas em auth.js),
 * não o acesso ao banco.
 */

jest.mock('jsonwebtoken');
jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../lib/tipoContexto', () => ({
  resolverTipoNoContexto: jest.fn(async () => ({ tipo: 'VETERINARIO', cargo: null, origem: 'legado' })),
}));

const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma').default;
const { authenticate } = require('../middlewares/auth');

const USER_ID = 10;
const EMPRESA_DO_USUARIO = 111;   // Tenant A — a empresa a que o usuário REALMENTE pertence
const EMPRESA_ALHEIA     = 999;   // Tenant B — empresa que ele tenta forçar pelo header

function reqFake(headers = {}) {
  return { headers: { authorization: 'Bearer token-fake', ...headers }, user: undefined };
}
function resFake() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), cookie: jest.fn(), clearCookie: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();

  jwt.verify = jest.fn(() => ({ id: USER_ID, role: 'USER', userType: 'VETERINARIO', sessionVersion: 1 }));

  prisma.user = { findUnique: jest.fn(async () => ({ ativo: true, sessionVersion: 1 })) };
  prisma.membroEquipe = { findFirst: jest.fn(async () => null) };

  // `validarEmpresaContexto` — só reconhece vínculo com EMPRESA_DO_USUARIO.
  // A query "própria empresa" (fallback, sem filtro por `id`) também usa
  // `empresa.findFirst`; distinguimos pelo `where.id` presente ou não.
  prisma.empresa = {
    findFirst: jest.fn(async ({ where }) => {
      if (where?.id != null) {
        return where.id === EMPRESA_DO_USUARIO ? { id: EMPRESA_DO_USUARIO } : null;
      }
      // fallback "própria empresa" (ownerId / GESTOR) — resolve pra empresa real do usuário
      return { id: EMPRESA_DO_USUARIO };
    }),
  };
  // `validarEquipeContexto` — nenhuma equipe vinculada a este usuário nos testes de header de empresa.
  prisma.equipe = { findFirst: jest.fn(async () => null) };
});

test('header x-empresa-id de tenant ALHEIO é ignorado — req.empresaId cai no fallback (a própria empresa)', async () => {
  const req = reqFake({ 'x-empresa-id': String(EMPRESA_ALHEIA) });
  const res = resFake();
  const next = jest.fn();

  await authenticate(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);           // não barrou com 401/403 — só ignorou o header
  expect(res.status).not.toHaveBeenCalled();
  expect(req.empresaId).toBe(EMPRESA_DO_USUARIO);  // NUNCA a empresa forjada
  expect(req.empresaId).not.toBe(EMPRESA_ALHEIA);
});

test('header x-empresa-id da PRÓPRIA empresa é aceito normalmente', async () => {
  const req = reqFake({ 'x-empresa-id': String(EMPRESA_DO_USUARIO) });
  const res = resFake();
  const next = jest.fn();

  await authenticate(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.empresaId).toBe(EMPRESA_DO_USUARIO);
});

test('header x-equipe-id de equipe ALHEIA (equipe fora do vínculo) também é ignorado', async () => {
  // Nenhuma equipe bate no `equipe.findFirst` (mock do beforeEach devolve null pra
  // qualquer id) — simula uma equipe de outra empresa, sem vínculo do usuário.
  const req = reqFake({ 'x-equipe-id': '555' });
  const res = resFake();
  const next = jest.fn();

  await authenticate(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.equipeId).toBeNull();
  expect(req.empresaId).toBe(EMPRESA_DO_USUARIO); // cai no MESMO fallback de sempre
});

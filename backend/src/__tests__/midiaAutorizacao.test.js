'use strict';

/**
 * TC-013 do "S2Vet Plano de Testes.csv" — "Tentar acessar a URL /api/midia/:chave do
 * arquivo do Tenant A [logado como Tenant B]" → esperado: 404 (NUNCA 403 — não pode
 * confirmar que o arquivo existe para quem não tem acesso).
 *
 * Cobre também o gap descoberto ao investigar por que essas tentativas não apareciam
 * em Auditoria Geral: até esta correção, `MidiaController` negava com 404 sem deixar
 * NENHUM rastro — diferente de `checkPermission`/`verificarAcessoAnimal` (middlewares)
 * e `podeOperarRegistro`, que já chamavam `registrarAcessoNegado`. Cada teste abaixo
 * que nega acesso confirma as DUAS coisas: o status devolvido (404, nunca 403) E que a
 * tentativa foi auditada.
 *
 * `MidiaController.js` requer `../lib/prisma` (TypeScript — o jest deste projeto não
 * transpila) e chama `verificarAcessoAnimal`/`registrarAcessoNegado`: os três são
 * mockados, mesmo padrão de `authTenantHeaderSpoof.test.js`. `autorizar()` é privada
 * (não exportada) — testada aqui só pelo comportamento OBSERVÁVEL de `baixar`, que é
 * exatamente o que a rota `GET /api/midia/:chave` expõe de verdade.
 */

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../lib/animalAccess', () => ({ verificarAcessoAnimal: jest.fn() }));
jest.mock('../lib/auditoria', () => ({ registrarAcessoNegado: jest.fn() }));

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { registrarAcessoNegado } = require('../lib/auditoria');
const MidiaController = require('../controllers/MidiaController');

// 48 chars hex — passa em /^[a-f0-9]{16,64}$/i (formato real da `chave`).
const CHAVE_VALIDA = 'a'.repeat(48);

const METADADOS_BASE = {
  id: 500, mimeType: 'image/jpeg', nomeOriginal: 'foto.jpg', tamanho: 1234,
  publico: false, criadoEm: new Date(),
};

function reqFake({ user, empresaId, equipeId, params = { chave: CHAVE_VALIDA }, headers = {} } = {}) {
  return {
    user: user ?? { id: 20, userType: 'VETERINARIO', role: 'USER' },
    empresaId, equipeId, params, headers,
  };
}
function resFake() {
  return {
    status:    jest.fn().mockReturnThis(),
    json:      jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    end:       jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.midiaArquivo = { findUnique: jest.fn() };
});

describe('MidiaController.baixar — autorização e auditoria (TC-013)', () => {
  test('chave malformada → 400, sem tocar no banco', async () => {
    const req = reqFake({ params: { chave: 'não-é-hex' } });
    const res = resFake();

    await MidiaController.baixar(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.midiaArquivo.findUnique).not.toHaveBeenCalled();
  });

  test('arquivo inexistente → 404, SEM auditoria (id que não existe não é uma tentativa negada)', async () => {
    prisma.midiaArquivo.findUnique.mockResolvedValueOnce(null);
    const req = reqFake({ empresaId: 58 });
    const res = resFake();

    await MidiaController.baixar(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(registrarAcessoNegado).not.toHaveBeenCalled();
  });

  test('arquivo de OUTRO paciente (verificarAcessoAnimal nega) → 404, NUNCA 403, tentativa auditada', async () => {
    const midia = { ...METADADOS_BASE, animalId: 42, empresaId: 31, criadoPorId: null };
    prisma.midiaArquivo.findUnique.mockResolvedValueOnce(midia);
    verificarAcessoAnimal.mockResolvedValueOnce(false);

    const req = reqFake({ user: { id: 99, userType: 'VETERINARIO' }, empresaId: 58, equipeId: 7 });
    const res = resFake();

    await MidiaController.baixar(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(registrarAcessoNegado).toHaveBeenCalledTimes(1);
    expect(registrarAcessoNegado).toHaveBeenCalledWith(req, expect.objectContaining({
      entidade:   'MIDIA',
      entidadeId: midia.id,
      animalId:   midia.animalId,
    }));
  });

  test('arquivo de OUTRA empresa (sem animalId, empresaId ≠ contexto) → 404 e auditado', async () => {
    const midia = { ...METADADOS_BASE, animalId: null, empresaId: 31, criadoPorId: null };
    prisma.midiaArquivo.findUnique.mockResolvedValueOnce(midia);

    const req = reqFake({ user: { id: 99, userType: 'VETERINARIO' }, empresaId: 58 });
    const res = resFake();

    await MidiaController.baixar(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(verificarAcessoAnimal).not.toHaveBeenCalled(); // sem animalId, esse ramo nem roda
    expect(registrarAcessoNegado).toHaveBeenCalledTimes(1);
  });

  test('sem contexto algum (arquivo legado sem dono) e usuário comum → 404 e auditado', async () => {
    const midia = { ...METADADOS_BASE, animalId: null, empresaId: null, criadoPorId: 12345 };
    prisma.midiaArquivo.findUnique.mockResolvedValueOnce(midia);

    const req = reqFake({ user: { id: 99, userType: 'VETERINARIO' } }); // não é o criadoPorId
    const res = resFake();

    await MidiaController.baixar(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(registrarAcessoNegado).toHaveBeenCalledTimes(1);
  });

  test('acesso PERMITIDO (mesmo animal) → não audita negação, envia o arquivo', async () => {
    const midia = { ...METADADOS_BASE, animalId: 42, empresaId: 58, criadoPorId: null };
    prisma.midiaArquivo.findUnique
      .mockResolvedValueOnce(midia)                            // metadados (SELECT_META)
      .mockResolvedValueOnce({ conteudo: Buffer.from('x') });  // conteúdo (enviarArquivo)
    verificarAcessoAnimal.mockResolvedValueOnce(true);

    const req = reqFake({ user: { id: 99, userType: 'VETERINARIO' }, empresaId: 58, equipeId: 7 });
    const res = resFake();

    await MidiaController.baixar(req, res);

    expect(registrarAcessoNegado).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
  });

  test('mídia PÚBLICA libera mesmo sem vínculo nenhum, sem auditoria', async () => {
    const midia = { ...METADADOS_BASE, animalId: null, empresaId: null, criadoPorId: null, publico: true };
    prisma.midiaArquivo.findUnique
      .mockResolvedValueOnce(midia)
      .mockResolvedValueOnce({ conteudo: Buffer.from('x') });

    const req = reqFake({ user: { id: 99, userType: 'VETERINARIO' }, empresaId: 58 });
    const res = resFake();

    await MidiaController.baixar(req, res);

    expect(registrarAcessoNegado).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });

  test('ADMIN da plataforma acessa qualquer arquivo, sem entrar na checagem de animal nem auditar', async () => {
    const midia = { ...METADADOS_BASE, animalId: 999, empresaId: 999, criadoPorId: null };
    prisma.midiaArquivo.findUnique
      .mockResolvedValueOnce(midia)
      .mockResolvedValueOnce({ conteudo: Buffer.from('x') });

    const req = reqFake({ user: { id: 1, role: 'ADMIN', userType: 'ADMIN' } });
    const res = resFake();

    await MidiaController.baixar(req, res);

    expect(verificarAcessoAnimal).not.toHaveBeenCalled();
    expect(registrarAcessoNegado).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });
});

describe('MidiaController.visualizarDocx — mesma autorização, mesma auditoria', () => {
  test('arquivo de OUTRO paciente → 404, NUNCA 403, tentativa auditada', async () => {
    const midia = { ...METADADOS_BASE, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', animalId: 42, empresaId: 31, criadoPorId: null };
    prisma.midiaArquivo.findUnique.mockResolvedValueOnce(midia);
    verificarAcessoAnimal.mockResolvedValueOnce(false);

    const req = reqFake({ user: { id: 99, userType: 'VETERINARIO' }, empresaId: 58, equipeId: 7 });
    const res = resFake();

    await MidiaController.visualizarDocx(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(registrarAcessoNegado).toHaveBeenCalledWith(req, expect.objectContaining({
      entidade:   'MIDIA',
      entidadeId: midia.id,
      animalId:   midia.animalId,
    }));
  });
});

'use strict';

/**
 * ASSISTÊNCIA VETERINÁRIA MENSAL É DO ANIMAL (2026-10-04, a pedido).
 *
 * Saiu do cadastro do proprietário e passou a ser de cada cavalo. Duas coisas quebram
 * EM SILÊNCIO se o elo se perder, por isso este arquivo:
 *
 *   1. A FATURA cobra UMA LINHA POR ANIMAL com assistência, com `animalId` (é isso que a
 *      põe no bloco do paciente certo). Um valor só por cliente era o comportamento
 *      antigo — e cliente com três cavalos pagava uma assistência só.
 *   2. TRANSIÇÃO: o mensalista legado (valor no PROPRIETÁRIO) segue cobrado até algum
 *      animal dele ter valor; a partir daí o legado para — senão o mesmo serviço sairia
 *      duas vezes. Sem o fallback, toda a base mensalista deixaria de ser cobrada.
 */

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../storage', () => ({ storage: { upload: jest.fn() }, chaveDaUrl: () => null }), { virtual: true });
jest.mock('../services/documentoWhatsappService', () => ({ htmlParaPdf: jest.fn() }), { virtual: true });
jest.mock('../services/whatsappService', () => ({}), { virtual: true });
jest.mock('../services/emailService', () => ({}), { virtual: true });
jest.mock('../lib/notificationDispatch', () => ({ enfileirarEnvioFatura: jest.fn() }), { virtual: true });
jest.mock('../lib/faturaLinkPublico', () => ({ criarLink: jest.fn(), revogar: jest.fn() }), { virtual: true });

const { valorDoBody } = require('../lib/animalAssistencia');
const { adicionarAssistenciaMensal } = require('../controllers/FaturaController');

function bancoFalso({ animais = [], legado = null } = {}) {
  const itens = [];
  let seq = 0;
  const casa = (linha, where) => Object.entries(where).every(([k, v]) => (linha[k] ?? null) === (v ?? null));
  return {
    itens,
    $queryRawUnsafe: async (sql) => {
      if (sql.includes('information_schema')) return [{ ok: 1 }];
      return animais.map(a => ({ id: a.id, nome: a.nome, valor_assistencia: a.valor }));
    },
    faturaItem: {
      findFirst: async ({ where }) => itens.find(i => casa(i, where)) ?? null,
      findMany:  async ({ where }) => itens.filter(i => casa(i, where)),
      create:    async ({ data }) => {
        const novo = { id: ++seq, descontoTipo: null, descontoValor: 0, ...data };
        itens.push(novo);
        return novo;
      },
    },
    fatura: {
      update:     async () => ({}),
      findUnique: async () => ({ id: 1, total: 0 }),
    },
    proprietarioPerfil: {
      findUnique: async () => (legado == null ? null : { valorAssistencia: legado }),
      findMany:   async () => (legado == null ? [] : [{ empresaId: 1, valorAssistencia: legado }]),
    },
    user: { findUnique: async () => ({ valorAssistencia: null }) },
  };
}

describe('valorDoBody', () => {
  test('undefined não mexe; vazio/zero/inválido = sem assistência; número e máscara BR passam', () => {
    expect(valorDoBody(undefined)).toBeUndefined();
    expect(valorDoBody(null)).toBeNull();
    expect(valorDoBody('')).toBeNull();
    expect(valorDoBody(0)).toBeNull();
    expect(valorDoBody('abc')).toBeNull();
    expect(valorDoBody(150)).toBe(150);
    expect(valorDoBody('1.234,56')).toBe(1234.56);
  });
});

describe('adicionarAssistenciaMensal — por animal', () => {
  test('uma linha por animal com assistência, cada uma com o seu animalId e valor', async () => {
    const db = bancoFalso({ animais: [{ id: 10, nome: 'Thor', valor: 300 }, { id: 11, nome: 'Zeus', valor: 450 }] });
    expect(await adicionarAssistenciaMensal(1, 77, null, 5, db)).toBe(true);
    expect(db.itens.map(i => [i.animalId, i.valor, i.tipo])).toEqual([
      [10, 300, 'ASSISTENCIA'], [11, 450, 'ASSISTENCIA'],
    ]);
  });

  test('é idempotente por animal (rodar de novo não duplica)', async () => {
    const db = bancoFalso({ animais: [{ id: 10, nome: 'Thor', valor: 300 }] });
    await adicionarAssistenciaMensal(1, 77, null, 5, db);
    expect(await adicionarAssistenciaMensal(1, 77, null, 5, db)).toBe(false);
    expect(db.itens).toHaveLength(1);
  });

  test('sem animal com assistência e sem valor legado, não gera linha', async () => {
    const db = bancoFalso();
    expect(await adicionarAssistenciaMensal(1, 77, null, 5, db)).toBe(false);
    expect(db.itens).toHaveLength(0);
  });
});

describe('adicionarAssistenciaMensal — transição do mensalista legado', () => {
  test('sem animal com assistência, o valor legado do proprietário segue cobrado (1 linha, sem animal)', async () => {
    const db = bancoFalso({ legado: 500 });
    expect(await adicionarAssistenciaMensal(1, 77, null, 5, db)).toBe(true);
    expect(db.itens).toHaveLength(1);
    expect(db.itens[0].valor).toBe(500);
    expect(db.itens[0].animalId).toBeUndefined();
  });

  test('com animal com assistência, o legado NÃO é cobrado junto (sem duplicar o serviço)', async () => {
    const db = bancoFalso({ animais: [{ id: 10, nome: 'Thor', valor: 300 }], legado: 500 });
    await adicionarAssistenciaMensal(1, 77, null, 5, db);
    expect(db.itens).toHaveLength(1);
    expect(db.itens[0].valor).toBe(300);
  });

  test('fatura que já tem a linha legada não ganha linhas por animal', async () => {
    const db = bancoFalso({ animais: [{ id: 10, nome: 'Thor', valor: 300 }] });
    db.itens.push({
      id: 99, faturaId: 1, tipo: 'ASSISTENCIA', animalId: null,
      descricao: 'Assistência Veterinária Mensal', valor: 500,
    });
    expect(await adicionarAssistenciaMensal(1, 77, null, 5, db)).toBe(false);
    expect(db.itens).toHaveLength(1);
  });
});

describe('gate estrutural', () => {
  const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const semComentarios = (s) => s.replace(/\/\/.*$/gm, '');

  test('o proprietário não grava mais mensalista/valorAssistencia', () => {
    const c = semComentarios(ler('controllers/ProprietarioController.js'));
    expect(c).not.toMatch(/mensalista\s*:/);
    expect(c).not.toMatch(/valorAssistencia\s*:/);
    expect(semComentarios(ler('lib/transferenciaPropriedadeAnimal.js'))).not.toMatch(/mensalista|valorAssistencia/);
  });

  test('o cadastro do animal grava a assistência (criar e atualizar)', () => {
    const c = ler('controllers/AnimalController.js');
    expect((c.match(/salvarAssistencia\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('a migration é aditiva e não faz backfill', () => {
    const sql = ler('../prisma/migrations/20261103000000_animal_assistencia/migration.sql')
      .replace(/--.*$/gm, '');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "valor_assistencia"/);
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/i);
  });
});

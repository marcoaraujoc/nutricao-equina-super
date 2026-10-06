'use strict';

/**
 * 🔴 FECHAR O PACIENTE GERA A FATURA DELE (2026-10-05, a pedido): "caso seja realizado o
 * fechamento da fatura por animal, deverá ser removido da fatura principal a informação
 * do animal fechado e será gerada uma nova fatura com as informações desse animal na
 * aba de fechado".
 *
 * Os lançamentos do paciente SAEM da fatura principal (UPDATE de `faturaId`) e vão para
 * uma `Fatura` nova do mesmo cliente/empresa/mês, marcada por `animalId`. O que quebra
 * EM SILÊNCIO se um elo se perder:
 *   · `getOrCreateFatura` adotar a fatura do paciente REABERTA como a corrente — a
 *     cobrança dos outros pacientes cairia dentro dela;
 *   · `abrirProximaFatura` abrir ciclo a partir dela (fatura de mês seguinte vazia);
 *   · a assistência mensal ser lançada DE NOVO na principal (cobrança em dobro) ou
 *     lançada para TODOS os animais dentro da fatura de um só;
 *   · o seletor escolher por MÊS — a fatura do paciente divide o mês com a principal e
 *     ficaria inalcançável.
 */

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/prisma', () => ({
  default: { $queryRawUnsafe: async () => [{ ok: 1 }] },
}), { virtual: true });

const fechamentoAnimal = require('../lib/faturaFechamentoAnimal');

const ler = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const lerFront = rel => fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'src', rel), 'utf8');

describe('separarAnimal — a operação', () => {
  function txFalso() {
    const chamadas = { create: null, sql: [], recalc: [] };
    return {
      chamadas,
      fatura: {
        create:     async ({ data }) => { chamadas.create = data; return { id: 900, ...data }; },
        findUnique: async ({ where }) => ({ id: where.id, ...chamadas.create }),
      },
      $executeRawUnsafe: async (sql, ...params) => { chamadas.sql.push({ sql, params }); return 3; },
    };
  }
  const origem = { id: 137, proprietarioId: 77, empresaId: 5, mesReferencia: '2026-10', status: 'ABERTA' };

  test('cria a fatura do paciente no MESMO cliente, empresa e mês, com o status pedido', async () => {
    const tx = txFalso();
    const r = await fechamentoAnimal.separarAnimal(tx, {
      origem, animalId: 110, status: 'FECHADA', recalcular: async () => {},
    });
    expect(tx.chamadas.create).toEqual({
      proprietarioId: 77, empresaId: 5, mesReferencia: '2026-10', animalId: 110, status: 'FECHADA', total: 0,
    });
    expect(r.fatura.id).toBe(900);
    expect(r.movidos).toBe(3);
  });

  test('🔴 MOVE os lançamentos (UPDATE de faturaId), só os NÃO PAGOS, e limpa a marca antiga', async () => {
    const tx = txFalso();
    await fechamentoAnimal.separarAnimal(tx, { origem, animalId: 110, status: 'FECHADA', recalcular: async () => {} });
    const [{ sql, params }] = tx.chamadas.sql;
    expect(sql).toMatch(/UPDATE "schs2vet"\."tb_fatura_itens"/);
    expect(sql).toMatch(/SET "faturaId" = \$3/);
    expect(sql).toMatch(/"fechado_em" = NULL/);
    expect(sql).toMatch(/"pago_em" IS NULL/);
    expect(params).toEqual([137, 110, 900]);
  });

  test('recalcula as DUAS faturas — a principal perde o valor, a nova o ganha', async () => {
    const tx = txFalso();
    const recalc = [];
    await fechamentoAnimal.separarAnimal(tx, {
      origem, animalId: 110, status: 'PAGA', recalcular: async (_tx, id) => { recalc.push(id); },
    });
    expect(recalc).toEqual([137, 900]);
  });

  test('ehFaturaDoPaciente: animalId JUNTO de proprietarioId (a fatura legada por animal não tem dono)', () => {
    expect(fechamentoAnimal.ehFaturaDoPaciente({ animalId: 1, proprietarioId: 2 })).toBe(true);
    expect(fechamentoAnimal.ehFaturaDoPaciente({ animalId: 1, proprietarioId: null })).toBe(false);
    expect(fechamentoAnimal.ehFaturaDoPaciente({ animalId: null, proprietarioId: 2 })).toBe(false);
  });
});

describe('os elos que somem em silêncio', () => {
  const ctrl  = ler('controllers/FaturaController.js');
  const utils = ler('lib/faturaUtils.js');

  test('fechar e pagar o paciente passam por separarAnimal DENTRO da transaction, com auditoria', () => {
    const bloco = ctrl.slice(ctrl.indexOf('const separando'), ctrl.indexOf('const CONTAGEM'));
    expect(bloco).toMatch(/acao === 'fechar' \|\| acao === 'pagar'/);
    const tx = bloco.slice(bloco.indexOf('prisma.$transaction'));
    expect(tx).toMatch(/fechamentoAnimal\.separarAnimal\(tx/);
    expect(tx).toMatch(/registrarAuditoria\(tx, req/);
    expect(bloco).toMatch(/faturaGerada/);
  });

  test('só fatura EM ABERTO se reparte, e a fatura do paciente não se reparte de novo', () => {
    const bloco = ctrl.slice(ctrl.indexOf('const separando'), ctrl.indexOf('const CONTAGEM'));
    expect(bloco).toMatch(/faturaEditavel\(alvo\.status\)/);
    expect(bloco).toMatch(/FATURA_DO_PACIENTE/);
  });

  test('🔴 getOrCreateFatura nunca adota a fatura do paciente reaberta', () => {
    const fn = utils.slice(utils.indexOf('async function getOrCreateFatura'), utils.indexOf('async function adicionarFaturaItem'));
    expect(fn).toMatch(/status: 'REABERTA'[^}]*animalId: null/);
  });

  test('a fatura do paciente não abre ciclo, nem impede o da principal', () => {
    const fn = ctrl.slice(ctrl.indexOf('async function abrirProximaFatura'), ctrl.indexOf('async function abrirProximaFaturaSemQuebrar'));
    expect(fn).toMatch(/if \(fechada\?\.animalId\) return null/);
    expect(fn).toMatch(/animalId: null/);
  });

  test('reabrir a fatura do paciente não esbarra em FATURA_ABERTA_NO_MES', () => {
    expect(ctrl).toMatch(/statusFinal === 'REABERTA' && !fechamentoAnimal\.ehFaturaDoPaciente\(alvo\)/);
  });

  test('assistência: nada na fatura do paciente, e a principal enxerga a que foi levada para ela', () => {
    const fn = ctrl.slice(ctrl.indexOf('async function adicionarAssistenciaMensal'), ctrl.indexOf('async function abrirProximaFatura'));
    expect(fn).toMatch(/if \(alvo\?\.animalId\) return false/);
    expect(fn).toMatch(/fatura: \{\s*animalId:\s*animal\.id/);
  });

  test('a TELA escolhe a fatura por ID (o mês é dividido) e tira da principal o paciente separado', () => {
    const tela = lerFront('pages/Faturamento.tsx');
    expect(tela).toMatch(/<option key=\{m\.id\} value=\{m\.id\}>/);
    expect(tela).toMatch(/faturaView \?\?/);
    expect(tela).toMatch(/animaisNaFatura\.map/);
    expect(tela).toMatch(/separavel: canEdit && !ehFaturaDoPaciente/);
  });
});

describe('assistência na fatura do paciente', () => {
  test('🔴 não lança assistência (nem a do cliente inteiro) na fatura de UM paciente', async () => {
    let adicionarAssistenciaMensal;
    jest.isolateModules(() => {
      jest.doMock('../lib/prisma', () => ({ default: {} }), { virtual: true });
      jest.doMock('../storage', () => ({ storage: { upload: jest.fn() }, chaveDaUrl: () => null }), { virtual: true });
      jest.doMock('../services/documentoWhatsappService', () => ({ htmlParaPdf: jest.fn() }), { virtual: true });
      jest.doMock('../services/whatsappService', () => ({}), { virtual: true });
      jest.doMock('../services/emailService', () => ({}), { virtual: true });
      jest.doMock('../lib/notificationDispatch', () => ({ enfileirarEnvioFatura: jest.fn() }), { virtual: true });
      jest.doMock('../lib/faturaLinkPublico', () => ({ criarLink: jest.fn(), revogar: jest.fn() }), { virtual: true });
      ({ adicionarAssistenciaMensal } = require('../controllers/FaturaController'));
    });
    const criados = [];
    const db = {
      fatura:     { findUnique: async () => ({ animalId: 110, proprietarioId: 77, empresaId: 5, mesReferencia: '2026-10' }) },
      faturaItem: { create: async ({ data }) => { criados.push(data); return data; }, findFirst: async () => null },
      $queryRawUnsafe: async () => [{ id: 110, nome: 'Thor', valor_assistencia: 300 }],
    };
    expect(await adicionarAssistenciaMensal(900, 77, null, 5, db)).toBe(false);
    expect(criados).toHaveLength(0);
  });
});

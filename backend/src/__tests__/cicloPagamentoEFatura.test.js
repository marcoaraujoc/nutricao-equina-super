'use strict';

/**
 * CICLO DE VIDA — FATURA E CONTA A PAGAR, AS DUAS METADES DO MESMO BALCÃO
 * (2026-09-23, a pedido).
 *
 * Quatro regras novas, e as quatro quebram EM SILÊNCIO:
 *
 *   1. **REABERTA fechada de novo não abre ciclo.** Abrir um criava uma fatura do mês
 *      seguinte a cada correção de linha de um mês já entregue — e o cliente terminava
 *      o ano com faturas vazias de meses que nunca foram faturados.
 *
 *   2. **Não se abre fatura de mês FUTURO.** Fechar setembro no dia 23 criava a de
 *      outubro com o mês ainda correndo, e toda cobrança do resto de setembro caía
 *      dentro dela.
 *
 *   3. **Uma ABERTA não convive com uma REABERTA do mesmo mês.** Duas faturas do mesmo
 *      mês partem a cobrança em dois documentos, e `getOrCreateFatura` pega a primeira
 *      que achar: metade dos lançamentos some da vista.
 *
 *   4. **Fechado é somente leitura** — na fatura, no bloco do PACIENTE dentro dela e na
 *      conta a pagar. Até aqui a regra existia só na TELA (`canEdit`), e um PUT direto
 *      passava numa fatura fechada.
 *
 * O que dá para testar por COMPORTAMENTO mora em `lib/faturaUtils.js` e
 * `lib/contasPagar.js`, que não dependem de banco. O resto é gate ESTRUTURAL: o elo
 * entre a regra e o controller some sem produzir erro nenhum.
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

const {
  abreProximoCiclo, mesReferenciaAtual, faturaEditavel, faturaAbertaNoMes,
} = require('../lib/faturaUtils');
const contasPagar = require('../lib/contasPagar');

const semComentarios = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
const leia = (rel) => semComentarios(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));

/** 'YYYY-MM' deslocado de `n` meses a partir de hoje. */
function mesRelativo(n) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

// ─── 1 e 2: quando o ciclo seguinte nasce ────────────────────────────────────

describe('abreProximoCiclo — fechar nem sempre abre a fatura seguinte', () => {
  it('REABERTA fechada de novo NÃO abre nada', () => {
    expect(abreProximoCiclo('REABERTA', mesRelativo(-1))).toBe(false);
    // Nem quando o mês seguinte já chegou: o que decide é a natureza do ato.
    expect(abreProximoCiclo('REABERTA', mesRelativo(-6))).toBe(false);
  });

  it('ABERTA fechada no mês SEGUINTE ao dela abre o ciclo', () => {
    expect(abreProximoCiclo('ABERTA', mesRelativo(-1))).toBe(true);
  });

  it('fechar a fatura do mês CORRENTE não abre a do mês que vem', () => {
    expect(abreProximoCiclo('ABERTA', mesReferenciaAtual())).toBe(false);
  });

  it('nem a de um mês que ainda nem começou', () => {
    expect(abreProximoCiclo('ABERTA', mesRelativo(+1))).toBe(false);
  });

  it('sem mês de referência cai no mês atual — e portanto ainda abre', () => {
    // `proximoMesReferencia(null)` devolve o mês ATUAL (não o seguinte), então a
    // comparação é `atual <= atual`. É o comportamento legado da fatura sem rótulo de
    // mês, e mantê-lo é o que evita o cliente ficar sem fatura corrente.
    expect(abreProximoCiclo('ABERTA', null)).toBe(true);
  });
});

// ─── 3: a ABERTA e a REABERTA do mesmo mês ───────────────────────────────────

describe('uma fatura ABERTA não convive com uma REABERTA do mesmo mês', () => {
  it('faturaAbertaNoMes procura pelo trio (cliente, empresa, mês) e só o status ABERTA', async () => {
    let capturado = null;
    const db = { fatura: { findFirst: async (args) => { capturado = args; return null; } } };
    await faturaAbertaNoMes(db, {
      proprietarioId: 7, empresaId: 42, mesReferencia: '2026-09', exceto: 10,
    });
    expect(capturado.where).toMatchObject({
      proprietarioId: 7, empresaId: 42, mesReferencia: '2026-09', status: 'ABERTA',
    });
    // Sem o `not`, a própria fatura sendo reaberta se acusaria como conflito.
    expect(capturado.where.id).toEqual({ not: 10 });
  });

  it('sem cliente ou sem mês não há o que procurar (fatura legada por animal)', async () => {
    const db = { fatura: { findFirst: async () => { throw new Error('não deveria consultar'); } } };
    expect(await faturaAbertaNoMes(db, { proprietarioId: null, mesReferencia: '2026-09' })).toBeNull();
    expect(await faturaAbertaNoMes(db, { proprietarioId: 7, mesReferencia: null })).toBeNull();
  });

  it('a reabertura CONSULTA a guarda antes de gravar', () => {
    const corpo = leia('controllers/FaturaController.js');
    const ini = corpo.indexOf('atualizarStatus: async (req, res)');
    const trecho = corpo.slice(ini, corpo.indexOf('\n  },\n', ini));
    expect(trecho).toMatch(/statusFinal === 'REABERTA'/);
    expect(trecho).toMatch(/faturaAbertaNoMes/);
    expect(trecho).toMatch(/FATURA_ABERTA_NO_MES/);
  });

  it('e getOrCreateFatura ADOTA a reaberta do mês corrente em vez de criar o par', () => {
    const src = leia('lib/faturaUtils.js');
    const ini = src.indexOf('async function getOrCreateFatura');
    const trecho = src.slice(ini, src.indexOf('\n}', ini));
    expect(trecho).toMatch(/status: 'REABERTA'[\s\S]*mesReferencia: mesAtual/);
  });
});

// ─── 4: fechado é somente leitura ────────────────────────────────────────────

describe('fechado é somente leitura — fatura, bloco do paciente e conta a pagar', () => {
  it('faturaEditavel aceita só ABERTA e REABERTA', () => {
    expect(faturaEditavel('ABERTA')).toBe(true);
    expect(faturaEditavel('REABERTA')).toBe(true);
    for (const s of ['FECHADA', 'ATRASADA', 'PAGA', 'CANCELADA']) {
      expect(faturaEditavel(s)).toBe(false);
    }
  });

  it('o lançamento do ORÇAMENTO na fatura segue a mesma regra', () => {
    // Era a outra porta de entrada de item: `POST /orcamentos/lancar-na-fatura` só
    // barrava PAGA e CANCELADA, então a taxa avulsa entrava numa fatura FECHADA.
    const src = leia('controllers/OrcamentoController.js');
    expect(src).toMatch(/faturaEditavel\(fatura\.status\)/);
    expect(src).toMatch(/FATURA_NAO_EDITAVEL/);
  });

  it('a conta a pagar só aceita remoção de item em conta ABERTA/REABERTA', () => {
    const src = leia('lib/contasPagar.js');
    const ini = src.indexOf('async function removerItem');
    const trecho = src.slice(ini, src.indexOf('\n}', ini));
    expect(trecho).toMatch(/c\.status = 'ABERTA' OR c\.status = 'REABERTA'/);
  });

  it('e a conta PAGA só é reaberta pelo GESTOR — como a fatura paga', () => {
    const src = leia('controllers/ContaPagarController.js');
    expect(src).toMatch(/saindoDePaga/);
    expect(src).toMatch(/ehGestorNoContexto/);
    expect(src).toMatch(/CONTA_PAGA/);
  });
});

// ─── o ciclo da CONTA espelha o da FATURA ────────────────────────────────────

describe('contasPagar.statusAoReabrir — espelho de faturaUtils', () => {
  it.each(['FECHADA', 'PAGA'])('%s + pedido ABERTA vira REABERTA', (atual) => {
    expect(contasPagar.statusAoReabrir(atual, 'ABERTA')).toBe('REABERTA');
  });

  it('uma REABERTA nunca volta a ser ABERTA', () => {
    expect(contasPagar.statusAoReabrir('REABERTA', 'ABERTA')).toBe('REABERTA');
  });

  it('conta que já está ABERTA continua ABERTA — não é reabertura', () => {
    expect(contasPagar.statusAoReabrir('ABERTA', 'ABERTA')).toBe('ABERTA');
  });

  it('CANCELADA fica de fora: desfazer cancelamento é UNDO, não reabertura', () => {
    expect(contasPagar.statusAoReabrir('CANCELADA', 'ABERTA')).toBe('ABERTA');
  });

  it('qualquer outro destino passa intacto', () => {
    expect(contasPagar.statusAoReabrir('ABERTA', 'FECHADA')).toBe('FECHADA');
    expect(contasPagar.statusAoReabrir('FECHADA', 'PAGA')).toBe('PAGA');
  });
});

describe('contasPagar.transicaoInvalida — o UPDATE deixou de ser cego', () => {
  it('só conta em aberto fecha', () => {
    expect(contasPagar.transicaoInvalida('ABERTA', 'FECHADA')).toBeNull();
    expect(contasPagar.transicaoInvalida('REABERTA', 'FECHADA')).toBeNull();
    // Gravar FECHADA sobre uma conta PAGA apagava a data do pagamento em silêncio.
    expect(contasPagar.transicaoInvalida('PAGA', 'FECHADA')).toMatch(/aberta/i);
  });

  it('conta CANCELADA não muda de status', () => {
    expect(contasPagar.transicaoInvalida('CANCELADA', 'PAGA')).toMatch(/cancelada/i);
    // Menos para ela mesma: reenviar o mesmo status não é uma transição.
    expect(contasPagar.transicaoInvalida('CANCELADA', 'CANCELADA')).toBeNull();
  });

  it('alterarStatus LÊ o estado atual antes de gravar', () => {
    const src = leia('lib/contasPagar.js');
    const ini = src.indexOf('async function alterarStatus');
    const trecho = src.slice(ini, src.indexOf('\n}', ini));
    expect(trecho).toMatch(/lerConta\(client, empresaId, contaId\)/);
    expect(trecho).toMatch(/statusAoReabrir\(atual\.status, statusPedido\)/);
    expect(trecho).toMatch(/transicaoInvalida\(atual\.status, status\)/);
  });
});

'use strict';

/**
 * AVISOS DE ORÇAMENTO EM ABERTO (2026-09-08, a pedido).
 *
 * O que este arquivo protege são as duas decisões que fazem o alerta servir para
 * alguma coisa — e as duas quebram em silêncio, produzindo mensagens que chegam e
 * são ignoradas:
 *
 *   1. A VÉSPERA É UM DIA EXATO, não "faltam <= 1 dia". O job roda todo dia; com um
 *      `<=`, o mesmo orçamento dispararia o alerta vermelho todos os dias até ser
 *      cancelado — e alerta que chega todo dia deixa de ser lido, justamente no dia
 *      em que ele importava.
 *
 *   2. A MENSAGEM TEM TETO. Numa clínica com 40 orçamentos parados, nomear todos
 *      produz uma mensagem que ninguém abre no celular (e que o WhatsApp trunca de
 *      qualquer jeito) — o teto com "e mais N" preserva a contagem REAL, que é a
 *      informação que não pode se perder.
 */

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../services/whatsappService', () => ({ sendMessage: jest.fn() }), { virtual: true });
jest.mock('../lib/tenantDb', () => ({ comTenant: jest.fn() }), { virtual: true });
jest.mock('../lib/cronTenant', () => ({ empresasAtivas: jest.fn() }), { virtual: true });

const {
  ehVespera, diasEmAberto, corpoComLimite, linhaDoOrcamento, MAX_NA_MENSAGEM,
} = require('../services/orcamentoAvisoService');

const AGORA = new Date('2026-09-08T12:00:00Z').getTime();
const criadoHa = (dias) => new Date(AGORA - dias * 24 * 60 * 60 * 1000).toISOString();

describe('diasEmAberto — dias corridos desde a criação', () => {
  it('conta os dias inteiros já completados', () => {
    expect(diasEmAberto(criadoHa(0), AGORA)).toBe(0);
    expect(diasEmAberto(criadoHa(14), AGORA)).toBe(14);
  });
});

describe('ehVespera — dispara UMA vez, no dia anterior ao cancelamento', () => {
  const VALIDADE = 15;

  it('no dia 14 de uma validade de 15, é véspera', () => {
    expect(ehVespera(criadoHa(14), VALIDADE, AGORA)).toBe(true);
  });

  it('no dia 13 ainda não é — o alerta chegaria cedo demais', () => {
    expect(ehVespera(criadoHa(13), VALIDADE, AGORA)).toBe(false);
  });

  // 🔴 O caso que um `<=` quebraria: no dia do vencimento (e depois dele) o alerta
  // NÃO se repete. Ele já foi dado ontem, e o job de cancelamento cuida do resto.
  it('no dia do vencimento e depois, NÃO repete', () => {
    expect(ehVespera(criadoHa(15), VALIDADE, AGORA)).toBe(false);
    expect(ehVespera(criadoHa(30), VALIDADE, AGORA)).toBe(false);
  });

  it('sem validade configurada não existe véspera', () => {
    expect(ehVespera(criadoHa(14), null, AGORA)).toBe(false);
  });

  it('validade de 1 dia avisa no MESMO dia da criação', () => {
    // Caso-limite real: com validade 1, a véspera é o dia 0. Sem isto o alerta nunca
    // sairia para quem configurou o prazo mais curto possível.
    expect(ehVespera(criadoHa(0), 1, AGORA)).toBe(true);
  });
});

describe('linhaDoOrcamento — o gestor precisa saber qual, de quem e quanto', () => {
  const orc = {
    numero: 7,
    proprietario: { fullName: 'Haras Boa Vista' },
    itens: [{ valorTotal: 1200.5 }, { valorTotal: 300 }],
  };

  it('numera com 4 dígitos, soma os itens e nomeia o cliente', () => {
    expect(linhaDoOrcamento(orc)).toBe('• #0007 — Haras Boa Vista — R$ 1500,50');
  });

  it('orçamento sem proprietário resolvido não quebra a mensagem', () => {
    expect(linhaDoOrcamento({ numero: 1, itens: [] })).toBe('• #0001 — cliente — R$ 0,00');
  });
});

describe('corpoComLimite — a contagem real sobrevive ao teto', () => {
  const lista = (n) => Array.from({ length: n }, (_, i) => ({ numero: i + 1, itens: [] }));

  it('lista curta sai inteira, sem sufixo', () => {
    const corpo = corpoComLimite(lista(3), (o) => `• ${o.numero}`);
    expect(corpo.split('\n')).toHaveLength(3);
    expect(corpo).not.toMatch(/mais/);
  });

  it('lista longa é cortada e o RESTANTE é dito — nunca some em silêncio', () => {
    const corpo = corpoComLimite(lista(40), (o) => `• ${o.numero}`);
    const linhas = corpo.split('\n');
    expect(linhas).toHaveLength(MAX_NA_MENSAGEM + 1);
    expect(linhas[linhas.length - 1]).toBe(`• …e mais ${40 - MAX_NA_MENSAGEM} orçamento(s).`);
  });

  it('exatamente no teto não ganha o "e mais 0"', () => {
    const corpo = corpoComLimite(lista(MAX_NA_MENSAGEM), (o) => `• ${o.numero}`);
    expect(corpo).not.toMatch(/mais/);
  });
});

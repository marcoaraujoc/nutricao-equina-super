'use strict';

/**
 * O QUE NÃO FOI APROVADO PRECISA DIZER POR QUÊ (2026-09-08, a pedido).
 *
 * A regra quebra em silêncio: sem ela a decisão é gravada normalmente, o orçamento
 * vira REJEITADO e ninguém percebe nada — o buraco só aparece semanas depois, quando
 * alguém abre o relatório para entender por que metade do que foi orçado não virou
 * receita e encontra a coluna Motivo vazia em todas as linhas.
 *
 * As duas metades da regra têm razões OPOSTAS, e é por isso que ela não é
 * "sempre exija um motivo":
 *   • recusa TOTAL pede UM motivo — o cliente recusou o documento, não sete linhas, e
 *     exigir sete justificativas idênticas vira obstáculo (e obstáculo se contorna
 *     digitando "x" sete vezes, que é pior que não perguntar);
 *   • recusa PARCIAL pede POR ITEM — cada linha pode ter caído por uma razão
 *     diferente, e é justamente essa diferença que permite renegociar.
 */

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const { faltaMotivoDeRecusa, MIN_MOTIVO } = require('../lib/orcamentoRecusa');

const chamar = (o) => faltaMotivoDeRecusa({ motivoPorItem: new Map(), ...o });

describe('nada recusado, nada a justificar', () => {
  it('aprovar tudo não pede motivo', () => {
    expect(chamar({ idsRecusados: [], totalDeItens: 3, motivoGeral: '' })).toBe(false);
  });
});

describe('recusa TOTAL — um motivo basta', () => {
  it('sem motivo, barra', () => {
    expect(chamar({ idsRecusados: [1, 2, 3], totalDeItens: 3, motivoGeral: '' })).toBe(true);
  });

  it('motivo curto demais não conta como motivo', () => {
    expect(chamar({ idsRecusados: [1, 2, 3], totalDeItens: 3, motivoGeral: 'x' })).toBe(true);
    // Espaço em branco também não: o campo preenchido com nada é campo vazio.
    expect(chamar({ idsRecusados: [1, 2, 3], totalDeItens: 3, motivoGeral: '    ' })).toBe(true);
  });

  it('com o motivo geral, passa — sem exigir um por item', () => {
    expect(chamar({ idsRecusados: [1, 2, 3], totalDeItens: 3, motivoGeral: 'valor acima do previsto' })).toBe(false);
  });
});

describe('recusa PARCIAL — por item, com o geral como padrão', () => {
  it('um item recusado sem motivo nenhum barra a decisão inteira', () => {
    expect(chamar({
      idsRecusados: [2, 5], totalDeItens: 7, motivoGeral: '',
      motivoPorItem: new Map([[2, 'cliente já tem o medicamento']]),
    })).toBe(true);
  });

  it('todos os recusados com motivo próprio passam', () => {
    expect(chamar({
      idsRecusados: [2, 5], totalDeItens: 7, motivoGeral: '',
      motivoPorItem: new Map([[2, 'cliente já tem o medicamento'], [5, 'vai fazer em outro lugar']]),
    })).toBe(false);
  });

  it('o motivo GERAL cobre o item que não tem o seu — é o que evita repetir sete vezes', () => {
    expect(chamar({
      idsRecusados: [2, 5], totalDeItens: 7, motivoGeral: 'orçamento acima do limite do cliente',
      motivoPorItem: new Map([[2, 'cliente já tem o medicamento']]),
    })).toBe(false);
  });

  it('chave em string (como chega do JSON) casa igual à numérica', () => {
    expect(chamar({
      idsRecusados: [2], totalDeItens: 7, motivoGeral: '',
      motivoPorItem: { 2: 'cliente já tem o medicamento' },
    })).toBe(false);
  });
});

describe('o mínimo é o mesmo do resto do sistema', () => {
  it('3 caracteres, como o ModalJustificativa (§33)', () => {
    expect(MIN_MOTIVO).toBe(3);
  });
});

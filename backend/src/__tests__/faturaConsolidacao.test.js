'use strict';

/**
 * CONSOLIDAÇÃO DA COBRANÇA POR EXECUÇÃO (2026-08-25).
 *
 * Cada dose aplicada gera cobrança (regra do produto, não muda). O que mudou é que a
 * dose seguinte SOMA na quantidade da linha que já existe, em vez de repetir a linha.
 *
 * Duas regras aqui quebram em silêncio, e as duas são dinheiro:
 *   1. O contador tem de subir DE UM EM UM, a cada execução. Se algum dia alguém
 *      lançar o curso inteiro de uma vez, o cliente é cobrado por dose que não foi
 *      aplicada — e o erro só aparece quando o tratamento é interrompido no meio.
 *   2. O desconto é do MEDICAMENTO, não da dose. Se a consolidação recusar a linha
 *      com desconto e abrir outra, metade do curso é cobrada cheia — sem nenhum erro,
 *      sem nenhum log, com a fatura fechando "certo" na soma das linhas.
 */

const {
  adicionarOuSomarFaturaItem,
  valorLiquidoItem,
} = require('../lib/faturaUtils');

// tx falso: guarda as linhas em memória e implementa só o que o helper usa.
function txFalso(linhas = []) {
  const estado = { linhas: linhas.map(l => ({ ...l })), fatura: { id: 1, total: 0 }, seq: 100 };
  const casa = (l, where) => Object.entries(where).every(([k, v]) => (l[k] ?? null) === v);
  return {
    estado,
    faturaItem: {
      findMany: async ({ where }) => estado.linhas.filter(l => casa(l, where)),
      create:   async ({ data }) => {
        const nova = { id: ++estado.seq, descontoTipo: null, descontoValor: 0, ...data };
        estado.linhas.push(nova);
        return nova;
      },
      update: async ({ where, data }) => {
        const alvo = estado.linhas.find(l => l.id === where.id);
        if (data.quantidade?.increment != null) alvo.quantidade += data.quantidade.increment;
        return alvo;
      },
    },
    fatura: {
      update: async ({ data }) => {
        if (data.total?.increment != null) estado.fatura.total += data.total.increment;
        else estado.fatura.total = data.total;
        return estado.fatura;
      },
    },
  };
}

const dose = (extra = {}) => ({
  faturaId: 1, animalId: 7, tipo: 'MEDICAMENTO',
  descricao: '[AG-0012] Ivermectina — 10mL × 4/4h',
  valor: 20, quantidade: 1, prescricaoId: 55, ...extra,
});

describe('contador incremental — o curso nunca é lançado de uma vez', () => {
  it('a 1ª dose cria a linha com quantidade 1', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose());
    expect(tx.estado.linhas).toHaveLength(1);
    expect(tx.estado.linhas[0].quantidade).toBe(1);
  });

  it('cada dose seguinte soma 1 na MESMA linha — 3 doses = 1 linha, Quant. 3', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose());
    await adicionarOuSomarFaturaItem(tx, dose());
    await adicionarOuSomarFaturaItem(tx, dose());
    expect(tx.estado.linhas).toHaveLength(1);
    expect(tx.estado.linhas[0].quantidade).toBe(3);
    // Tratamento parado na 3ª dose de um curso de 18: cobra 3, nunca 18.
    expect(tx.estado.fatura.total).toBe(60);
  });

  it('preço unitário DIFERENTE abre linha própria (não dá para somar qtd de preços distintos)', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ valor: 20 }));
    await adicionarOuSomarFaturaItem(tx, dose({ valor: 31.5 }));
    expect(tx.estado.linhas).toHaveLength(2);
  });

  it('origem DIFERENTE abre linha própria — senão o estorno de uma prescrição levaria a outra', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 56 }));
    expect(tx.estado.linhas).toHaveLength(2);
  });

  it('sem origem rastreável (lançamento manual) nunca consolida', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: null }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: null }));
    expect(tx.estado.linhas).toHaveLength(2);
  });
});

describe('o desconto é do MEDICAMENTO, não da dose', () => {
  it('dose nova cai NA MESMA linha com 10% e herda o desconto', async () => {
    // Ivermectina 4/4h por 3 dias (18 doses), 10% negociado depois da 2ª dose.
    const tx = txFalso([{
      id: 1, faturaId: 1, animalId: 7, tipo: 'MEDICAMENTO',
      descricao: '[AG-0012] Ivermectina — 10mL × 4/4h',
      valor: 20, quantidade: 2, prescricaoId: 55,
      descontoTipo: 'PERCENTUAL', descontoValor: 10,
    }]);

    await adicionarOuSomarFaturaItem(tx, dose());

    expect(tx.estado.linhas).toHaveLength(1);          // não abriu linha sem desconto
    const linha = tx.estado.linhas[0];
    expect(linha.quantidade).toBe(3);
    expect(linha.descontoTipo).toBe('PERCENTUAL');
    // 3 × 20 = 60 bruto, −10% = 54 — o desconto acompanhou a dose nova.
    expect(valorLiquidoItem(linha)).toBeCloseTo(54, 2);
    expect(tx.estado.fatura.total).toBeCloseTo(54, 2);
  });

  it('desconto em VALOR continua absoluto na linha (R$ 5 na ivermectina, não R$ 5 por dose)', async () => {
    const tx = txFalso([{
      id: 1, faturaId: 1, animalId: 7, tipo: 'MEDICAMENTO',
      descricao: '[AG-0012] Ivermectina — 10mL × 4/4h',
      valor: 20, quantidade: 2, prescricaoId: 55,
      descontoTipo: 'VALOR', descontoValor: 5,
    }]);

    await adicionarOuSomarFaturaItem(tx, dose());

    const linha = tx.estado.linhas[0];
    expect(linha.quantidade).toBe(3);
    expect(linha.descontoValor).toBe(5);
    expect(valorLiquidoItem(linha)).toBeCloseTo(55, 2); // 60 − 5
  });

  it('o total da fatura é RECALCULADO, não incrementado por valor × qtd', async () => {
    // O bug que isto pega: incrementar 20 (bruto da dose) numa linha com 10% deixaria
    // o total da fatura acima da soma real dos itens, e ninguém notaria.
    const tx = txFalso([{
      id: 1, faturaId: 1, animalId: 7, tipo: 'MEDICAMENTO',
      descricao: '[AG-0012] Ivermectina — 10mL × 4/4h',
      valor: 20, quantidade: 1, prescricaoId: 55,
      descontoTipo: 'PERCENTUAL', descontoValor: 50,
    }]);

    await adicionarOuSomarFaturaItem(tx, dose());

    const somaDosItens = tx.estado.linhas.reduce((a, l) => a + valorLiquidoItem(l), 0);
    expect(tx.estado.fatura.total).toBeCloseTo(somaDosItens, 2);
    expect(tx.estado.fatura.total).toBeCloseTo(20, 2); // 2 × 20 = 40, −50% = 20
  });
});

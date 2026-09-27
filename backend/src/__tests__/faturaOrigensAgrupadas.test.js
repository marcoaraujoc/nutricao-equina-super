'use strict';

/**
 * A OBSERVAÇÃO DA LINHA DA FATURA É UMA POR REGISTRO E POR DIA — não uma por dose
 * (2026-09-26).
 *
 * `registrarOrigem` grava uma contribuição a cada EXECUÇÃO. Duas doses do mesmo
 * atendimento no mesmo dia saíam como
 *     ↳ EV-0001 · 26/09 · Quant.: 1
 *     ↳ EV-0001 · 26/09 · Quant.: 1
 * quando o que se confere é "EV-0001 · 26/09 · Quant.: 2". O agrupamento é só de
 * LEITURA (`origensPorItem`): a tabela continua uma linha por execução, que é o que o
 * estorno por origem precisa.
 */

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const { origensPorItem } = require('../lib/faturaItemOrigens');

// Client falso: devolve as contribuições na consulta de origens, e nada nas consultas
// de fuso (override ausente) — a empresa fica em São Paulo pelo endereço.
function clientCom(linhas) {
  return {
    $queryRawUnsafe: async (sql) => (sql.includes('tb_fatura_item_origens') ? linhas : []),
    empresa: { findUnique: async () => ({ cep: null, estado: 'SP' }) },
  };
}

const base = {
  faturaItemId: 10, empresaId: 777,
  prescricaoId: 55, vacinaClinicaId: null, exameClinicoId: null, encaminhamentoClinicoId: null,
  vacinaNumero: null, vacinaAnimalId: null, exameNumero: null,
  evolucaoId: 1, evolucaoNumero: 1, tipoAtendimento: null, agendamentoId: null, evolucaoAnimalId: 84,
};

describe('origensPorItem — agrupamento da observação', () => {
  it('duas doses do MESMO atendimento no MESMO dia viram uma entrada somada', async () => {
    const mapa = await origensPorItem(clientCom([
      { ...base, id: 1, quantidade: 1, ocorridoEm: new Date('2026-09-26T11:00:00Z') },
      { ...base, id: 2, quantidade: 1, ocorridoEm: new Date('2026-09-26T23:00:00Z') },
    ]), [10]);
    const origens = mapa.get(10);
    expect(origens).toHaveLength(1);
    expect(origens[0].quantidade).toBe(2);
    expect(origens[0].evolucaoId).toBe(1);
  });

  it('o dia é o da CLÍNICA: a dose das 22:00 de Brasília (01:00 UTC) não abre outro dia', async () => {
    const mapa = await origensPorItem(clientCom([
      { ...base, id: 1, quantidade: 1, ocorridoEm: new Date('2026-09-26T13:00:00Z') },
      { ...base, id: 2, quantidade: 1, ocorridoEm: new Date('2026-09-27T01:00:00Z') },
    ]), [10]);
    expect(mapa.get(10)).toHaveLength(1);
    expect(mapa.get(10)[0].quantidade).toBe(2);
  });

  it('dias DIFERENTES do mesmo atendimento seguem separados', async () => {
    const mapa = await origensPorItem(clientCom([
      { ...base, id: 1, quantidade: 1, ocorridoEm: new Date('2026-09-26T13:00:00Z') },
      { ...base, id: 2, quantidade: 1, ocorridoEm: new Date('2026-09-27T13:00:00Z') },
    ]), [10]);
    expect(mapa.get(10).map(o => o.quantidade)).toEqual([1, 1]);
  });

  it('atendimentos DIFERENTES no mesmo dia seguem separados', async () => {
    const mapa = await origensPorItem(clientCom([
      { ...base, id: 1, quantidade: 1, ocorridoEm: new Date('2026-09-26T13:00:00Z') },
      { ...base, id: 2, quantidade: 3, prescricaoId: 56, evolucaoId: 2, evolucaoNumero: 2,
        ocorridoEm: new Date('2026-09-26T14:00:00Z') },
    ]), [10]);
    expect(mapa.get(10).map(o => o.quantidade)).toEqual([1, 3]);
  });

  it('a soma da observação continua batendo com a quantidade da linha', async () => {
    const linhas = [
      { ...base, id: 1, quantidade: 1, ocorridoEm: new Date('2026-09-26T11:00:00Z') },
      { ...base, id: 2, quantidade: 1, ocorridoEm: new Date('2026-09-26T19:00:00Z') },
      { ...base, id: 3, quantidade: 2, ocorridoEm: new Date('2026-09-27T11:00:00Z') },
    ];
    const mapa = await origensPorItem(clientCom(linhas), [10]);
    const soma = mapa.get(10).reduce((a, o) => a + o.quantidade, 0);
    expect(soma).toBe(4);
  });

  it('contribuição sem registro resolvido nunca é fundida às cegas', async () => {
    const orfa = { ...base, prescricaoId: null, evolucaoId: null, evolucaoNumero: null, evolucaoAnimalId: null };
    const mapa = await origensPorItem(clientCom([
      { ...orfa, id: 1, quantidade: 1, ocorridoEm: new Date('2026-09-26T11:00:00Z') },
      { ...orfa, id: 2, quantidade: 1, ocorridoEm: new Date('2026-09-26T12:00:00Z') },
    ]), [10]);
    expect(mapa.get(10)).toHaveLength(2);
  });
});

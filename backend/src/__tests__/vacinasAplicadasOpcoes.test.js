'use strict';

/**
 * O SELETOR DE VACINAS DO ATESTADO — todas as opções, e as APLICADAS no topo (2026-09-10).
 *
 * 🔴 DUAS REGRAS QUE QUEBRAM EM SILÊNCIO:
 *
 *   1. **A lista tem de ser COMPLETA.** Havia um `take: 500` aplicado à consulta CRUA —
 *      isto é, ANTES da deduplicação por nome. Nesta base ele não cortava (426 linhas →
 *      231 nomes), mas o corte era ALFABÉTICO e SEM AVISO: bastava a clínica cadastrar as
 *      próprias vacinas para o fim do catálogo ("Z…") desaparecer do atestado e ninguém
 *      descobrir. Num documento com valor legal, opção que falta é vacina que deixa de
 *      ser atestada.
 *
 *   2. **✅ só em quem foi APLICADA de verdade.** `SALVA` é rascunho e `FINALIZADA` está
 *      na fila do plantão aguardando aplicação. Marcar as duas afirmaria no atestado que
 *      o animal recebeu uma dose que ninguém aplicou.
 */

const vacinasFake = [];
const registrosFake = [];

jest.mock('../lib/prisma', () => ({
  default: {
    medicamento: {
      findMany: jest.fn(async (args) => {
        // O teste falha de propósito se alguém reintroduzir um teto na consulta crua:
        // o corte silencioso é justamente o defeito.
        if (args && args.take !== undefined) throw new Error(`take proibido na consulta de vacinas: ${args.take}`);
        return vacinasFake;
      }),
    },
    vacinaClinica: {
      findMany: jest.fn(async ({ where }) => registrosFake
        .filter(r => r.status === where.status && r.dataAplicacao >= where.dataAplicacao.gte)
        .sort((a, b) => b.dataAplicacao - a.dataAplicacao)),
    },
  },
}), { virtual: true });

// 🔴 SEM `{ virtual: true }` AQUI, e a diferença não é cosmética: `lib/fusoEmpresa` é um
// `.js` que existe em disco, e `virtual` diz ao jest o oposto ("este módulo não existe").
// Com ele, um worker que já tivesse carregado o módulo REAL num arquivo anterior às vezes
// resolvia o real em vez do mock — e o teste falhava só no run COMPLETO, uma vez a cada
// ~8, com a data em dd/MM/aaaa no lugar do ISO. `virtual` é para `lib/prisma`, que é `.ts`
// e o babel-jest não transpila.
jest.mock('../lib/fusoEmpresa', () => ({
  fusoDaEmpresa: async () => null,
  formatarDataNaEmpresa: (d) => new Date(d).toISOString().slice(0, 10),
}));

const { OPCOES } = require('../lib/documentoListas');
const listas = require('../lib/documentoListas');

// `opcoesEmpresaVacinas` não é exportada — o caminho público é `sugerirOpcoes`, que é
// justamente o que o controller chama. Testar por ele é testar o contrato de verdade.
const pedir = (animalId) => listas.sugerirOpcoes(
  [{ chave: 'vac', fonteOpcoes: 'empresa.vacinas' }],
  { empresaId: 7, animalId },
).then(m => m.vac);

const vac = (nome, extras = {}) => ({ nome, apresentacao: null, fabricante: null, lotes: [], ...extras });

beforeEach(() => {
  vacinasFake.length = 0;
  registrosFake.length = 0;
});

const diasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

describe('a lista sai COMPLETA', () => {
  it('devolve todas as vacinas, sem teto', async () => {
    for (let i = 0; i < 640; i++) vacinasFake.push(vac(`Vacina ${String(i).padStart(4, '0')}`));
    const opcoes = await pedir(null);
    expect(opcoes).toHaveLength(640);
  });

  it('deduplica por NOME — catálogo misto não mostra o mesmo produto duas vezes', async () => {
    // Global sem dado + a da empresa com fabricante: vence a que tem MAIS informação,
    // porque é ela que preenche as outras colunas do atestado sozinha.
    vacinasFake.push(vac('Abor-Vac'), vac('Abor-Vac', { fabricante: 'Zoetis' }));
    const opcoes = await pedir(null);
    expect(opcoes).toHaveLength(1);
    expect(opcoes[0].valores.Fabricante).toBe('Zoetis');
  });

  it('sem paciente sai em ordem ALFABÉTICA (é o caso do editor de modelos)', async () => {
    vacinasFake.push(vac('Zimag'), vac('Abor-Vac'), vac('Marbo'));
    const opcoes = await pedir(null);
    expect(opcoes.map(o => o.rotulo)).toEqual(['Abor-Vac', 'Marbo', 'Zimag']);
  });
});

describe('APLICADAS no último ano vêm no topo, com a marca', () => {
  it('erguidas para o começo, da mais recente para a mais antiga', async () => {
    vacinasFake.push(vac('Abor-Vac'), vac('Marbo'), vac('Zimag'));
    registrosFake.push(
      { nome: 'Zimag', status: 'EXECUTADA', dataAplicacao: diasAtras(10) },
      { nome: 'Marbo', status: 'EXECUTADA', dataAplicacao: diasAtras(200) },
    );
    const opcoes = await pedir(55);
    expect(opcoes.map(o => o.rotulo)).toEqual(['Zimag', 'Marbo', 'Abor-Vac']);
    expect(opcoes[0].aplicada).toBe(true);
    expect(opcoes[1].aplicada).toBe(true);
    expect(opcoes[2].aplicada).toBe(false);
  });

  it('ERGUE, nunca FILTRA — a primeira dose é vacina que o paciente nunca tomou', async () => {
    vacinasFake.push(vac('Abor-Vac'), vac('Zimag'));
    registrosFake.push({ nome: 'Zimag', status: 'EXECUTADA', dataAplicacao: diasAtras(5) });
    const opcoes = await pedir(55);
    expect(opcoes).toHaveLength(2);
    expect(opcoes.map(o => o.rotulo)).toContain('Abor-Vac');
  });

  it('🔴 SALVA e FINALIZADA NÃO ganham a marca — ninguém aplicou aquela dose', async () => {
    vacinasFake.push(vac('Abor-Vac'), vac('Marbo'));
    registrosFake.push(
      { nome: 'Abor-Vac', status: 'SALVA',      dataAplicacao: diasAtras(3) },
      { nome: 'Marbo',    status: 'FINALIZADA', dataAplicacao: diasAtras(3) },
    );
    const opcoes = await pedir(55);
    expect(opcoes.every(o => o.aplicada === false)).toBe(true);
  });

  it('fora da janela de 12 meses não sobe nem marca', async () => {
    vacinasFake.push(vac('Abor-Vac'), vac('Zimag'));
    registrosFake.push({ nome: 'Zimag', status: 'EXECUTADA', dataAplicacao: diasAtras(500) });
    const opcoes = await pedir(55);
    expect(opcoes.map(o => o.rotulo)).toEqual(['Abor-Vac', 'Zimag']);
    expect(opcoes.every(o => o.aplicada === false)).toBe(true);
  });

  it('casa o nome sem diferenciar caixa nem espaço em volta', async () => {
    // O registro de vacina guarda o NOME (não há FK garantida), então o casamento é
    // textual — e o nome gravado no atendimento pode ter caixa/espaço diferentes.
    vacinasFake.push(vac('Abor-Vac'));
    registrosFake.push({ nome: '  abor-vac ', status: 'EXECUTADA', dataAplicacao: diasAtras(2) });
    const opcoes = await pedir(55);
    expect(opcoes[0].aplicada).toBe(true);
  });

  it('duas doses da mesma vacina → a marca leva a data da MAIS RECENTE', async () => {
    vacinasFake.push(vac('Abor-Vac'));
    registrosFake.push(
      { nome: 'Abor-Vac', status: 'EXECUTADA', dataAplicacao: diasAtras(200) },
      { nome: 'Abor-Vac', status: 'EXECUTADA', dataAplicacao: diasAtras(9) },
    );
    const opcoes = await pedir(55);
    const esperado = new Date(diasAtras(9)).toISOString().slice(0, 10);
    expect(opcoes[0].aplicadaEm).toBe(esperado);
  });

  it('sem animal não consulta aplicação nenhuma', async () => {
    vacinasFake.push(vac('Abor-Vac'));
    registrosFake.push({ nome: 'Abor-Vac', status: 'EXECUTADA', dataAplicacao: diasAtras(1) });
    const opcoes = await pedir(null);
    expect(opcoes[0].aplicada).toBe(false);
    expect(opcoes[0].aplicadaEm).toBeNull();
  });
});

describe('contrato', () => {
  it('`empresa.vacinas` continua sendo a fonte reconhecida', () => {
    expect(OPCOES['empresa.vacinas']).toBeTruthy();
  });

  it('cada opção traz as colunas que o atestado preenche', async () => {
    vacinasFake.push(vac('Abor-Vac', { fabricante: 'Zoetis', lotes: [{ lote: 'L1', validade: new Date('2027-08-16') }] }));
    const [o] = await pedir(null);
    expect(o.valores['Nome comercial da vacina']).toBe('Abor-Vac');
    expect(o.valores['Número da partida']).toBe('L1');
    expect(o.valores['Data de validade']).toBe('2027-08-16');
    // DATA DE FABRICAÇÃO fica de fora: o S2Vet não guarda esse dado, e preenchê-la com a
    // validade seria inventar valor num documento com valor legal.
    expect(o.valores['Data de fabricação']).toBeUndefined();
  });
});

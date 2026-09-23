// backend/src/__tests__/dosesDoPeriodo.test.js
//
// Gate da contagem de DOSES do Mapa de Atendimento. Esta conta quebra em SILÊNCIO:
// errá-la não produz erro nenhum, só um painel com números tranquilizadores e
// errados — foi assim que "Executadas" e "Não executadas / Atrasadas" ficaram em
// zero enquanto havia dose atrasada na base.
'use strict';

const {
  dosesDoItemNoPeriodo,
  dosesDoGrupoNoPeriodo,
  statusDasDoses,
  foraDaContagem,
} = require('../lib/dosesDoPeriodo');

// Item como o Prisma o devolve: `dataInicio` é data pura (meia-noite UTC).
const item = (over = {}) => ({
  id: 1,
  ativo: true,
  frequencia: '1xDia',
  duracaoDias: 1,
  horaInicio: '',
  dataInicio: new Date('2026-09-22T00:00:00Z'),
  dosesExecutadas: 0,
  proximaDoseEm: null,
  executadoEm: null,
  execucoesDose: [],
  aplicadaPeloProprietario: false,
  ...over,
});

const HOJE = {
  inicioStr: '2026-09-22',
  fimStr:    '2026-09-22',
  hojeStr:   '2026-09-22',
  agora:     new Date('2026-09-22T15:00:00'),
};

describe('dosesDoPeriodo — o que entra na conta', () => {
  test('item aplicado pelo proprietário não é dose do plantão', () => {
    expect(foraDaContagem(item({ aplicadaPeloProprietario: true }))).toBe(true);
    expect(dosesDoItemNoPeriodo(item({ aplicadaPeloProprietario: true }), HOJE).total).toBe(0);
  });

  test('"se necessário" e SOS não têm agenda — nunca viram pendência', () => {
    for (const frequencia of ['seNecessario', 'SOS']) {
      expect(dosesDoItemNoPeriodo(item({ frequencia }), HOJE).total).toBe(0);
    }
  });

  test('item inativo (removido do documento) sai da conta', () => {
    expect(dosesDoItemNoPeriodo(item({ ativo: false }), HOJE).total).toBe(0);
  });
});

describe('dosesDoPeriodo — executadas saem do LOG de dose, não de executadoEm', () => {
  test('conta uma linha por dose aplicada no período', () => {
    const d = dosesDoItemNoPeriodo(item({
      frequencia: '12em12h', duracaoDias: 1, dosesExecutadas: 2,
      execucoesDose: [
        { horarioExecutado: new Date('2026-09-22T08:00:00') },
        { horarioExecutado: new Date('2026-09-22T20:00:00') },
      ],
    }), HOJE);
    expect(d.executadas).toBe(2);
  });

  test('dose aplicada FORA do período não conta', () => {
    const d = dosesDoItemNoPeriodo(item({
      dosesExecutadas: 1,
      execucoesDose: [{ horarioExecutado: new Date('2026-09-21T08:00:00') }],
    }), HOJE);
    expect(d.executadas).toBe(0);
  });

  test('🔴 executar 1 de 2 doses do dia NÃO encerra o item', () => {
    // Era o defeito: `executadoEm` guarda só a ÚLTIMA dose, então o painel dava
    // o documento inteiro por executado com metade das aplicações por fazer.
    const d = dosesDoItemNoPeriodo(item({
      frequencia: '12em12h', duracaoDias: 1, dosesExecutadas: 1,
      proximaDoseEm: new Date('2026-09-22T20:00:00'),
      executadoEm:   new Date('2026-09-22T08:00:00'),
      execucoesDose: [{ horarioExecutado: new Date('2026-09-22T08:00:00') }],
    }), HOJE);
    expect(d).toMatchObject({ executadas: 1, atrasadas: 0, previstas: 1, total: 2 });
  });

  test('legado (frequência "agora") não grava dose — cai em executadoEm', () => {
    const d = dosesDoItemNoPeriodo(item({
      frequencia: 'agora', executadoEm: new Date('2026-09-22T09:00:00'),
    }), HOJE);
    expect(d).toMatchObject({ executadas: 1, atrasadas: 0, previstas: 0 });
  });
});

describe('dosesDoPeriodo — atrasada x prevista', () => {
  test('dose com horário vencido há mais de 30min está atrasada', () => {
    const d = dosesDoItemNoPeriodo(item({
      dosesExecutadas: 1, duracaoDias: 5,
      proximaDoseEm: new Date('2026-09-22T14:00:00'), // 1h atrás
    }), HOJE);
    expect(d).toMatchObject({ atrasadas: 1, previstas: 0 });
  });

  test('dentro da tolerância de 30min ainda é prevista', () => {
    const d = dosesDoItemNoPeriodo(item({
      dosesExecutadas: 1, duracaoDias: 5,
      proximaDoseEm: new Date('2026-09-22T14:45:00'), // 15min atrás
    }), HOJE);
    expect(d).toMatchObject({ atrasadas: 0, previstas: 1 });
  });

  test('🔴 item SEM hora e SEM dose dada não nasce atrasado à meia-noite', () => {
    // `horaInicio` deixou de ser obrigatório em 2026-08-23. Tratar a meia-noite
    // como horário previsto faria toda dose do dia aparecer atrasada às 00:01.
    const d = dosesDoItemNoPeriodo(item({ horaInicio: '', dosesExecutadas: 0 }), HOJE);
    expect(d).toMatchObject({ atrasadas: 0, previstas: 1 });
    expect(d.proximoHorario).toBeNull(); // só se sabe o DIA
  });

  test('dose de DIA anterior não dada está atrasada, tenha hora ou não', () => {
    const d = dosesDoItemNoPeriodo(
      item({ dataInicio: new Date('2026-09-20T00:00:00Z') }),
      { ...HOJE, inicioStr: '2026-09-20' },
    );
    expect(d.atrasadas).toBe(1);
  });

  test('dose de dia futuro dentro do período é prevista, nunca atrasada', () => {
    const d = dosesDoItemNoPeriodo(
      item({ dataInicio: new Date('2026-09-25T00:00:00Z') }),
      { ...HOJE, fimStr: '2026-09-30' },
    );
    expect(d).toMatchObject({ atrasadas: 0, previstas: 1 });
  });
});

describe('dosesDoPeriodo — janela do curso e frequência', () => {
  test('curso de vários dias rende uma dose por dia dentro do período', () => {
    const d = dosesDoItemNoPeriodo(
      item({ frequencia: '1xDia', duracaoDias: 5 }),
      { ...HOJE, fimStr: '2026-09-26' },
    );
    expect(d.previstas).toBe(5);
  });

  test('🔴 "1x por semana durante 28 dias" são 4 doses, não 28', () => {
    // A janela do curso trazia o item TODO dia; a cadência é que manda.
    const d = dosesDoItemNoPeriodo(
      item({ frequencia: '1xSemana', duracaoDias: 28 }),
      { ...HOJE, fimStr: '2026-10-31' },
    );
    expect(d.previstas).toBe(4);
  });

  test('curso que termina antes do período não deixa dose nele', () => {
    const d = dosesDoItemNoPeriodo(
      item({ dataInicio: new Date('2026-09-01T00:00:00Z'), duracaoDias: 2 }),
      HOJE,
    );
    expect(d.total).toBe(0);
  });

  test('curso completo (todas as doses dadas) não deixa pendência', () => {
    const d = dosesDoItemNoPeriodo(item({
      frequencia: '1xDia', duracaoDias: 3, dosesExecutadas: 3,
      proximaDoseEm: new Date('2026-09-22T10:00:00'),
    }), HOJE);
    expect(d).toMatchObject({ atrasadas: 0, previstas: 0 });
  });
});

describe('dosesDoGrupoNoPeriodo e statusDasDoses', () => {
  const grupo = (status, itens) => ({ id: 1, status, itens });

  test('soma os itens do documento', () => {
    const d = dosesDoGrupoNoPeriodo(grupo('FINALIZADO', [
      item({ id: 1, frequencia: '12em12h' }),
      item({ id: 2, frequencia: '1xDia' }),
    ]), HOJE);
    expect(d.total).toBe(3);
  });

  test('🔴 curso CANCELADO não projeta dose para o futuro', () => {
    const d = dosesDoGrupoNoPeriodo(
      grupo('CANCELADO', [item({ frequencia: '1xDia', duracaoDias: 5 })]),
      { ...HOJE, fimStr: '2026-09-26' },
    );
    expect(d.previstas).toBe(0);
  });

  test('o que venceu antes do cancelamento continua contando como não executado', () => {
    const d = dosesDoGrupoNoPeriodo(
      grupo('CANCELADO', [item({ dataInicio: new Date('2026-09-20T00:00:00Z') })]),
      { ...HOJE, inicioStr: '2026-09-20' },
    );
    expect(d.atrasadas).toBe(1);
  });

  test('status: atrasada > a fazer > executado > cancelado', () => {
    expect(statusDasDoses({ executadas: 1, atrasadas: 1, previstas: 1 }, 'FINALIZADO')).toBe('ATRASADA');
    expect(statusDasDoses({ executadas: 1, atrasadas: 0, previstas: 1 }, 'FINALIZADO')).toBe('AGENDADO');
    expect(statusDasDoses({ executadas: 2, atrasadas: 0, previstas: 0 }, 'FINALIZADO')).toBe('EXECUTADO');
    expect(statusDasDoses({ executadas: 0, atrasadas: 0, previstas: 0 }, 'CANCELADO')).toBe('CANCELADO');
  });
});

describe('gate estrutural — o Mapa precisa ler a dose, não o documento', () => {
  const fs = require('fs');
  const path = require('path');
  const fonte = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'MapaAtendimentoController.js'),
    'utf8',
  );

  test('o controller consome a lib de doses', () => {
    expect(fonte).toContain('dosesDoGrupoNoPeriodo');
    expect(fonte).toContain('statusDasDoses');
  });

  test('o log append-only de dose entra no select', () => {
    expect(fonte).toContain('execucoesDose');
  });

  test('🔴 o Mapa NÃO volta a exigir evolução FINALIZADA', () => {
    // `listarParaExecucao` não exige desde 2026-07-16: a prescrição vai ao plantão
    // quando o GRUPO é finalizado. Reintroduzir isto some com toda prescrição de
    // atendimento EM_ANDAMENTO — o estado normal de quem está atendendo agora.
    expect(fonte).not.toMatch(/evolucao:\s*\{\s*status:\s*'FINALIZADA'\s*\}/);
  });

  test('a flag do item aplicado pelo proprietário vem do helper de SQL cru', () => {
    expect(fonte).toContain('anexarAplicadaProprietario');
  });
});

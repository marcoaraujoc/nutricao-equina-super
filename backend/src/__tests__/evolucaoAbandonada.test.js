// backend/src/__tests__/evolucaoAbandonada.test.js
//
// FINALIZAÇÃO AUTOMÁTICA DO ATENDIMENTO ABANDONADO (2026-09-18).
//
// 🔴 POR QUE ESTE GATE EXISTE: a rotina foi relatada como "já existe e não está
// executando" — e não existia. O modo de ela deixar de existir de novo é silencioso:
// o job some de `server.ts`, ou a chamada da cascata sai do service, e nada quebra.
// O atendimento simplesmente volta a ficar aberto para sempre, e só se descobre
// semanas depois, pelo banner que não fecha.
'use strict';

const fs   = require('fs');
const path = require('path');

const lerFonte = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
/** Ignora comentários: sem isso o gate passa só porque a PROSA cita o que ele exige. */
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const {
  finalizarEvolucoesAbandonadas, JUSTIFICATIVA_SISTEMA, HORAS_ATE_FINALIZAR,
} = require('../services/evolucaoCronService');

// Banco falso mínimo: registra o que a rotina tentou gravar.
function bancoFalso(abertas) {
  const chamadas = { updates: [], raw: [] };
  return {
    chamadas,
    evolucaoClinica: {
      findMany: jest.fn(async () => abertas),
      update:   jest.fn(async (args) => { chamadas.updates.push(args); return args; }),
    },
    agendamentoClinico: { updateMany: jest.fn(async () => ({ count: 1 })) },
    prescricaoGrupo:    { findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 0 })) },
    prescricao:         { updateMany: jest.fn(async () => ({ count: 0 })) },
    $executeRawUnsafe:  jest.fn(async (sql) => { chamadas.raw.push(sql); return 0; }),
  };
}

const horasAtras = (h) => new Date(Date.now() - h * 60 * 60 * 1000);

describe('janela de 48h', () => {
  it('a constante é 48 — é ela que separa "ainda em curso" de "ninguém voltou"', () => {
    // Menos que isso alcançaria a internação e o plantão noturno: o atendimento
    // legítimo que atravessa a virada do dia seria fechado por baixo de quem ainda
    // está escrevendo nele.
    expect(HORAS_ATE_FINALIZAR).toBe(48);
  });

  it('a busca é por dataInicio ANTERIOR ao limite, e só EM_ANDAMENTO/ativo', async () => {
    const db = bancoFalso([]);
    await finalizarEvolucoesAbandonadas(db);
    const where = db.evolucaoClinica.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('EM_ANDAMENTO');
    expect(where.ativo).toBe(true);
    // `lt`, nunca `gt`: o filtro é "aberta HÁ MAIS DE 48h".
    expect(where.dataInicio.lt).toBeInstanceOf(Date);
    const horas = (Date.now() - where.dataInicio.lt.getTime()) / 3600000;
    expect(horas).toBeGreaterThan(47.9);
    expect(horas).toBeLessThan(48.1);
  });

  it('nada aberto além do limite → não notifica (não vira e-mail todo dia)', async () => {
    const r = await finalizarEvolucoesAbandonadas(bancoFalso([]));
    expect(r).toEqual({ ok: true, notificar: false });
  });
});

describe('o que é gravado', () => {
  const abertas = [
    { id: 10, animalId: 1, agendamentoId: 99, numero: 4, dataInicio: horasAtras(50) },
    { id: 11, animalId: 2, agendamentoId: null, numero: 5, dataInicio: horasAtras(72) },
  ];

  it('grava a justificativa pedida, literal', async () => {
    const db = bancoFalso(abertas);
    await finalizarEvolucoesAbandonadas(db);
    for (const c of db.chamadas.updates) {
      expect(c.data.justificativaExclusao).toBe('Finalizada pelo Sistema');
    }
    expect(JUSTIFICATIVA_SISTEMA).toBe('Finalizada pelo Sistema');
  });

  it('status FINALIZADA e dataFim preenchida', async () => {
    const db = bancoFalso(abertas);
    await finalizarEvolucoesAbandonadas(db);
    expect(db.chamadas.updates).toHaveLength(2);
    for (const c of db.chamadas.updates) {
      expect(c.data.status).toBe('FINALIZADA');
      expect(c.data.dataFim).toBeInstanceOf(Date);
    }
  });

  it('🔴 NÃO reescreve o responsável — ninguém conduziu esta finalização', async () => {
    // No Finalizar normal quem finaliza vira o responsável porque ESCOLHEU fechar e
    // responde pelo que declara. Aqui é consequência administrativa: carimbar um nome
    // no prontuário alheio seria falsear a autoria clínica.
    const db = bancoFalso(abertas);
    await finalizarEvolucoesAbandonadas(db);
    for (const c of db.chamadas.updates) {
      expect(c.data).not.toHaveProperty('veterinarioId');
      expect(c.data).not.toHaveProperty('autorId');
    }
  });

  it('a cascata roda para cada evolução (prescrição/vacina vão ao plantão)', async () => {
    const db = bancoFalso(abertas);
    await finalizarEvolucoesAbandonadas(db);
    // O agendamento de origem sai de EM_ANDAMENTO — só a evolução 10 tem um.
    expect(db.agendamentoClinico.updateMany).toHaveBeenCalledTimes(1);
    // A vacina é promovida por SQL cru (o status vive fora do client gerado).
    expect(db.chamadas.raw.filter(q => /tb_vacinas_clinicas/.test(q))).toHaveLength(2);
  });

  it('a versão é invalidada EM LOTE — quem tem a tela aberta leva 409', async () => {
    const db = bancoFalso(abertas);
    await finalizarEvolucoesAbandonadas(db);
    const bump = db.chamadas.raw.filter(q => /SET "versao" = "versao" \+ 1/.test(q));
    // Uma chamada só para as duas evoluções, não uma por evolução.
    expect(bump).toHaveLength(1);
  });

  it('o resumo conta quantos foram fechados (vai para a Monitoração)', async () => {
    const r = await finalizarEvolucoesAbandonadas(bancoFalso(abertas));
    expect(r.ok).toBe(true);
    expect(r.notificar).toBe(true);
    expect(r.resumo).toMatch(/2 atendimento/);
    expect(r.resumo).toMatch(/Finalizada pelo Sistema/);
  });
});

describe('gate estrutural — os elos que somem em silêncio', () => {
  it('o job está registrado em server.ts', () => {
    const server = semComentarios(lerFonte('server.ts'));
    expect(server).toMatch(/registrarJob\('finalizar_evolucoes_abandonadas'/);
    expect(server).toMatch(/finalizarEvolucoesAbandonadas/);
  });

  it('roda POR EMPRESA (o `tx` com tenant carimbado), nunca solto', () => {
    // Sem `porEmpresa` o cron chega sem tenant e o RLS devolve ZERO linha — em
    // silêncio, que é o pior resultado possível (armadilha de 2026-08-23, parte 4).
    const server = semComentarios(lerFonte('server.ts'));
    expect(server).toMatch(/porEmpresa\('EvolucaoAbandonada-Cron'[\s\S]*?finalizarEvolucoesAbandonadas\)/);
  });

  it('roda DEPOIS dos crons de cancelamento (23:30 e 23:40)', () => {
    // Antes deles, a rotina mandaria a prescrição ao plantão no mesmo minuto em que o
    // outro cron a cancelaria por fim de janela.
    const server = lerFonte('server.ts');
    const bloco = server.slice(server.indexOf("registrarJob('finalizar_evolucoes_abandonadas'"));
    const expr = bloco.match(/exprPadrao:\s*'([^']+)'/)[1];
    expect(Number(expr.split(' ')[0])).toBeGreaterThan(40);
  });

  it('o service usa a cascata COMPARTILHADA, não uma cópia própria', () => {
    // Duas cópias divergiriam em silêncio: a prescrição iria ao plantão por um
    // caminho e não pelo outro.
    const svc = semComentarios(lerFonte('services/evolucaoCronService.js'));
    expect(svc).toMatch(/require\('\.\.\/lib\/finalizacaoEvolucao'\)/);
    expect(svc).toMatch(/cascataDaFinalizacao\(db,/);
  });
});

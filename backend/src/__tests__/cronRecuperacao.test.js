'use strict';

/**
 * RECUPERAÇÃO DO DISPARO PERDIDO (2026-09-09, a pedido).
 *
 * O pedido: o cancelamento de orçamentos vencidos "precisa rodar diariamente e sempre
 * fazer a busca; se ele falhar ou se o servidor estiver indisponível, deverá rodar
 * normalmente no dia seguinte verificando as datas dos orçamentos em aberto".
 *
 * São DUAS garantias, e as duas quebram em silêncio:
 *
 *   1. A BUSCA É POR DATA DO ORÇAMENTO, nunca "o que venceu desde a última execução".
 *      É o que torna o job idempotente e auto-corretivo — o orçamento que venceu numa
 *      noite sem servidor continua vencido na noite seguinte. Trocar por um cursor de
 *      "última execução" faria o dia perdido ser PULADO para sempre, e nada acusaria.
 *
 *   2. O JOB VOLTA A RODAR. `node-cron` NÃO recupera disparo perdido: com o backend
 *      fora do ar às 23:50, aquele dia simplesmente não acontece — e em ambiente onde
 *      o processo raramente está no ar nesse horário, não acontece nunca. Foi o que
 *      manteve um orçamento de 10/08 em aberto até 08/09, com o job correto e ZERO
 *      execuções no log.
 */

jest.mock('../lib/prisma', () => ({ default: {
  $queryRawUnsafe: jest.fn(),
  cronAgenda: {
    findMany:   jest.fn().mockResolvedValue([]),
    upsert:     jest.fn().mockResolvedValue({}),
    findUnique: jest.fn().mockResolvedValue({ chave: 'z', cronExpr: '0 0 * * *', ativo: false }),
  },
} }), { virtual: true });
jest.mock('node-cron', () => ({ validate: () => true, schedule: () => ({ stop() {} }) }), { virtual: true });
jest.mock('../lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }), { virtual: true });

const fs   = require('fs');
const path = require('path');

const HORA = 60 * 60 * 1000;
const haHoras = (h) => new Date(Date.now() - h * HORA);

describe('cronManager.recuperarJobsPerdidos', () => {
  let prisma, cronManager, cronTrace;

  beforeEach(() => {
    jest.resetModules();
    prisma      = require('../lib/prisma').default;
    cronManager = require('../lib/cronManager');
    cronTrace   = require('../lib/cronTrace');
    prisma.$queryRawUnsafe.mockReset();
  });

  const comUltima = (data) => prisma.$queryRawUnsafe.mockResolvedValue([{ ultima: data }]);

  it('NÃO roda quando a última execução bem-sucedida está dentro da janela', async () => {
    const fn = jest.fn();
    cronManager.registrarJob('x', { nome: 'X', exprPadrao: '0 0 * * *', fn, recuperarSePerdido: true });
    comUltima(haHoras(2));
    await cronManager.recuperarJobsPerdidos();
    expect(fn).not.toHaveBeenCalled();
  });

  it('RODA quando o disparo do dia foi perdido (servidor fora do ar)', async () => {
    const fn = jest.fn();
    cronManager.registrarJob('x', { nome: 'X', exprPadrao: '0 0 * * *', fn, recuperarSePerdido: true });
    comUltima(haHoras(40));
    await cronManager.recuperarJobsPerdidos();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // 🔴 O SEGUNDO CASO DO PEDIDO: "se ele falhar". A consulta filtra `ok = true`, então
  // uma execução que terminou em ERRO não conta como feita. Aceitar qualquer linha
  // faria uma falha diária silenciar a recuperação para sempre.
  it('a consulta considera só execução BEM-SUCEDIDA', async () => {
    const fn = jest.fn();
    cronManager.registrarJob('x', { nome: 'X', exprPadrao: '0 0 * * *', fn, recuperarSePerdido: true });
    comUltima(haHoras(40));
    await cronManager.recuperarJobsPerdidos();
    const [sql, nome] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(sql).toMatch(/ok\s*=\s*true/);
    expect(sql).toMatch(/max\("executadoEm"\)/);
    expect(nome).toBe('X');
  });

  it('RODA quando não há nenhuma execução registrada (base nova / log expurgado)', async () => {
    const fn = jest.fn();
    cronManager.registrarJob('x', { nome: 'X', exprPadrao: '0 0 * * *', fn, recuperarSePerdido: true });
    comUltima(null);
    await cronManager.recuperarJobsPerdidos();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('os limites da recuperação — o que ela NÃO pode fazer', () => {
  let prisma, cronManager;

  beforeEach(() => {
    jest.resetModules();
    prisma      = require('../lib/prisma').default;
    cronManager = require('../lib/cronManager');
    prisma.$queryRawUnsafe.mockReset().mockResolvedValue([{ ultima: null }]);
  });

  // Ligar isto em job de MENSAGEM mandaria ao cliente um aviso sobre um prazo que já
  // passou — pior que não mandar. Por isso é opt-in, e o default tem de ser NÃO.
  it('job sem `recuperarSePerdido` não é recuperado', async () => {
    const fn = jest.fn();
    cronManager.registrarJob('y', { nome: 'Y', exprPadrao: '0 0 * * *', fn });
    await cronManager.recuperarJobsPerdidos();
    expect(fn).not.toHaveBeenCalled();
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  // `ativo: false` é decisão do ADMIN na tela de Configuração; ressuscitar o job na
  // subida a desfaria pelas costas dele.
  it('agenda DESLIGADA pelo ADMIN não é ressuscitada', async () => {
    const fn = jest.fn();
    cronManager.registrarJob('z', { nome: 'Z', exprPadrao: '0 0 * * *', fn, recuperarSePerdido: true });
    await cronManager.reagendar('z', { ativo: false });
    expect(cronManager.listarJobs().find(j => j.chave === 'z').ativo).toBe(false);
    await cronManager.recuperarJobsPerdidos();
    expect(fn).not.toHaveBeenCalled();
  });

  // Falhar a recuperação não pode derrubar a subida do backend nem impedir os demais.
  it('um job que lança não impede a recuperação dos outros', async () => {
    const quebrado = jest.fn(() => { throw new Error('boom'); });
    const bom      = jest.fn();
    cronManager.registrarJob('a', { nome: 'A', exprPadrao: '0 0 * * *', fn: quebrado, recuperarSePerdido: true });
    cronManager.registrarJob('b', { nome: 'B', exprPadrao: '0 0 * * *', fn: bom,      recuperarSePerdido: true });
    await expect(cronManager.recuperarJobsPerdidos()).resolves.toBeUndefined();
    expect(quebrado).toHaveBeenCalled();
    expect(bom).toHaveBeenCalled();
  });

  // Sem valor PRÓPRIO no log, a execução atrasada ficaria indistinguível da que
  // aconteceu no horário — e a próxima investigação começaria de um log que mente.
  it('marca a execução como RECUPERACAO no histórico', async () => {
    const cronTrace = require('../lib/cronTrace');
    let origem = null;
    cronManager.registrarJob('c', {
      nome: 'C', exprPadrao: '0 0 * * *', recuperarSePerdido: true,
      fn: () => { origem = cronTrace.origemAtual(); },
    });
    await cronManager.recuperarJobsPerdidos();
    expect(origem).toBe('RECUPERACAO');
    // `tb_cron_execucoes.origem` é VARCHAR(12) — o valor tem de caber.
    expect('RECUPERACAO'.length).toBeLessThanOrEqual(12);
  });
});

// ---------------------------------------------------------------------------
describe('🔴 GATE — as duas garantias do cancelamento de orçamentos', () => {
  const RAIZ = path.join(__dirname, '..');
  const ler  = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  const semComentarios = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('a busca é por DATA do orçamento, não por "desde a última execução"', () => {
    const src = semComentarios(ler('services/orcamentoCronService.js'));
    // `createdAt < (agora - validade)` é o que faz o dia perdido ser recuperado
    // sozinho: o vencido de ontem continua vencido hoje. Um cursor de última
    // execução puliria aquele dia para sempre.
    expect(src).toMatch(/createdAt:\s*\{\s*lt:\s*limite\s*\}/);
    expect(src).toMatch(/escopo\.dias\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it('o job está marcado para recuperar disparo perdido', () => {
    const src = semComentarios(ler('server.ts'));
    const ini = src.indexOf("registrarJob('cancelar_orcamentos_vencidos'");
    expect(ini).toBeGreaterThan(-1);
    const corpo = src.slice(ini, src.indexOf('});', ini));
    expect(corpo).toMatch(/recuperarSePerdido:\s*true/);
    // Diariamente: o pedido foi "rodar diariamente e sempre fazer a busca".
    expect(corpo).toMatch(/exprPadrao:\s*'[^']*\*\s\*\s\*'/);
  });

  it('a subida do backend agenda e SÓ ENTÃO recupera', () => {
    const src = semComentarios(ler('server.ts'));
    // A recuperação lê o `ativo` que `iniciarJobs` carrega do banco — invertida, ela
    // ressuscitaria job que o ADMIN desligou.
    expect(src).toMatch(/iniciarJobs\(\)\s*\.then\(\(\)\s*=>\s*recuperarJobsPerdidos\(\)\)/);
  });

  it('nenhum job de MENSAGEM foi marcado para recuperação', () => {
    // Recuperar um lembrete/aviso mandaria ao cliente uma mensagem sobre um prazo que
    // já passou. A varredura é sobre os jobs cujo nome denuncia envio.
    const src = semComentarios(ler('server.ts'));
    for (const chave of ['lembrete_d1_email', 'lembrete_whatsapp', 'lembrete_dose_prescricao',
                         'avisar_orcamentos_em_aberto', 'avisar_orcamentos_a_expirar',
                         'reenviar_links_fatura']) {
      const ini = src.indexOf(`registrarJob('${chave}'`);
      expect(ini).toBeGreaterThan(-1);
      expect(src.slice(ini, src.indexOf('});', ini))).not.toMatch(/recuperarSePerdido/);
    }
  });
});

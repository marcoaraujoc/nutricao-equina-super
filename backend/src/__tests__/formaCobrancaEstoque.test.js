// Forma de cobrança de medicamento/vacina — o que quebra em SILÊNCIO aqui é o PREÇO
// que vai para a fatura do cliente: um erro não derruba tela nenhuma, só cobra o
// valor errado. Os casos abaixo são os do pedido (2026-09-10), com os números
// conferidos à mão.
'use strict';

const fc = require('../lib/formaCobrancaEstoque');

// Estoque do exemplo: 2 un a R$ 120 (lote velho) e 6 un a R$ 150 (lote novo).
const ESTOQUE = [
  { preco: 120, qtd: 2 },
  { preco: 150, qtd: 6 },
];

describe('precoDeVenda — as quatro formas', () => {
  test('VALOR_REPASSADO cobra o preço DO LOTE debitado (comportamento histórico)', () => {
    const cfg = { forma: fc.FORMAS.VALOR_REPASSADO, percentual: null };
    expect(fc.precoDeVenda(cfg, 120, ESTOQUE)).toBe(120);
    expect(fc.precoDeVenda(cfg, 150, ESTOQUE)).toBe(150);
  });

  test('config ausente/nula cai em VALOR_REPASSADO — nenhuma clínica muda de preço', () => {
    expect(fc.precoDeVenda(null, 120, ESTOQUE)).toBe(120);
    expect(fc.precoDeVenda({}, 150, ESTOQUE)).toBe(150);
    expect(fc.precoDeVenda({ forma: 'QUALQUER_COISA' }, 150, ESTOQUE)).toBe(150);
  });

  test('PERCENTUAL acresce sobre o preço do lote — 10% → 132 e 165', () => {
    const cfg = { forma: fc.FORMAS.PERCENTUAL, percentual: 10 };
    expect(fc.precoDeVenda(cfg, 120, ESTOQUE)).toBeCloseTo(132, 6);
    expect(fc.precoDeVenda(cfg, 150, ESTOQUE)).toBeCloseTo(165, 6);
  });

  test('PERCENTUAL sem número configurado não inventa acréscimo', () => {
    const cfg = { forma: fc.FORMAS.PERCENTUAL, percentual: null };
    expect(fc.precoDeVenda(cfg, 120, ESTOQUE)).toBe(120);
  });

  test('MAIOR_VALOR usa o maior repassado do estoque — 150 para os DOIS lotes', () => {
    const cfg = { forma: fc.FORMAS.MAIOR_VALOR, percentual: null };
    expect(fc.precoDeVenda(cfg, 120, ESTOQUE)).toBe(150);
    expect(fc.precoDeVenda(cfg, 150, ESTOQUE)).toBe(150);
  });

  test('CUSTO_MEDIO é ponderado pela quantidade — (2×120 + 6×150)/8 = 142,50', () => {
    const cfg = { forma: fc.FORMAS.CUSTO_MEDIO, percentual: null };
    expect(fc.precoDeVenda(cfg, 120, ESTOQUE)).toBeCloseTo(142.5, 6);
    expect(fc.precoDeVenda(cfg, 150, ESTOQUE)).toBeCloseTo(142.5, 6);
  });

  test('🔴 MAIOR_VALOR e CUSTO_MEDIO dão o MESMO preço aos dois lotes — é isso que faz a fatura sair em UMA linha', () => {
    for (const forma of [fc.FORMAS.MAIOR_VALOR, fc.FORMAS.CUSTO_MEDIO]) {
      const cfg = { forma, percentual: null };
      expect(fc.precoDeVenda(cfg, 120, ESTOQUE)).toBe(fc.precoDeVenda(cfg, 150, ESTOQUE));
    }
  });

  test('lote SEM SALDO fica fora da conta — zerado e caro não puxa o preço para cima', () => {
    const comZerado = [...ESTOQUE, { preco: 900, qtd: 0 }];
    expect(fc.precoDeVenda({ forma: fc.FORMAS.MAIOR_VALOR }, 120, comZerado)).toBe(150);
    expect(fc.precoDeVenda({ forma: fc.FORMAS.CUSTO_MEDIO }, 120, comZerado)).toBeCloseTo(142.5, 6);
  });

  test('sem NENHUMA entrada com saldo (execução forçada) cai no preço do lote, nunca em zero', () => {
    for (const forma of [fc.FORMAS.MAIOR_VALOR, fc.FORMAS.CUSTO_MEDIO]) {
      expect(fc.precoDeVenda({ forma }, 137, [])).toBe(137);
      expect(fc.precoDeVenda({ forma }, 137, [{ preco: 900, qtd: 0 }])).toBe(137);
    }
  });
});

describe('normalizarForma', () => {
  test('undefined não altera nada (PATCH parcial)', () => {
    expect(fc.normalizarForma(undefined, undefined)).toEqual({ forma: undefined, percentual: undefined });
  });

  test('vazio volta ao padrão', () => {
    expect(fc.normalizarForma('', '10')).toEqual({ forma: null, percentual: null });
  });

  test('forma desconhecida é recusada', () => {
    expect(fc.normalizarForma('MENOR_VALOR', null).erro).toBeTruthy();
  });

  test('PERCENTUAL exige o número — sem ele, recusa em vez de gravar 0%', () => {
    expect(fc.normalizarForma('PERCENTUAL', '').erro).toBeTruthy();
    expect(fc.normalizarForma('PERCENTUAL', null).erro).toBeTruthy();
  });

  test('PERCENTUAL aceita vírgula e recusa negativo (é acréscimo, não desconto)', () => {
    expect(fc.normalizarForma('PERCENTUAL', '12,5')).toEqual({ forma: 'PERCENTUAL', percentual: 12.5 });
    expect(fc.normalizarForma('PERCENTUAL', '-5').erro).toBeTruthy();
  });

  test('🔴 fora de PERCENTUAL o número é ZERADO — senão ele voltaria a valer sozinho ao trocar a forma de volta', () => {
    expect(fc.normalizarForma('CUSTO_MEDIO', '10')).toEqual({ forma: 'CUSTO_MEDIO', percentual: null });
    expect(fc.normalizarForma('MAIOR_VALOR', '10')).toEqual({ forma: 'MAIOR_VALOR', percentual: null });
    expect(fc.normalizarForma('VALOR_REPASSADO', '10')).toEqual({ forma: 'VALOR_REPASSADO', percentual: null });
  });
});

describe('lerForma — base ainda não migrada', () => {
  test('coluna inexistente devolve o padrão em vez de derrubar a execução', async () => {
    const client = { $queryRawUnsafe: async () => { throw new Error('column does not exist'); } };
    fc.invalidarCache();
    await expect(fc.lerForma(client, 7)).resolves.toEqual({ forma: 'VALOR_REPASSADO', percentual: null });
    fc.invalidarCache();
    await expect(fc.lerFormaDoEscopo(client, 7, null)).resolves.toEqual({ forma: 'VALOR_REPASSADO', percentual: null });
  });

  test('sem empresa no contexto não consulta o banco', async () => {
    let chamou = false;
    const client = { $queryRawUnsafe: async () => { chamou = true; return []; } };
    fc.invalidarCache();
    await expect(fc.lerForma(client, null)).resolves.toEqual({ forma: 'VALOR_REPASSADO', percentual: null });
    expect(chamou).toBe(false);
  });

  test('empresa PESSOAL (config por equipe) é alcançada pelo fallback de escopo', async () => {
    const client = {
      $queryRawUnsafe: async () => [{ forma: 'CUSTO_MEDIO', percentual: null }],
    };
    fc.invalidarCache();
    await expect(fc.lerForma(client, 42)).resolves.toEqual({ forma: 'CUSTO_MEDIO', percentual: null });
  });
});

describe('salvarForma', () => {
  test('undefined não emite UPDATE nenhum', async () => {
    let sqls = [];
    const client = { $executeRawUnsafe: async (sql) => { sqls.push(sql); } };
    await fc.salvarForma(client, 1, null, undefined, undefined);
    expect(sqls).toHaveLength(0);
  });

  test('🔴 usa aspas em "empresaId"/"equipeId" — a tabela é das poucas SEM @map (armadilha 41)', async () => {
    const sqls = [];
    const client = { $executeRawUnsafe: async (sql) => { sqls.push(sql); } };
    await fc.salvarForma(client, 1, null, 'PERCENTUAL', 10);
    await fc.salvarForma(client, 1, 9, 'PERCENTUAL', 10);
    expect(sqls).toHaveLength(2);
    for (const sql of sqls) {
      expect(sql).toMatch(/"empresaId"/);
      expect(sql).not.toMatch(/empresa_id/);
    }
    expect(sqls[0]).toMatch(/"equipeId" IS NULL/);
    expect(sqls[1]).toMatch(/"equipeId" = \$4/);
  });
});

// ─── GATE ESTRUTURAL ─────────────────────────────────────────────────────────
// O modo de quebrar esta regra é ESQUECER a chamada num caminho de cobrança: o preço
// volta a ser o do lote e NADA acusa — nem erro, nem tela, nem o teste de unidade da
// função pura. Por isso a varredura é no CÓDIGO.
describe('gate — a forma de cobrança está ligada onde o preço nasce', () => {
  const fs   = require('fs');
  const path = require('path');
  const ler  = (f) => fs.readFileSync(path.join(__dirname, '..', 'controllers', f), 'utf8');
  // Comentário que EXPLICA a regra não pode fazer o gate passar sozinho.
  const semComentarios = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  test('debitarEstoqueDia (medicamento) precifica pela forma configurada', () => {
    const src = semComentarios(ler('PrescricaoGrupoController.js'));
    expect(src).toMatch(/formaCobranca\.lerForma\(tx, empresaId\)/);
    expect(src).toMatch(/formaCobranca\.precoDeVenda\(/);
    // 🔴 O retrato do estoque tem de ser tirado ANTES do laço de baixa: depois dele,
    // cada lote debitado mudaria o preço dos seguintes na mesma execução.
    const iRetrato = src.indexOf('entradasParaCobranca(estoques');
    const iBaixa   = src.indexOf("tipo: 'SAIDA', quantidade: deduzido");
    expect(iRetrato).toBeGreaterThan(-1);
    expect(iBaixa).toBeGreaterThan(iRetrato);
  });

  test('darBaixaEFaturar (vacina) precifica pela forma configurada', () => {
    const src = semComentarios(ler('VacinaClinicaController.js'));
    expect(src).toMatch(/formaCobranca\.lerForma\(tx, empresaIdEfetivo\)/);
    expect(src).toMatch(/formaCobranca\.precoDeVenda\(cfgCobranca, loteValor, entradas\)/);
    // O retrato dos lotes é lido antes de consumir a reserva, que já dá baixa.
    const iRetrato = src.indexOf('entradasCobrancaVacina(tx, info.medicamentoCatId');
    const iConsumo = src.indexOf('consumirReservaVacina(tx, vacina.id)');
    expect(iRetrato).toBeGreaterThan(-1);
    expect(iConsumo).toBeGreaterThan(iRetrato);
  });

  test('EquipeController lê E grava a forma nas configurações', () => {
    const src = semComentarios(ler('EquipeController.js'));
    expect(src).toMatch(/formaCobranca\.normalizarForma\(/);
    expect(src).toMatch(/formaCobranca\.salvarForma\(/);
    expect(src).toMatch(/formaCobrancaEstoque:\s+cobranca\.forma/);
  });
});


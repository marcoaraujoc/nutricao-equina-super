'use strict';

/**
 * FECHAR A FATURA POR ANIMAL (2026-09-22).
 *
 * A fatura é do PROPRIETÁRIO e junta todos os pacientes dele. Fechar por animal encerra
 * o bloco de UM deles: os lançamentos ficam no documento, marcados, e SAEM do total.
 *
 * Três regras aqui quebram EM SILÊNCIO, e as três são dinheiro:
 *
 *  1. **`recalcularTotal` tem de separar aberto de fechado.** Se voltar a somar tudo, o
 *     bloco "fechado" é cobrado DE NOVO no total da fatura — sem erro, sem log, com a
 *     fatura fechando "certa" na soma das linhas.
 *  2. **Fechar de novo não pode reescrever a data do fechamento anterior.** Sem o
 *     `fechado_em IS NULL` no WHERE, a segunda rodada carimba tudo com a data de hoje e
 *     o histórico do bloco se perde.
 *  3. **Os indicadores de "a receber" têm de somar `total + totalFechado`.** O bloco
 *     fechado continua DEVIDO (é acertado à parte, não perdoado): somar só `total` faz o
 *     Dashboard, os Relatórios e os Devedores encolherem a cada fechamento, e ninguém
 *     liga a queda a um ato feito semanas antes.
 *
 * Por isso metade daqui é GATE ESTRUTURAL: o modo de quebrar estas regras é apagar um
 * elo, e o sintoma é um número plausível a menos.
 */

const fs   = require('fs');
const path = require('path');

const { recalcularTotal, valorLiquidoItem } = require('../lib/faturaUtils');
const fechamento = require('../lib/faturaFechamentoAnimal');

const raiz = path.join(__dirname, '..');
const ler  = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
/** Tira comentários: gate que se satisfaz com a própria documentação é gate que se
 *  aprende a ignorar (mesma lição de `pacienteDeClienteInativo`). */
const semComentarios = (txt) =>
  txt.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// 1. O TOTAL — aberto conta, fechado sai
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Client falso para `recalcularTotal`. `fechadosDaFatura` é injetado pelo próprio teste
 * (em produção ele lê `fechado_em` por SQL cru), e `gravarTotais` cai no ramo "base não
 * migrada" quando não há colunas — por isso `fatura.update` precisa existir.
 */
function clienteFalso(itens) {
  const gravado = { total: null, totalFechado: null };
  return {
    gravado,
    faturaItem: { findMany: async () => itens },
    fatura:     { update: async ({ data }) => { gravado.total = data.total; return data; } },
  };
}

const item = (id, valor, quantidade, extra = {}) => ({
  id, valor, quantidade, descontoTipo: null, descontoValor: 0, ...extra,
});

describe('recalcularTotal separa o que a fatura cobra do que foi fechado à parte', () => {
  let espiao;
  afterEach(() => espiao?.mockRestore());

  const comFechados = (ids) => {
    espiao = jest.spyOn(fechamento, 'fechadosDaFatura')
      .mockResolvedValue(new Map(ids.map(id => [id, { fechadoEm: '2026-09-22T10:00:00', fechadoPorId: 1 }])));
  };

  it('sem nenhum bloco fechado, o total é a soma de todos os itens (comportamento de sempre)', async () => {
    comFechados([]);
    const client = clienteFalso([item(1, 100, 1), item(2, 50, 2)]);
    const total = await recalcularTotal(client, 1);
    expect(total).toBeCloseTo(200, 2);
  });

  it('🔴 o item do bloco FECHADO sai do total', async () => {
    comFechados([2]);
    const client = clienteFalso([item(1, 100, 1), item(2, 50, 2)]);
    const total = await recalcularTotal(client, 1);
    // 100 aberto; os 100 do item 2 foram fechados à parte
    expect(total).toBeCloseTo(100, 2);
  });

  it('🔴 o que sai do total vai para `totalFechado` — nada é perdido', async () => {
    comFechados([2]);
    const capturado = {};
    const espiaoGravar = jest.spyOn(fechamento, 'gravarTotais')
      .mockImplementation(async (_c, _id, totais) => { Object.assign(capturado, totais); });
    await recalcularTotal(clienteFalso([item(1, 100, 1), item(2, 50, 2)]), 1);
    expect(capturado.total).toBeCloseTo(100, 2);
    expect(capturado.totalFechado).toBeCloseTo(100, 2);
    // A soma dos dois continua sendo a soma das linhas: o fechamento MOVE, não apaga.
    expect(capturado.total + capturado.totalFechado).toBeCloseTo(200, 2);
    espiaoGravar.mockRestore();
  });

  it('o DESCONTO do item é respeitado dos dois lados', async () => {
    comFechados([2]);
    const capturado = {};
    const espiaoGravar = jest.spyOn(fechamento, 'gravarTotais')
      .mockImplementation(async (_c, _id, totais) => { Object.assign(capturado, totais); });
    const abertoComDesconto  = item(1, 100, 1, { descontoTipo: 'PERCENTUAL', descontoValor: 10 });
    const fechadoComDesconto = item(2, 100, 1, { descontoTipo: 'VALOR', descontoValor: 25 });
    await recalcularTotal(clienteFalso([abertoComDesconto, fechadoComDesconto]), 1);
    expect(capturado.total).toBeCloseTo(valorLiquidoItem(abertoComDesconto), 2);        // 90
    expect(capturado.totalFechado).toBeCloseTo(valorLiquidoItem(fechadoComDesconto), 2); // 75
    espiaoGravar.mockRestore();
  });

  it('fatura com TODOS os blocos fechados cobra ZERO — e o valor não some, fica em totalFechado', async () => {
    comFechados([1, 2]);
    const capturado = {};
    const espiaoGravar = jest.spyOn(fechamento, 'gravarTotais')
      .mockImplementation(async (_c, _id, totais) => { Object.assign(capturado, totais); });
    await recalcularTotal(clienteFalso([item(1, 100, 1), item(2, 50, 2)]), 1);
    expect(capturado.total).toBe(0);
    expect(capturado.totalFechado).toBeCloseTo(200, 2);
    espiaoGravar.mockRestore();
  });

  it('base ainda NÃO migrada grava só o `total` — e ele é a soma de tudo, como antes', async () => {
    // Sem as colunas, `fechadosDaFatura` devolve mapa vazio e `gravarTotais` usa o
    // client tipado. É o que preserva a fatura de quem ainda não aplicou a migration.
    const client = clienteFalso([item(1, 100, 1), item(2, 50, 2)]);
    const total = await recalcularTotal(client, 1);
    expect(total).toBeCloseTo(200, 2);
    expect(client.gravado.total).toBeCloseTo(200, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GATE — o SQL do fechamento
// ─────────────────────────────────────────────────────────────────────────────

describe('gate: o SQL de fechar/reabrir o bloco do paciente', () => {
  const lib = ler('lib/faturaFechamentoAnimal.js');

  it('🔴 fechar só marca o que está ABERTO — a data do fechamento anterior fica de pé', () => {
    const trecho = lib.slice(lib.indexOf('async function fecharAnimal'));
    expect(trecho).toMatch(/"fechado_em" IS NULL/);
  });

  it('🔴 grava `NOW() AT TIME ZONE \'UTC\'`, nunca `NOW()` puro (a hora sairia 3h atrás)', () => {
    expect(lib).toMatch(/NOW\(\) AT TIME ZONE 'UTC'/);
    expect(semComentarios(lib)).not.toMatch(/=\s*NOW\(\)\s*,/);
  });

  it('reabrir só mexe no que está FECHADO', () => {
    const trecho = lib.slice(lib.indexOf('async function reabrirAnimal'));
    expect(trecho).toMatch(/"fechado_em" IS NOT NULL/);
  });

  it('o recorte é sempre (fatura, animal) — nunca só o animal, que alcançaria outras faturas', () => {
    for (const fn of ['fecharAnimal', 'reabrirAnimal', 'contarAbertosDoAnimal', 'contarFechadosDoAnimal']) {
      const trecho = lib.slice(lib.indexOf(`async function ${fn}`), lib.indexOf(`async function ${fn}`) + 900);
      expect(trecho).toMatch(/"faturaId" = \$1 AND "animalId" = \$2/);
    }
  });

  it('a guarda de coluna usa o client GLOBAL, nunca o `tx` (SQL cru inválido aborta a transaction inteira)', () => {
    const trecho = lib.slice(lib.indexOf('async function temColunas'), lib.indexOf('async function fechadosDaFatura'));
    expect(trecho).toMatch(/prismaGlobal\(\)\.\$queryRawUnsafe/);
    expect(trecho).not.toMatch(/clienteOu\(/);
  });

  it('não importa `lib/prisma` no topo (é TypeScript: derrubaria a carga do módulo no jest)', () => {
    // Sem comentários: o cabeçalho deste arquivo EXPLICA a regra citando o `require`,
    // e olhar o texto cru faria o gate reprovar a própria documentação dele.
    const topo = semComentarios(lib.slice(0, lib.indexOf('function prismaGlobal')));
    expect(topo).not.toMatch(/require\('\.\/prisma'\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GATE — o controller e a rota
// ─────────────────────────────────────────────────────────────────────────────

describe('gate: quem pode fechar o bloco, e quando', () => {
  const ctrl  = ler('controllers/FaturaController.js');
  const rotas = ler('routes/fatura.js');
  const trecho = ctrl.slice(ctrl.indexOf('async function alterarFechamentoDoAnimal'),
                            ctrl.indexOf('const FaturaController = {'));

  it('a fatura de OUTRA clínica responde 404 (isolamento entre empresas)', () => {
    expect(trecho).toMatch(/faturaForaDoEscopo\(alvo, req\)/);
    expect(trecho).toMatch(/404/);
  });

  it('🔴 fatura PAGA é somente leitura — mover valor mudaria o que o cliente já quitou', () => {
    expect(trecho).toMatch(/status === 'PAGA'/);
    expect(trecho).toMatch(/FATURA_PAGA/);
  });

  it('fatura CANCELADA também não aceita', () => {
    expect(trecho).toMatch(/status === 'CANCELADA'/);
  });

  it('bloco sem nada a fechar/reabrir recusa, em vez de dizer que fechou', () => {
    expect(trecho).toMatch(/NADA_A_FECHAR/);
    expect(trecho).toMatch(/NADA_A_REABRIR/);
  });

  it('🔴 marcar, recalcular e auditar acontecem na MESMA transaction', () => {
    const tx = trecho.slice(trecho.indexOf('prisma.$transaction'));
    expect(tx).toMatch(/fechamentoAnimal\.(fecharAnimal|reabrirAnimal)\(tx/);
    expect(tx).toMatch(/recalcularTotalCompartilhado\(tx, faturaId\)/);
    expect(tx).toMatch(/registrarAuditoria\(tx, req/);
  });

  it('base sem a migration diz que o recurso está indisponível, em vez de fingir que fechou', () => {
    expect(trecho).toMatch(/temColunas\(\)/);
    expect(trecho).toMatch(/FECHAMENTO_ANIMAL_INDISPONIVEL/);
  });

  it('as duas rotas existem e usam o slug de FECHAR — quem encerra é quem desfaz', () => {
    expect(rotas).toMatch(/animais\/:animalId\/fechar.*financeiro\.faturas\.fechar/);
    expect(rotas).toMatch(/animais\/:animalId\/reabrir.*financeiro\.faturas\.fechar/);
  });

  it('🔴 a leitura da fatura anexa `fechadoEm` aos itens (sem isso a tela mostra o fechado como aberto)', () => {
    const leitura = ctrl.slice(ctrl.indexOf('async function comPerfilDaEmpresa'),
                               ctrl.indexOf('async function comOrigensDetalhadas'));
    expect(leitura).toMatch(/fechamentoAnimal\.anexarFechamento/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GATE — o dinheiro a receber não pode encolher em silêncio
// ─────────────────────────────────────────────────────────────────────────────

describe('gate: "contas a receber" soma total + totalFechado', () => {
  const alvos = [
    ['controllers/DashboardController.js',          'contasReceberVencidas'],
    ['controllers/RelatoriosController.js',          'contasReceber'],
    ['controllers/RelatorioGerencialController.js',  'totalDevido'],
  ];

  it.each(alvos)('%s soma o bloco fechado em %s', (arquivo) => {
    const txt = semComentarios(ler(arquivo));
    expect(txt).toMatch(/totalFechadoPorFatura/);
    expect(txt).toMatch(/fechadoPorFatura\.get\(f\.id\)/);
  });

  it('o ranking de melhores pagadores também soma — senão quem pagou só bloco fechado some', () => {
    const txt = ler('controllers/RelatorioGerencialController.js');
    const trecho = txt.slice(txt.indexOf('async function blocoMelhoresPagadores'));
    expect(trecho).toMatch(/fechadoPorFatura\.get\(f\.id\)/);
    // O `take: 15` tem de vir DEPOIS da soma: ordenado por `total` no banco, o cliente
    // cujo pagamento inteiro esteja no bloco fechado ficaria fora do top 15.
    expect(trecho).toMatch(/\.slice\(0, 15\)/);
  });

  it('⚠️ o FATURAMENTO do período NÃO muda — ele soma ITENS, e o item fechado é receita', () => {
    const txt = ler('controllers/RelatoriosController.js');
    const trecho = txt.slice(txt.indexOf('for (const i of itensAno)'), txt.indexOf('// Ticket médio'));
    expect(trecho).not.toMatch(/fechado/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GATE — a migration e a tela
// ─────────────────────────────────────────────────────────────────────────────

describe('gate: migration e tela', () => {
  const migration = fs.readFileSync(
    path.join(raiz, '..', 'prisma', 'migrations', '20261018000000_fatura_fechamento_por_animal', 'migration.sql'),
    'utf8');

  it('a migration é ADITIVA — nenhuma linha existente muda de valor', () => {
    const sql = migration.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "fechado_em"/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "total_fechado"/);
  });

  it('`total_fechado` nasce em 0 — toda fatura existente segue cobrando o mesmo', () => {
    expect(migration).toMatch(/"total_fechado" DOUBLE PRECISION NOT NULL DEFAULT 0/);
  });

  it('🔴 a tela tira o item fechado do subtotal do paciente', () => {
    const tela = semComentarios(ler('../../frontend/src/pages/Faturamento.tsx'));
    expect(tela).toMatch(/const itensAbertos\s*=\s*todosItens\.filter\(i => !i\.fechadoEm\)/);
    expect(tela).toMatch(/const subtotal\s*=\s*itensAbertos\.reduce/);
  });

  it('🔴 a folha impressa mostra o bloco fechado FORA do total (o cliente precisa conferir)', () => {
    const exportacao = semComentarios(ler('../../frontend/src/utils/FaturaExport.ts'));
    expect(exportacao).toMatch(/const totalFechado\s*=\s*fatura\.itens\.filter\(i => !!i\.fechadoEm\)/);
    expect(exportacao).toMatch(/Fechado à parte/);
  });
});

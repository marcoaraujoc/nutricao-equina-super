// FORMA DE CÁLCULO — a embalagem deixou de ser a própria unidade (2026-09-16).
//
// O QUE QUEBRA EM SILÊNCIO AQUI, e é por isso que o arquivo existe:
//   1. o frasco de 20 mL era cadastrado como "1 Un.". A receita saía em mL,
//      `mesmoGrupo('mL','Un.')` é FALSO e a baixa caía no valor BRUTO: uma dose de
//      5 mL debitava 5 FRASCOS e cobrava 5 frascos. Nenhum erro, nenhuma tela acusando;
//   2. deixar o ESTOQUE contar numa unidade e a RECEITA ser escrita em outra devolve o
//      mesmo defeito por outro caminho — por isso `unidadeDoEstoque` tem de valer na
//      reserva, na baixa e nas três verificações, não só numa delas;
//   3. `qtdPorEmbalagem` nulo tratado como 1 afirmaria "a embalagem tem uma unidade da
//      forma" para todo item que não declara conteúdo;
//   4. marcar multidose numa linha GLOBAL do catálogo mudaria a cobrança de TODAS as
//      clínicas do SaaS.
//
// ⚠️ ESTE ARQUIVO SUBSTITUI a versão que testava a semântica ANTIGA de multidose
// ("N aplicações por frasco, desconta 1/N"). Ela foi trocada a pedido: hoje o produto
// declara QUANTO cabe na embalagem e EM QUÊ, e não há mais divisão por doses.
'use strict';

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
const Prescricao = require('../controllers/PrescricaoGrupoController');
const forma      = require('../lib/formaCalculo');

const { qtdDoEstoque } = Prescricao;
const leia = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
// Comentários explicam a regra CITANDO as mesmas palavras; um gate que se satisfaz
// com a própria documentação é um gate que se aprende a ignorar.
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ─── 1. A CONTA QUE VAI PARA O ESTOQUE E PARA A FATURA ───────────────────────
describe('quantidade que sai do estoque', () => {
  test('receita e estoque na MESMA unidade: 5 mL saem de 60 mL, sem conversão', () => {
    expect(qtdDoEstoque(5, 'mL', 'mL')).toBeCloseTo(5, 6);
  });

  test('unidades do mesmo grupo continuam convertendo: 500 g -> 0,5 kg', () => {
    expect(qtdDoEstoque(500, 'g', 'kg')).toBeCloseTo(0.5, 6);
    expect(qtdDoEstoque(2, 'L', 'mL')).toBeCloseTo(2000, 6);
  });

  test('unidades incompatíveis subtraem direto — o comportamento legado', () => {
    expect(qtdDoEstoque(10, 'mL', 'Un.')).toBe(10);
  });

  test('fração não é truncada: 2,5 mL é dosagem legítima', () => {
    expect(qtdDoEstoque(2.5, 'mL', 'mL')).toBeCloseTo(2.5, 6);
  });
});

// ─── 2. A FATURA — o exemplo que originou a mudança ──────────────────────────
describe('cobrança por conteúdo da embalagem', () => {
  // Produto: Forma de Cálculo mL, Qtd 20 (a embalagem tem 20 mL).
  // Estoque: Qtd Produto 3 -> Qtd Total 60 mL; Valor Unitário Cobrado R$ 100 por
  // embalagem -> R$ 300 no total da entrada.
  const QTD_POR_EMBALAGEM = 20;
  const PRECO_EMBALAGEM   = 100;
  const EMBALAGENS        = 3;

  const qtdTotal   = EMBALAGENS * QTD_POR_EMBALAGEM;   // 60 mL
  const valorTotal = EMBALAGENS * PRECO_EMBALAGEM;     // R$ 300
  // É o que `calcPrecoUnitarioBase` grava na entrada: valor ÷ quantidade.
  const precoPorMl = valorTotal / qtdTotal;            // R$ 5/mL

  test('a baixa de 5 mL deixa 55 mL', () => {
    expect(qtdTotal - qtdDoEstoque(5, 'mL', 'mL')).toBeCloseTo(55, 6);
  });

  test('a linha da fatura é qtd x valorUnitarioCobrado / qtdPorEmbalagem', () => {
    const valorDaDose = qtdDoEstoque(5, 'mL', 'mL') * precoPorMl;
    expect(valorDaDose).toBeCloseTo(25, 6);
    // A MESMA conta, escrita como o pedido a descreve.
    expect(valorDaDose).toBeCloseTo(5 * PRECO_EMBALAGEM / QTD_POR_EMBALAGEM, 6);
  });

  test('o conteúdo da embalagem é cobrado UMA vez ao longo das aplicações', () => {
    // 20 mL consumidos em 4 aplicações de 5 mL custam exatamente uma embalagem.
    const total = [5, 5, 5, 5].reduce((s, q) => s + qtdDoEstoque(q, 'mL', 'mL') * precoPorMl, 0);
    expect(total).toBeCloseTo(PRECO_EMBALAGEM, 6);
  });
});

// ─── 3. A LIB DA FORMA DE CÁLCULO ────────────────────────────────────────────
describe('lib/formaCalculo', () => {
  test('aceita a grafia gravada no banco, sem caixa', () => {
    expect(forma.normalizarFormaCalculo('ML')).toBe('mL');
    expect(forma.normalizarFormaCalculo(' doses ')).toBe('doses');
    expect(forma.normalizarFormaCalculo('frasco')).toBeNull();
    expect(forma.normalizarFormaCalculo('')).toBeNull();
  });

  test('qtdPorEmbalagem NULO não é 1 — é "não declara conteúdo"', () => {
    expect(forma.qtdPorEmbalagemDe({ multidose: true, qtdPorEmbalagem: null })).toBeNull();
    expect(forma.qtdPorEmbalagemDe({ multidose: false, qtdPorEmbalagem: 20 })).toBeNull();
    expect(forma.qtdPorEmbalagemDe({ multidose: true, qtdPorEmbalagem: 20 })).toBe(20);
    expect(forma.qtdPorEmbalagemDe({ multidose: true, qtdPorEmbalagem: 2.5 })).toBe(2.5);
  });

  test('a unidade operativa é a forma de cálculo — e cai na embalagem sem ela', () => {
    expect(forma.unidadeOperativa({ multidose: true, formaCalculo: 'mL', qtdPorEmbalagem: 20, unidade: 'Frasco' }))
      .toBe('mL');
    // Marcado sem quantidade é PENDÊNCIA de cadastro, não item medido: segue na embalagem.
    expect(forma.unidadeOperativa({ multidose: true, formaCalculo: 'mL', qtdPorEmbalagem: null, unidade: 'Frasco' }))
      .toBe('Frasco');
    expect(forma.unidadeOperativa({ multidose: false, unidade: 'Comprimido' })).toBe('Comprimido');
  });
});

// ─── 4. GATE ESTRUTURAL ──────────────────────────────────────────────────────
// Os elos abaixo somem sem erro nenhum: a execução continua funcionando e só o VALOR
// da fatura (ou o saldo do estoque) fica errado.
describe('elos que somem em silêncio', () => {
  const controller = semComentarios(leia('controllers/PrescricaoGrupoController.js'));

  test('a baixa da dose resolve a unidade pela FORMA DE CÁLCULO', () => {
    expect(controller).toMatch(/async function debitarEstoqueDia[\s\S]{0,900}mapaFormaCalculo\(/);
    expect(controller).toMatch(/let restante = qtdDoEstoque\(qtdDia, item\.unidade, unidadeEstoque\)/);
  });

  test('a RESERVA nasce na MESMA unidade da baixa', () => {
    // ⚠️ RECORTADO em `criarReservas`: a mesma chamada existe em `debitarEstoqueDia` e
    // em `verificarDisponibilidade`, então procurá-la no arquivo INTEIRO passaria mesmo
    // com a reserva voltando a usar a unidade crua da embalagem — e uma reserva numa
    // unidade que o débito não consome trava o saldo para toda a clínica.
    const corpo = controller.slice(controller.indexOf('async function criarReservas'));
    expect(corpo.slice(0, 900)).toMatch(/mapaFormaCalculo\(/);
    expect(corpo.slice(0, 1400)).toMatch(/unidadeDoEstoque\(formas, item,/);
  });

  test('as TRÊS verificações de estoque usam a mesma unidade — senão barram o que cabe', () => {
    for (const fn of ['verificarEstoqueParaDia', 'verificarEstoqueParaExecucao', 'verificarDisponibilidade']) {
      const corpo = controller.slice(controller.indexOf(`async function ${fn}`));
      expect(corpo.slice(0, 1400)).toMatch(/mapaFormaCalculo\(prisma, itens\)/);
      expect(corpo.slice(0, 1800)).toMatch(/unidadeDoEstoque\(formas, item,/);
    }
  });

  test('o lookup roda com o client da TRANSAÇÃO (o prisma global não enxerga o tenant)', () => {
    expect(controller).toMatch(/mapaFormaCalculo\(tx, itens\)/);
  });

  test('a divisão por doses SAIU — o item medido não converte mais nada', () => {
    const fn = controller.slice(controller.indexOf('function qtdDoEstoque'));
    expect(fn.slice(0, 400)).not.toMatch(/dosesPorEmbalagem/);
  });

  test('o preço do estoque é calculado na unidade OPERATIVA, não na da embalagem', () => {
    const estoque = semComentarios(leia('controllers/EstoqueController.js'));
    expect(estoque).toMatch(/calcPrecoUnitarioBase\(Number\(valorRepassado\), Number\(qtdEstoque\), unidadeConta\)/);
    expect(estoque).toMatch(/async function unidadeOperativaDoItem\(/);
  });

  test('multidose marcado exige o PAR forma + quantidade', () => {
    const prod = semComentarios(leia('controllers/ProdutoController.js'));
    expect(prod).toMatch(/normalizarFormaCalculo\(formaCalculo\)\)\s*faltando\.push\('Forma de Cálculo'\)/);
    expect(prod).toMatch(/numeroPositivo\(dosesPorEmbalagem\) == null\)\s*faltando\.push\('Qtd'\)/);
  });

  test('o reforço da vacina deixou de deduzir o tamanho da série da dosagem', () => {
    const vac = semComentarios(leia('controllers/VacinaClinicaController.js'));
    const fn  = vac.slice(vac.indexOf('async function agendarReforcos'));
    expect(fn.slice(0, 500)).not.toMatch(/quantidade/);
    // A dosagem não é mais travada em >= 1: 0,5 mL é cadastro legítimo.
    expect(vac).toMatch(/function dosagemDaVacina\(/);
    expect(vac).not.toMatch(/Math\.max\(1, Number\(quantidade\)/);
  });
});

// ─── 5. MULTI-TENANT, RLS E A MIGRATION ──────────────────────────────────────
describe('multi-tenant e migration', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', '..', 'prisma', 'migrations',
              '20261012000000_forma_calculo_produto', 'migration.sql'), 'utf8');
  const sql = migration.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  test('é ADITIVA: nenhum UPDATE/DELETE de dado gravado', () => {
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP)\b/i);
  });

  test('a forma de cálculo nasce NULA — nenhum cadastro existente muda de cobrança', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "forma_calculo" VARCHAR\(20\)/);
    expect(sql).not.toMatch(/forma_calculo" VARCHAR\(20\) NOT NULL/i);
  });

  test('as quantidades viram DOUBLE PRECISION — inteiro truncaria 2,5 mL em silêncio', () => {
    for (const col of ['doses_por_embalagem', 'quantidade', 'qtd_disponivel', 'doses_por_frasco']) {
      expect(sql).toMatch(new RegExp(`ALTER COLUMN "${col}" TYPE DOUBLE PRECISION`));
    }
  });

  test('só a CÓPIA da empresa é marcada — o catálogo global nunca', () => {
    const med = semComentarios(leia('controllers/MedicamentoController.js'));
    expect(med).toMatch(/WHERE id = \$1 AND empresa_id IS NOT NULL/);
  });

  test('a gravação da forma é por SQL cru com catch — base não migrada não quebra', () => {
    const lib = leia('lib/catalogoEmpresa.js');
    const fn  = lib.slice(lib.indexOf('async function gravarMultidose'));
    expect(fn.slice(0, 1600)).toMatch(/temColunaFormaCalculo\(client\)/);
    expect(fn.slice(0, 1600)).toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  test('o front e o backend oferecem a MESMA lista de formas', () => {
    const ts = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'utils', 'formaCalculo.ts'), 'utf8');
    const m = ts.match(/FORMAS_CALCULO = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const doFront = m[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
    expect(doFront).toEqual(forma.FORMAS_CALCULO);
  });
});

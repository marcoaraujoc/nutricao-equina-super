// PRODUTO MULTIDOSE — o frasco que rende N aplicações (2026-09-12).
//
// O QUE QUEBRA EM SILÊNCIO AQUI, e é por isso que o arquivo existe:
//   1. desde que a UNIDADE virou da clínica, o estoque é contado em EMBALAGENS. A
//      prescrição continua em mL/mg, `mesmoGrupo('mL','Un.')` é FALSO e a baixa caía
//      no valor BRUTO: uma dose de 10 mL debitava 10 FRASCOS e cobrava 10 frascos na
//      fatura. Nenhum erro, nenhuma tela acusando;
//   2. aplicar a regra da dose sem levá-la à RESERVA travaria o frasco inteiro por
//      aplicação, e o estoque da clínica "acabaria" na primeira receita;
//   3. esquecer a contagem (`resolverDoses`) na execução faria a dose voltar a ser
//      cobrada pela DOSAGEM — o defeito original, de volta em silêncio;
//   4. marcar multidose numa linha GLOBAL do catálogo mudaria a cobrança de TODAS as
//      clínicas do SaaS.
'use strict';

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
const Prescricao = require('../controllers/PrescricaoGrupoController');

const { qtdDoEstoque, dosesDoDia, dosesDoCurso } = Prescricao;
const leia = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
// Comentários explicam a regra CITANDO as mesmas palavras; um gate que se satisfaz
// com a própria documentação é um gate que se aprende a ignorar.
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ─── 1. A CONTA DA DOSE ──────────────────────────────────────────────────────
describe('quantidade que sai do estoque', () => {
  test('multidose: cada aplicação tira 1/N da embalagem — não o frasco inteiro', () => {
    // 10 mL prescritos, estoque contado em "Un.", frasco com 5 doses.
    expect(qtdDoEstoque(10, 'mL', 'Un.', 1, 5)).toBeCloseTo(0.2, 6);
  });

  test('multidose: o dia inteiro de um 12/12h tira 2 doses', () => {
    expect(qtdDoEstoque(10, 'mL', 'Un.', 2, 5)).toBeCloseTo(0.4, 6);
  });

  test('SEM multidose, mL contra Un. debita o BRUTO — o defeito que a regra corrige', () => {
    // Este é o comportamento ANTIGO, preservado para quem não marcou nada: 10 mL
    // viram 10 "Un.". É exatamente por isso que o checkbox precisa existir.
    expect(qtdDoEstoque(10, 'mL', 'Un.', 1, null)).toBe(10);
  });

  test('sem multidose, unidades compatíveis continuam convertendo (500 g para 0,5 kg)', () => {
    expect(qtdDoEstoque(500, 'g', 'kg', 1, null)).toBeCloseTo(0.5, 6);
  });

  test('multidose VENCE a conversão: mesmo em mL x mL a dose é 1/N', () => {
    // A clínica declarou que conta em embalagens; a conversão numérica não pode
    // reintroduzir a cobrança por volume pelas costas.
    expect(qtdDoEstoque(10, 'mL', 'mL', 1, 4)).toBeCloseTo(0.25, 6);
  });

  test('N = 1 é legítimo: ampola de dose única contada em unidades', () => {
    expect(qtdDoEstoque(2, 'mL', 'Un.', 1, 1)).toBe(1);
  });

  test('N ausente/zero NAO vira 1 — "não informei" não é "dose única"', () => {
    expect(qtdDoEstoque(10, 'mL', 'Un.', 1, undefined)).toBe(10);
    expect(qtdDoEstoque(10, 'mL', 'Un.', 1, 0)).toBe(10);
  });
});

describe('contagem de aplicações', () => {
  test('"agora" é uma aplicação, no dia e no curso', () => {
    const item = { frequencia: 'agora', duracaoDias: 7 };
    expect(dosesDoDia(item)).toBe(1);
    expect(dosesDoCurso(item)).toBe(1);
  });

  test('12em12h por 7 dias = 2 por dia, 14 no curso', () => {
    const item = { frequencia: '12em12h', duracaoDias: 7 };
    expect(dosesDoDia(item)).toBe(2);
    expect(dosesDoCurso(item)).toBe(14);
  });

  test('1x a cada 3 dias por 21 dias = 7 aplicações no curso', () => {
    // A família multi-dia já é fracionária por DIA (1/3); multiplicada pela duração
    // ela devolve a contagem certa de aplicações — é o que a reserva precisa saber.
    expect(dosesDoCurso({ frequencia: '1x3dias', duracaoDias: 21 })).toBeCloseTo(7, 6);
  });

  test('frequência desconhecida cai em 1/dia (nunca 0 — dose que não conta não é cobrada)', () => {
    expect(dosesDoDia({ frequencia: 'sob demanda' })).toBe(1);
    expect(dosesDoCurso({ frequencia: 'sob demanda', duracaoDias: 0 })).toBe(1);
  });
});

// ─── 2. O VALOR QUE VAI PARA A FATURA ────────────────────────────────────────
// `debitarEstoqueDia` computa `valorDaDose = qtdDebitada x preçoUnitário`. Como a
// unidade contável tem fator 1, a conta abaixo é literalmente a do controller.
describe('cobrança por dose', () => {
  const valorDaDose = (precoDaEmbalagem, doses, dosesPorEmb) =>
    qtdDoEstoque(10, 'mL', 'Un.', doses, dosesPorEmb) * precoDaEmbalagem;

  test('frasco de R$ 100 com 5 doses: a dose entra na fatura por R$ 20', () => {
    expect(valorDaDose(100, 1, 5)).toBeCloseTo(20, 6);
  });

  test('o frasco inteiro é cobrado ao longo das N doses — nunca N vezes o frasco', () => {
    const total = Array.from({ length: 5 }, () => valorDaDose(100, 1, 5)).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  test('SEM multidose o mesmo caso cobraria 10 frascos (R$ 1.000) numa dose só', () => {
    expect(valorDaDose(100, 1, null)).toBeCloseTo(1000, 6);
  });
});

// ─── 3. GATE ESTRUTURAL ──────────────────────────────────────────────────────
// Os elos abaixo somem sem erro nenhum: a execução continua funcionando e só o VALOR
// da fatura fica errado.
describe('elos que somem em silêncio', () => {
  const controller = semComentarios(leia('controllers/PrescricaoGrupoController.js'));

  test('a baixa da dose consulta o mapa de multidose', () => {
    expect(controller).toMatch(/async function debitarEstoqueDia[\s\S]{0,900}mapaMultidose\(/);
  });

  test('a baixa usa `qtdDoEstoque` — não a conversão de unidade escrita à mão', () => {
    expect(controller).toMatch(/let restante = qtdDoEstoque\(qtdDia,/);
  });

  test('a execução passa a CONTAGEM de aplicações para a baixa e para a verificação', () => {
    expect(controller).toMatch(/debitarEstoqueDia\(tx, itensHoje, empresaIdEfetivo, grupoId, resolverQtdExecucao, resolverDosesExecucao\)/);
    expect(controller).toMatch(/verificarEstoqueParaDia\(itensHoje, empresaIdEfetivo, resolverQtdExecucao, resolverDosesExecucao\)/);
  });

  test('a RESERVA também é por dose — senão o frasco inteiro fica travado por aplicação', () => {
    expect(controller).toMatch(/async function criarReservas[\s\S]{0,600}mapaMultidose\(/);
    expect(controller).toMatch(/qtdNaUnidadeEstoque\(item, unidadeEstoque, multidose\.get\(/);
  });

  test('o lookup roda com o client da TRANSAÇÃO (o prisma global não enxerga o tenant)', () => {
    expect(controller).toMatch(/mapaMultidose\(tx, itens, empresaId\)/);
  });
});

describe('multi-tenant e RLS', () => {
  const lib = leia('lib/produtoFornecedor.js');
  const migration = fs.readFileSync(
    path.join(__dirname, '..', '..', 'prisma', 'migrations', '20261008000000_produto_multidose', 'migration.sql'), 'utf8');

  test('a marca NAO vai para o catálogo global — mora na tabela da empresa', () => {
    expect(migration).toMatch(/ALTER TABLE "schs2vet"\."tb_produtos_fornecedor"/);
    expect(migration).not.toMatch(/ALTER TABLE[^\n]*tb_medicamentos/);
  });

  test('a migration é ADITIVA: nenhum UPDATE/DELETE de dado gravado', () => {
    const sql = migration.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP)\b/i);
  });

  test('o default é `false` — nenhum item passa a ser cobrado diferente ao aplicar', () => {
    expect(migration).toMatch(/"multidose" BOOLEAN NOT NULL DEFAULT false/);
  });

  test('toda consulta de dose é escopada por empresa_id', () => {
    const fn = lib.slice(lib.indexOf('async function dosesPorEmbalagemDeMedicamentos'));
    expect(fn).toMatch(/WHERE empresa_id = \$1/);
  });

  test('base sem a migration devolve o comportamento antigo, nunca erro', () => {
    const fn = lib.slice(lib.indexOf('async function dosesPorEmbalagemDeMedicamentos'));
    expect(fn).toMatch(/temColunasMultidose\(\)\)\) return vazio/);
  });

  test('só entra no mapa o vínculo ATIVO, marcado e com o número informado', () => {
    const fn = lib.slice(lib.indexOf('async function dosesPorEmbalagemDeMedicamentos'));
    expect(fn).toMatch(/ativo = true AND multidose = true/);
    expect(fn).toMatch(/doses_por_embalagem IS NOT NULL/);
  });

  test('a bandeira do multidose vem JÁ NA CARGA da tela, não só no detalhe', () => {
    // Resolvida só ao escolher um item do catálogo, o checkbox ficaria à mostra para
    // quem digita um produto NOVO — e a marcação sumiria no salvar, em silêncio.
    const ctrl = leia('controllers/ProdutoController.js');
    const fn = ctrl.slice(ctrl.indexOf('const listar ='), ctrl.indexOf('const listarCatalogo ='));
    expect(fn).toMatch(/multidose: await produtoFornecedor\.temColunasMultidose\(\)/);
  });

  test('o detalhe do item só devolve linha global ou da própria empresa', () => {
    const ctrl = leia('controllers/ProdutoController.js');
    const fn = ctrl.slice(ctrl.indexOf('const detalhe ='), ctrl.indexOf('const criar ='));
    expect(fn).toMatch(/OR: \[\{ empresaId: null \}, \{ empresaId: req\.empresaId \}\]/);
    expect(fn).toMatch(/return res\.status\(404\)/);
  });
});

describe('a tela tem porta de entrada', () => {
  test('Produtos está no menu (a rota existia desde 10/09 e ninguém a alcançava)', () => {
    const sidebar = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'components', 'Sidebar.tsx'), 'utf8');
    expect(semComentarios(sidebar)).toMatch(/subLink\('\/cadastro\/produtos'/);
  });
});

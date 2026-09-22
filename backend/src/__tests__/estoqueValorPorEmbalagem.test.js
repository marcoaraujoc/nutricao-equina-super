// VALOR COMPRADO / VALOR REPASSADO SÃO POR EMBALAGEM (2026-09-17, a pedido: "no estoque
// não multiplique o Valor Comprado e Valor Repassado pela quantidade; isso mexe
// diretamente no cálculo da fatura").
//
// O QUE QUEBRAVA EM SILÊNCIO, e é por isso que este arquivo existe:
//   1. a tela multiplicava os dois valores pela Qtd Produto antes de gravar e
//      `calcPrecoUnitarioBase` dividia pelo SALDO. As duas contas se cancelavam, então
//      o preço da dose saía CERTO e nada acusava — mas o banco guardava o total da
//      compra em colunas rotuladas "Valor Unitário";
//   2. quem lia a coluna CRUA cobrava a compra inteira numa linha só. Medido:
//      `debitarInsumoUnidade` lançava `valorRepassado` como preço de UMA seringa, ou
//      seja, a caixa inteira na fatura do cliente;
//   3. reabrir a entrada trazia o total para um campo unitário — e salvar de novo o
//      multiplicava outra vez, dobrando o valor a cada edição;
//   4. o preço dependia do saldo, então ajustar o estoque mexia no valor já cobrado.
//
// ⚠️ A multiplicação some em silêncio: sem ela e com o divisor antigo, o preço da dose
// sai DIVIDIDO pela quantidade comprada e a clínica cobra centavos. Por isso os gates
// abaixo varrem o CÓDIGO dos dois lados, não só o resultado da função.
'use strict';

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
const EstoqueController = require('../controllers/EstoqueController');

const { calcPrecoUnitarioBase } = EstoqueController;
const leia = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const leiaFront = (rel) =>
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'src', rel), 'utf8');
// Comentário que EXPLICA a regra cita as mesmas palavras; um gate que se satisfaz com a
// própria documentação é um gate que se aprende a ignorar.
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ─── 1. A CONTA ──────────────────────────────────────────────────────────────
describe('o preço da dose sai da EMBALAGEM, não da compra', () => {
  test('o exemplo do produto medido por dentro: frasco de 20 mL por R$ 100', () => {
    expect(calcPrecoUnitarioBase(100, 20, 'mL')).toBeCloseTo(5, 6);
  });

  test('o exemplo do não-multidose: embalagem avulsa por R$ 30', () => {
    // Sem conteúdo declarado a embalagem é a própria unidade.
    expect(calcPrecoUnitarioBase(30, null, 'Un.')).toBe(30);
  });

  test('🔴 comprar mais não baixa o preço da dose', () => {
    // O defeito que a multiplicação escondia: com o valor unitário gravado e o divisor
    // antigo (o saldo), 10 embalagens de R$ 30 dariam R$ 3,00 na dose.
    const uma = calcPrecoUnitarioBase(30, null, 'Un.');
    expect(uma).toBe(30);
    // A mesma embalagem, tenha a clínica comprado 1 ou 500.
    expect(calcPrecoUnitarioBase(30, null, 'Un.')).toBe(uma);
  });

  test('a base da unidade continua valendo: embalagem de 1 kg por R$ 100 → R$ 0,10/g', () => {
    expect(calcPrecoUnitarioBase(100, 1, 'kg')).toBeCloseTo(0.1, 6);
    expect(calcPrecoUnitarioBase(100, 1, 'l')).toBeCloseTo(0.1, 6);
  });

  test('conteúdo nulo ou zero vale 1 — nunca divisão por zero nem preço nulo', () => {
    expect(calcPrecoUnitarioBase(80, null, 'Un.')).toBe(80);
    expect(calcPrecoUnitarioBase(80, 0, 'Un.')).toBe(80);
  });

  test('sem preço não inventa valor', () => {
    expect(calcPrecoUnitarioBase(0, 20, 'mL')).toBeNull();
    expect(calcPrecoUnitarioBase(null, 20, 'mL')).toBeNull();
  });
});

// ─── 2. GATE — A TELA NÃO MULTIPLICA ─────────────────────────────────────────
describe('gate — a Farmácia grava o valor como foi digitado', () => {
  const tela = semComentarios(leiaFront('pages/Farmacia.tsx'));

  test('🔴 o payload não multiplica valor nem valorRepassado', () => {
    expect(tela).toMatch(/valor:\s*form\.valor,/);
    expect(tela).toMatch(/valorRepassado:\s*form\.valorRepassado,/);
    // O `nPacotes` que fazia a multiplicação não pode voltar.
    expect(tela).not.toMatch(/nPacotes/);
  });

  test('o rótulo é UNITÁRIO nos dois modos — criação e edição', () => {
    // Enquanto a edição dizia "Valor Total", o campo mostrava o total da compra e
    // salvar de novo o multiplicava outra vez.
    expect(tela).not.toMatch(/Valor Total Comprado/);
    expect(tela).not.toMatch(/Valor Total Repassado/);
    expect(tela).toMatch(/Valor Unitário \(R\$\)/);
    expect(tela).toMatch(/Valor Unitário Cobrado \(R\$\)/);
  });
});

// ─── 3. GATE — O BACKEND DIVIDE PELO CONTEÚDO, NUNCA PELO SALDO ──────────────
describe('gate — o saldo saiu da conta do preço', () => {
  const estoque = semComentarios(leia('controllers/EstoqueController.js'));

  test('🔴 a criação passa o CONTEÚDO da embalagem', () => {
    expect(estoque).toMatch(/const conteudoEmb\s*=\s*pesoPorEmbalagem \? Number\(pesoPorEmbalagem\) : null;/);
    expect(estoque).toMatch(/calcPrecoUnitarioBase\(Number\(valorRepassado\), conteudoEmb, unidadeConta\)/);
  });

  test('🔴 nenhuma chamada volta a passar a quantidade', () => {
    expect(estoque).not.toMatch(/calcPrecoUnitarioBase\([^)]*qtdEstoque/);
    expect(estoque).not.toMatch(/calcPrecoUnitarioBase\([^)]*qtdFinal/);
  });

  test('🔴 a consolidação NÃO soma os valores — eles são por embalagem', () => {
    const corpo = estoque.slice(estoque.indexOf('if (existente)')).slice(0, 1600);
    // Somá-los dobraria o preço da embalagem a cada reentrada do mesmo lote.
    expect(corpo).not.toMatch(/valor:\s*\{ increment/);
    expect(corpo).not.toMatch(/valorRepassado:\s*\{ increment/);
    // A quantidade continua somando: é ela que representa o que entrou.
    expect(corpo).toMatch(/qtdEstoque:\s*\{ increment/);
  });

  test('a edição recalcula por valor/conteúdo/unidade, nunca por quantidade', () => {
    const corpo = estoque.slice(estoque.indexOf('const atualizar = async')).slice(0, 5000);
    expect(corpo).toMatch(/valorRepassado !== undefined \|\| data\.pesoPorEmbalagem !== undefined \|\| u\.alterado/);
    expect(corpo).not.toMatch(/data\.qtdEstoque !== undefined \|\| u\.alterado/);
  });
});

// ─── 4. GATE — O QUE LÊ A COLUNA CRUA ────────────────────────────────────────
describe('gate — ninguém cobra a embalagem inteira por uma unidade', () => {
  const presc = semComentarios(leia('controllers/PrescricaoGrupoController.js'));

  test('🔴 o insumo (seringa/agulha) é cobrado pelo preço de UMA unidade', () => {
    const fn = presc.slice(presc.indexOf('async function debitarInsumoUnidade'));
    const corpo = fn.slice(0, fn.indexOf('\n}') + 2);
    // `valorRepassado` cru é o valor da EMBALAGEM: lançá-lo direto cobrava a caixa.
    expect(corpo).toMatch(/estoque\.precoUnitarioBase/);
  });

  test('o fallback legado divide pelo CONTEÚDO, não pelo estoque restante', () => {
    const fn = presc.slice(presc.indexOf('function precoUnitarioDoEstoque'));
    const corpo = fn.slice(0, fn.indexOf('\n}') + 2);
    expect(corpo).toMatch(/pesoPorEmbalagem/);
    expect(corpo).not.toMatch(/paraBase\(estoque\.qtdEstoque/);
  });

  test('a baixa usa a FONTE ÚNICA do preço, sem recalcular por conta própria', () => {
    // A janela subiu de 3500 para 5000 em 2026-09-19: a conta acumulada das embalagens
    // entrou ANTES do laco de baixa e empurrou `precoUnitarioDoEstoque` para depois do
    // corte antigo — o gate reprovava por tamanho, nao por regra quebrada.
    const corpo = presc.slice(presc.indexOf('async function debitarEstoqueDia')).slice(0, 5000);
    expect(corpo).toMatch(/precoUnitarioDoEstoque\(estoque, unidadeEstoque\)/);
    // A conta escrita à mão dentro da baixa divergiria da fonte única na 1ª correção.
    expect(corpo).not.toMatch(/qtdEstoqueBase\s*>\s*0\s*\?\s*precoVenda/);
  });

  test('o valor do saldo no relatório multiplica pela quantidade em estoque', () => {
    const rel = semComentarios(leia('controllers/RelatoriosController.js'));
    const corpo = rel.slice(rel.indexOf('const valorItemEstoque')).slice(0, 600);
    // `valorRepassado` cru devolvia o preço de UMA embalagem como se fosse o estoque.
    expect(corpo).toMatch(/qtd \* \(porEmbalagem \/ conteudo\)/);
  });
});

// ─── 5. A MIGRATION DE REEXPRESSÃO ───────────────────────────────────────────
describe('backfill — reexpressa a coluna sem mudar cobrança', () => {
  const bruto = fs.readFileSync(
    path.join(__dirname, '..', '..', 'prisma', 'migrations',
      '20261014000000_estoque_valor_por_embalagem', 'migration.sql'), 'utf8');
  // O cabeçalho explica a regra CITANDO as tabelas e colunas que o UPDATE não toca —
  // sem tirar os comentários, o gate reprova a própria documentação dele.
  const sql = bruto.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');

  test('🔴 carimba app.plataforma — sem ele o UPDATE afeta ZERO linhas em silêncio', () => {
    expect(sql).toMatch(/set_config\('app\.plataforma',\s*'on',\s*true\)/);
    // O carimbo precisa vir ANTES do UPDATE.
    expect(sql.indexOf('set_config')).toBeLessThan(sql.indexOf('UPDATE'));
  });

  test('divide valor e valor_repassado pelas embalagens, e só isso', () => {
    expect(sql).toMatch(/"valor"\s*=\s*"valor"\s*\/\s*"qtd_embalagens"/);
    expect(sql).toMatch(/"valor_repassado"\s*=\s*"valor_repassado"\s*\/\s*"qtd_embalagens"/);
  });

  test('🔴 NÃO toca preco_unitario_base — é ele que a fatura cobra', () => {
    expect(sql).not.toMatch(/SET[\s\S]*"preco_unitario_base"\s*=/);
  });

  test('🔴 NÃO toca o saldo nem os movimentos', () => {
    expect(sql).not.toMatch(/"qtdEstoque"\s*=/);
    expect(sql).not.toMatch(/tb_movimentos_estoque/);
  });

  test('entrada sem embalagens declaradas fica intocada — o valor já é unitário', () => {
    expect(sql).toMatch(/"qtd_embalagens" IS NOT NULL/);
    expect(sql).toMatch(/"qtd_embalagens" > 1/);
  });
});

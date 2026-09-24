'use strict';

/**
 * 🔴 O PLANTÃO NÃO RECUSA DOSE — NEM POR SALDO, NEM POR ATRASO (2026-09-23).
 *
 * Duas travas diferentes produziam o MESMO resultado prático: a dose foi aplicada na
 * baia e o sistema não deixava registrar. Uma some do backend, a outra do front:
 *
 *   1. ESTOQUE — `executar` devolvia 409 `ESTOQUE_INSUFICIENTE` quando o saldo não
 *      cobria a dose. O recorte era perverso: só alcançava o medicamento CADASTRADO
 *      no estoque (sem cadastro, `verificarEstoqueParaDia` ignora), ou seja, punia
 *      exatamente a clínica que mantém o controle em dia. Estoque é CONTROLE, não
 *      autorização clínica — recusar o registro não devolve o frasco, só apaga o
 *      rastro (fatura, histórico, conta a pagar).
 *
 *   2. ATRASO — o filtro do modal (`itemDevidoHoje`) comparava
 *      `diaISO(proximaDoseEm) === dataRef`. A LISTA já usava `<=` desde 2026-08-29
 *      (`itemDeveDoseEm`), então a dose vencida ficava no card marcada ATRASADA e
 *      SUMIA ao abrir o modal: nada a executar, "Nenhum item ativo".
 *
 * 🔴 AS DUAS QUEBRAM EM SILÊNCIO — por isso o gate é ESTRUTURAL. Nenhuma delas
 * derruba teste de comportamento: a primeira devolve um 409 "legítimo", a segunda
 * apenas não renderiza a linha. Quem descobre é quem está de plantão.
 *
 * ⚠️ O que este gate NÃO afrouxa:
 *   • a trava da FINALIZAÇÃO (`finalizar`, 409 com escape por `forcarFinalizacao`):
 *     lá a prescrição ainda vai ser escrita e dá tempo de decidir. É ASSERTADA como
 *     presente — remover a daqui não pode virar licença para remover a de lá;
 *   • a baixa de estoque: `debitarEstoqueDia` continua debitando o que HOUVER, em
 *     FEFO, parando no lote zerado — nada de saldo negativo;
 *   • o cron `cancelar_doses_prescricao_perdidas`, que continua sendo o ÚNICO a
 *     tirar dose perdida da fila (um filtro de tela a esconde sem cancelar nada).
 */

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler  = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/**
 * Comentário NÃO é código. Sem isto a varredura se satisfaz com o próprio
 * comentário que EXPLICA a regra — e um gate que aprova a documentação em vez do
 * comportamento é um gate que se aprende a ignorar.
 */
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Recorta o corpo de uma função/arrow nomeada, para a asserção não vazar para o
 * arquivo todo.
 *
 * ⚠️ O corpo começa na chave que vem DEPOIS da lista de parâmetros, nunca na
 * primeira `{` encontrada: `debitarEstoqueDia(…, { incluirDoProprietario = false })`
 * tem desestruturação na assinatura, e pegar aquela devolveria dois parâmetros como
 * se fossem a função inteira — um gate que passa a medir nada.
 */
function corpoDaFuncao(src, nome) {
  const i = src.indexOf(nome);
  expect(i).toBeGreaterThan(-1);
  let par = 0, fimAssinatura = -1;
  for (let p = i; p < src.length; p++) {
    if (src[p] === '(') par++;
    else if (src[p] === ')') { par--; if (par === 0) { fimAssinatura = p; break; } }
  }
  expect(fimAssinatura).toBeGreaterThan(-1);
  const abre = src.indexOf('{', fimAssinatura);
  let nivel = 0;
  for (let p = abre; p < src.length; p++) {
    if (src[p] === '{') nivel++;
    if (src[p] === '}') { nivel--; if (nivel === 0) return src.slice(abre, p + 1); }
  }
  throw new Error(`corpo de ${nome} não fechou`);
}

const CONTROLLER = semComentarios(ler('controllers/PrescricaoGrupoController.js'));
const TELA       = semComentarios(
  fs.readFileSync(path.join(RAIZ, '..', '..', 'frontend', 'src', 'pages', 'ExecucaoPrescricao.tsx'), 'utf8'),
);

describe('EXECUTAR não é barrado por saldo de estoque', () => {
  const executar = corpoDaFuncao(CONTROLLER, 'const executar = async (req, res)');

  test('`executar` não devolve ESTOQUE_INSUFICIENTE', () => {
    expect(executar).not.toMatch(/ESTOQUE_INSUFICIENTE/);
  });

  test('`executar` não chama a verificação de saldo para decidir se segue', () => {
    expect(executar).not.toMatch(/verificarEstoqueParaDia|verificarEstoqueParaExecucao|verificarDisponibilidade/);
  });

  test('a baixa de estoque continua acontecendo — o que saiu foi o BLOQUEIO, não o débito', () => {
    expect(executar).toMatch(/debitarEstoqueDia\(/);
  });

  test('`debitarEstoqueDia` nunca gera saldo negativo (para no lote zerado)', () => {
    const debitar = corpoDaFuncao(CONTROLLER, 'async function debitarEstoqueDia');
    expect(debitar).toMatch(/if \(estoque\.qtdEstoque <= 0\) continue;/);
    expect(debitar).toMatch(/Math\.min\(estoque\.qtdEstoque, restante\)/);
  });

  test('a trava da FINALIZAÇÃO continua de pé (com o escape de `forcarFinalizacao`)', () => {
    const finalizar = corpoDaFuncao(CONTROLLER, 'const finalizar = async (req, res)');
    expect(finalizar).toMatch(/forcarFinalizacao/);
    expect(finalizar).toMatch(/ESTOQUE_INSUFICIENTE/);
  });
});

describe('DOSE ATRASADA continua executável — lista e modal fazem a MESMA pergunta', () => {
  test('o filtro do modal aceita a dose vencida (`<=`, nunca `===`)', () => {
    const devido = corpoDaFuncao(TELA, 'const itemDevidoHoje = (i: ItemExecucao): boolean');
    expect(devido).toMatch(/diaPrevisto <= dataRef/);
    expect(devido).not.toMatch(/diaISO\(i\.proximaDoseEm\) === dataRef/);
  });

  test('o filtro da LISTA segue com o mesmo `<=` (a origem da regra, 2026-08-29)', () => {
    const deve = corpoDaFuncao(TELA, 'export function itemDeveDoseEm');
    expect(deve).toMatch(/diaPrevisto <= data/);
  });

  test('o front não reintroduz painel de estoque insuficiente na execução', () => {
    expect(TELA).not.toMatch(/ESTOQUE_INSUFICIENTE/);
  });
});

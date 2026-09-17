'use strict';
// backend/src/lib/formaCalculo.js
//
// 🔴 FORMA DE CÁLCULO — a unidade em que o produto é MEDIDO, prescrito, debitado do
// estoque e cobrado (2026-09-16, a pedido).
//
// O DEFEITO QUE ELA RESOLVE: embalagem e conteúdo eram a mesma coisa. O frasco de
// 20 mL era cadastrado como "1 Un.", e uma dose de 5 mL debitava 5 UNIDADES (cinco
// frascos) e cobrava cinco frascos — `mesmoGrupo('mL','Un.')` é falso e a baixa caía
// no valor BRUTO, sem erro nenhum na tela. Agora o produto declara QUANTO cabe na
// embalagem (`qtdPorEmbalagem`) e EM QUÊ (`formaCalculo`):
//
//     produto : Forma de Cálculo mL, Qtd 20         (a embalagem tem 20 mL)
//     estoque : Qtd Produto 3  → Qtd Total 60 mL    (3 × 20)
//     receita : 5 mL            → estoque 55 mL     (baixa na MESMA unidade)
//     fatura  : 5 × 100 ÷ 20 = R$ 25,00             (preço da embalagem ÷ conteúdo)
//
// ⚠️ ESPELHO de `frontend/src/utils/formaCalculo.ts`. Os dois precisam concordar: é a
// lista daqui que valida o que a tela oferece — forma aceita só de um lado vira
// cadastro que a tela grava e o servidor descarta em silêncio.
//
// ⚠️ NÃO confundir com `Medicamento.unidade`, que continua existindo e é a unidade da
// EMBALAGEM ("Frasco", "Un.", "Caixa"). A forma de cálculo é o que está DENTRO dela.
//
// 🔴 PRODUTO SEM MULTIDOSE tem forma de cálculo **'Un.'** (2026-09-17, a pedido): a
// embalagem é a própria unidade, a receita sai em 'Un.' e a linha da fatura é
// `qtd × (valorRepassado ÷ Qtd Produto)`. Ver `UNIDADE_AVULSA` abaixo.

/** As formas oferecidas, na ORDEM pedida. `doses` é a contável. */
const FORMAS_CALCULO = ['mL', 'L', 'g', 'kg', 'mcg', 'mg', 'doses'];

const FORMA_DOSES = 'doses';

// 🔴 PRODUTO SEM MULTIDOSE É MEDIDO EM UNIDADE (2026-09-17, a pedido).
//
// A embalagem inteira é a unidade: entra inteira no estoque, é prescrita inteira e é
// cobrada inteira. Antes, "sem forma de cálculo" caía na unidade da EMBALAGEM do
// catálogo — que pode ser 'g', 'mL', 'kg'… —, e daí a receita saía numa unidade de
// CONTEÚDO enquanto o estoque contava EMBALAGENS: 1 bisnaga cadastrada como 'g' com
// 10 em estoque recebia uma receita de "20 g" e debitava 20 de 10, cobrando 20 × R$/g.
// Com 'Un.' nos dois lados a conta fecha sozinha e o preço da linha é
// `valorRepassado ÷ Qtd Produto` — o preço da embalagem, que é o que se entrega.
//
// ⚠️ É a MESMA constante de `lib/unidadeMedicamento.js` (a opção que o seletor do
// catálogo garante), importada e não recopiada: duas grafias ('Un.' × 'un') fariam
// `mesmaUnidade` divergir do que a receita escreve, e a divergência voltaria a aparecer
// como quantidade bruta na baixa.
const { UNIDADE_AVULSA } = require('./unidadeMedicamento');

/** Texto livre → forma canônica da lista, ou `null`. Sem caixa: o banco guarda a
 *  grafia de quem cadastrou, e recusá-la faria o produto perder a forma na edição. */
function normalizarFormaCalculo(v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return null;
  return FORMAS_CALCULO.find(f => f.toLowerCase() === t) ?? null;
}

function ehFormaContavel(v) {
  return normalizarFormaCalculo(v) === FORMA_DOSES;
}

/** Número positivo ou `null` — vazio NÃO é zero (ver `qtdPorEmbalagem`). */
function numeroPositivo(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Quanto a embalagem rende, na unidade em que o item é medido.
 *
 * 🔴 `null` NÃO É 1, e a diferença governa a cobrança: `null` = o produto não declara
 * conteúdo, então a embalagem é a própria unidade e tudo segue como sempre foi; 1 =
 * "a embalagem tem uma unidade da forma", que é uma AFIRMAÇÃO do cadastro.
 */
function qtdPorEmbalagemDe(produto) {
  if (!produto) return null;
  if (produto.multidose !== true) return null;
  return numeroPositivo(produto.qtdPorEmbalagem ?? produto.dosesPorEmbalagem);
}

/**
 * A unidade OPERATIVA do item: a forma de cálculo quando ele a declara, senão a
 * unidade da embalagem.
 *
 * É ela que precisa valer nos TRÊS lugares ao mesmo tempo — quanto entra no estoque,
 * em que a receita é escrita e por quanto a linha sai na fatura. Duas respostas
 * diferentes para essa pergunta é o que fazia 5 mL virarem 5 frascos.
 */
function unidadeOperativa(produto) {
  const conteudo = qtdPorEmbalagemDe(produto);
  const forma    = normalizarFormaCalculo(produto?.formaCalculo);
  if (forma && conteudo != null) return forma;
  // 🔴 LEGADO: multidose COM quantidade e SEM forma (cadastro feito entre a migration
  // `20261009000000` e a `20261012000000`, quando `forma_calculo` ainda não existia).
  // O estoque desse item foi gravado MULTIPLICANDO pela quantidade, ou seja, está
  // contado no CONTEÚDO — e a unidade do catálogo é a que o descreve. Devolver 'Un.'
  // aqui faria 19,9 mL de frasco serem lidos como "19,9 unidades", e uma dose de 5 mL
  // debitaria 1 em vez de 5 e cobraria R$ 5 no lugar de R$ 25. Medido na base: o
  // "17 Beta - 0%, frasco-ampola" está exatamente assim.
  // ⚠️ Não é exceção à regra nova: ela vale para quem NÃO é multidose. Aqui o produto
  // DECLARA conteúdo — só não declara em quê, e a unidade da embalagem é a resposta que
  // o próprio cadastro deu antes de o campo existir.
  if (conteudo != null && produto?.unidade) return produto.unidade;
  // ⚠️ Fora isso NÃO é `produto.unidade`: aquela é a unidade da EMBALAGEM ("Frasco",
  // "g", "mL"), e devolvê-la faz a receita ser escrita no CONTEÚDO enquanto o estoque
  // conta embalagens — ver o comentário de UNIDADE_AVULSA.
  return UNIDADE_AVULSA;
}

module.exports = {
  FORMAS_CALCULO,
  FORMA_DOSES,
  UNIDADE_AVULSA,
  normalizarFormaCalculo,
  ehFormaContavel,
  numeroPositivo,
  qtdPorEmbalagemDe,
  unidadeOperativa,
};

// frontend/src/utils/formaCalculo.ts
//
// 🔴 FORMA DE CÁLCULO — a unidade em que o produto é MEDIDO, prescrito, debitado do
// estoque e cobrado (2026-09-16, a pedido).
//
// O QUE ELA RESOLVE: até aqui a embalagem e o conteúdo dela eram a MESMA coisa. O
// frasco de 20 mL era cadastrado como "1 Un." e uma dose de 5 mL debitava 5 UNIDADES
// (cinco frascos) e cobrava cinco frascos — `mesmoGrupo('mL','Un.')` é falso e a baixa
// caía no valor bruto. Agora o produto declara **quanto** cabe na embalagem
// (`qtdPorEmbalagem`) e **em quê** (`formaCalculo`): 3 embalagens de 20 mL são 60 mL em
// estoque, a prescrição sai em mL e a linha da fatura é
// `qtd × valorUnitárioCobrado ÷ qtdPorEmbalagem`.
//
// ⚠️ ESTE ARQUIVO É O ESPELHO de `backend/src/lib/formaCalculo.js`. Os dois precisam
// concordar: é esta lista que a tela oferece e é o backend que a valida — uma forma
// aceita só de um lado vira cadastro que a tela grava e o servidor descarta em
// silêncio. Mexeu aqui, mexa lá.

/** As formas oferecidas, na ORDEM pedida. `doses` é a contável (frasco que rende N aplicações). */
export const FORMAS_CALCULO = ['mL', 'L', 'g', 'kg', 'mcg', 'mg', 'doses'] as const;

export type FormaCalculo = (typeof FORMAS_CALCULO)[number];

/** A forma CONTÁVEL — não converte para peso nem volume; é "quantas aplicações". */
export const FORMA_DOSES: FormaCalculo = 'doses';

/**
 * 🔴 A unidade do produto que NÃO é multidose (2026-09-17, a pedido).
 *
 * Sem multidose a embalagem é a própria unidade: entra inteira no estoque (Qtd Total =
 * Qtd Produto), a receita é escrita em 'Un.' e a linha da fatura sai por
 * `valorRepassado ÷ Qtd Produto`. Antes disso a unidade era a da EMBALAGEM do catálogo
 * ('g', 'mL', 'kg'), e a receita saía numa unidade de CONTEÚDO contra um estoque que
 * conta embalagens — "20 g" debitava 20 de um saldo de 10 bisnagas.
 *
 * ⚠️ MESMA grafia de `backend/src/lib/formaCalculo.js` (que a importa de
 * `lib/unidadeMedicamento.js`, onde ela nasceu como a opção garantida do seletor).
 * Divergir ('Un' × 'Un.') faz a receita e o estoque deixarem de casar.
 */
export const UNIDADE_AVULSA = 'Un.';

/** O produto declara conteúdo medido por dentro (multidose com forma e quantidade)? */
export function temConteudoDeclarado(
  p: { multidose?: boolean | null; formaCalculo?: string | null; dosesPorEmbalagem?: number | string | null } | null | undefined,
): boolean {
  if (!p || p.multidose !== true || !p.formaCalculo) return false;
  const n = Number(p.dosesPorEmbalagem);
  return Number.isFinite(n) && n > 0;
}

/**
 * A unidade em que o produto é CONTADO no estoque, ESCRITO na receita e COBRADO.
 *
 * Forma de cálculo quando ele declara conteúdo; **'Un.'** quando não declara.
 * As três respostas têm de ser a MESMA — duas unidades para o mesmo item é o que fazia
 * 5 mL virarem 5 frascos na baixa e na fatura.
 *
 * ⚠️ `null` para produto AUSENTE (item digitado à mão, fora do catálogo): ali não há
 * estoque nem preço, e a unidade é escolhida na mão.
 */
export function unidadeOperativaProduto(
  p: {
    multidose?: boolean | null;
    formaCalculo?: string | null;
    dosesPorEmbalagem?: number | string | null;
    /** A unidade da EMBALAGEM — usada SÓ no legado descrito abaixo. */
    unidade?: string | null;
  } | null | undefined,
): string | null {
  if (!p) return null;
  if (temConteudoDeclarado(p)) return p.formaCalculo as string;
  // 🔴 LEGADO: multidose COM quantidade e SEM forma (cadastro feito entre as migrations
  // `20261009000000` e `20261012000000`, quando `forma_calculo` ainda não existia). O
  // estoque desse item foi gravado MULTIPLICANDO pela quantidade — está contado no
  // CONTEÚDO —, e a unidade do catálogo é o que o descreve. Devolver 'Un.' faria 19,9 mL
  // de frasco serem lidos como "19,9 unidades".
  const qtd = Number(p.dosesPorEmbalagem);
  if (p.multidose === true && Number.isFinite(qtd) && qtd > 0 && p.unidade) return p.unidade;
  return UNIDADE_AVULSA;
}

/**
 * A unidade em que a RECEITA daquele produto é escrita — o que aparece ao lado do
 * campo Dosagem da Prescrição.
 *
 * 🔴 DIVERGE de `unidadeOperativaProduto` no produto SEM multidose, de propósito
 * (2026-09-18, a pedido):
 *
 *     multidose     → a forma de cálculo declarada   (mL, g, doses…)    [= estoque]
 *     não-multidose → a UNIDADE DO CATÁLOGO          (mL, g, Frasco…)   [estoque: 'Un.']
 *
 * Sem multidose o produto não declara quanto cabe na embalagem, mas o veterinário
 * prescreve na unidade REAL do medicamento: "5 mL de xarope", nunca "0,1 frasco". Até
 * aqui as duas respostas eram 'Un.' e o campo saía em unidades.
 *
 * ⚠️ Quem fecha a conta é a regra da ENTREGA no backend: receita em unidade de
 * CONTEÚDO contra estoque em EMBALAGENS consome UMA embalagem, cobrada uma vez no
 * curso inteiro. Espelho de `lib/formaCalculo.unidadePrescricao` — mexeu aqui, mexa lá.
 *
 * ⚠️ `null` só para produto AUSENTE (item digitado à mão, fora do catálogo): ali não há
 * estoque nem preço, e a unidade continua sendo escolhida no `<select>`.
 */
export function unidadePrescricaoProduto(
  p: {
    multidose?: boolean | null;
    formaCalculo?: string | null;
    dosesPorEmbalagem?: number | string | null;
    unidade?: string | null;
  } | null | undefined,
): string | null {
  if (!p) return null;
  if (temConteudoDeclarado(p)) return p.formaCalculo as string;
  return p.unidade || UNIDADE_AVULSA;
}

/**
 * 🔴 Quanto cabe na embalagem de um produto **SEM** multidose (2026-09-19, a pedido).
 *
 * Espelho de `lib/formaCalculo.conteudoDaEmbalagem` — mexeu aqui, mexa lá.
 *
 * É o dado que faltava para o caso "frasco de 100 mL, receita de 5 doses de 25 mL":
 * 125 mL não cabem num frasco e o curso consome DOIS. Sem ele, a regra da entrega
 * assume uma embalagem para o curso inteiro e a clínica entrega dois e cobra um.
 *
 * ⚠️ NÃO é `temConteudoDeclarado`, e as duas nunca respondem juntas: aquela é a chave
 * do MULTIDOSE e muda a unidade operativa (estoque passa a ser contado em mL, cobrança
 * proporcional, sobra volta para a prateleira). Esta não muda unidade nenhuma — o
 * estoque continua em 'Un.' e a receita na unidade do catálogo; o conteúdo responde
 * UMA pergunta só: quantas embalagens o curso gasta.
 */
export function conteudoDaEmbalagemProduto(
  p: { multidose?: boolean | null; dosesPorEmbalagem?: number | string | null } | null | undefined,
): number | null {
  if (!p || p.multidose === true) return null;
  const n = Number(String(p.dosesPorEmbalagem ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Quantas EMBALAGENS INTEIRAS uma quantidade prescrita consome.
 *
 * 🔴 ARREDONDA PARA CIMA: 125 mL de um frasco de 100 mL são DOIS frascos, não 1,25 — a
 * embalagem sem multidose é do paciente e, aberta, não volta para a prateleira.
 *
 * ⚠️ Sem conteúdo declarado devolve **1** (a entrega única de 2026-09-18, que é o
 * comportamento de toda base existente). Nunca 0.
 * ⚠️ Espelho de `lib/formaCalculo.embalagensPara`, incluindo a tolerância de 1e-9 — sem
 * ela, 3 doses de 0,1 somam 0.30000000000000004 e pedem 2 embalagens de 0,3.
 */
export function embalagensParaQtd(
  qtdPrescrita: number | null | undefined,
  conteudoEmbalagem: number | null | undefined,
): number {
  const conteudo = Number(conteudoEmbalagem);
  if (!Number.isFinite(conteudo) || conteudo <= 0) return 1;
  const qtd = Number(qtdPrescrita);
  if (!Number.isFinite(qtd) || qtd <= 0) return 1;
  return Math.max(1, Math.ceil(qtd / conteudo - 1e-9));
}

/**
 * Texto livre → a forma canônica da lista (ou `null`).
 *
 * ⚠️ Compara SEM caixa e SEM acento porque o valor pode chegar do banco com a grafia
 * de quem cadastrou ("ML", "Doses"). Devolver `null` para uma grafia válida faria o
 * produto perder a forma ao ser reaberto para edição.
 */
export function normalizarFormaCalculo(v: string | null | undefined): FormaCalculo | null {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return null;
  return FORMAS_CALCULO.find(f => f.toLowerCase() === t) ?? null;
}

export function ehFormaContavel(v: string | null | undefined): boolean {
  return normalizarFormaCalculo(v) === FORMA_DOSES;
}

/**
 * 🔴 Acha, em QUALQUER dos textos dados, o número que precede EXATAMENTE a
 * unidade-alvo (2026-09-26, a pedido — "varrer apresentação e nome do produto").
 *
 * "Seringa de 30 g"    + g   → 30
 * "Ivermectina 500 mg" + mg  → 500
 * "Ivermectina 500 mg" + g   → null   ("500" não precede "g" — precede "mg")
 * "3 gotas"            + g   → null   ("g" de "gotas" continua em outra letra)
 *
 * A regra é uma só: o número tem de estar IMEDIATAMENTE (espaço opcional) antes da
 * unidade-alvo, e a unidade não pode CONTINUAR em outra letra logo depois. É esse par
 * que evita ler "500 mg" como 500 g (a unidade-alvo não pode estar dentro de outra) e
 * "3 gotas" como 3 g (a letra seguinte à unidade quebra a correspondência) — sem
 * precisar de uma lista de unidades concorrentes para desambiguar.
 *
 * ⚠️ Quem chama decide a ORDEM dos textos — em geral apresentação primeiro (é lá que o
 * tamanho da embalagem costuma estar escrito, "Seringa de 30 g") e o nome depois (que
 * geralmente carrega a concentração do princípio ativo, não o conteúdo da embalagem).
 */
export function qtdDaUnidadeNoTexto(
  textos: Array<string | null | undefined>,
  unidadeAlvo: string | null | undefined,
): number | null {
  const alvo = String(unidadeAlvo ?? '').trim();
  if (!alvo) return null;
  const escapado = alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${escapado}(?![a-zà-öø-ÿA-ZÀ-ÖØ-Ý])`, 'i');
  for (const texto of textos) {
    if (!texto) continue;
    const m = String(texto).match(re);
    if (m) {
      const n = Number(m[1].replace(',', '.'));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/**
 * Acha no NOME do produto a quantidade da embalagem, na forma escolhida.
 *
 * "Ocitocina 20 mL"        + mL → 20
 * "Dipirona 500 mg/mL"     + mg → 500      (o "/mL" não tem número antes, então não casa em mL)
 * "Medicamento 17 Beta"    + mL → null     (o 17 não é seguido de unidade)
 *
 * 🔴 SÓ CASA COM A FORMA ESCOLHIDA, nunca "o primeiro número do nome": em "Dipirona
 * 500 mg/mL" o 500 é massa, e oferecê-lo como volume preencheria a embalagem com um
 * número que não é dela — e esse número divide o preço da dose na fatura.
 * ⚠️ `doses` nunca é extraída do nome: rótulo de produto não traz contagem de
 * aplicação, e o que viesse daí seria palpite.
 *
 * ⚠️ Delega para `qtdDaUnidadeNoTexto` — mantido como função própria só porque quem já
 * chama espera `(nome, forma)`; o comportamento é o mesmo de sempre.
 */
export function qtdDoNome(nome: string, forma: string | null | undefined): number | null {
  const alvo = normalizarFormaCalculo(forma);
  if (!alvo || alvo === FORMA_DOSES) return null;
  return qtdDaUnidadeNoTexto([nome], alvo);
}

/** Formata a quantidade sem zeros à toa: 20 → "20", 2.5 → "2,5". */
export function fmtQtdForma(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '';
  return String(v).replace('.', ',');
}

/** Campo de digitação decimal → número (ou `null` quando vazio/inválido). */
export function numeroDoCampo(v: string): number | null {
  const t = String(v ?? '').trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

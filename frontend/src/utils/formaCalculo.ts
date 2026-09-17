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
 */
export function qtdDoNome(nome: string, forma: string | null | undefined): number | null {
  const alvo = normalizarFormaCalculo(forma);
  if (!alvo || alvo === FORMA_DOSES) return null;

  // Ordem LONGA → CURTA: a alternação do regex é leftmost-first, então sem isso
  // "500mg" casaria com "g" e devolveria a massa errada.
  const re = /(\d+(?:[.,]\d+)?)\s*(mcg|mg|kg|ml|l|g)\b/gi;
  const texto = String(nome ?? '');
  for (const m of texto.matchAll(re)) {
    if (m[2].toLowerCase() !== alvo.toLowerCase()) continue;
    const n = Number(m[1].replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
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

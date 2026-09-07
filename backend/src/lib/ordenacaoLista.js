// backend/src/lib/ordenacaoLista.js
'use strict';

/**
 * ORDENAÇÃO PEDIDA PELA TELA em listagens PAGINADAS NO SERVIDOR.
 *
 * POR QUE NO BACKEND: onde a paginação é do servidor (evolução, prescrição), ordenar
 * no navegador reorganizaria as 10 linhas da PÁGINA e mentiria sobre as outras — a
 * primeira linha da lista deixaria de ser a primeira do histórico. Onde a tela já tem
 * a lista inteira em mãos, a ordenação continua sendo dela (components/OrdenacaoLista).
 *
 * 🔴 WHITELIST OBRIGATÓRIA. O campo vem do CLIENTE e vira caminho de `orderBy` do
 * Prisma: aceitar qualquer string deixaria a tela ordenar por coluna que a listagem
 * não expõe (e, com relação aninhada, alcançar tabela vizinha). Cada chamador declara
 * o mapa `chave -> (direcao) => orderBy`; o que não estiver nele cai no PADRÃO.
 *
 * ⚠️ `nulls: 'last'` no campo OPCIONAL, nos dois sentidos — mesma regra do front:
 * registro sem valor vai para o fim, senão ordenar por "Data Fim" enche a primeira
 * página com as linhas em branco. Só vale para coluna anulável (o Prisma recusa a
 * forma `{ sort, nulls }` em campo obrigatório).
 */

/** `orderBy` de coluna anulável, com o vazio sempre no fim. */
function opcional(campo) {
  return (direcao) => ({ [campo]: { sort: direcao, nulls: 'last' } });
}

/** `orderBy` de coluna obrigatória. */
function simples(campo) {
  return (direcao) => ({ [campo]: direcao });
}

/** `orderBy` por campo de uma RELAÇÃO (ex.: nome do responsável). */
function daRelacao(relacao, campo) {
  return (direcao) => ({ [relacao]: { [campo]: direcao } });
}

/**
 * Resolve o `orderBy` a partir de `?ordenarPor=&ordem=`.
 * @param {object} query   req.query
 * @param {object} mapa    { chaveDaTela: (direcao) => orderBy }
 * @param {object} padrao  ordem natural da listagem (o que vale sem pedido explícito)
 */
function orderByDaQuery(query, mapa, padrao) {
  const chave   = String(query?.ordenarPor ?? '').trim();
  const direcao = String(query?.ordem ?? '').toLowerCase() === 'desc' ? 'desc' : 'asc';
  const montar  = Object.prototype.hasOwnProperty.call(mapa, chave) ? mapa[chave] : null;
  return montar ? montar(direcao) : padrao;
}

module.exports = { orderByDaQuery, opcional, simples, daRelacao };

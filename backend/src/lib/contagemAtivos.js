'use strict';

/**
 * Contagem das abas Todos / Ativos / Inativos das telas de CADASTRO (2026-10-02).
 *
 * Toda pílula de status da aplicação mostra a sua quantidade entre parênteses. Nos
 * cadastros a lista é filtrada no SERVIDOR (`?ativo=true|false|all`), então a tela só
 * enxerga a aba escolhida e não tem como contar as outras — quem conta é o backend.
 *
 * ⚠️ A contagem usa o MESMO `where` da lista, MENOS o próprio filtro de ativo: com ele,
 * a aba escolhida contaria tudo e as outras sairiam zeradas. Busca, escopo da empresa e
 * qualquer outro recorte continuam valendo — o número é o que a aba traria se clicada.
 *
 * ⚠️ OPT-IN por `?contagens=1`: as mesmas rotas alimentam autocompletes e seletores de
 * outras telas, e duas consultas a mais por tecla digitada não se pagam ali.
 */

/** A tela pediu as contagens? */
function querContagens(query) {
  const v = query?.contagens;
  return v === '1' || v === 'true';
}

/**
 * `{ all, ativo, inativo }` para o `where` dado.
 * @param {object} delegate  delegate do Prisma (`prisma.fornecedor`, `tx.tratador`…)
 * @param {object} where     o `where` da LISTA (com ou sem `ativo`)
 * @param {string} [campo]   nome do campo booleano de ativo (padrão `ativo`)
 */
async function contarAtivosInativos(delegate, where, campo = 'ativo') {
  const { [campo]: _ignorado, ...base } = where ?? {};
  const [ativo, inativo] = await Promise.all([
    delegate.count({ where: { ...base, [campo]: true } }),
    delegate.count({ where: { ...base, [campo]: false } }),
  ]);
  return { all: ativo + inativo, ativo, inativo };
}

module.exports = { querContagens, contarAtivosInativos };

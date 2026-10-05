'use strict';
// lib/faturaItemUnidade.js — EM QUÊ a quantidade da linha da fatura está contada
// (migration 20261101000000, 2026-10-02, a pedido).
//
// 🔴 O CASO: medicamento MULTIDOSE medido em mL. Até aqui a linha contava DOSES
// ("Quant.: 3 · Unitário: R$ 25,00", o preço da dose de 5 mL), e o cliente não tinha
// como conferir quanto do frasco foi usado. Agora a linha conta o que SAIU do frasco:
// "Quant.: 15 mL · Unitário: R$ 5,00". O TOTAL é o mesmo — muda só a leitura.
//
// ⚠️ NULL = unidade/dose/embalagem, o significado de TODA linha anterior à coluna. Só a
// linha do multidose em mL recebe 'mL'; nenhum outro lançamento muda.
//
// ⚠️ A unidade entra na CHAVE da consolidação (`adicionarOuSomarFaturaItem`): somar 5 mL
// numa linha legada que conta doses produziria "Quant.: 8" sem unidade nenhuma que a
// descreva. Linha em mL só soma em linha em mL.
//
// 🔴 SQL CRU COM GUARDA DE COLUNA — mesmo padrão de `lib/faturaFechamentoAnimal.js`. No
// Windows o `prisma generate` FALHA com o backend rodando (§11): passar `unidade` ao
// `faturaItem.create` tipado com o client defasado derrubaria o LANÇAMENTO inteiro da
// execução, não só o campo novo.
//
// ⚠️ TENANCY: nada aqui amplia escopo — `tb_fatura_itens` já tem RLS pelo pai, e as
// consultas passam pelo MESMO client carimbado de quem chama.

/** Unidade que a fatura passa a exibir no multidose. Grafia canônica de `FORMAS_CALCULO`. */
const UNIDADE_ML = 'mL';

function prismaGlobal() {
  return require('./prisma').default;
}

let _temColuna   = null;
let _temColunaEm = 0;

/**
 * A coluna já existe? `false` expira em 60s (aplicar a migration com o backend no ar
 * volta a funcionar sem restart). Guarda pelo client GLOBAL, nunca pelo `tx`: SQL cru
 * contra coluna inexistente dentro de uma transaction aborta a transaction INTEIRA.
 */
async function temColuna() {
  if (_temColuna === true) return true;
  if (_temColuna === false && Date.now() - _temColunaEm < 60000) return false;
  try {
    const rows = await prismaGlobal().$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_fatura_itens'
          AND column_name = 'unidade'
        LIMIT 1`,
    );
    _temColuna   = rows.length > 0;
    _temColunaEm = Date.now();
  } catch {
    // Soluço do banco não é "a coluna não existe": vale a última resposta conhecida.
    if (_temColuna !== null) return _temColuna;
    return false;
  }
  return _temColuna;
}

/** 'ml', 'ML', ' mL ' → 'mL'; o resto → null. Só o mL tem exibição própria hoje. */
function normalizarUnidade(u) {
  return String(u ?? '').trim().toLowerCase() === 'ml' ? UNIDADE_ML : null;
}

/** Grava a unidade de UMA linha. Sem coluna (base não migrada) não faz nada. */
async function gravarUnidade(client, itemId, unidade) {
  const u = normalizarUnidade(unidade);
  if (!u || !(await temColuna())) return;
  await client.$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_fatura_itens" SET "unidade" = $1 WHERE "id" = $2`,
    u, Number(itemId),
  );
}

/**
 * `Map<itemId, unidade>` — só as linhas COM unidade. UMA consulta para a lista toda,
 * nunca uma por linha (a fatura de um mês tem dezenas de itens).
 */
async function unidadesDosItens(client, ids) {
  const mapa = new Map();
  const lista = [...new Set((ids ?? []).map(Number).filter(Number.isFinite))];
  if (lista.length === 0 || !(await temColuna())) return mapa;
  const rows = await client.$queryRawUnsafe(
    `SELECT "id", "unidade" FROM "schs2vet"."tb_fatura_itens"
      WHERE "id" = ANY($1::int[]) AND "unidade" IS NOT NULL`,
    lista,
  );
  for (const r of rows) mapa.set(Number(r.id), r.unidade);
  return mapa;
}

/** Põe `unidade` (ou null) em cada item da fatura. */
async function anexarUnidadeNosItens(client, fatura) {
  if (!fatura?.itens?.length) return fatura;
  const mapa = await unidadesDosItens(client, fatura.itens.map(i => i.id));
  return { ...fatura, itens: fatura.itens.map(i => ({ ...i, unidade: mapa.get(Number(i.id)) ?? null })) };
}

/** Põe `unidade` (ou null) em UM item — respostas de lançar/editar. */
async function anexarUnidadeNoItem(client, item) {
  if (!item?.id) return item;
  const mapa = await unidadesDosItens(client, [item.id]);
  return { ...item, unidade: mapa.get(Number(item.id)) ?? null };
}

module.exports = {
  UNIDADE_ML,
  normalizarUnidade,
  gravarUnidade,
  unidadesDosItens,
  anexarUnidadeNosItens,
  anexarUnidadeNoItem,
};

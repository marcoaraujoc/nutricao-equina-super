'use strict';
// lib/animalAssistencia.js — ASSISTÊNCIA VETERINÁRIA MENSAL POR ANIMAL
// (migration 20261103000000)
//
// A assistência deixou de ser do PROPRIETÁRIO (`tb_proprietario_perfis.valor_assistencia`)
// e passou a ser de cada cavalo: o cliente com três animais combina um valor por animal, e
// só os que têm assistência contratada entram na fatura.
//
// 🔴 O GATILHO É O VALOR (> 0), não um flag — mesma decisão da assistência do proprietário:
// um segundo campo "tem assistência?" seria uma segunda fonte de verdade capaz de divergir.
// NULL / 0 = sem assistência.
//
// 🔴 SQL CRU, COM GUARDA DE EXISTÊNCIA DA COLUNA — padrão de `lib/animalFei.js`. No Windows
// o `prisma generate` falha com o backend rodando, e um campo desconhecido no
// `animal.create` derrubaria o CADASTRO DE PACIENTE inteiro, não só o campo novo.
//
// ⚠️ TENANCY: acesso por `id` de animal que o chamador JÁ autorizou; o RLS de `tb_animais`
// continua valendo por baixo. As listagens recebem o `db` (tx) — no CRON o `prisma` global
// chega ao banco sem tenant e o RLS devolveria ZERO animais, sem erro e sem log.

const prisma = require('./prisma').default;

let _temColuna   = null;
let _temColunaEm = 0;

async function temColuna(db = prisma) {
  if (_temColuna === true) return true;
  if (_temColuna === false && Date.now() - _temColunaEm < 60_000) return false;
  try {
    const rows = await db.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_animais'
          AND column_name = 'valor_assistencia' LIMIT 1`,
    );
    _temColuna = rows.length > 0;
  } catch { _temColuna = false; }
  _temColunaEm = Date.now();
  return _temColuna;
}

/**
 * Normaliza o valor do body. `undefined` = não enviado (não mexe); `null` = sem
 * assistência; número ≤ 0 ou inválido = sem assistência. Aceita "1.234,56" e "150".
 */
function valorDoBody(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'number'
    ? v
    : Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Grava a assistência de UM animal. Silenciosa sem a coluna e com `undefined`. */
async function salvarAssistencia(client, animalId, valor) {
  const v = valorDoBody(valor);
  if (v === undefined || !animalId) return;
  const db = client ?? prisma;
  if (!(await temColuna(db))) return;
  await db.$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_animais" SET "valor_assistencia" = $1::float8 WHERE "id" = $2`,
    v, Number(animalId),
  );
}

/** Mapa id → valor, em BLOCO (nunca uma consulta por item de lista). */
async function assistenciaPorAnimal(ids, db = prisma) {
  const alvos = [...new Set((ids ?? []).map(Number).filter(Number.isFinite))];
  const mapa = new Map();
  if (alvos.length === 0) return mapa;
  if (!(await temColuna(db))) return mapa;
  const rows = await db.$queryRawUnsafe(
    `SELECT "id", "valor_assistencia" FROM "schs2vet"."tb_animais" WHERE "id" = ANY($1::int[])`,
    alvos,
  );
  for (const r of rows) mapa.set(Number(r.id), r.valor_assistencia == null ? null : Number(r.valor_assistencia));
  return mapa;
}

/** Anexa `valorAssistencia` a um animal (ou lista). Sem a coluna, devolve `null`. */
async function anexarAssistencia(animalOuLista) {
  if (!animalOuLista) return animalOuLista;
  const lista = Array.isArray(animalOuLista) ? animalOuLista : [animalOuLista];
  const mapa = await assistenciaPorAnimal(lista.map(a => a?.id));
  const com = lista.map(a => (a ? { ...a, valorAssistencia: mapa.get(Number(a.id)) ?? null } : a));
  return Array.isArray(animalOuLista) ? com : com[0];
}

/**
 * Animais do proprietário NA EMPRESA com assistência contratada — é o que a fatura cobra.
 * Só animal ATIVO: o paciente excluído logicamente não gera cobrança. O paciente
 * INATIVO (congelado) continua sendo cliente e continua cobrado: o contrato é dele.
 *
 * @returns {Promise<Array<{ id: number, nome: string, valor: number }>>}
 */
async function animaisComAssistencia(proprietarioId, empresaId, db = prisma) {
  if (!proprietarioId) return [];
  if (!(await temColuna(db))) return [];
  const params = [Number(proprietarioId)];
  let filtroEmpresa = '';
  if (empresaId) { params.push(Number(empresaId)); filtroEmpresa = `AND "empresaId" = $2`; }
  const rows = await db.$queryRawUnsafe(
    `SELECT "id", "nome", "valor_assistencia"
       FROM "schs2vet"."tb_animais"
      WHERE "userId" = $1 ${filtroEmpresa}
        AND "ativo" = true AND "valor_assistencia" > 0
      ORDER BY "id" ASC`,
    ...params,
  );
  return rows.map(r => ({ id: Number(r.id), nome: r.nome, valor: Number(r.valor_assistencia) }));
}

module.exports = {
  temColuna, valorDoBody, salvarAssistencia, assistenciaPorAnimal,
  anexarAssistencia, animaisComAssistencia,
};

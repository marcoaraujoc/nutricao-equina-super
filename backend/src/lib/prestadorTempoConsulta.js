// backend/src/lib/prestadorTempoConsulta.js
//
// TEMPO DE CONSULTA do PRESTADOR externo — fonte única (2026-10-01).
//
// O prestador que NÃO integra a equipe é agendado em qualquer dia e horário; a única
// régua da grade dele é a DURAÇÃO do atendimento, que mora aqui
// (`tb_prestadores.tempo_consulta_min`, migration 20261031000000). null = o tempo de
// consulta padrão da empresa (Configurações).
//
// ⚠️ SQL CRU com guarda, pelo motivo de sempre (CLAUDE.md §11): a coluna NÃO está no
// `schema.prisma` (ver o comentário no model Prestador), e enquanto a migration não
// for aplicada a gravação não pode derrubar o CADASTRO inteiro — o pior caso é o
// tempo não persistir, e "padrão da empresa" é o comportamento de antes.
'use strict';

const prismaPadrao = require('./prisma').default;

// Mesma régua do tempo de consulta do membro (`parseLocaisTrabalho`): a grade é
// regerada a partir do início do dia, então qualquer múltiplo de 5 serve.
const TEMPO_MIN = 5;
const TEMPO_MAX = 480;

/**
 * Valida o que veio do body. `undefined` = não mexer; '' / null = voltar ao padrão.
 * @returns {{ erro: string|null, valor: number|null|undefined }}
 */
function normalizarTempoConsulta(bruto) {
  if (bruto === undefined) return { erro: null, valor: undefined };
  if (bruto === null || String(bruto).trim() === '') return { erro: null, valor: null };
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < TEMPO_MIN || n > TEMPO_MAX || n % 5 !== 0) {
    return { erro: `Tempo de consulta deve ser múltiplo de 5, entre ${TEMPO_MIN} e ${TEMPO_MAX} minutos.`, valor: undefined };
  }
  return { erro: null, valor: n };
}

/** Grava. `undefined` não mexe. É UPDATE — chamar DEPOIS do `create`. */
async function gravarTempoConsulta(db, prestadorId, valor) {
  if (valor === undefined) return;
  await db.$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_prestadores" SET "tempo_consulta_min" = $2 WHERE "id" = $1`,
    Number(prestadorId), valor == null ? null : Number(valor),
  ).catch(() => {});
}

/** Map prestadorId → minutos (só os que têm tempo próprio). */
async function lerTemposConsulta(ids, db = prismaPadrao) {
  const lista = [...new Set((ids ?? []).map(Number).filter(Number.isInteger))];
  if (lista.length === 0) return new Map();
  const linhas = await db.$queryRawUnsafe(
    `SELECT "id", "tempo_consulta_min" AS "tempo"
       FROM "schs2vet"."tb_prestadores"
      WHERE "id" = ANY($1::int[]) AND "tempo_consulta_min" IS NOT NULL`,
    lista,
  ).catch(() => []);
  return new Map(linhas.map(l => [Number(l.id), Number(l.tempo)]));
}

/** Anexa `tempoConsultaMin` (null = padrão da empresa) à lista devolvida ao front. */
async function anexarTempoConsulta(lista, db = prismaPadrao) {
  if (!Array.isArray(lista) || lista.length === 0) return lista;
  const mapa = await lerTemposConsulta(lista.map(p => p?.id), db);
  return lista.map(p => (p ? { ...p, tempoConsultaMin: mapa.get(p.id) ?? null } : p));
}

module.exports = {
  TEMPO_MIN, TEMPO_MAX,
  normalizarTempoConsulta, gravarTempoConsulta, lerTemposConsulta, anexarTempoConsulta,
};

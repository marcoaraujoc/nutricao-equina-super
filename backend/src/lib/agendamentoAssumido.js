// backend/src/lib/agendamentoAssumido.js
'use strict';

/**
 * Rastro de quem PERDEU o atendimento quando alguém o assumiu.
 *
 * POR QUE EXISTE
 * `assumir` (agenda e evolução) só troca o `veterinario_id`. Do ponto de vista da
 * tela, o atendimento simplesmente some da agenda de um e aparece na do outro —
 * sem dizer que houve troca nem de quem veio. O AuditLog registra o evento, mas é
 * texto livre e não serve para pintar a linha da agenda.
 *
 * ACESSO POR SQL CRU (parametrizado), mesmo padrão de `lib/proprietarioLocalidades.js`
 * e `lib/usuarioEmpresa.js`: funciona com o client Prisma ainda não regenerado (no
 * Windows o `prisma generate` falha enquanto o backend está rodando — CLAUDE.md §11).
 * Passar `tx` quando a operação já roda dentro de uma transaction.
 */

const prismaPadrao = require('./prisma').default;

const TABELA = 'schs2vet.tb_agendamentos_clinicos';

/**
 * Marca que `agendamentoId` mudou de responsável, guardando de QUEM veio.
 * `deVetId` null (agendamento sem responsável) ainda grava a data — o selo passa a
 * dizer que houve troca, sem o nome.
 */
async function marcarAssumido(client, agendamentoId, deVetId) {
  const db = client || prismaPadrao;
  await db.$executeRawUnsafe(
    `UPDATE ${TABELA} SET "assumido_de_id" = $2, "assumido_em" = NOW() WHERE id = $1`,
    Number(agendamentoId),
    deVetId == null ? null : Number(deVetId),
  );
}

/**
 * Lê o rastro de vários agendamentos de uma vez.
 * Devolve Map<agendamentoId, { assumidoDeId, assumidoDeNome, assumidoEm }>.
 */
async function lerAssumidos(ids, client) {
  const db = client || prismaPadrao;
  const alvo = [...new Set((ids ?? []).map(Number).filter(Number.isInteger))];
  if (alvo.length === 0) return new Map();

  const linhas = await db.$queryRawUnsafe(
    `SELECT a.id,
            a."assumido_de_id" AS "assumidoDeId",
            a."assumido_em"    AS "assumidoEm",
            u."fullName"       AS "assumidoDeNome"
       FROM ${TABELA} a
       LEFT JOIN schs2vet.users u ON u.id = a."assumido_de_id"
      WHERE a.id = ANY($1::int[])
        AND a."assumido_em" IS NOT NULL`,
    alvo,
  );

  const mapa = new Map();
  for (const l of linhas) {
    mapa.set(Number(l.id), {
      assumidoDeId:   l.assumidoDeId == null ? null : Number(l.assumidoDeId),
      assumidoDeNome: l.assumidoDeNome ?? null,
      assumidoEm:     l.assumidoEm ?? null,
    });
  }
  return mapa;
}

/** Anexa o rastro a uma lista de agendamentos já carregada pelo Prisma. */
async function anexarAssumidoEmLista(lista, client) {
  const itens = Array.isArray(lista) ? lista : [];
  if (itens.length === 0) return itens;
  const mapa = await lerAssumidos(itens.map(i => i.id), client);
  for (const item of itens) {
    const info = mapa.get(Number(item.id));
    item.assumidoDe   = info?.assumidoDeId
      ? { id: info.assumidoDeId, fullName: info.assumidoDeNome }
      : null;
    item.assumidoEm   = info?.assumidoEm ?? null;
  }
  return itens;
}

/** Mesma coisa para UM agendamento. */
async function anexarAssumido(item, client) {
  if (!item) return item;
  await anexarAssumidoEmLista([item], client);
  return item;
}

module.exports = {
  marcarAssumido,
  lerAssumidos,
  anexarAssumido,
  anexarAssumidoEmLista,
};

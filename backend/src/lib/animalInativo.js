// backend/src/lib/animalInativo.js
//
// Paciente INATIVO — somente leitura, sem sumir da lista (migration
// 20260818000000_animal_inativo). DIFERENTE de `Animal.ativo` (exclusão lógica — o
// animal SOME de tudo); aqui ele continua aparecendo, só travado: nenhum registro
// clínico novo pode ser criado nem o cadastro do animal editado enquanto durar.
//
// Qualquer perfil com `animais.ativar` pode INATIVAR (motivo obrigatório). REATIVAR é
// sempre gestor/admin — regra fixa no controller (AnimalController.ativar), não
// configurável pela matriz.
//
// ACESSO POR SQL CRU (parametrizado), mesmo padrão de `lib/agendamentoAssumido.js` e
// `lib/proprietarioLocalidades.js`: funciona com o client Prisma ainda não regenerado
// (no Windows o `prisma generate` falha com o backend rodando — CLAUDE.md §11).
'use strict';

const prismaPadrao = require('./prisma').default;

const TABELA = 'schs2vet.tb_animais';

/** Marca o animal como INATIVO, guardando motivo e quem inativou. */
async function marcarInativo(client, animalId, { motivo, porId }) {
  const db = client || prismaPadrao;
  await db.$executeRawUnsafe(
    `UPDATE ${TABELA}
        SET "inativo" = true, "inativo_em" = NOW(), "inativo_motivo" = $2, "inativo_por_id" = $3
      WHERE id = $1`,
    Number(animalId),
    String(motivo ?? '').trim() || null,
    porId == null ? null : Number(porId),
  );
}

/** Reativa o animal — limpa o rastro (a justificativa de cada troca fica no AuditLog). */
async function marcarAtivo(client, animalId) {
  const db = client || prismaPadrao;
  await db.$executeRawUnsafe(
    `UPDATE ${TABELA}
        SET "inativo" = false, "inativo_em" = NULL, "inativo_motivo" = NULL, "inativo_por_id" = NULL
      WHERE id = $1`,
    Number(animalId),
  );
}

/** Lê o estado de inativação de UM animal — usado pelos guards dos módulos clínicos. */
async function lerInativo(animalId, client) {
  const db = client || prismaPadrao;
  const [linha] = await db.$queryRawUnsafe(
    `SELECT "inativo", "inativo_em" AS "inativoEm", "inativo_motivo" AS "inativoMotivo",
            "inativo_por_id" AS "inativoPorId"
       FROM ${TABELA} WHERE id = $1`,
    Number(animalId),
  );
  return linha
    ? {
        inativo:       !!linha.inativo,
        inativoEm:     linha.inativoEm ?? null,
        inativoMotivo: linha.inativoMotivo ?? null,
        inativoPorId:  linha.inativoPorId == null ? null : Number(linha.inativoPorId),
      }
    : null;
}

/** true quando o animal está inativo — atalho para os guards de criação/edição. */
async function animalEstaInativo(animalId, client) {
  if (!animalId) return false;
  const info = await lerInativo(animalId, client);
  return !!info?.inativo;
}

/** Lê o rastro de vários animais de uma vez. Devolve Map<animalId, info + nome>. */
async function lerInativosEmLote(ids, client) {
  const db = client || prismaPadrao;
  const alvo = [...new Set((ids ?? []).map(Number).filter(Number.isInteger))];
  if (alvo.length === 0) return new Map();

  const linhas = await db.$queryRawUnsafe(
    `SELECT a.id,
            a."inativo"          AS "inativo",
            a."inativo_em"       AS "inativoEm",
            a."inativo_motivo"   AS "inativoMotivo",
            a."inativo_por_id"   AS "inativoPorId",
            u."fullName"         AS "inativoPorNome"
       FROM ${TABELA} a
       LEFT JOIN schs2vet.users u ON u.id = a."inativo_por_id"
      WHERE a.id = ANY($1::int[])`,
    alvo,
  );

  const mapa = new Map();
  for (const l of linhas) {
    mapa.set(Number(l.id), {
      inativo:        !!l.inativo,
      inativoEm:      l.inativoEm ?? null,
      inativoMotivo:  l.inativoMotivo ?? null,
      inativoPorId:   l.inativoPorId == null ? null : Number(l.inativoPorId),
      inativoPorNome: l.inativoPorNome ?? null,
    });
  }
  return mapa;
}

/** Anexa o estado de inativação a uma lista de animais já carregada pelo Prisma. */
async function anexarInativoEmLista(lista, client) {
  const itens = Array.isArray(lista) ? lista : [];
  if (itens.length === 0) return itens;
  const mapa = await lerInativosEmLote(itens.map(i => i.id), client);
  for (const item of itens) {
    const info = mapa.get(Number(item.id)) ?? null;
    item.inativo        = info?.inativo ?? false;
    item.inativoEm      = info?.inativoEm ?? null;
    item.inativoMotivo  = info?.inativoMotivo ?? null;
    item.inativoPor     = info?.inativoPorId
      ? { id: info.inativoPorId, fullName: info.inativoPorNome }
      : null;
  }
  return itens;
}

/** Mesma coisa para UM animal. */
async function anexarInativo(item, client) {
  if (!item) return item;
  await anexarInativoEmLista([item], client);
  return item;
}

module.exports = {
  marcarInativo,
  marcarAtivo,
  lerInativo,
  animalEstaInativo,
  lerInativosEmLote,
  anexarInativo,
  anexarInativoEmLista,
};

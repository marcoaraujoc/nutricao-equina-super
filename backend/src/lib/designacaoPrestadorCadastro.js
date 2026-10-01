// backend/src/lib/designacaoPrestadorCadastro.js
//
// 🔴 AUTORIZAÇÃO DE PACIENTE PELO CADASTRO DO PRESTADOR — fonte única (2026-09-30).
//
// POR QUE EXISTE: o "Gerenciar Acesso" gravava a designação pelo LOGIN
// (`tb_designacoes_prestador.prestador_id` → `users`). O prestador cadastrado SEM
// "Terá acesso ao sistema" não tem login, então o botão nem aparecia para ele — e,
// sem autorização registrada, não havia como agendá-lo para um paciente.
// Decisão (a pedido): o prestador SEM login também recebe a autorização, e ela é o
// que libera agendá-lo na Agenda.
//
// DUAS TABELAS, UM CONCEITO — "este prestador está autorizado para este paciente?":
//   • `tb_designacoes_prestador_cadastro` (migration 20261028000000) → pelo CADASTRO.
//     É a fonte desta tela, com ou sem login.
//   • `tb_designacoes_prestador` → pelo LOGIN. É a que dá ESCOPO DE ACESSO ao
//     sistema (animalScope/animalAccess) e continua sendo gravada pelo encaminhamento.
// A resposta é a UNIÃO das duas: designação feita antes desta mudança (pelo login,
// ou pelo encaminhamento) continua valendo, sem backfill.
//
// ⚠️ Com login, conceder/revogar grava AS DUAS (espelho). Sem isso a Agenda aceitaria
// o paciente e o prestador, ao entrar, não o veria — ou o contrário.
// ⚠️ Quando o login nasce DEPOIS (cadastro salvo com "Terá acesso ao sistema"),
// `sincronizarComLogin` copia as autorizações do cadastro para a do login.
//
// ACESSO À TABELA NOVA POR SQL CRU (parametrizado), mesmo padrão de
// `lib/encaminhamentoPrestador.js`: funciona com o client Prisma ainda não regenerado
// (no Windows o `generate` falha com o backend rodando — CLAUDE.md §11). Sem a
// migration aplicada, a leitura cai só nas designações por login e a ESCRITA recusa
// com `MigrationPendenteError` — nunca um 500 sem explicação.
'use strict';

const prismaPadrao = require('./prisma').default;

const TABELA = 'schs2vet.tb_designacoes_prestador_cadastro';
const MIGRATION = '20261028000000_prestador_designacao_agenda';

class MigrationPendenteError extends Error {
  constructor() {
    super(`Autorização de prestador sem login indisponível: a migration ${MIGRATION} ainda não foi aplicada no banco.`);
    this.code   = 'MIGRATION_PENDENTE';
    this.status = 400;
  }
}

// `true` fica em cache (a tabela não some); `false` é consultado de novo — a
// migration pode ser aplicada com o backend no ar.
let tabelaConfirmada = false;
async function temTabela(db = prismaPadrao) {
  if (tabelaConfirmada) return true;
  try {
    const r = await db.$queryRawUnsafe(`SELECT to_regclass('${TABELA}') IS NOT NULL AS ok`);
    tabelaConfirmada = !!r?.[0]?.ok;
  } catch { tabelaConfirmada = false; }
  return tabelaConfirmada;
}

/**
 * Equipe do CARTÃO DE ACESSO do prestador NA EMPRESA DELE — é onde a designação por
 * login é gravada. `null` = sem login ou sem cartão (não há o que espelhar).
 *
 * ⚠️ Escopado pela empresa do CADASTRO: o mesmo profissional pode ser membro de outra
 * clínica (ex.: veterinário lá, prestador aqui). O "primeiro vínculo" sem esse filtro
 * gravaria a autorização na equipe da OUTRA empresa.
 */
async function equipeDoCartao(db, prestador) {
  if (!prestador?.userId || !prestador?.empresaId) return null;
  const v = await db.membroEquipe.findFirst({
    where:   { userId: Number(prestador.userId), equipe: { empresaId: Number(prestador.empresaId) } },
    select:  { equipeId: true },
    orderBy: { createdAt: 'asc' },
  });
  return v?.equipeId ?? null;
}

/**
 * Autorizações VIGENTES de UM prestador, já com a união das duas fontes.
 * Devolve Map<animalId, { motivo, dataInicio }>.
 */
async function autorizacoesDoPrestador(db, prestador) {
  const mapa = new Map();
  if (!prestador?.id) return mapa;

  if (await temTabela(db)) {
    const linhas = await db.$queryRawUnsafe(
      `SELECT animal_id AS "animalId", motivo, data_inicio AS "dataInicio"
         FROM ${TABELA}
        WHERE prestador_id = $1 AND ativo = true`,
      Number(prestador.id),
    );
    for (const l of linhas) mapa.set(Number(l.animalId), { motivo: l.motivo ?? null, dataInicio: l.dataInicio });
  }

  if (prestador.userId && prestador.empresaId) {
    const porLogin = await db.designacaoPrestador.findMany({
      where:  { prestadorId: Number(prestador.userId), ativo: true, equipe: { empresaId: Number(prestador.empresaId) } },
      select: { animalId: true, motivo: true, dataInicio: true },
    });
    for (const d of porLogin) {
      if (!mapa.has(d.animalId)) mapa.set(d.animalId, { motivo: d.motivo ?? null, dataInicio: d.dataInicio });
    }
  }
  return mapa;
}

/** O prestador está autorizado para este paciente? (união das duas fontes) */
async function prestadorAutorizado(db, prestador, animalId) {
  const mapa = await autorizacoesDoPrestador(db, prestador);
  return mapa.has(Number(animalId));
}

/**
 * Autorizações vigentes de VÁRIOS prestadores de uma vez (grade da Agenda).
 * `prestadores` = [{ id, userId, empresaId }]. Devolve Map<prestadorId, Set<animalId>>.
 */
async function autorizacoesEmLote(db, prestadores) {
  const mapa = new Map();
  const lista = (prestadores ?? []).filter(p => p?.id);
  for (const p of lista) mapa.set(Number(p.id), new Set());
  if (lista.length === 0) return mapa;

  if (await temTabela(db)) {
    const linhas = await db.$queryRawUnsafe(
      `SELECT prestador_id AS "prestadorId", animal_id AS "animalId"
         FROM ${TABELA}
        WHERE ativo = true AND prestador_id = ANY($1::int[])`,
      lista.map(p => Number(p.id)),
    );
    for (const l of linhas) mapa.get(Number(l.prestadorId))?.add(Number(l.animalId));
  }

  const comLogin = lista.filter(p => p.userId && p.empresaId);
  if (comLogin.length > 0) {
    const porUser = new Map(comLogin.map(p => [Number(p.userId), p]));
    const porLogin = await db.designacaoPrestador.findMany({
      where:  { prestadorId: { in: [...porUser.keys()] }, ativo: true },
      select: { prestadorId: true, animalId: true, equipe: { select: { empresaId: true } } },
    });
    for (const d of porLogin) {
      const p = porUser.get(d.prestadorId);
      // Só vale a designação feita NA empresa do cadastro — a de outra clínica é
      // escopo daquela clínica, não autorização desta.
      if (p && d.equipe?.empresaId === Number(p.empresaId)) mapa.get(Number(p.id))?.add(d.animalId);
    }
  }
  return mapa;
}

/**
 * Concede a autorização a vários pacientes, numa transaction do chamador.
 * Com login + cartão, espelha na designação por login (é ela que dá acesso ao sistema).
 */
async function conceder(tx, { prestador, animalIds, motivo, criadoPorId }) {
  if (!(await temTabela(tx))) throw new MigrationPendenteError();
  const ids = [...new Set((animalIds ?? []).map(Number))].filter(Number.isInteger);
  const motivoLimpo = motivo?.trim() ? motivo.trim().slice(0, 255) : null;

  for (const animalId of ids) {
    // `NOW() AT TIME ZONE 'UTC'`: coluna `timestamp` (UTC naive) — o `NOW()` puro
    // gravaria a hora do fuso da SESSÃO (§6, SQL cru).
    await tx.$executeRawUnsafe(
      `INSERT INTO ${TABELA}
              (empresa_id, prestador_id, animal_id, motivo, ativo, data_inicio, data_fim, criado_por_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, NOW() AT TIME ZONE 'UTC', NULL, $5, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
       ON CONFLICT (prestador_id, animal_id) DO UPDATE
          SET ativo = true, data_fim = NULL, motivo = EXCLUDED.motivo,
              data_inicio = EXCLUDED.data_inicio, updated_at = EXCLUDED.updated_at`,
      Number(prestador.empresaId), Number(prestador.id), animalId, motivoLimpo,
      criadoPorId ? Number(criadoPorId) : null,
    );
  }

  const equipeId = await equipeDoCartao(tx, prestador);
  if (equipeId) {
    const agora = new Date();
    for (const animalId of ids) {
      await tx.designacaoPrestador.upsert({
        where:  { animalId_prestadorId_equipeId: { animalId, prestadorId: Number(prestador.userId), equipeId } },
        create: {
          animalId, prestadorId: Number(prestador.userId), equipeId,
          motivo: motivoLimpo, criadoPorId: criadoPorId ? Number(criadoPorId) : null, ativo: true, dataInicio: agora,
        },
        update: { ativo: true, dataFim: null, motivo: motivoLimpo, dataInicio: agora },
      });
    }
  }
  return ids.length;
}

/**
 * Revoga a autorização de UM paciente (`animalId`) ou de TODOS (`animalId` nulo), nas
 * duas fontes. Soft delete (ativo=false + data_fim), preservando o histórico.
 * Devolve quantos pacientes estavam autorizados e deixaram de estar.
 */
async function revogar(tx, { prestador, animalId = null }) {
  const antes = await autorizacoesDoPrestador(tx, prestador);
  const alvo  = animalId == null ? [...antes.keys()] : (antes.has(Number(animalId)) ? [Number(animalId)] : []);

  if (await temTabela(tx)) {
    await tx.$executeRawUnsafe(
      `UPDATE ${TABELA}
          SET ativo = false, data_fim = NOW() AT TIME ZONE 'UTC', updated_at = NOW() AT TIME ZONE 'UTC'
        WHERE prestador_id = $1 AND ativo = true
          AND ($2::int IS NULL OR animal_id = $2::int)`,
      Number(prestador.id), animalId == null ? null : Number(animalId),
    );
  }

  if (prestador.userId && prestador.empresaId) {
    await tx.designacaoPrestador.updateMany({
      where: {
        prestadorId: Number(prestador.userId), ativo: true,
        equipe: { empresaId: Number(prestador.empresaId) },
        ...(animalId == null ? {} : { animalId: Number(animalId) }),
      },
      data: { ativo: false, dataFim: new Date() },
    });
  }
  return alvo.length;
}

/**
 * O login do prestador NASCEU (ou o cartão foi reemitido): as autorizações que ele já
 * tinha pelo CADASTRO passam a valer também para o login — senão ele entraria no
 * sistema sem enxergar os pacientes que a clínica já tinha autorizado.
 * Idempotente (upsert). Sem a tabela, não há o que copiar.
 */
async function sincronizarComLogin(tx, { prestadorId, userId, equipeId }) {
  if (!prestadorId || !userId || !equipeId) return 0;
  if (!(await temTabela(tx))) return 0;
  const linhas = await tx.$queryRawUnsafe(
    `SELECT animal_id AS "animalId", motivo, criado_por_id AS "criadoPorId"
       FROM ${TABELA} WHERE prestador_id = $1 AND ativo = true`,
    Number(prestadorId),
  );
  const agora = new Date();
  for (const l of linhas) {
    const animalId = Number(l.animalId);
    await tx.designacaoPrestador.upsert({
      where:  { animalId_prestadorId_equipeId: { animalId, prestadorId: Number(userId), equipeId: Number(equipeId) } },
      create: {
        animalId, prestadorId: Number(userId), equipeId: Number(equipeId),
        motivo: l.motivo ?? null, criadoPorId: l.criadoPorId ?? null, ativo: true, dataInicio: agora,
      },
      update: { ativo: true, dataFim: null },
    });
  }
  return linhas.length;
}

module.exports = {
  MigrationPendenteError,
  temTabela,
  equipeDoCartao,
  autorizacoesDoPrestador,
  prestadorAutorizado,
  autorizacoesEmLote,
  conceder,
  revogar,
  sincronizarComLogin,
};

// backend/src/lib/proprietarioLocalidades.js
'use strict';

/**
 * Localidades atendidas de um PROPRIETÁRIO, cada uma com a SUA frequência de visitas
 * semanais (ex.: Sociedade Hípica Brasileira 2x + Haras H.P. 3x).
 *
 * POR QUE EXISTE
 * O cliente pode ter animais em mais de um lugar, e o combinado de visitas é POR LUGAR.
 * O campo único `frequenciaVisitas` (User / ProprietarioPerfil / UsuarioEmpresa) não
 * comporta isso; ele segue existindo como AGREGADO (o MAIOR entre as localidades) para
 * as leituras legadas e para o ADMIN global, que não tem empresa de contexto.
 *
 * POR EMPRESA, pela mesma razão do `proprietarioPerfil`: o combinado da clínica A não é
 * o da clínica B, ainda que o cliente seja o mesmo login.
 *
 * ACESSO POR SQL CRU (parametrizado), mesmo padrão de `lib/auditoria.js` e do
 * `isConvidado`/`cadastroConfirmadoEm`: funciona mesmo com o client Prisma ainda não
 * regenerado nesta máquina (no Windows o `prisma generate` falha enquanto o backend
 * está rodando — ver seção 11 do CLAUDE.md).
 */

const prismaPadrao = require('./prisma').default;

const TABELA = 'schs2vet.tb_proprietario_localidades';

const FREQ_MIN = 1;
const FREQ_MAX = 7;

/**
 * Valida e normaliza `body.localidades` = [{ localizacaoId, frequenciaVisitas }].
 * undefined → { localidades: undefined } (não altera nada).
 * Retorna { localidades } ou { erro }.
 */
function normalizarLocalidades(entrada) {
  if (entrada === undefined) return { localidades: undefined };
  if (!Array.isArray(entrada)) return { erro: 'localidades deve ser uma lista.' };

  const out = [];
  const vistos = new Set();
  for (const l of entrada) {
    const localizacaoId = Number(l?.localizacaoId);
    if (!Number.isInteger(localizacaoId) || localizacaoId <= 0) {
      return { erro: 'Selecione a localidade de cada linha.' };
    }
    const freq = Number(l?.frequenciaVisitas);
    if (!Number.isInteger(freq) || freq < FREQ_MIN || freq > FREQ_MAX) {
      return { erro: `Informe a frequência de visitas de cada localidade (${FREQ_MIN} a ${FREQ_MAX} vezes por semana).` };
    }
    // Uma frequência por lugar: repetir a localidade seria um segundo combinado
    // para o mesmo local, sem como saber qual vale.
    if (vistos.has(localizacaoId)) {
      return { erro: 'Localidade repetida — informe uma frequência por localidade.' };
    }
    vistos.add(localizacaoId);
    out.push({ localizacaoId, frequenciaVisitas: freq });
  }
  return { localidades: out };
}

/**
 * Agregado para o campo único legado: a MAIOR frequência entre as localidades.
 * MAIOR (e não a soma) porque o campo é semanticamente 1-7 — somar estouraria a
 * escala e quebraria a leitura de quem ainda lê o campo antigo.
 */
function frequenciaAgregada(localidades) {
  if (!Array.isArray(localidades) || localidades.length === 0) return null;
  return localidades.reduce((max, l) => Math.max(max, Number(l.frequenciaVisitas) || 0), 0) || null;
}

/** Localidades de UM proprietário numa empresa (com o nome do local). */
async function listarLocalidades(userId, empresaId, client = prismaPadrao) {
  if (!userId || !empresaId) return [];
  const mapa = await buscarPorProprietarios([userId], empresaId, client);
  return mapa.get(Number(userId)) ?? [];
}

/** Map(userId → localidades[]) para vários proprietários da MESMA empresa. */
async function buscarPorProprietarios(userIds, empresaId, client = prismaPadrao) {
  const ids = [...new Set((userIds ?? []).map(Number).filter(Number.isInteger))];
  if (!empresaId || ids.length === 0) return new Map();

  // Placeholders numerados: $1 = empresaId, $2.. = ids
  const ph = ids.map((_, i) => `$${i + 2}`).join(', ');
  const rows = await client.$queryRawUnsafe(
    `SELECT pl."user_id"            AS "userId",
            pl."localizacao_id"     AS "localizacaoId",
            pl."frequencia_visitas" AS "frequenciaVisitas",
            loc."nome"              AS "localizacaoNome"
       FROM ${TABELA} pl
       JOIN schs2vet.tb_localizacoes_animal loc ON loc."id" = pl."localizacao_id"
      WHERE pl."empresa_id" = $1 AND pl."user_id" IN (${ph})
      ORDER BY loc."nome" ASC`,
    Number(empresaId), ...ids,
  );

  const mapa = new Map();
  for (const r of rows) {
    const uid = Number(r.userId);
    if (!mapa.has(uid)) mapa.set(uid, []);
    mapa.get(uid).push({
      localizacaoId:     Number(r.localizacaoId),
      localizacaoNome:   r.localizacaoNome ?? null,
      frequenciaVisitas: Number(r.frequenciaVisitas),
    });
  }
  return mapa;
}

/** Anexa `localidades` a cada proprietário de uma lista já carregada. */
async function anexarEmLista(proprietarios, empresaId, client = prismaPadrao) {
  const lista = proprietarios ?? [];
  if (!empresaId || lista.length === 0) {
    return lista.map(p => ({ ...p, localidades: [] }));
  }
  const mapa = await buscarPorProprietarios(lista.map(p => p.id), empresaId, client);
  return lista.map(p => ({ ...p, localidades: mapa.get(Number(p.id)) ?? [] }));
}

/** Anexa `localidades` a UM proprietário já carregado. */
async function anexar(proprietario, empresaId, client = prismaPadrao) {
  if (!proprietario) return proprietario;
  return { ...proprietario, localidades: await listarLocalidades(proprietario.id, empresaId, client) };
}

/**
 * Substitui TODAS as localidades do proprietário NA EMPRESA (delete + insert).
 * `localidades === undefined` → não altera nada; `[]` → limpa.
 * Passar `tx` quando já houver transação em andamento.
 */
async function salvarLocalidades(client, userId, empresaId, localidades) {
  if (localidades === undefined) return;
  if (!empresaId) return; // ADMIN global não tem empresa a que atribuir o combinado

  await client.$executeRawUnsafe(
    `DELETE FROM ${TABELA} WHERE "user_id" = $1 AND "empresa_id" = $2`,
    Number(userId), Number(empresaId),
  );
  for (const l of localidades) {
    await client.$executeRawUnsafe(
      `INSERT INTO ${TABELA}
         ("user_id", "empresa_id", "localizacao_id", "frequencia_visitas", "created_at", "updated_at")
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("user_id", "empresa_id", "localizacao_id") DO UPDATE
         SET "frequencia_visitas" = EXCLUDED."frequencia_visitas",
             "updated_at" = CURRENT_TIMESTAMP`,
      Number(userId), Number(empresaId), Number(l.localizacaoId), Number(l.frequenciaVisitas),
    );
  }
}

module.exports = {
  FREQ_MIN,
  FREQ_MAX,
  normalizarLocalidades,
  frequenciaAgregada,
  listarLocalidades,
  buscarPorProprietarios,
  anexarEmLista,
  anexar,
  salvarLocalidades,
};

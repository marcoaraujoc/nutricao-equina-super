// backend/src/lib/animalAtivacao.js
//
// Trilha de ATIVAÇÃO/DESATIVAÇÃO de Animal.ativo — exclusão lógica "de verdade":
// quando ativo=false o paciente some de toda tela do sistema (ver
// lib/visibilidade.js). `ativo` sozinho só diz o estado ATUAL; a tela de
// Pacientes (abas Ativos/Inativos/Todos) e a Auditoria precisam responder
// TAMBÉM "desde quando" e "por quem" — ver AnimalController.excluir/reativar.
//
// ⚠️ NÃO confundir com `lib/animalInativo.js` (Animal.inativo — bloqueio de
// somente-leitura; o paciente CONTINUA aparecendo normalmente). São dois
// recursos diferentes, e por isso as colunas de trilha têm nomes diferentes:
// `ativo_em`/`ativo_por_id` (reativação) e `desativado_em`/`desativado_por_id`
// (exclusão lógica) — `inativo_em`/`inativo_por_id` já pertencem ao outro
// recurso.
//
// Migration `20260827000001_animal_ativacao_trilha`. ACESSO POR SQL CRU
// (parametrizado), mesmo padrão de `lib/animalInativo.js` e
// `lib/cadastroAtivacao.js`: funciona com o client Prisma ainda não regenerado
// (no Windows o `prisma generate` falha com o backend rodando).
'use strict';

const prismaPadrao = require('./prisma').default;

const TABELA = 'schs2vet.tb_animais';

// Mesma cache de `cadastroAtivacao.js#temColunas`: positivo é definitivo,
// negativo expira em 60s (roda a migration com o backend no ar sem restart).
let _temColunas = null;
let _temColunasEm = 0;
async function temColunas() {
  if (_temColunas === true) return true;
  if (_temColunas === false && Date.now() - _temColunasEm < 60_000) return false;
  try {
    const rows = await prismaPadrao.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_animais'
          AND column_name = 'ativo_por_id' LIMIT 1`,
    );
    _temColunas = rows.length > 0;
  } catch { _temColunas = false; }
  _temColunasEm = Date.now();
  return _temColunas;
}

// Cache PRÓPRIA para `desativado_motivo` (migration 20260901000000) — separada
// de `temColunas()` porque a trilha básica pode já estar em produção enquanto
// esta coluna ainda não foi migrada. NÃO confundir com `inativo_motivo`, que já
// existe em `tb_animais` para o recurso DIFERENTE de bloqueio somente-leitura.
let _temMotivo = null;
let _temMotivoEm = 0;
async function temColunaMotivo() {
  if (_temMotivo === true) return true;
  if (_temMotivo === false && Date.now() - _temMotivoEm < 60_000) return false;
  try {
    const rows = await prismaPadrao.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_animais'
          AND column_name = 'desativado_motivo' LIMIT 1`,
    );
    _temMotivo = rows.length > 0;
  } catch { _temMotivo = false; }
  _temMotivoEm = Date.now();
  return _temMotivo;
}

/**
 * Grava a REATIVAÇÃO (ativo=true) + quem/quando.
 * ⚠️ O ativo=true SEMPRE é gravado, mesmo sem as colunas de trilha (migration
 * ainda não aplicada) — cair fora nesse caso deixava a reativação em NO-OP
 * silencioso. A trilha (quem/quando) é só um EXTRA best-effort por cima do
 * estado real.
 */
async function registrarAtivacao(client, animalId, porUserId) {
  const db = client || prismaPadrao;
  if (!(await temColunas())) {
    await db.$executeRawUnsafe(`UPDATE ${TABELA} SET ativo = true WHERE id = $1`, Number(animalId));
    return;
  }
  await db.$executeRawUnsafe(
    `UPDATE ${TABELA} SET ativo = true, ativo_em = now(), ativo_por_id = $1 WHERE id = $2`,
    Number(porUserId), Number(animalId),
  );
}

/**
 * Grava a DESATIVAÇÃO (ativo=false) + quem/quando + a justificativa (`motivo`,
 * exigida por `AnimalController.excluir`). Mesma garantia de best-effort acima
 * para a trilha básica; `motivo` só é gravado quando a coluna já existe.
 */
async function registrarDesativacao(client, animalId, porUserId, motivo = null) {
  const db = client || prismaPadrao;
  if (!(await temColunas())) {
    await db.$executeRawUnsafe(`UPDATE ${TABELA} SET ativo = false WHERE id = $1`, Number(animalId));
    return;
  }
  if (motivo != null && (await temColunaMotivo())) {
    await db.$executeRawUnsafe(
      `UPDATE ${TABELA} SET ativo = false, desativado_em = now(), desativado_por_id = $1, desativado_motivo = $2 WHERE id = $3`,
      Number(porUserId), motivo, Number(animalId),
    );
    return;
  }
  await db.$executeRawUnsafe(
    `UPDATE ${TABELA} SET ativo = false, desativado_em = now(), desativado_por_id = $1 WHERE id = $2`,
    Number(porUserId), Number(animalId),
  );
}

/**
 * Trilha de vários animais de uma vez:
 * Map(animalId → { ativoEm, ativoPorNome, desativadoEm, desativadoPorNome, desativadoMotivo }).
 */
async function lerTrilhaEmLote(ids, client) {
  const db = client || prismaPadrao;
  const idsNum = [...new Set((ids ?? []).map(Number).filter(Number.isInteger))];
  const mapa = new Map();
  if (idsNum.length === 0 || !(await temColunas())) return mapa;
  const comMotivo = await temColunaMotivo();
  const rows = await db.$queryRawUnsafe(
    `SELECT a.id AS id, a.ativo_em AS ativo_em, a.desativado_em AS desativado_em,
            ap."fullName" AS ativo_por_nome, dp."fullName" AS desativado_por_nome
            ${comMotivo ? ', a.desativado_motivo AS desativado_motivo' : ''}
       FROM ${TABELA} a
       LEFT JOIN schs2vet.users ap ON ap.id = a.ativo_por_id
       LEFT JOIN schs2vet.users dp ON dp.id = a.desativado_por_id
      WHERE a.id = ANY($1::int[])`,
    idsNum,
  );
  for (const r of rows) {
    mapa.set(Number(r.id), {
      ativoEm:            r.ativo_em ?? null,
      ativoPorNome:       r.ativo_por_nome ?? null,
      desativadoEm:       r.desativado_em ?? null,
      desativadoPorNome:  r.desativado_por_nome ?? null,
      desativadoMotivo:   comMotivo ? (r.desativado_motivo ?? null) : null,
    });
  }
  return mapa;
}

/** Anexa a trilha a uma lista de animais já carregada (cada item já com `id`). */
async function anexarTrilhaEmLista(itens, client) {
  if (!Array.isArray(itens) || itens.length === 0) return itens;
  const mapa = await lerTrilhaEmLote(itens.map(i => i?.id), client);
  if (mapa.size === 0) return itens;
  return itens.map(item => {
    const d = mapa.get(Number(item.id));
    return d ? { ...item, ...d } : item;
  });
}

/**
 * Animal com EXCLUSÃO LÓGICA (Animal.ativo=false) — "some de tudo" (lib/visibilidade.js):
 * nenhum registro clínico novo pode ser criado para ele até o gestor reativar.
 *
 * ⚠️ NÃO confundir com `lib/animalInativo.js#animalEstaInativo` — aquele é o BLOQUEIO
 * de somente-leitura (Animal.inativo, paciente continua visível/normal em toda tela),
 * este é a exclusão lógica (Animal.ativo, paciente some de tudo). São dois recursos
 * diferentes e as telas de CRIAÇÃO de registro clínico precisam checar os DOIS —
 * checar só o bloqueio deixava criar evolução/prescrição/vacina/exame/encaminhamento/
 * agendamento/dieta para um paciente já inativado, contanto que quem estivesse
 * logado fosse gestor (só o gestor consegue abrir o cadastro de um animal inativo).
 */
async function animalFoiExcluido(animalId) {
  const animal = await prismaPadrao.animal.findUnique({
    where: { id: Number(animalId) }, select: { ativo: true },
  });
  return !animal || animal.ativo === false;
}

module.exports = {
  registrarAtivacao,
  registrarDesativacao,
  lerTrilhaEmLote,
  anexarTrilhaEmLista,
  animalFoiExcluido,
};

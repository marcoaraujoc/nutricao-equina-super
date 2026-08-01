// backend/src/lib/validadeOrcamento.js
// Validade do ORÇAMENTO em dias — coluna `validade_orcamento_dias` de
// tb_empresa_configuracoes (migration 20260813000000).
//
// POR QUE SQL CRU: mesma razão do `isConvidado`/`cadastroConfirmadoEm`/`acessoSistema` —
// no Windows o `prisma generate` falha com o backend rodando, e passar um campo que o
// client ainda não conhece ao `update`/`create` derrubaria o SALVAR de Configurações
// INTEIRO (logo, o gestor não conseguiria nem mexer no logo). Sempre parametrizado.
'use strict';

const prisma = require('./prisma').default;

const VALIDADE_MIN = 1;
const VALIDADE_MAX = 365;

/** Normaliza a entrada do request. Retorna { erro } ou { valor: number|null }. */
function normalizarValidade(bruto) {
  if (bruto === undefined) return { valor: undefined }; // não altera
  const s = String(bruto).trim();
  if (s === '') return { valor: null };                 // sem validade — não expira
  const n = Number(s);
  if (!Number.isInteger(n) || n < VALIDADE_MIN || n > VALIDADE_MAX) {
    return { erro: `Validade do orçamento inválida — informe de ${VALIDADE_MIN} a ${VALIDADE_MAX} dias.` };
  }
  return { valor: n };
}

// ⚠️ tb_empresa_configuracoes é das poucas tabelas SEM @map nas FKs: as colunas
// chamam-se "empresaId"/"equipeId" (camelCase), e no Postgres isso EXIGE aspas —
// sem elas o identificador é dobrado para minúsculas e a query morre com
// `column "empresa_id" does not exist`.

/** Lê a validade configurada no escopo. null = sem validade. */
async function lerValidade(client, empresaId, equipeId = null) {
  const rows = equipeId == null
    ? await client.$queryRawUnsafe(
        `SELECT validade_orcamento_dias AS dias FROM schs2vet.tb_empresa_configuracoes
          WHERE "empresaId" = $1 AND "equipeId" IS NULL LIMIT 1`, empresaId)
    : await client.$queryRawUnsafe(
        `SELECT validade_orcamento_dias AS dias FROM schs2vet.tb_empresa_configuracoes
          WHERE "empresaId" = $1 AND "equipeId" = $2 LIMIT 1`, empresaId, equipeId);
  const dias = rows?.[0]?.dias;
  return dias == null ? null : Number(dias);
}

/**
 * Grava a validade no escopo. A linha de configuração já existe quando isto roda
 * (salvarConfiguracao faz o upsert antes) — sem linha, não há o que atualizar.
 */
async function salvarValidade(client, empresaId, equipeId, dias) {
  if (dias === undefined) return;
  const valor = dias == null ? null : Number(dias);
  if (equipeId == null) {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_empresa_configuracoes SET validade_orcamento_dias = $2
        WHERE "empresaId" = $1 AND "equipeId" IS NULL`, empresaId, valor);
  } else {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_empresa_configuracoes SET validade_orcamento_dias = $2
        WHERE "empresaId" = $1 AND "equipeId" = $3`, empresaId, valor, equipeId);
  }
}

/** Todos os escopos com validade configurada — usado pelo cron de expiração. */
async function listarEscoposComValidade(client = prisma) {
  const rows = await client.$queryRawUnsafe(
    `SELECT "empresaId", "equipeId", validade_orcamento_dias AS dias
       FROM schs2vet.tb_empresa_configuracoes
      WHERE validade_orcamento_dias IS NOT NULL`);
  return (rows ?? []).map(r => ({
    empresaId: Number(r.empresaId),
    equipeId:  r.equipeId == null ? null : Number(r.equipeId),
    dias:      Number(r.dias),
  }));
}

module.exports = {
  VALIDADE_MIN, VALIDADE_MAX,
  normalizarValidade, lerValidade, salvarValidade, listarEscoposComValidade,
};

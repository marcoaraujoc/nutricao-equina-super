'use strict';
// lib/faturaFechamentoAnimal.js — FECHAR A FATURA POR ANIMAL (migration 20261018000000)
//
// 🔴 A fatura é do PROPRIETÁRIO e junta TODOS os pacientes dele. Fechar por animal
// encerra o bloco de UM paciente dentro dela: os itens daquele animal ficam marcados
// (`fechado_em`) e SAEM do `total` da fatura, indo para `total_fechado`.
//
// ⚠️ A MARCA É DO ITEM, nunca do par (fatura, animal). É o que faz a cobrança que
// chegar DEPOIS do fechamento nascer ABERTA e voltar a contar no total — com a marca no
// par, toda dose aplicada depois cairia calada dentro de um bloco já encerrado e o
// cliente deixaria de ser cobrado por ela. O mesmo animal pode ser fechado de novo
// quantas vezes o ciclo pedir.
//
// ⚠️ O bloco fechado NÃO é "pago" nem "cancelado": continua DEVIDO, só é acertado à
// parte. Por isso `total_fechado` existe — "contas a receber" e "devedores" somam
// `total + totalFechado`, senão o fechamento por animal apagaria dinheiro dos
// indicadores em silêncio.
//
// 🔴 SQL CRU COM GUARDA DE COLUNA — mesmo padrão de `lib/formasRecebimentoFatura.js` e
// `lib/animalFei.js`. No Windows o `prisma generate` FALHA com o backend rodando (§11),
// então o client em execução pode não conhecer as colunas novas; passá-las ao
// `fatura.update` tipado nesse estado derrubaria o RECÁLCULO DO TOTAL — ou seja, a
// fatura inteira — e não só o campo novo.
//
// ⚠️ TENANCY: nada aqui amplia escopo. `tb_fatura_itens` e `tb_faturas` já têm RLS
// próprio (o item pelo pai `faturaId` → `tb_faturas."empresa_id"`, ver lib/tenancyMap.js),
// e estas consultas passam pelo MESMO client carimbado da requisição. Quem confere se a
// fatura é desta clínica antes de chamar é o controller (`faturaForaDoEscopo`), como em
// toda ação de fatura alcançada por id.

/**
 * O client global, resolvido SOB DEMANDA.
 *
 * ⚠️ `require('./prisma')` no topo do módulo quebraria todo teste que só exercita a
 * ARITMÉTICA da fatura: `lib/prisma` é TypeScript, o jest não o transpila, e o import
 * derrubaria o arquivo inteiro na carga — mesma razão de `lib/faturaItemOrigens.js`
 * receber o client por parâmetro e nunca importá-lo.
 * Sem banco, a guarda de coluna cai em `false` (= "base não migrada") e tudo se comporta
 * como antes do fechamento por animal: nenhum item fechado, `total` = soma de todos.
 */
function prismaGlobal() {
  return require('./prisma').default;
}

/** O client da chamada, ou o global quando não houver. */
function clienteOu(client) {
  return client ?? prismaGlobal();
}

let _temColunas   = null;
let _temColunasEm = 0;

/**
 * As colunas já existem no banco? `false` expira em 60s — aplicar a migration com o
 * backend no ar volta a funcionar sem restart.
 *
 * ⚠️ A guarda usa o client GLOBAL de propósito, nunca o `tx` recebido: SQL cru contra
 * coluna inexistente DENTRO de uma transaction aborta a TRANSACTION INTEIRA (25P02), e
 * quem estoura é o comando seguinte, longe do culpado.
 */
async function temColunas() {
  if (_temColunas === true) return true;
  if (_temColunas === false && Date.now() - _temColunasEm < 60000) return false;
  try {
    const rows = await prismaGlobal().$queryRawUnsafe(
      `SELECT 1
         FROM information_schema.columns i
        WHERE i.table_schema = 'schs2vet'
          AND i.table_name   = 'tb_fatura_itens'
          AND i.column_name  = 'fechado_em'
          AND EXISTS (SELECT 1 FROM information_schema.columns j
                       WHERE j.table_schema = 'schs2vet'
                         AND j.table_name   = 'tb_faturas'
                         AND j.column_name  = 'total_fechado')
        LIMIT 1`,
    );
    _temColunas   = rows.length > 0;
    _temColunasEm = Date.now();
  } catch {
    // 🔴 FALHA NA CONSULTA NÃO É "A COLUNA NÃO EXISTE", e aqui a diferença é DINHEIRO.
    // Cravar `false` num soluço do banco faria `recalcularTotal` voltar a somar o bloco
    // FECHADO dentro do total — ou seja, cobrar de novo o que já foi acertado à parte —
    // e o erro se propagaria como um total plausível, sem nada acusando.
    // Já tendo respondido antes, a última resposta CONHECIDA vale; sem nenhuma, devolve
    // `false` SEM cachear, para a próxima chamada perguntar de novo.
    if (_temColunas !== null) return _temColunas;
    return false;
  }
  return _temColunas;
}

/**
 * Mapa `itemId → { fechadoEm, fechadoPorId }` dos itens JÁ FECHADOS de uma fatura.
 * UMA consulta para a fatura inteira, nunca uma por linha (mesma razão de
 * `origensPorItem`: a fatura de um mês tem dezenas de itens).
 *
 * Base ainda sem as colunas devolve mapa VAZIO — isto é, tudo aberto, que é
 * exatamente o comportamento anterior ao fechamento por animal.
 */
async function fechadosDaFatura(client, faturaId) {
  const mapa = new Map();
  const id = Number(faturaId);
  if (!Number.isFinite(id)) return mapa;
  if (!(await temColunas())) return mapa;
  try {
    const rows = await clienteOu(client).$queryRawUnsafe(
      `SELECT "id", "fechado_em" AS "fechadoEm", "fechado_por_id" AS "fechadoPorId"
         FROM "schs2vet"."tb_fatura_itens"
        WHERE "faturaId" = $1 AND "fechado_em" IS NOT NULL`,
      id,
    );
    for (const r of rows) {
      mapa.set(Number(r.id), { fechadoEm: r.fechadoEm, fechadoPorId: r.fechadoPorId ?? null });
    }
  } catch { /* sem as colunas/linhas: tudo aberto */ }
  return mapa;
}

/**
 * Anexa `fechadoEm`/`fechadoPorId` a cada item da fatura lida pelo client tipado.
 *
 * ⚠️ Necessário porque o `select` tipado do Prisma não traz coluna que o client ainda
 * não conhece — e sem ela a TELA mostraria como aberto um bloco já fechado, com o botão
 * "Fechar" de volta e o subtotal contando de novo.
 */
async function anexarFechamento(fatura, client = null) {
  if (!fatura?.itens?.length) return fatura;
  const mapa = await fechadosDaFatura(client, fatura.id);
  return {
    ...fatura,
    itens: fatura.itens.map(i => {
      const f = mapa.get(Number(i.id));
      return { ...i, fechadoEm: f?.fechadoEm ?? null, fechadoPorId: f?.fechadoPorId ?? null };
    }),
  };
}

/** Quantos itens ABERTOS a fatura tem para este animal (0 = não há o que fechar). */
async function contarAbertosDoAnimal(client, faturaId, animalId) {
  if (!(await temColunas())) return 0;
  const rows = await clienteOu(client).$queryRawUnsafe(
    `SELECT COUNT(*)::int AS "n"
       FROM "schs2vet"."tb_fatura_itens"
      WHERE "faturaId" = $1 AND "animalId" = $2 AND "fechado_em" IS NULL`,
    Number(faturaId), Number(animalId),
  );
  return Number(rows?.[0]?.n ?? 0);
}

/** Quantos itens FECHADOS a fatura tem para este animal (0 = não há o que reabrir). */
async function contarFechadosDoAnimal(client, faturaId, animalId) {
  if (!(await temColunas())) return 0;
  const rows = await clienteOu(client).$queryRawUnsafe(
    `SELECT COUNT(*)::int AS "n"
       FROM "schs2vet"."tb_fatura_itens"
      WHERE "faturaId" = $1 AND "animalId" = $2 AND "fechado_em" IS NOT NULL`,
    Number(faturaId), Number(animalId),
  );
  return Number(rows?.[0]?.n ?? 0);
}

/**
 * Fecha o bloco do animal: marca os itens ABERTOS dele nesta fatura.
 *
 * ⚠️ `fechado_em IS NULL` no WHERE não é otimização — é o que preserva a DATA do
 * fechamento anterior quando o bloco é fechado de novo depois de novas cobranças.
 * Sem ele, a segunda rodada reescreveria a data da primeira e o histórico se perderia.
 *
 * ⚠️ `NOW() AT TIME ZONE 'UTC'`, nunca `NOW()` puro: a coluna é `timestamp WITHOUT
 * time zone` e o Prisma a lê como UTC naive — `NOW()` gravaria a hora LOCAL da sessão
 * com cara de UTC e a tela mostraria 3h a menos (CLAUDE.md §6).
 *
 * @returns {Promise<number>} quantos itens foram fechados
 */
async function fecharAnimal(client, { faturaId, animalId, userId = null }) {
  if (!(await temColunas())) return 0;
  return clienteOu(client).$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_fatura_itens"
        SET "fechado_em" = NOW() AT TIME ZONE 'UTC', "fechado_por_id" = $3
      WHERE "faturaId" = $1 AND "animalId" = $2 AND "fechado_em" IS NULL`,
    Number(faturaId), Number(animalId), userId == null ? null : Number(userId),
  );
}

/**
 * Reabre o bloco do animal: devolve os itens dele ao total da fatura.
 * @returns {Promise<number>} quantos itens voltaram a ficar abertos
 */
async function reabrirAnimal(client, { faturaId, animalId }) {
  if (!(await temColunas())) return 0;
  return clienteOu(client).$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_fatura_itens"
        SET "fechado_em" = NULL, "fechado_por_id" = NULL
      WHERE "faturaId" = $1 AND "animalId" = $2 AND "fechado_em" IS NOT NULL`,
    Number(faturaId), Number(animalId),
  );
}

/**
 * Mapa `faturaId → totalFechado` em BLOCO.
 *
 * 🔴 EXISTE PARA OS INDICADORES DE DINHEIRO A RECEBER. `Fatura.total` passou a ser só
 * o que a fatura AINDA cobra; o bloco de paciente fechado à parte continua DEVIDO. Quem
 * somar só `total` (Dashboard "contas a receber", Relatórios, Devedores) passaria a
 * mostrar menos dinheiro do que existe, sem erro e sem log — e ninguém ligaria a queda
 * do indicador a um fechamento por animal feito semanas antes.
 *
 * ⚠️ SQL cru, e não `select: { totalFechado: true }`: um `select` TIPADO com coluna que
 * o client Prisma ainda não conhece não devolve o campo vazio — ele DERRUBA a consulta
 * inteira, e com ela o relatório. Ver o cabeçalho deste arquivo.
 *
 * Base sem a coluna devolve mapa vazio; quem chama soma 0 e mantém o número de antes.
 */
async function totalFechadoPorFatura(client, faturaIds) {
  const alvos = [...new Set((faturaIds ?? []).map(Number).filter(Number.isFinite))];
  const mapa = new Map();
  if (alvos.length === 0) return mapa;
  if (!(await temColunas())) return mapa;
  try {
    const rows = await clienteOu(client).$queryRawUnsafe(
      `SELECT "id", "total_fechado" AS "totalFechado"
         FROM "schs2vet"."tb_faturas"
        WHERE "id" = ANY($1::int[]) AND "total_fechado" <> 0`,
      alvos,
    );
    for (const r of rows) mapa.set(Number(r.id), Number(r.totalFechado) || 0);
  } catch { /* sem a coluna: nada fechado, indicador igual ao de antes */ }
  return mapa;
}

/**
 * Grava os DOIS totais da fatura numa tacada.
 *
 * ⚠️ Base sem `total_fechado` grava só o `total` pelo client tipado — e ali `total` é
 * a soma de TODOS os itens (não há fechado nenhum), ou seja, o comportamento de antes.
 * O que não pode acontecer é o recálculo do total falhar por causa da coluna nova.
 */
async function gravarTotais(client, faturaId, { total, totalFechado }) {
  const cliente = clienteOu(client);
  if (!(await temColunas())) {
    await cliente.fatura.update({ where: { id: Number(faturaId) }, data: { total } });
    return;
  }
  await cliente.$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_faturas"
        SET "total" = $2, "total_fechado" = $3
      WHERE "id" = $1`,
    Number(faturaId), Number(total) || 0, Number(totalFechado) || 0,
  );
}

module.exports = {
  temColunas,
  fechadosDaFatura,
  anexarFechamento,
  contarAbertosDoAnimal,
  contarFechadosDoAnimal,
  fecharAnimal,
  reabrirAnimal,
  gravarTotais,
  totalFechadoPorFatura,
};

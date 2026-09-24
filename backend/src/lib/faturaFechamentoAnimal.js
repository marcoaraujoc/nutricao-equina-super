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

let _temPagamento   = null;
let _temPagamentoEm = 0;

/**
 * As colunas do PAGAMENTO por animal já existem? Mesma mecânica (e as mesmas
 * armadilhas) de `temColunas`: guarda pelo client GLOBAL, nunca pelo `tx`, e soluço
 * do banco não vira "a coluna não existe".
 *
 * ⚠️ Separada de `temColunas` de propósito: o pagamento chegou numa migration
 * POSTERIOR ao fechamento, então existe base com uma e sem a outra. Colapsar as duas
 * faria a base só-fechamento perder o fechamento por animal inteiro.
 */
async function temColunasPagamento() {
  if (_temPagamento === true) return true;
  if (_temPagamento === false && Date.now() - _temPagamentoEm < 60000) return false;
  try {
    const rows = await prismaGlobal().$queryRawUnsafe(
      `SELECT 1
         FROM information_schema.columns i
        WHERE i.table_schema = 'schs2vet'
          AND i.table_name   = 'tb_fatura_itens'
          AND i.column_name  = 'pago_em'
          AND EXISTS (SELECT 1 FROM information_schema.columns j
                       WHERE j.table_schema = 'schs2vet'
                         AND j.table_name   = 'tb_faturas'
                         AND j.column_name  = 'total_pago_animal')
        LIMIT 1`,
    );
    _temPagamento   = rows.length > 0;
    _temPagamentoEm = Date.now();
  } catch {
    if (_temPagamento !== null) return _temPagamento;
    return false;
  }
  return _temPagamento;
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
 * Mapa `itemId → { pagoEm, pagoPorId }` dos itens JÁ PAGOS de uma fatura — uma
 * consulta para a fatura inteira, como `fechadosDaFatura`.
 * Base sem as colunas devolve mapa VAZIO: nada pago, que é o estado anterior.
 */
async function pagosDaFatura(client, faturaId) {
  const mapa = new Map();
  const id = Number(faturaId);
  if (!Number.isFinite(id)) return mapa;
  if (!(await temColunasPagamento())) return mapa;
  try {
    const rows = await clienteOu(client).$queryRawUnsafe(
      `SELECT "id", "pago_em" AS "pagoEm", "pago_por_id" AS "pagoPorId"
         FROM "schs2vet"."tb_fatura_itens"
        WHERE "faturaId" = $1 AND "pago_em" IS NOT NULL`,
      id,
    );
    for (const r of rows) {
      mapa.set(Number(r.id), { pagoEm: r.pagoEm, pagoPorId: r.pagoPorId ?? null });
    }
  } catch { /* sem as colunas/linhas: nada pago */ }
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
  const [mapa, pagos] = await Promise.all([
    fechadosDaFatura(client, fatura.id),
    pagosDaFatura(client, fatura.id),
  ]);
  return {
    ...fatura,
    itens: fatura.itens.map(i => {
      const f = mapa.get(Number(i.id));
      const p = pagos.get(Number(i.id));
      return {
        ...i,
        fechadoEm:    f?.fechadoEm ?? null,
        fechadoPorId: f?.fechadoPorId ?? null,
        pagoEm:       p?.pagoEm ?? null,
        pagoPorId:    p?.pagoPorId ?? null,
      };
    }),
  };
}

/**
 * `{ fechadoEm, pagoEm }` de UM item — a guarda de escrita do bloco do paciente.
 *
 * 🔴 BLOCO FECHADO É SOMENTE LEITURA (2026-09-23, a pedido): "a regra de fechar
 * somente o paciente deve ser a mesma para a fatura". Fechar o bloco de um paciente
 * encerra a cobrança dele — alterar ou remover a linha depois disso mudaria um valor
 * que já foi apartado do total e, no caso do PAGO, um valor que o cliente já acertou.
 *
 * ⚠️ Base sem as colunas devolve tudo nulo: nada trava, que é o estado anterior.
 * ⚠️ SQL cru pela mesma razão do resto desta lib — o client tipado pode não conhecer
 * as colunas (§11), e pedi-las no `select` derrubaria a edição de item inteira.
 */
async function estadoDoItem(client, itemId) {
  const vazio = { fechadoEm: null, pagoEm: null };
  const id = Number(itemId);
  if (!Number.isFinite(id)) return vazio;
  const [temFechamento, temPagamento] = await Promise.all([temColunas(), temColunasPagamento()]);
  if (!temFechamento && !temPagamento) return vazio;
  const cols = [
    temFechamento ? '"fechado_em" AS "fechadoEm"' : 'NULL AS "fechadoEm"',
    temPagamento  ? '"pago_em"    AS "pagoEm"'    : 'NULL AS "pagoEm"',
  ].join(', ');
  try {
    const rows = await clienteOu(client).$queryRawUnsafe(
      `SELECT ${cols} FROM "schs2vet"."tb_fatura_itens" WHERE "id" = $1`, id);
    return rows[0] ? { fechadoEm: rows[0].fechadoEm ?? null, pagoEm: rows[0].pagoEm ?? null } : vazio;
  } catch { return vazio; }
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

/**
 * Quantos itens FECHADOS **e ainda não pagos** a fatura tem para este animal
 * (0 = não há o que reabrir).
 *
 * ⚠️ O item PAGO fica de fora: reabrir devolve a linha à cobrança da fatura, e
 * cobrar de novo o que já foi recebido é o erro que este recorte evita. Para mexer
 * num bloco já acertado, o caminho é ESTORNAR o pagamento primeiro.
 */
async function contarFechadosDoAnimal(client, faturaId, animalId) {
  if (!(await temColunas())) return 0;
  const filtroPago = (await temColunasPagamento()) ? ' AND "pago_em" IS NULL' : '';
  const rows = await clienteOu(client).$queryRawUnsafe(
    `SELECT COUNT(*)::int AS "n"
       FROM "schs2vet"."tb_fatura_itens"
      WHERE "faturaId" = $1 AND "animalId" = $2 AND "fechado_em" IS NOT NULL${filtroPago}`,
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
 *
 * ⚠️ NÃO toca no que já foi PAGO (`pago_em`). Sem esse recorte, reabrir um bloco
 * acertado devolveria à cobrança um valor que o cliente já pagou — e ainda deixaria
 * a linha "aberta e paga", estado que `recalcularTotal` não sabe classificar. Quem
 * precisa desfazer um acerto estorna o pagamento antes.
 *
 * @returns {Promise<number>} quantos itens voltaram a ficar abertos
 */
async function reabrirAnimal(client, { faturaId, animalId }) {
  if (!(await temColunas())) return 0;
  const filtroPago = (await temColunasPagamento()) ? ' AND "pago_em" IS NULL' : '';
  return clienteOu(client).$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_fatura_itens"
        SET "fechado_em" = NULL, "fechado_por_id" = NULL
      WHERE "faturaId" = $1 AND "animalId" = $2 AND "fechado_em" IS NOT NULL${filtroPago}`,
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

/** Quantos itens PAGOS a fatura tem para este animal (0 = não há acerto a desfazer). */
async function contarPagosDoAnimal(client, faturaId, animalId) {
  if (!(await temColunasPagamento())) return 0;
  const rows = await clienteOu(client).$queryRawUnsafe(
    `SELECT COUNT(*)::int AS "n"
       FROM "schs2vet"."tb_fatura_itens"
      WHERE "faturaId" = $1 AND "animalId" = $2 AND "pago_em" IS NOT NULL`,
    Number(faturaId), Number(animalId),
  );
  return Number(rows?.[0]?.n ?? 0);
}

/** Quantos itens deste animal ainda NÃO foram pagos (abertos + fechados a receber). */
async function contarNaoPagosDoAnimal(client, faturaId, animalId) {
  if (!(await temColunasPagamento())) return 0;
  const rows = await clienteOu(client).$queryRawUnsafe(
    `SELECT COUNT(*)::int AS "n"
       FROM "schs2vet"."tb_fatura_itens"
      WHERE "faturaId" = $1 AND "animalId" = $2 AND "pago_em" IS NULL`,
    Number(faturaId), Number(animalId),
  );
  return Number(rows?.[0]?.n ?? 0);
}

/**
 * Marca como PAGO o bloco do animal — e FECHA, na mesma passada, o que ainda estiver
 * aberto dele.
 *
 * ⚠️ Fechar junto não é conveniência: item pago e aberto ao mesmo tempo seria uma
 * linha que a fatura ainda cobra e que o relatório já conta como recebida — o mesmo
 * valor contado dos dois lados.
 *
 * ⚠️ `pago_em IS NULL` no WHERE preserva a data do acerto anterior quando o bloco é
 * pago de novo depois de novas cobranças (mesma razão do `fechado_em IS NULL`), e
 * `NOW() AT TIME ZONE 'UTC'` é obrigatório: a coluna é `timestamp` naive lida como
 * UTC pelo Prisma (CLAUDE.md §6).
 *
 * @returns {Promise<number>} quantos itens foram marcados como pagos
 */
async function pagarAnimal(client, { faturaId, animalId, userId = null }) {
  if (!(await temColunasPagamento())) return 0;
  const cliente = clienteOu(client);
  const fid = Number(faturaId), aid = Number(animalId);
  const uid = userId == null ? null : Number(userId);
  // O que ainda está aberto é fechado ANTES da baixa: sem isso a linha recém-paga
  // ficaria sem `fechado_em` e o valor já recebido voltaria a contar como devido.
  if (await temColunas()) {
    await cliente.$executeRawUnsafe(
      `UPDATE "schs2vet"."tb_fatura_itens"
          SET "fechado_em" = NOW() AT TIME ZONE 'UTC', "fechado_por_id" = $3
        WHERE "faturaId" = $1 AND "animalId" = $2 AND "fechado_em" IS NULL`,
      fid, aid, uid,
    );
  }
  return cliente.$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_fatura_itens"
        SET "pago_em" = NOW() AT TIME ZONE 'UTC', "pago_por_id" = $3
      WHERE "faturaId" = $1 AND "animalId" = $2 AND "pago_em" IS NULL`,
    fid, aid, uid,
  );
}

/**
 * Desfaz o acerto do bloco do animal: as linhas voltam a ser DEVIDAS.
 *
 * ⚠️ Desfaz SÓ o pagamento — o bloco continua FECHADO. São dois estados e duas
 * perguntas ("saiu do total?" e "foi recebido?"); juntá-las tiraria do gestor a
 * chance de corrigir uma baixa errada sem devolver o bloco à cobrança da fatura.
 *
 * @returns {Promise<number>} quantos itens deixaram de estar pagos
 */
async function desfazerPagamentoAnimal(client, { faturaId, animalId }) {
  if (!(await temColunasPagamento())) return 0;
  return clienteOu(client).$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_fatura_itens"
        SET "pago_em" = NULL, "pago_por_id" = NULL
      WHERE "faturaId" = $1 AND "animalId" = $2 AND "pago_em" IS NOT NULL`,
    Number(faturaId), Number(animalId),
  );
}

/**
 * Mapa `faturaId → totalPagoAnimal` em BLOCO — o que já foi ACERTADO à parte.
 *
 * 🔴 NÃO entra em "contas a receber" (esse valor deixou de ser devido); entra em quem
 * conta RECEBIDO — o ranking de melhores pagadores, que somaria menos do que o
 * cliente pagou se olhasse só `total + total_fechado`.
 *
 * Mesmo SQL cru de `totalFechadoPorFatura`, pela mesma razão: `select` tipado com
 * coluna que o client não conhece derruba o relatório inteiro.
 */
async function totalPagoAnimalPorFatura(client, faturaIds) {
  const alvos = [...new Set((faturaIds ?? []).map(Number).filter(Number.isFinite))];
  const mapa = new Map();
  if (alvos.length === 0) return mapa;
  if (!(await temColunasPagamento())) return mapa;
  try {
    const rows = await clienteOu(client).$queryRawUnsafe(
      `SELECT "id", "total_pago_animal" AS "totalPagoAnimal"
         FROM "schs2vet"."tb_faturas"
        WHERE "id" = ANY($1::int[]) AND "total_pago_animal" <> 0`,
      alvos,
    );
    for (const r of rows) mapa.set(Number(r.id), Number(r.totalPagoAnimal) || 0);
  } catch { /* sem a coluna: nada pago à parte, indicador igual ao de antes */ }
  return mapa;
}

/**
 * Grava os TRÊS totais da fatura numa tacada.
 *
 * ⚠️ Base sem `total_fechado` grava só o `total` pelo client tipado — e ali `total` é
 * a soma de TODOS os itens (não há fechado nenhum), ou seja, o comportamento de antes.
 * O que não pode acontecer é o recálculo do total falhar por causa da coluna nova.
 */
async function gravarTotais(client, faturaId, { total, totalFechado, totalPagoAnimal = 0 }) {
  const cliente = clienteOu(client);
  if (!(await temColunas())) {
    await cliente.fatura.update({ where: { id: Number(faturaId) }, data: { total } });
    return;
  }
  // Base com o fechamento mas SEM o pagamento (migration 20261021000000 pendente): o
  // valor pago volta a somar em `total_fechado`, ou seja, segue sendo cobrado — que é
  // exatamente o comportamento anterior ao pagamento por animal.
  if (!(await temColunasPagamento())) {
    await cliente.$executeRawUnsafe(
      `UPDATE "schs2vet"."tb_faturas"
          SET "total" = $2, "total_fechado" = $3
        WHERE "id" = $1`,
      Number(faturaId), Number(total) || 0, (Number(totalFechado) || 0) + (Number(totalPagoAnimal) || 0),
    );
    return;
  }
  await cliente.$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_faturas"
        SET "total" = $2, "total_fechado" = $3, "total_pago_animal" = $4
      WHERE "id" = $1`,
    Number(faturaId), Number(total) || 0, Number(totalFechado) || 0, Number(totalPagoAnimal) || 0,
  );
}

module.exports = {
  temColunas,
  estadoDoItem,
  temColunasPagamento,
  fechadosDaFatura,
  pagosDaFatura,
  anexarFechamento,
  contarAbertosDoAnimal,
  contarFechadosDoAnimal,
  contarPagosDoAnimal,
  contarNaoPagosDoAnimal,
  fecharAnimal,
  reabrirAnimal,
  pagarAnimal,
  desfazerPagamentoAnimal,
  gravarTotais,
  totalFechadoPorFatura,
  totalPagoAnimalPorFatura,
};

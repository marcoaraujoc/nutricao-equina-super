'use strict';
/**
 * CONTAS A PAGAR — o outro lado do balcão da FATURA (2026-09-10)
 *
 * A fatura (`lib/faturaUtils.js`) é o que a clínica COBRA do cliente. Esta lib é o
 * que ela DEVE a um terceiro: ao FORNECEDOR (medicamento/vacina que ele entregou) e
 * ao PRESTADOR (procedimento que ele executou).
 *
 * 🔴 UMA estrutura para os dois, separados por `tipo`. São o mesmo documento, com o
 * mesmo ciclo — abrir → fechar → pagar. Duas tabelas dariam duas telas, dois
 * totalizadores e duas regras de fechamento, que divergiriam na primeira correção;
 * a `Fatura` também é uma só para todo tipo de item cobrado.
 *
 * 🔴 O LANÇAMENTO É NA EXECUÇÃO, na MESMA transaction do lançamento na fatura do
 * cliente (decisão de 2026-09-10). Ou o cliente é cobrado e o terceiro entra na conta,
 * ou nada acontece: fora da transaction existiria a janela em que a clínica cobrou e
 * não deve a ninguém. Mesma premissa do ledger do prestador.
 *
 * 🔴 LEITURA/ESCRITA SEMPRE POR AQUI, em SQL cru — as tabelas são da migration
 * `20261006000000` e o client Prisma pode não conhecê-las (§11). Nenhuma função aqui
 * LANÇA: falha ao registrar a conta a pagar não pode derrubar a execução clínica, que
 * é o ato que importa. O pior caso é a conta não nascer, e o financeiro lança à mão.
 */

const prisma = require('./prisma').default;

const TIPOS = ['FORNECEDOR', 'PRESTADOR'];
/** Editáveis; só a ABERTA recebe lançamento novo automático. */
const STATUS_ABERTOS   = ['ABERTA'];
const STATUS_FECHADOS  = ['FECHADA', 'PAGA', 'CANCELADA'];
const STATUS_VALIDOS   = [...STATUS_ABERTOS, ...STATUS_FECHADOS];

/** Origens do lançamento automático — o que torna cada linha rastreável e idempotente. */
const ORIGENS = {
  PRESCRICAO_ITEM:    'PRESCRICAO_ITEM',
  VACINA:             'VACINA',
  EXECUCAO_PRESTADOR: 'EXECUCAO_PRESTADOR',
  MANUAL:             'MANUAL',
};

let _temTabelas = null;
async function temTabelas() {
  if (_temTabelas !== null) return _temTabelas;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'schs2vet'
          AND table_name IN ('tb_contas_pagar', 'tb_conta_pagar_itens')`);
    _temTabelas = rows.length === 2;
  } catch { _temTabelas = false; }
  return _temTabelas;
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Dinheiro ao CENTAVO. Percentual fecha em 55.000000000000004 e a conta sairia com
 *  um centavo que ninguém consegue explicar. */
const cent = (v) => (v == null ? 0 : Math.round(Number(v) * 100) / 100);

const corta = (v, max) => String(v ?? '').trim().slice(0, max);

/** "2026-09" do instante informado, no formato de `Fatura.mesReferencia`. */
function mesReferenciaDe(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

function normalizarConta(r) {
  return {
    id:            r.id,
    tipo:          r.tipo,
    credorId:      r.credor_id,
    credorNome:    r.credor_nome ?? '',
    mesReferencia: r.mes_referencia ?? null,
    total:         num(r.total) ?? 0,
    status:        r.status,
    observacao:    r.observacao ?? null,
    pagoEm:        r.pago_em ?? null,
    criadoEm:      r.created_at ?? null,
  };
}

function normalizarItem(r) {
  return {
    id:              r.id,
    contaId:         r.conta_id,
    animalId:        r.animal_id ?? null,
    animalNome:      r.animal_nome ?? '',
    descricao:       r.descricao ?? '',
    quantidade:      num(r.quantidade) ?? 1,
    valor:           num(r.valor) ?? 0,
    solicitanteId:   r.solicitante_id ?? null,
    solicitanteNome: r.solicitante_nome ?? '',
    ocorridoEm:      r.ocorrido_em ?? null,
    origemTipo:      r.origem_tipo ?? null,
    origemId:        r.origem_id ?? null,
  };
}

/**
 * A conta ABERTA do credor no mês — criando-a se ainda não existir.
 *
 * ⚠️ Espelha `getOrCreateFatura`: é a conta CORRENTE, a que recebe o lançamento de
 * hoje. Conta FECHADA/PAGA do mesmo mês não é reaberta — ela já foi conferida e
 * possivelmente paga, e escrever nela mudaria um documento entregue.
 *
 * ⚠️ `ON CONFLICT` repete o predicado do índice PARCIAL (`WHERE status = 'ABERTA'`):
 * sem isso o Postgres responde `42P10 there is no unique or exclusion constraint
 * matching the ON CONFLICT specification` — a armadilha achada em 2026-09-09, que
 * `node --check` não pega porque é erro de execução.
 */
async function contaAbertaDoCredor(client, { empresaId, tipo, credorId, credorNome, mesReferencia }) {
  const emp = Number(empresaId);
  const cre = Number(credorId);
  if (!emp || !cre || !TIPOS.includes(tipo)) return null;
  const mes = mesReferencia || mesReferenciaDe();
  try {
    const rows = await client.$queryRawUnsafe(
      `INSERT INTO schs2vet.tb_contas_pagar
         (empresa_id, tipo, credor_id, credor_nome, mes_referencia, total, status,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, 'ABERTA',
               NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
       ON CONFLICT (empresa_id, tipo, credor_id, mes_referencia)
         WHERE status = 'ABERTA'
         DO UPDATE SET
           -- Só ATUALIZA o nome (o cadastro pode ter sido corrigido); o total é
           -- recalculado a partir dos itens, nunca somado aqui.
           credor_nome = EXCLUDED.credor_nome,
           updated_at  = NOW() AT TIME ZONE 'UTC'
       RETURNING id, tipo, credor_id, credor_nome, mes_referencia, total, status,
                 observacao, pago_em, created_at`,
      emp, tipo, cre, corta(credorNome, 255), mes,
    );
    return rows[0] ? normalizarConta(rows[0]) : null;
  } catch (err) {
    console.error('contasPagar.contaAbertaDoCredor:', err.message);
    return null;
  }
}

/**
 * Recalcula o total da conta a partir dos ITENS.
 *
 * ⚠️ Recalcula, nunca incrementa: somar no lançamento faria o total divergir dos
 * itens em qualquer caminho que remova uma linha, e aí não há qual dos dois
 * acreditar. Mesma decisão de `faturaUtils.recalcularTotal`.
 */
async function recalcularTotal(client, contaId) {
  try {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_contas_pagar c
          SET total = COALESCE((
                SELECT SUM(i.valor * i.quantidade)
                  FROM schs2vet.tb_conta_pagar_itens i
                 WHERE i.conta_id = c.id
              ), 0),
              updated_at = NOW() AT TIME ZONE 'UTC'
        WHERE c.id = $1`,
      Number(contaId),
    );
    return true;
  } catch { return false; }
}

/**
 * 🔴 O LANÇAMENTO — chamado de dentro da transaction da execução.
 *
 * ⚠️ NUNCA LANÇA. Falha aqui não pode derrubar a execução clínica; devolve `null` e
 * o financeiro lança à mão. Base sem a migration devolve `null` na primeira linha.
 *
 * ⚠️ IDEMPOTENTE por (origemTipo, origemId) — há índice único PARCIAL no banco, e o
 * `ON CONFLICT DO NOTHING` o usa: reprocessar a mesma execução não cria a segunda
 * linha. É isso que permite chamar daqui sem contar quantas vezes rodou.
 *
 * ⚠️ Valor ZERO ou nulo NÃO vira linha: conta a pagar de R$ 0,00 é ruído no
 * fechamento do mês, e afirma uma dívida que não existe.
 */
async function lancarItem(client, {
  empresaId, tipo, credorId, credorNome,
  animalId, animalNome, descricao, quantidade = 1, valor,
  solicitanteId, solicitanteNome, ocorridoEm, origemTipo, origemId,
}) {
  if (!(await temTabelas())) return null;
  const v = cent(num(valor));
  if (!v || v <= 0) return null;

  const quando = ocorridoEm instanceof Date ? ocorridoEm : new Date(ocorridoEm ?? Date.now());
  const conta = await contaAbertaDoCredor(client, {
    empresaId, tipo, credorId, credorNome, mesReferencia: mesReferenciaDe(quando),
  });
  if (!conta) return null;

  try {
    await client.$executeRawUnsafe(
      `INSERT INTO schs2vet.tb_conta_pagar_itens
         (conta_id, animal_id, animal_nome, descricao, quantidade, valor,
          solicitante_id, solicitante_nome, ocorrido_em, origem_tipo, origem_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW() AT TIME ZONE 'UTC')
       ON CONFLICT (origem_tipo, origem_id)
         WHERE origem_tipo IS NOT NULL AND origem_id IS NOT NULL
         DO NOTHING`,
      conta.id,
      animalId ? Number(animalId) : null,
      corta(animalNome, 255),
      String(descricao ?? '').trim() || 'Item sem descrição',
      num(quantidade) ?? 1,
      v,
      solicitanteId ? Number(solicitanteId) : null,
      corta(solicitanteNome, 255),
      quando,
      origemTipo ?? null,
      origemId ? Number(origemId) : null,
    );
    await recalcularTotal(client, conta.id);
    return conta.id;
  } catch (err) {
    console.error('contasPagar.lancarItem:', err.message);
    return null;
  }
}

/** Contas do período, com os itens — a tela de Pagamentos. */
async function listarContas(empresaId, { tipo, inicio, fim, status, client = prisma } = {}) {
  if (!empresaId || !(await temTabelas())) return [];
  try {
    const params = [Number(empresaId)];
    let filtro = '';
    if (tipo && TIPOS.includes(tipo)) { params.push(tipo); filtro += ` AND c.tipo = $${params.length}`; }
    if (status && STATUS_VALIDOS.includes(status)) { params.push(status); filtro += ` AND c.status = $${params.length}`; }
    // ⚠️ A janela recorta pelo ITEM (`ocorrido_em`, o fato gerador), não pela criação
    // da conta: a conta do mês nasce no primeiro lançamento e viveria fora de todo
    // período seguinte se o corte fosse por `created_at`.
    if (inicio && fim) {
      params.push(inicio, fim);
      filtro += ` AND EXISTS (SELECT 1 FROM schs2vet.tb_conta_pagar_itens i
                               WHERE i.conta_id = c.id
                                 AND i.ocorrido_em >= $${params.length - 1}
                                 AND i.ocorrido_em <  $${params.length})`;
    }
    const contas = await client.$queryRawUnsafe(
      `SELECT c.id, c.tipo, c.credor_id, c.credor_nome, c.mes_referencia, c.total,
              c.status, c.observacao, c.pago_em, c.created_at
         FROM schs2vet.tb_contas_pagar c
        WHERE c.empresa_id = $1 ${filtro}
        ORDER BY c.mes_referencia DESC NULLS LAST, c.credor_nome ASC`,
      ...params,
    );
    if (contas.length === 0) return [];

    const ids = contas.map(c => c.id);
    const ph  = ids.map((_, i) => `$${i + 1}`).join(', ');
    const itens = await client.$queryRawUnsafe(
      `SELECT id, conta_id, animal_id, animal_nome, descricao, quantidade, valor,
              solicitante_id, solicitante_nome, ocorrido_em, origem_tipo, origem_id
         FROM schs2vet.tb_conta_pagar_itens
        WHERE conta_id IN (${ph})
        ORDER BY ocorrido_em ASC, id ASC`,
      ...ids,
    );
    const porConta = new Map();
    for (const i of itens) {
      const lista = porConta.get(i.conta_id) ?? [];
      lista.push(normalizarItem(i));
      porConta.set(i.conta_id, lista);
    }
    return contas.map(c => ({ ...normalizarConta(c), itens: porConta.get(c.id) ?? [] }));
  } catch (err) {
    console.error('contasPagar.listarContas:', err.message);
    return [];
  }
}

/**
 * Muda o status da conta.
 *
 * ⚠️ PAGA grava quando e por quem — é o que a torna um comprovante e não só um
 * rótulo. Sair de PAGA limpa os dois: um pagamento desfeito não pode deixar a data
 * do anterior no registro, afirmando algo que deixou de valer.
 */
async function alterarStatus(client, empresaId, contaId, status, usuarioId) {
  if (!STATUS_VALIDOS.includes(status)) return { erro: 'Status inválido.' };
  if (!(await temTabelas())) return { erro: 'Recurso ainda não disponível nesta base.' };
  try {
    const rows = await client.$queryRawUnsafe(
      `UPDATE schs2vet.tb_contas_pagar
          SET status      = $3,
              pago_em     = CASE WHEN $3 = 'PAGA' THEN NOW() AT TIME ZONE 'UTC' ELSE NULL END,
              pago_por_id = CASE WHEN $3 = 'PAGA' THEN $4 ELSE NULL END,
              updated_at  = NOW() AT TIME ZONE 'UTC'
        WHERE id = $1 AND empresa_id = $2
        RETURNING id, tipo, credor_id, credor_nome, mes_referencia, total, status,
                  observacao, pago_em, created_at`,
      Number(contaId), Number(empresaId), status, usuarioId ? Number(usuarioId) : null,
    );
    if (rows.length === 0) return { erro: 'Conta não encontrada.' };
    return { dados: normalizarConta(rows[0]) };
  } catch (err) {
    console.error('contasPagar.alterarStatus:', err.message);
    return { erro: 'Erro ao alterar o status da conta.' };
  }
}

/** Lançamento MANUAL na conta (o financeiro acrescentando o que o automático não pegou). */
async function lancarManual(client, empresaId, { tipo, credorId, credorNome, animalId, animalNome, descricao, quantidade, valor, solicitanteId, solicitanteNome, ocorridoEm }) {
  if (!(await temTabelas())) return { erro: 'Recurso ainda não disponível nesta base.' };
  if (!TIPOS.includes(tipo)) return { erro: 'Tipo inválido.' };
  const v = cent(num(valor));
  if (!v || v <= 0) return { erro: 'Informe um valor maior que zero.' };
  if (!String(descricao ?? '').trim()) return { erro: 'Informe a descrição.' };

  const contaId = await lancarItem(client, {
    empresaId, tipo, credorId, credorNome,
    animalId, animalNome, descricao, quantidade: num(quantidade) ?? 1, valor: v,
    solicitanteId, solicitanteNome, ocorridoEm,
    origemTipo: ORIGENS.MANUAL, origemId: null,
  });
  if (!contaId) return { erro: 'Não foi possível lançar na conta.' };
  return { contaId };
}

/** Remove um item lançado à mão e recalcula o total. */
async function removerItem(client, empresaId, itemId) {
  if (!(await temTabelas())) return false;
  try {
    const rows = await client.$queryRawUnsafe(
      `DELETE FROM schs2vet.tb_conta_pagar_itens i
        USING schs2vet.tb_contas_pagar c
        WHERE i.id = $1 AND i.conta_id = c.id AND c.empresa_id = $2
        RETURNING c.id AS conta_id`,
      Number(itemId), Number(empresaId),
    );
    if (rows.length === 0) return false;
    await recalcularTotal(client, rows[0].conta_id);
    return true;
  } catch { return false; }
}

module.exports = {
  TIPOS,
  ORIGENS,
  STATUS_ABERTOS,
  STATUS_FECHADOS,
  STATUS_VALIDOS,
  temTabelas,
  mesReferenciaDe,
  contaAbertaDoCredor,
  recalcularTotal,
  lancarItem,
  listarContas,
  alterarStatus,
  lancarManual,
  removerItem,
};

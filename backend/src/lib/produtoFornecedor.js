'use strict';
/**
 * PRODUTO DE FORNECEDOR — "de quem eu compro este item, e por quanto" (2026-09-10)
 *
 * 🔴 POR QUE ESTA TABELA EXISTE: a clínica só sabia falar de item que ELA GUARDA.
 * `tb_estoque_clinica` e `tb_lotes_vacina` são ESTOQUE FÍSICO (quantidade, lote,
 * validade). O item que a clínica NÃO estoca — pede ao fornecedor quando o vet
 * prescreve — não tinha onde existir, e na tela de prescrição aparecia como "Sem
 * estoque", cinza, indistinguível do que ninguém fornece.
 *
 * 🔴 LEITURA/ESCRITA SEMPRE POR AQUI, em SQL cru: a tabela é da migration
 * `20261006000000` e o client Prisma pode não conhecê-la (§11 — no Windows o
 * `prisma generate` falha com o backend rodando). Um `select` tipado derrubaria a
 * LISTA DE MEDICAMENTOS inteira numa base ainda não migrada; aqui o pior caso é o
 * item aparecer sem o selo de fornecedor, como aparecia antes.
 *
 * ⚠️ TODA consulta é escopada por `empresa_id`. O RLS já recusaria linha de outra
 * clínica, mas o filtro explícito é o que faz a resposta ser a mesma com e sem o
 * carimbo (ADMIN de plataforma incluído) — mesma regra de `tb_prestadores`.
 */

const prisma = require('./prisma').default;

/** A tabela da migration 20261006000000 existe nesta base? */
let _temTabela = null;
async function temTabela() {
  if (_temTabela !== null) return _temTabela;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_produtos_fornecedor' LIMIT 1`);
    _temTabela = rows.length > 0;
  } catch { _temTabela = false; }
  return _temTabela;
}

/** As colunas de fornecedor/nota do LOTE DE VACINA existem nesta base? */
let _temColunasLote = null;
async function temColunasLote() {
  if (_temColunasLote !== null) return _temColunasLote;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_lotes_vacina'
          AND column_name IN ('fornecedor_id', 'nota_fiscal')`);
    _temColunasLote = rows.length === 2;
  } catch { _temColunasLote = false; }
  return _temColunasLote;
}

/**
 * As colunas de MULTIDOSE (migration 20261008000000) existem nesta base?
 *
 * ⚠️ Sem elas o SELECT quebraria e derrubaria a LISTA DE PRODUTOS inteira — e, pior,
 * a EXECUÇÃO da prescrição, que consulta este módulo para saber quantas doses o
 * frasco rende. Detectando, o pior caso é o item não ser multidose: exatamente o
 * comportamento anterior à migration.
 */
let _temColunasMultidose = null;
async function temColunasMultidose() {
  if (_temColunasMultidose !== null) return _temColunasMultidose;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_produtos_fornecedor'
          AND column_name IN ('multidose', 'doses_por_embalagem')`);
    _temColunasMultidose = rows.length === 2;
  } catch { _temColunasMultidose = false; }
  return _temColunasMultidose;
}

/** As colunas de multidose para o SELECT — vazio na base ainda não migrada. */
async function colunasMultidose() {
  return (await temColunasMultidose())
    ? ', pf.multidose, pf.doses_por_embalagem'
    : '';
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const texto = (v, max) => {
  const t = String(v ?? '').trim();
  if (!t) return null;
  return max ? t.slice(0, max) : t;
};

function normalizar(r) {
  return {
    id:            r.id,
    medicamentoId: r.medicamento_id,
    fornecedorId:  r.fornecedor_id,
    fornecedorNome: r.fornecedor_nome ?? null,
    valorUnitario: num(r.valor_unitario),
    valorVenda:    num(r.valor_venda),
    unidade:       r.unidade ?? null,
    notaFiscal:    r.nota_fiscal ?? null,
    observacao:    r.observacao ?? null,
    ativo:         r.ativo !== false,
    // ⚠️ `multidose` sem `dosesPorEmbalagem` é uma PENDÊNCIA de cadastro, não um
    // item de dose única: a tela cobra o número, e a regra de baixa/cobrança só
    // entra em vigor quando ele existe (ver `dosesPorEmbalagemDeMedicamentos`).
    multidose:     r.multidose === true,
    dosesPorEmbalagem: r.doses_por_embalagem != null ? Number(r.doses_por_embalagem) : null,
  };
}

/**
 * Produtos (com o nome do fornecedor) de VÁRIOS medicamentos de uma vez.
 *
 * ⚠️ EM BLOCO, nunca um por item: a lista de medicamentos da prescrição tem
 * milhares de linhas, e uma ida ao banco por linha derrubaria a tela. Devolve um
 * Map por `medicamentoId`, com a lista de fornecedores daquele item.
 */
async function produtosPorMedicamento(empresaId, medicamentoIds, { client = prisma } = {}) {
  const ids = [...new Set((medicamentoIds ?? []).map(Number).filter(Number.isInteger))];
  const vazio = new Map();
  if (!empresaId || ids.length === 0) return vazio;
  if (!(await temTabela())) return vazio;
  try {
    const extra = await colunasMultidose();
    const ph = ids.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT pf.id, pf.medicamento_id, pf.fornecedor_id, pf.valor_unitario,
              pf.valor_venda, pf.unidade, pf.nota_fiscal, pf.observacao, pf.ativo
              ${extra},
              f.nome AS fornecedor_nome
         FROM schs2vet.tb_produtos_fornecedor pf
         JOIN schs2vet.tb_fornecedores f ON f.id = pf.fornecedor_id
        WHERE pf.empresa_id = $1 AND pf.ativo = true
          AND pf.medicamento_id IN (${ph})
        ORDER BY f.nome ASC`,
      Number(empresaId), ...ids,
    );
    const mapa = new Map();
    for (const r of rows) {
      const lista = mapa.get(r.medicamento_id) ?? [];
      lista.push(normalizar(r));
      mapa.set(r.medicamento_id, lista);
    }
    return mapa;
  } catch { return vazio; }
}

/** Lista os produtos da empresa, com nome do item e do fornecedor (tela de Produtos). */
async function listarDaEmpresa(empresaId, { busca, ativo = true, client = prisma } = {}) {
  if (!empresaId || !(await temTabela())) return [];
  try {
    const extra = await colunasMultidose();
    const params = [Number(empresaId)];
    let filtro = '';
    if (ativo !== 'all') {
      params.push(ativo === true || ativo === 'true');
      filtro += ` AND pf.ativo = $${params.length}`;
    }
    if (busca?.trim()) {
      params.push(`%${busca.trim()}%`);
      filtro += ` AND (m.nome ILIKE $${params.length} OR f.nome ILIKE $${params.length})`;
    }
    const rows = await client.$queryRawUnsafe(
      `SELECT pf.id, pf.medicamento_id, pf.fornecedor_id, pf.valor_unitario,
              pf.valor_venda, pf.unidade, pf.nota_fiscal, pf.observacao, pf.ativo,
              pf.created_at ${extra},
              m.nome AS medicamento_nome, m.classificacao, m.unidade AS unidade_catalogo,
              f.nome AS fornecedor_nome
         FROM schs2vet.tb_produtos_fornecedor pf
         JOIN schs2vet.tb_medicamentos m  ON m.id = pf.medicamento_id
         JOIN schs2vet.tb_fornecedores f  ON f.id = pf.fornecedor_id
        WHERE pf.empresa_id = $1 ${filtro}
        ORDER BY m.nome ASC, f.nome ASC`,
      ...params,
    );
    return rows.map(r => ({
      ...normalizar(r),
      medicamentoNome: r.medicamento_nome,
      unidadeCatalogo: r.unidade_catalogo ?? null,
      // A vacina é a linha do catálogo cuja `classificacao` contém "vacin" — mesmo
      // critério de `MedicamentoController.paraAtendimento`. Duas regras diferentes
      // para "isto é vacina?" fariam a tela e o seletor discordarem.
      ehVacina: /vacin/i.test(String(r.classificacao ?? '')),
      criadoEm: r.created_at,
    }));
  } catch { return []; }
}

/**
 * Cria ou atualiza o vínculo (empresa, medicamento, fornecedor).
 *
 * ⚠️ Idempotente pelo unique da tabela — é ele que impede a mesma dupla existir
 * duas vezes com dois preços e ninguém saber qual vale.
 * ⚠️ `undefined` NÃO toca no valor gravado (PATCH parcial); `null` APAGA. É como se
 * remove um preço cadastrado por engano sem apagar o vínculo inteiro.
 */
async function salvarProduto(client, { empresaId, medicamentoId, fornecedorId, valorUnitario, valorVenda, unidade, notaFiscal, observacao, ativo, multidose, dosesPorEmbalagem }) {
  if (!(await temTabela())) {
    return { erro: 'Recurso de produtos ainda não disponível nesta base (migration 20261006000000).' };
  }
  const emp  = Number(empresaId);
  const med  = Number(medicamentoId);
  const forn = Number(fornecedorId);
  if (!emp || !med || !forn) return { erro: 'Empresa, produto e fornecedor são obrigatórios.' };

  // O fornecedor precisa ser DESTA empresa (ou global/legado). O RLS não cruza
  // tabelas, então a policy do produto não impede gravar o id de outra clínica.
  const donos = await client.$queryRawUnsafe(
    `SELECT id FROM schs2vet.tb_fornecedores
      WHERE id = $1 AND (empresa_id IS NULL OR empresa_id = $2) LIMIT 1`,
    forn, emp,
  );
  if (donos.length === 0) return { erro: 'Fornecedor não encontrado nesta empresa.' };

  // Multidose só entra na gravação quando a migration 20261008000000 foi aplicada —
  // na base antiga, o resto do cadastro continua salvando normalmente.
  const temMulti = await temColunasMultidose();
  // ⚠️ `undefined` NÃO toca no gravado (PATCH parcial, a mesma regra dos preços);
  // `false` DESMARCA e zera as doses, senão um item desmarcado continuaria com o
  // número antigo e voltaria a ser multidose na próxima gravação parcial.
  const multi = multidose === undefined ? null : Boolean(multidose);
  const dosesNum = multi === true ? Math.trunc(num(dosesPorEmbalagem) ?? 0) || null : null;

  try {
    const rows = await client.$queryRawUnsafe(
      `INSERT INTO schs2vet.tb_produtos_fornecedor
         (empresa_id, medicamento_id, fornecedor_id, valor_unitario, valor_venda,
          unidade, nota_fiscal, observacao, ativo${temMulti ? ', multidose, doses_por_embalagem' : ''},
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9${temMulti ? ', COALESCE($10::boolean, false), $11::integer' : ''},
               NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
       ON CONFLICT (empresa_id, medicamento_id, fornecedor_id) DO UPDATE SET
         valor_unitario = COALESCE($4, schs2vet.tb_produtos_fornecedor.valor_unitario),
         valor_venda    = COALESCE($5, schs2vet.tb_produtos_fornecedor.valor_venda),
         unidade        = COALESCE($6, schs2vet.tb_produtos_fornecedor.unidade),
         nota_fiscal    = COALESCE($7, schs2vet.tb_produtos_fornecedor.nota_fiscal),
         observacao     = COALESCE($8, schs2vet.tb_produtos_fornecedor.observacao),
         ativo          = $9,${temMulti ? `
         multidose      = COALESCE($10::boolean, schs2vet.tb_produtos_fornecedor.multidose),
         doses_por_embalagem = CASE WHEN $10::boolean IS NULL
                                   THEN schs2vet.tb_produtos_fornecedor.doses_por_embalagem
                                   ELSE $11::integer END,` : ''}
         updated_at     = NOW() AT TIME ZONE 'UTC'
       RETURNING id`,
      emp, med, forn,
      num(valorUnitario), num(valorVenda),
      texto(unidade, 30), texto(notaFiscal, 100), texto(observacao),
      ativo === undefined ? true : Boolean(ativo),
      ...(temMulti ? [multi, dosesNum] : []),
    );
    return { id: rows?.[0]?.id ?? null };
  } catch (err) {
    console.error('produtoFornecedor.salvarProduto:', err.message);
    return { erro: 'Erro ao salvar o produto.' };
  }
}

/** Remove o vínculo. Produto não é registro clínico — o hard delete é adequado. */
async function removerProduto(client, empresaId, id) {
  if (!(await temTabela())) return false;
  try {
    await client.$executeRawUnsafe(
      `DELETE FROM schs2vet.tb_produtos_fornecedor WHERE id = $1 AND empresa_id = $2`,
      Number(id), Number(empresaId),
    );
    return true;
  } catch { return false; }
}

/**
 * O fornecedor de um item, para o lançamento da conta a pagar.
 *
 * Devolve o produto ATIVO mais barato do item — quando há mais de um fornecedor,
 * é dele que a clínica compraria. `null` quando o item não é produto de ninguém
 * (aí não há conta a pagar a lançar, e é o caso do item de estoque próprio).
 *
 * ⚠️ Ordena com `NULLS LAST`: fornecedor SEM preço cadastrado não pode ser
 * escolhido na frente de quem tem preço — no Postgres, `NULL` vem por último em
 * `ASC` por padrão, mas explicitar evita que a intenção se perca numa edição.
 */
async function fornecedorDoItem(client, empresaId, medicamentoId) {
  if (!empresaId || !medicamentoId || !(await temTabela())) return null;
  try {
    const extra = await colunasMultidose();
    const rows = await client.$queryRawUnsafe(
      `SELECT pf.id, pf.medicamento_id, pf.fornecedor_id, pf.valor_unitario,
              pf.valor_venda, pf.unidade, pf.nota_fiscal, pf.observacao, pf.ativo
              ${extra},
              f.nome AS fornecedor_nome
         FROM schs2vet.tb_produtos_fornecedor pf
         JOIN schs2vet.tb_fornecedores f ON f.id = pf.fornecedor_id
        WHERE pf.empresa_id = $1 AND pf.medicamento_id = $2 AND pf.ativo = true
        ORDER BY pf.valor_unitario ASC NULLS LAST, pf.id ASC
        LIMIT 1`,
      Number(empresaId), Number(medicamentoId),
    );
    return rows[0] ? normalizar(rows[0]) : null;
  } catch { return null; }
}

/**
 * 🔴 "QUANTAS DOSES SAEM DE UMA EMBALAGEM" — o dado que faz a cobrança ser POR DOSE.
 *
 * Devolve `Map<medicamentoId, dosesPorEmbalagem>` só dos itens que a clínica marcou
 * como MULTIDOSE e cujo número está informado. É consultado pela execução da
 * prescrição, então vem EM BLOCO: um item por consulta multiplicaria as idas ao banco
 * pelo número de medicamentos do documento.
 *
 * ⚠️ Item fora do Map = comportamento de sempre (conversão de unidade). É o que faz
 * esta mudança não alterar NENHUMA cobrança existente — nem numa base sem a migration,
 * onde o Map sai sempre vazio.
 *
 * ⚠️ O vínculo é por (empresa, medicamento, FORNECEDOR) e a embalagem é do PRODUTO:
 * dois fornecedores do mesmo item deveriam declarar o mesmo número. Havendo
 * divergência, vence o vínculo mais antigo (`id ASC`) — escolher o maior faria a dose
 * ficar mais barata do que a clínica paga, e o menor cobraria a mais.
 *
 * ⚠️ Escopado por `empresa_id` explicitamente: o RLS já recusaria linha de outra
 * clínica, mas o filtro é o que faz a resposta ser a mesma com e sem o carimbo
 * (ADMIN de plataforma incluído) — mesma regra do resto deste módulo.
 */
async function dosesPorEmbalagemDeMedicamentos(client, empresaId, medicamentoIds) {
  const ids = [...new Set((medicamentoIds ?? []).map(Number).filter(Number.isInteger))];
  const vazio = new Map();
  if (!empresaId || ids.length === 0) return vazio;

  // 🔴 O ITEM DO CATÁLOGO também carrega multidose desde 2026-09-15 — é lá que a
  // tela de Produtos passou a gravá-lo, porque ela deixou de pedir fornecedor.
  // ⚠️ O VÍNCULO COM O FORNECEDOR VENCE quando existe: é o dado mais específico
  // (aquele frasco, daquele fornecedor) e é o que já está gravado nas bases que usaram
  // a tela antiga — mudar a precedência trocaria a cobrança por dose de quem já
  // cadastrou, sem ninguém ter pedido.
  const mapa = await dosesNoCatalogo(client, ids);

  if (!(await temTabela()) || !(await temColunasMultidose())) return mapa;
  try {
    const ph = ids.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT DISTINCT ON (medicamento_id) medicamento_id, doses_por_embalagem
         FROM schs2vet.tb_produtos_fornecedor
        WHERE empresa_id = $1 AND ativo = true AND multidose = true
          AND doses_por_embalagem IS NOT NULL AND doses_por_embalagem >= 1
          AND medicamento_id IN (${ph})
        ORDER BY medicamento_id, id ASC`,
      Number(empresaId), ...ids,
    );
    for (const r of rows) mapa.set(Number(r.medicamento_id), Number(r.doses_por_embalagem));
    return mapa;
  } catch { return mapa; }
}

/**
 * Doses por embalagem gravadas no PRÓPRIO item do catálogo (migration
 * 20261009000000).
 *
 * ⚠️ SQL cru com `catch`: base ainda não migrada devolve mapa vazio e tudo cai na
 * conversão de unidade de sempre (§11) — nenhuma cobrança existente muda de valor.
 */
async function dosesNoCatalogo(client, ids) {
  const mapa = new Map();
  if (!ids || ids.length === 0) return mapa;
  try {
    const ph = ids.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT id, doses_por_embalagem
         FROM schs2vet.tb_medicamentos
        WHERE multidose = true AND doses_por_embalagem IS NOT NULL
          AND doses_por_embalagem >= 1 AND id IN (${ph})`, ...ids);
    for (const r of rows) mapa.set(Number(r.id), Number(r.doses_por_embalagem));
  } catch { /* coluna ainda não migrada */ }
  return mapa;
}

/** Grava fornecedor e nota fiscal num lote de vacina (colunas novas, SQL cru). */
async function gravarFornecedorNoLote(client, loteId, { fornecedorId, notaFiscal }) {
  if (!loteId || !(await temColunasLote())) return false;
  try {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_lotes_vacina
          SET fornecedor_id = $2, nota_fiscal = $3
        WHERE id = $1`,
      Number(loteId),
      fornecedorId ? Number(fornecedorId) : null,
      texto(notaFiscal, 100),
    );
    return true;
  } catch { return false; }
}

module.exports = {
  temTabela,
  temColunasLote,
  temColunasMultidose,
  dosesPorEmbalagemDeMedicamentos,
  produtosPorMedicamento,
  listarDaEmpresa,
  salvarProduto,
  removerProduto,
  fornecedorDoItem,
  gravarFornecedorNoLote,
};

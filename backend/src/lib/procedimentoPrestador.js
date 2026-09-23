// backend/src/lib/procedimentoPrestador.js
//
// FONTE ÚNICA de "quem executa o procedimento, por quanto, e quanto a clínica lhe
// deve" (2026-09-08). Três coisas moram aqui e em nenhum outro lugar:
//
//   1. O VÍNCULO prestador × procedimento (`tb_procedimento_prestadores`), com os
//      DOIS valores: `valorCliente` (o que se cobra do cliente quando é ESTE
//      prestador que executa) e `valorPrestador` (o que ELE cobra da clínica).
//   2. A RESOLUÇÃO do preço na hora de faturar — vínculo do prestador > valor
//      padrão da empresa > `valorVenda` do catálogo > 0.
//   3. O CÁLCULO do que vai ao recibo, a partir da forma de pagamento do prestador.
//
// 🔴 POR QUE UMA FONTE ÚNICA: são dois preços para a mesma linha, e eles vão para
// documentos DIFERENTES — o cliente recebe a fatura, o prestador recebe o recibo.
// Cada tela que resolvesse isso por conta própria seria uma chance de cobrar de um
// e pagar ao outro por bases que não conversam, e a divergência só apareceria no
// fim do mês, no dinheiro.
//
// 🔴 TUDO POR SQL CRU E PARAMETRIZADO. As duas tabelas e a coluna
// `tb_prescricoes.prestador_id` nasceram na migration `20261001000000`, que é
// GERADA E NÃO APLICADA; e no Windows o `prisma generate` falha com o backend
// rodando (§11), então o client tipado pode não conhecer nem a tabela nem a coluna.
// Pelo client tipado, uma base ainda não migrada derrubaria a EXECUÇÃO DE
// PRESCRIÇÃO inteira — que é operação clínica. Assim o pior caso é o recibo não
// registrar a linha, e a fatura do cliente sai como sempre saiu.
'use strict';

const prisma = require('./prisma').default;

// ─────────────────────────────────────────────────────────────────────────────
// Sondagem do schema (uma vez por processo)
// ─────────────────────────────────────────────────────────────────────────────
// Sempre com o client GLOBAL, nunca com o `tx` recebido: um erro dentro de uma
// transaction a ABORTA, e a sondagem é justamente a chamada que pode falhar numa
// base não migrada. Mesmo cuidado de `temColunaProprietario`
// (PrescricaoGrupoController).

let _temTabelas = null;
async function temTabelas() {
  if (_temTabelas !== null) return _temTabelas;
  try {
    const rows = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'schs2vet'
         AND table_name IN ('tb_procedimento_prestadores', 'tb_execucoes_procedimento_prestador')`;
    _temTabelas = Number(rows?.[0]?.n ?? 0) === 2;
  } catch { _temTabelas = false; }
  return _temTabelas;
}

let _temColunaItem = null;
async function temColunaPrestadorItem() {
  if (_temColunaItem !== null) return _temColunaItem;
  try {
    const rows = await prisma.$queryRaw`
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'schs2vet' AND table_name = 'tb_prescricoes'
         AND column_name = 'prestador_id' LIMIT 1`;
    _temColunaItem = rows.length > 0;
  } catch { _temColunaItem = false; }
  return _temColunaItem;
}

/**
 * A coluna `exame_clinico_id` do LEDGER existe nesta base (migration 20261019000000)?
 * Sem ela o exame ainda registra a execução, só sem dizer de qual exame veio — e sem
 * o `ON CONFLICT` que impede a dívida duplicada. É o mesmo contrato dos demais
 * guardas deste arquivo: base não migrada não quebra, degrada.
 */
let _temColunaExameExec = null;
async function temColunaExameExecucao() {
  if (_temColunaExameExec !== null) return _temColunaExameExec;
  try {
    const rows = await prisma.$queryRaw`
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'schs2vet' AND table_name = 'tb_execucoes_procedimento_prestador'
         AND column_name = 'exame_clinico_id' LIMIT 1`;
    _temColunaExameExec = rows.length > 0;
  } catch { _temColunaExameExec = false; }
  return _temColunaExameExec;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formas de pagamento do PRESTADOR
// ─────────────────────────────────────────────────────────────────────────────
/**
 * `POR_PROCEDIMENTO` é EXCLUSIVO do prestador e por isso mora aqui, e não em
 * `TIPOS_PAGAMENTO` de `lib/usuarioEmpresa.js`.
 *
 * ⚠️ Aquela lista é compartilhada com o INCLUIR MEMBRO (`tb_usuario_empresa`), e
 * acrescentar o valor lá o tornaria aceito no backend para membro de equipe sem que
 * nenhuma tela o ofereça — um estado alcançável só por chamada direta à API, que
 * ninguém consegue configurar nem corrigir depois. O prestador é o único que recebe
 * POR PROCEDIMENTO porque é o único cujo trabalho é contado por procedimento.
 */
const TIPOS_PAGAMENTO_PRESTADOR = ['SALARIO', 'COMISSAO', 'POR_PROCEDIMENTO'];

/** `POR_PROCEDIMENTO` não tem "R$ ou %": o valor é o do vínculo, procedimento a procedimento. */
const TIPOS_SEM_FORMA = ['POR_PROCEDIMENTO'];

const BASES_CALCULO = {
  VALOR_PROCEDIMENTO: 'VALOR_PROCEDIMENTO', // valor que o prestador cobra pelo procedimento
  PERCENTUAL_CLIENTE: 'PERCENTUAL_CLIENTE', // % sobre o Valor Cobrado para o Cliente
  VALOR_FIXO:         'VALOR_FIXO',         // comissão em R$, fixa por procedimento
  SALARIO:            'SALARIO',            // remuneração fixa — não se apura por procedimento
  SEM_CONFIG:         'SEM_CONFIG',         // prestador sem forma de pagamento cadastrada
};

/**
 * Número ou `null` — e `null`/`undefined`/'' NÃO são zero.
 *
 * 🔴 `Number(null)` é 0, e é finito: com um `Number.isFinite` cru, coluna VAZIA voltaria
 * como 0 e duas regras cairiam de uma vez —
 *   • `valorCliente` nulo significa "usa o valor padrão da empresa"; virando 0, a tela
 *     mostraria "R$ 0,00" e o gestor concluiria que o procedimento é gratuito com
 *     aquele prestador;
 *   • prestador POR_PROCEDIMENTO sem valor no vínculo cairia em VALOR_PROCEDIMENTO com
 *     valor 0 em vez de SEM_CONFIG, e a PENDÊNCIA desapareceria do recibo — que é
 *     justamente o aviso de que falta cadastrar o preço.
 * Foi o teste que pegou isto.
 */
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Dinheiro é arredondado ao CENTAVO na gravação — não na exibição. Um percentual
// sobre 183,33 dá 55,000000000000004 em ponto flutuante, e a soma de 30 linhas dessas
// fecharia o recibo com um centavo de diferença que ninguém consegue explicar.
const arred = (v) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * O QUE A CLÍNICA DEVE por UMA execução. Função PURA — é a regra do recibo, e é
 * ela que os testes travam.
 *
 * ⚠️ `valorCliente` é o valor JÁ TOTAL daquela execução (o mesmo que foi para a
 * fatura), então o PERCENTUAL incide sobre ele sem multiplicar por quantidade de
 * novo — foi o pedido: "se for % ele deverá ser calculado em cima do Valor Cobrado
 * para o Cliente". Já `VALOR_FIXO` e `VALOR_PROCEDIMENTO` são preços UNITÁRIOS, e
 * esses sim acompanham a quantidade.
 *
 * ⚠️ SALARIO devolve ZERO, e isso não é lacuna: salário é remuneração fixa do mês e
 * não se apura procedimento a procedimento — somá-lo por execução pagaria o mesmo
 * salário tantas vezes quantos procedimentos a pessoa fizesse. A execução é
 * registrada de qualquer forma (o recibo lista o serviço prestado e diz que a
 * remuneração é fixa); apagá-la faria o prestador assalariado desaparecer do
 * relatório e ninguém conferiria o que ele produziu.
 *
 * ⚠️ Prestador sem forma de pagamento cadastrada cai em `SEM_CONFIG` com valor
 * ZERO — nunca num palpite. Recibo com valor inventado é pior que recibo com a
 * pendência à vista, e a tela mostra a linha pedindo o cadastro.
 */
function calcularValorAPagar({
  valorCliente = 0, valorPrestador = null,
  tipoPagamento = null, formaPagamento = null, valorPagamento = null,
  quantidade = 1,
} = {}) {
  const cliente = num(valorCliente) ?? 0;
  const qtd     = Math.max(num(quantidade) ?? 1, 0);
  const tipo    = String(tipoPagamento  ?? '').trim().toUpperCase();
  const forma   = String(formaPagamento ?? '').trim().toUpperCase();
  const valor   = num(valorPagamento);
  const doProc  = num(valorPrestador);

  if (tipo === 'POR_PROCEDIMENTO') {
    if (doProc === null) return { valorAPagar: 0, baseCalculo: BASES_CALCULO.SEM_CONFIG };
    return { valorAPagar: arred(doProc * qtd), baseCalculo: BASES_CALCULO.VALOR_PROCEDIMENTO };
  }
  if (tipo === 'SALARIO')  return { valorAPagar: 0, baseCalculo: BASES_CALCULO.SALARIO };
  if (tipo === 'COMISSAO') {
    if (valor === null || valor <= 0) return { valorAPagar: 0, baseCalculo: BASES_CALCULO.SEM_CONFIG };
    if (forma === 'PERCENTUAL') {
      return { valorAPagar: arred(cliente * (valor / 100)), baseCalculo: BASES_CALCULO.PERCENTUAL_CLIENTE };
    }
    return { valorAPagar: arred(valor * qtd), baseCalculo: BASES_CALCULO.VALOR_FIXO };
  }
  return { valorAPagar: 0, baseCalculo: BASES_CALCULO.SEM_CONFIG };
}

// ─────────────────────────────────────────────────────────────────────────────
// VÍNCULO prestador × procedimento
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vínculos de uma lista de procedimentos, com o cadastro do prestador (nome e forma
 * de pagamento) já anexado — é isso que a tela de Cadastro > Procedimentos precisa
 * para desenhar uma linha por prestador.
 *
 * ⚠️ Devolve Map(procedimentoId → vínculos[]). Sem tabela/empresa, Map vazio: a
 * tela cai no comportamento anterior (só o valor padrão da empresa).
 */
async function vinculosPorProcedimento(empresaId, procedimentoIds, { client = prisma, incluirInativos = false } = {}) {
  const ids = [...new Set((procedimentoIds ?? []).map(Number).filter(Number.isInteger))];
  const vazio = new Map();
  if (!empresaId || ids.length === 0) return vazio;
  if (!(await temTabelas())) return vazio;
  try {
    const ph = ids.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT pp.id, pp.procedimento_id, pp.prestador_id, pp.valor_cliente, pp.valor_prestador, pp.ativo,
              p.nome AS prestador_nome, p.tipo_servico, p.ativo AS prestador_ativo,
              p.tipo_pagamento, p.forma_pagamento, p.valor_pagamento
         FROM schs2vet.tb_procedimento_prestadores pp
         JOIN schs2vet.tb_prestadores p ON p.id = pp.prestador_id
        WHERE pp.empresa_id = $1 AND pp.procedimento_id IN (${ph})
              ${incluirInativos ? '' : 'AND pp.ativo = true'}
        ORDER BY p.nome ASC`,
      Number(empresaId), ...ids,
    );
    const mapa = new Map();
    for (const r of rows) {
      const lista = mapa.get(r.procedimento_id) ?? [];
      lista.push(normalizarVinculo(r));
      mapa.set(r.procedimento_id, lista);
    }
    return mapa;
  } catch { return vazio; }
}

function normalizarVinculo(r) {
  return {
    id:             r.id,
    procedimentoId: r.procedimento_id,
    prestadorId:    r.prestador_id,
    prestadorNome:  r.prestador_nome,
    tipoServico:    r.tipo_servico ?? null,
    prestadorAtivo: r.prestador_ativo !== false,
    valorCliente:   num(r.valor_cliente),
    valorPrestador: num(r.valor_prestador),
    ativo:          r.ativo !== false,
    tipoPagamento:  r.tipo_pagamento  ?? null,
    formaPagamento: r.forma_pagamento ?? null,
    valorPagamento: num(r.valor_pagamento),
  };
}

/**
 * Cria ou atualiza o vínculo. Idempotente por (empresa, procedimento, prestador) —
 * é o unique da tabela, e é ele que impede a mesma dupla existir duas vezes com
 * dois preços diferentes e ninguém saber qual vale.
 *
 * ⚠️ `undefined` não toca no valor gravado (PATCH parcial); `null` APAGA — é como
 * se devolve o procedimento ao valor padrão da empresa depois de ter dado um preço
 * próprio ao prestador.
 */
async function salvarVinculo(client, { empresaId, procedimentoId, prestadorId, valorCliente, valorPrestador, ativo }) {
  if (!(await temTabelas())) return { erro: 'Recurso de prestador por procedimento ainda não disponível nesta base.' };
  const emp  = Number(empresaId);
  const proc = Number(procedimentoId);
  const pres = Number(prestadorId);
  if (!emp || !proc || !pres) return { erro: 'Empresa, procedimento e prestador são obrigatórios.' };

  // `undefined` = não mandou (mantém o gravado); vazio/`null` = APAGAR (volta ao valor
  // padrão da empresa). São coisas DIFERENTES, e é por isso que o UPDATE é montado
  // campo a campo em vez de um COALESCE — com COALESCE não há como apagar.
  const ehVazio = (v) => v === null || v === '';
  const vc = valorCliente   === undefined ? undefined : (ehVazio(valorCliente)   ? null : num(valorCliente));
  const vp = valorPrestador === undefined ? undefined : (ehVazio(valorPrestador) ? null : num(valorPrestador));
  if (vc !== undefined && vc !== null && !(vc >= 0)) return { erro: 'Valor cobrado para o cliente inválido.' };
  if (vp !== undefined && vp !== null && !(vp >= 0)) return { erro: 'Valor cobrado pelo prestador inválido.' };

  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT id FROM schs2vet.tb_procedimento_prestadores
        WHERE empresa_id = $1 AND procedimento_id = $2 AND prestador_id = $3 LIMIT 1`,
      emp, proc, pres,
    );
    const existente = rows?.[0]?.id ?? null;

    if (!existente) {
      const criado = await client.$queryRawUnsafe(
        `INSERT INTO schs2vet.tb_procedimento_prestadores
           (empresa_id, procedimento_id, prestador_id, valor_cliente, valor_prestador, ativo,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
         RETURNING id`,
        emp, proc, pres,
        vc === undefined ? null : vc,
        vp === undefined ? null : vp,
        ativo === undefined ? true : ativo === true,
      );
      return { erro: null, id: criado?.[0]?.id ?? null, criado: true };
    }

    const sets = [];
    const vals = [];
    const push = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (vc    !== undefined) push('valor_cliente',   vc);
    if (vp    !== undefined) push('valor_prestador', vp);
    if (ativo !== undefined) push('ativo',           ativo === true);
    if (sets.length > 0) {
      vals.push(existente);
      await client.$executeRawUnsafe(
        `UPDATE schs2vet.tb_procedimento_prestadores
            SET ${sets.join(', ')}, updated_at = NOW() AT TIME ZONE 'UTC'
          WHERE id = $${vals.length}`,
        ...vals,
      );
    }
    return { erro: null, id: existente, criado: false };
  } catch (err) {
    console.error('procedimentoPrestador.salvarVinculo:', err.message);
    return { erro: 'Erro ao salvar o vínculo do prestador.' };
  }
}

/** Remove o vínculo (hard delete: é configuração de preço, não registro clínico). */
async function removerVinculo(client, empresaId, vinculoId) {
  if (!(await temTabelas())) return 0;
  return client.$executeRawUnsafe(
    'DELETE FROM schs2vet.tb_procedimento_prestadores WHERE id = $1 AND empresa_id = $2',
    Number(vinculoId), Number(empresaId),
  );
}

/**
 * Prestadores que executam um procedimento, achado pelo NOME — é o seletor de
 * prestador da tela de prescrição, onde o item guarda só o nome (não há FK).
 *
 * ⚠️ Devolve APENAS vínculo ATIVO de prestador ATIVO: oferecer na prescrição quem foi
 * inativado no cadastro produziria uma execução cujo recibo ninguém vai pagar. Quem já
 * está gravado num item antigo continua sendo exibido — isso é `anexarPrestador`, que
 * lê pelo id e não por esta lista.
 */
async function prestadoresDoProcedimentoPorNome(empresaId, nome, { client = prisma } = {}) {
  const n = String(nome ?? '').trim();
  if (!empresaId || !n || !(await temTabelas())) return [];
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT pp.id, pp.procedimento_id, pp.prestador_id, pp.valor_cliente, pp.valor_prestador, pp.ativo,
              p.nome AS prestador_nome, p.tipo_servico, p.ativo AS prestador_ativo,
              p.tipo_pagamento, p.forma_pagamento, p.valor_pagamento
         FROM schs2vet.tb_procedimento_prestadores pp
         JOIN schs2vet.tb_procedimentos_vet pv ON pv.id = pp.procedimento_id
         JOIN schs2vet.tb_prestadores       p  ON p.id  = pp.prestador_id
        WHERE pp.empresa_id = $1
          AND pp.ativo = true AND p.ativo = true
          AND lower(btrim(pv.nome)) = lower(btrim($2))
        ORDER BY p.nome ASC`,
      Number(empresaId), n,
    );
    return rows.map(normalizarVinculo);
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUÇÃO do preço na hora de faturar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O que o VÍNCULO diz sobre este procedimento para este prestador, achado pelo NOME
 * (o item de prescrição guarda só o nome — não há FK).
 *
 * Devolve `{ valorCliente, valorPrestador, vinculoId }`, com `null` no que o vínculo
 * não define. NÃO é a cadeia completa de preço: quem a fecha é
 * `resolverValorProcedimento` (PrescricaoGrupoController), na ordem
 *   vínculo do prestador > valor padrão da empresa > `valorVenda` do catálogo > 0.
 *
 * ⚠️ O vínculo vem PRIMEIRO lá porque é o mais específico: é o preço daquele
 * procedimento QUANDO É AQUELE PRESTADOR que executa — justamente o caso que o valor
 * único da empresa não sabia representar.
 *
 * ⚠️ Sem prestador no item esta função não é nem consultada, e a ordem é a de sempre:
 * nenhuma prescrição existente muda de preço por causa desta mudança.
 *
 * ⚠️ NÃO filtra por `ativo`, pelo mesmo motivo de `resolverValorProcedimento`: isto
 * precifica algo que a pessoa JÁ ESCOLHEU ao prescrever, e inativar o vínculo entre a
 * prescrição e a execução não pode fazer a linha nascer com valor 0. Havendo os dois,
 * o ATIVO vence (`ORDER BY pp.ativo DESC`).
 */
async function resolverValoresPorNome(client, empresaId, nome, prestadorId) {
  const n = String(nome ?? '').trim();
  const fora = { valorCliente: null, valorPrestador: null, vinculoId: null };
  if (!n) return fora;

  let doVinculo = fora;
  if (empresaId && prestadorId && await temTabelas()) {
    try {
      const rows = await client.$queryRawUnsafe(
        `SELECT pp.id, pp.valor_cliente, pp.valor_prestador
           FROM schs2vet.tb_procedimento_prestadores pp
           JOIN schs2vet.tb_procedimentos_vet pv ON pv.id = pp.procedimento_id
          WHERE pp.empresa_id = $1 AND pp.prestador_id = $2
                AND lower(btrim(pv.nome)) = lower(btrim($3))
          ORDER BY pp.ativo DESC, pp.id DESC
          LIMIT 1`,
        Number(empresaId), Number(prestadorId), n,
      );
      if (rows.length > 0) {
        doVinculo = {
          valorCliente:   num(rows[0].valor_cliente),
          valorPrestador: num(rows[0].valor_prestador),
          vinculoId:      rows[0].id,
        };
      }
    } catch { /* base não migrada — segue pelo valor padrão */ }
  }
  return doVinculo;
}

// ─────────────────────────────────────────────────────────────────────────────
// `tb_prescricoes.prestador_id` (coluna nova → SQL cru)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Anexa `prestadorId` (+ `prestadorNome`) a itens já carregados. Aceita item, lista
 * de itens ou lista de GRUPOS (percorre `grupo.itens`).
 *
 * ⚠️ TODA leitura que decida FATURA ou RECIBO passa por aqui: sem o campo, o
 * procedimento do prestador externo é cobrado pelo valor padrão da empresa e não
 * gera linha nenhuma no recibo — em silêncio.
 */
async function anexarPrestador(client, itens) {
  const eLista = Array.isArray(itens);
  const lista  = eLista ? itens : [itens];
  const ids    = lista.map(i => i?.id).filter(Number.isInteger);
  const semNada = (i) => ({ ...i, prestadorId: null, prestadorNome: null });
  if (ids.length === 0 || !(await temColunaPrestadorItem())) {
    return eLista ? lista.map(semNada) : semNada(itens);
  }
  let porItem = new Map();
  try {
    const ph = ids.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT pr.id, pr.prestador_id, p.nome AS prestador_nome
         FROM schs2vet.tb_prescricoes pr
         LEFT JOIN schs2vet.tb_prestadores p ON p.id = pr.prestador_id
        WHERE pr.id IN (${ph}) AND pr.prestador_id IS NOT NULL`,
      ...ids,
    );
    porItem = new Map(rows.map(r => [r.id, { prestadorId: r.prestador_id, prestadorNome: r.prestador_nome ?? null }]));
  } catch { /* coluna não migrada */ }
  const aplicar = (i) => ({ ...i, ...(porItem.get(i.id) ?? { prestadorId: null, prestadorNome: null }) });
  return eLista ? lista.map(aplicar) : aplicar(itens);
}

/** Mesma coisa, para grupos já carregados com `itens`. */
async function anexarPrestadorEmGrupos(client, grupos) {
  const eLista = Array.isArray(grupos);
  const lista  = eLista ? grupos : [grupos];
  const todos  = lista.flatMap(g => g?.itens ?? []);
  if (todos.length === 0) return grupos;
  const comCampo = await anexarPrestador(client, todos);
  const porId = new Map(comCampo.map(i => [i.id, i]));
  const aplicar = (g) => ({ ...g, itens: (g.itens ?? []).map(i => porId.get(i.id) ?? i) });
  return eLista ? lista.map(aplicar) : aplicar(grupos);
}

/**
 * Grava o prestador do item. `undefined` não toca no valor (PATCH parcial do
 * `atualizarItem`); `null` desvincula.
 *
 * ⚠️ Só grava em item de PROCEDIMENTO — medicamento não tem prestador, e aceitar o
 * campo ali criaria linha de recibo por dose de remédio.
 */
async function gravarPrestadorDoItem(client, itemId, prestadorId, tipo = 'PROCEDIMENTO') {
  if (prestadorId === undefined) return;
  if (!(await temColunaPrestadorItem())) return;
  const valor = (tipo ?? 'PROCEDIMENTO') === 'PROCEDIMENTO' && prestadorId !== null && prestadorId !== ''
    ? Number(prestadorId)
    : null;
  if (valor !== null && !Number.isInteger(valor)) return;
  try {
    await client.$executeRawUnsafe(
      'UPDATE schs2vet.tb_prescricoes SET prestador_id = $1 WHERE id = $2',
      valor, Number(itemId),
    );
  } catch { /* coluna não migrada */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMBO: prestador + valor do prestador (colunas novas → SQL cru)
// ─────────────────────────────────────────────────────────────────────────────
// `ProcedimentoCombo.valor` já era, e continua sendo, o VALOR CLIENTE do pacote — só o
// rótulo da tela mudou. O que é novo é QUEM executa e QUANTO ELE cobra.

let _temColunasCombo = null;
async function temColunasCombo() {
  if (_temColunasCombo !== null) return _temColunasCombo;
  try {
    const rows = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'schs2vet' AND table_name = 'tb_procedimento_combos'
         AND column_name IN ('prestador_id', 'valor_prestador')`;
    _temColunasCombo = Number(rows?.[0]?.n ?? 0) === 2;
  } catch { _temColunasCombo = false; }
  return _temColunasCombo;
}

/**
 * Anexa `prestadorId`/`prestadorNome`/`valorPrestador` a combos já carregados.
 *
 * ⚠️ Sem as colunas devolve os campos como `null` — a tela cai no comportamento
 * anterior (combo com um valor só) em vez de quebrar.
 */
async function anexarPrestadorEmCombos(client, combos) {
  const eLista = Array.isArray(combos);
  const lista  = eLista ? combos : [combos];
  const ids    = lista.map(c => c?.id).filter(Number.isInteger);
  const semNada = (c) => ({ ...c, prestadorId: null, prestadorNome: null, valorPrestador: null });
  if (ids.length === 0 || !(await temColunasCombo())) {
    return eLista ? lista.map(semNada) : semNada(combos);
  }
  let porId = new Map();
  try {
    const ph = ids.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT c.id, c.prestador_id, c.valor_prestador, p.nome AS prestador_nome
         FROM schs2vet.tb_procedimento_combos c
         LEFT JOIN schs2vet.tb_prestadores p ON p.id = c.prestador_id
        WHERE c.id IN (${ph})`,
      ...ids,
    );
    porId = new Map(rows.map(r => [r.id, {
      prestadorId:    r.prestador_id,
      prestadorNome:  r.prestador_nome ?? null,
      valorPrestador: num(r.valor_prestador),
    }]));
  } catch { /* colunas não migradas */ }
  const aplicar = (c) => ({ ...c, ...(porId.get(c.id) ?? { prestadorId: null, prestadorNome: null, valorPrestador: null }) });
  return eLista ? lista.map(aplicar) : aplicar(combos);
}

/**
 * Grava as duas colunas novas do combo. `undefined` não toca no valor gravado (PATCH
 * parcial); vazio/`null` APAGA — é como se desvincula o prestador do pacote.
 */
async function gravarPrestadorDoCombo(client, comboId, { prestadorId, valorPrestador } = {}) {
  if (prestadorId === undefined && valorPrestador === undefined) return;
  if (!(await temColunasCombo())) return;
  const vazio = (v) => v === null || v === '' || v === undefined;
  const sets = [];
  const vals = [];
  const push = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (prestadorId    !== undefined) push('prestador_id',    vazio(prestadorId)    ? null : Number(prestadorId));
  if (valorPrestador !== undefined) push('valor_prestador', vazio(valorPrestador) ? null : num(valorPrestador));
  if (sets.length === 0) return;
  vals.push(Number(comboId));
  try {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_procedimento_combos SET ${sets.join(', ')} WHERE id = $${vals.length}`,
      ...vals,
    );
  } catch { /* colunas não migradas */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEDGER da execução (base do recibo)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra UMA execução de procedimento atribuída a um prestador.
 *
 * ⚠️ Chamada DENTRO da transaction da execução, junto do lançamento na fatura: ou o
 * cliente é cobrado e o prestador entra no recibo, ou nada acontece. Registrar
 * depois do commit abriria a janela em que a clínica cobrou e não deve a ninguém.
 *
 * ⚠️ NUNCA lança: falha aqui não pode derrubar a execução clínica. Sem tabela (base
 * não migrada) devolve null e a fatura sai como sempre saiu.
 *
 * ⚠️ Snapshot COMPLETO da base do cálculo (valores + forma de pagamento do
 * prestador). É o que permite reimprimir o recibo de março com os números de março.
 *
 * 🔴 DUAS ORIGENS, campos SEPARADOS: `prescricaoId` (procedimento executado no
 * plantão) e `exameClinicoId` (exame concluído — 2026-09-22). Guardar as duas no
 * mesmo campo tornaria impossível dizer se o id 47 é a prescrição 47 ou o exame 47.
 *
 * 🔴 A origem EXAME é IDEMPOTENTE, e a de prescrição não precisa ser: `executar` só
 * roda uma vez por dose, mas `salvarResultado` é REENVIÁVEL (recarregar o laudo
 * porque a IA falhou, corrigir a tabela digitada). Sem o `ON CONFLICT`, cada reenvio
 * somaria outra dívida ao prestador, em silêncio. Quem garante é o índice único
 * parcial `tb_execucoes_proc_prestador_exame_unico` (migration 20261019000000).
 */
async function registrarExecucao(client, dados) {
  if (!(await temTabelas())) return null;
  const {
    empresaId, prestadorId, prescricaoId = null, exameClinicoId = null, animalId,
    animalNome = '', procedimentoNome = '',
    quantidade = 1, valorCliente = 0, valorPrestador = null,
    tipoPagamento = null, formaPagamento = null, valorPagamento = null,
    executadoEm, executadoPorId = null, faturaItemId = null,
  } = dados ?? {};
  if (!empresaId || !prestadorId || !animalId) return null;

  // Base ainda sem a migration 20261019000000: registra como sempre registrou (sem a
  // coluna de exame). O pior caso é o ledger não saber de qual exame a linha veio —
  // nunca derrubar a conclusão do exame.
  const comExame = exameClinicoId != null && (await temColunaExameExecucao());

  const { valorAPagar, baseCalculo } = calcularValorAPagar({
    valorCliente, valorPrestador, tipoPagamento, formaPagamento, valorPagamento, quantidade,
  });

  try {
    const rows = await client.$queryRawUnsafe(
      `INSERT INTO schs2vet.tb_execucoes_procedimento_prestador
         (empresa_id, prestador_id, prescricao_id, animal_id, animal_nome, procedimento_nome,
          quantidade, valor_cliente, valor_prestador,
          tipo_pagamento, forma_pagamento, valor_pagamento,
          valor_a_pagar, base_calculo, executado_em, executado_por_id, fatura_item_id
          ${comExame ? ', exame_clinico_id' : ''})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17${comExame ? ',$18' : ''})
       ${comExame ? 'ON CONFLICT ("exame_clinico_id") WHERE "exame_clinico_id" IS NOT NULL DO NOTHING' : ''}
       RETURNING id`,
      Number(empresaId), Number(prestadorId),
      prescricaoId ? Number(prescricaoId) : null, Number(animalId),
      String(animalNome ?? '').slice(0, 255), String(procedimentoNome ?? '').slice(0, 255),
      num(quantidade) ?? 1, arred(valorCliente), num(valorPrestador),
      tipoPagamento ?? null, formaPagamento ?? null, num(valorPagamento),
      valorAPagar, baseCalculo,
      executadoEm instanceof Date ? executadoEm : new Date(executadoEm ?? Date.now()),
      executadoPorId ? Number(executadoPorId) : null,
      faturaItemId ? Number(faturaItemId) : null,
      ...(comExame ? [Number(exameClinicoId)] : []),
    );
    // `DO NOTHING` não devolve linha: null aqui significa "já estava registrado",
    // que é sucesso, não falha. Quem chama não distingue os dois — e não precisa.
    return rows?.[0]?.id ?? null;
  } catch (err) {
    // Log e segue: a operação clínica não pode cair porque o recibo não registrou.
    console.error('procedimentoPrestador.registrarExecucao:', err.message);
    return null;
  }
}

/**
 * Execuções de um PERÍODO, para o recibo. Uma linha por execução, com o que o
 * recibo tem de mostrar: animal, procedimento executado, valor e data da execução.
 *
 * ⚠️ Janela `[inicio, fim)` — fim EXCLUSIVO. Com `<=` numa data sem hora, o último
 * dia do período entra com 00:00 e a execução das 14h daquele dia fica de fora.
 */
async function listarExecucoes(empresaId, { inicio, fim, prestadorId = null } = {}, { client = prisma } = {}) {
  if (!empresaId || !(await temTabelas())) return [];
  try {
    const params = [Number(empresaId), inicio, fim];
    let filtro = '';
    if (prestadorId) { params.push(Number(prestadorId)); filtro = `AND e.prestador_id = $${params.length}`; }
    const rows = await client.$queryRawUnsafe(
      `SELECT e.id, e.prestador_id, e.animal_id, e.animal_nome, e.procedimento_nome,
              e.quantidade, e.valor_cliente, e.valor_prestador,
              e.tipo_pagamento, e.forma_pagamento, e.valor_pagamento,
              e.valor_a_pagar, e.base_calculo, e.executado_em, e.prescricao_id,
              p.nome AS prestador_nome, p.cpf, p.cnpj, p.tipo_servico, p.telefone, p.email
         FROM schs2vet.tb_execucoes_procedimento_prestador e
         LEFT JOIN schs2vet.tb_prestadores p ON p.id = e.prestador_id
        WHERE e.empresa_id = $1 AND e.executado_em >= $2 AND e.executado_em < $3 ${filtro}
        ORDER BY p.nome ASC, e.executado_em ASC, e.id ASC`,
      ...params,
    );
    return rows.map(r => ({
      id:               r.id,
      prestadorId:      r.prestador_id,
      prestadorNome:    r.prestador_nome ?? 'Prestador excluído',
      prestadorDoc:     r.cnpj || r.cpf || null,
      prestadorTipo:    r.tipo_servico ?? null,
      prestadorTelefone: r.telefone ?? null,
      prestadorEmail:   r.email ?? null,
      animalId:         r.animal_id,
      animalNome:       r.animal_nome,
      procedimento:     r.procedimento_nome,
      quantidade:       num(r.quantidade) ?? 1,
      valorCliente:     num(r.valor_cliente) ?? 0,
      valorPrestador:   num(r.valor_prestador),
      tipoPagamento:    r.tipo_pagamento ?? null,
      formaPagamento:   r.forma_pagamento ?? null,
      valorPagamento:   num(r.valor_pagamento),
      valorAPagar:      num(r.valor_a_pagar) ?? 0,
      baseCalculo:      r.base_calculo,
      executadoEm:      r.executado_em,
      prescricaoId:     r.prescricao_id,
    }));
  } catch { return []; }
}

/**
 * TOTAL DE COMISSÃO/REMUNERAÇÃO de prestador apurada no período.
 *
 * 🔴 POR QUE O RELATÓRIO FINANCEIRO PRECISA DISTO (a pedido, 2026-09-15): o valor
 * INTEIRO do procedimento vai para a fatura do cliente — é o que ele paga. Mas parte
 * dele é da pessoa que executou, e sai da clínica como conta a pagar. Somar a receita
 * bruta na linha "Procedimentos" afirmaria que a clínica ficou com tudo.
 *
 * ⚠️ A fonte é o LEDGER (`tb_execucoes_procedimento_prestador`), a MESMA do recibo —
 * nunca um recálculo: o ledger é SNAPSHOT do acordo vigente na execução, e recalcular
 * na leitura faria o relatório de março usar o percentual renegociado em setembro.
 *
 * ⚠️ Base não migrada (ou sem empresa no contexto) devolve 0 — o relatório volta a
 * mostrar a receita bruta, que é o comportamento anterior.
 *
 * @returns {Promise<number>} soma de `valor_a_pagar` no intervalo [inicio, fim]
 */
async function totalComissaoNoPeriodo(empresaId, inicio, fim, { client = prisma } = {}) {
  if (!empresaId || !inicio || !fim) return 0;
  if (!(await temTabelas())) return 0;
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT COALESCE(SUM(valor_a_pagar), 0)::float8 AS total
         FROM schs2vet.tb_execucoes_procedimento_prestador
        WHERE empresa_id = $1 AND executado_em >= $2 AND executado_em <= $3`,
      Number(empresaId), inicio, fim,
    );
    return Number(rows?.[0]?.total ?? 0);
  } catch { return 0; }
}

module.exports = {
  totalComissaoNoPeriodo,
  TIPOS_PAGAMENTO_PRESTADOR,
  TIPOS_SEM_FORMA,
  BASES_CALCULO,
  calcularValorAPagar,
  temTabelas,
  temColunaPrestadorItem,
  temColunaExameExecucao,
  vinculosPorProcedimento,
  salvarVinculo,
  removerVinculo,
  prestadoresDoProcedimentoPorNome,
  resolverValoresPorNome,
  anexarPrestador,
  anexarPrestadorEmGrupos,
  temColunasCombo,
  anexarPrestadorEmCombos,
  gravarPrestadorDoCombo,
  gravarPrestadorDoItem,
  registrarExecucao,
  listarExecucoes,
};

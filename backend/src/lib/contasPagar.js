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
const { calcularVencimento, statusExibicao } = require('./vencimentoCredor');

const TIPOS = ['FORNECEDOR', 'PRESTADOR'];
/**
 * 🔴 REABERTA NÃO É ABERTA — a MESMA distinção da fatura (`faturaUtils`,
 * STATUS_FATURA_ABERTOS). As duas são editáveis, mas só a ABERTA é a conta CORRENTE:
 * é ela que `contaAbertaDoCredor` encontra (índice único PARCIAL `WHERE status =
 * 'ABERTA'`) para receber o lançamento automático de hoje. Sem a distinção, reabrir a
 * conta de agosto para corrigir um valor faria a compra de setembro cair dentro dela,
 * num documento que o credor já tinha recebido uma vez.
 */
const STATUS_ABERTOS   = ['ABERTA', 'REABERTA'];
const STATUS_FECHADOS  = ['FECHADA', 'PAGA', 'CANCELADA'];
const STATUS_VALIDOS   = [...STATUS_ABERTOS, ...STATUS_FECHADOS];
/**
 * 🔴 ATRASADA É DERIVADA, NUNCA GRAVADA (ver `lib/vencimentoCredor.js#statusExibicao`)
 * — por isso ela vale como FILTRO e não como valor de `alterarStatus`. Aceitá-la na
 * escrita criaria um segundo dono da verdade: a coluna diria ATRASADA e o cadastro do
 * credor diria outra coisa, e não haveria em qual acreditar.
 */
const STATUS_FILTRAVEIS = [...STATUS_VALIDOS, 'ATRASADA'];

/** Origens do lançamento automático — o que torna cada linha rastreável e idempotente. */
const ORIGENS = {
  PRESCRICAO_ITEM:    'PRESCRICAO_ITEM',
  VACINA:             'VACINA',
  EXECUCAO_PRESTADOR: 'EXECUCAO_PRESTADOR',
  // Exame concluído por prestador externo (2026-09-22). Origem PRÓPRIA, e não o
  // reuso de EXECUCAO_PRESTADOR: o par (origem, id) é a chave de idempotência da
  // linha, e o exame 47 e o item de prescrição 47 colidiriam — a segunda dívida
  // seria descartada pelo `ON CONFLICT DO NOTHING` sem ninguém notar.
  EXAME_PRESTADOR:    'EXAME_PRESTADOR',
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

/**
 * A base já tem as colunas de vencimento do credor (migration `20261020000000`)?
 *
 * ⚠️ Guarda de COLUNA, no padrão de `temTabelas`: o `JOIN` que as lê roda em SQL cru,
 * e numa base sem a migration o Postgres responde `column ... does not exist` — o que
 * derrubaria a LISTAGEM INTEIRA de pagamentos por causa de um campo acessório. Sem
 * elas a conta simplesmente não tem vencimento e nunca atrasa, que é o comportamento
 * de antes.
 */
let _temVencimento = null;
async function temColunasVencimento() {
  if (_temVencimento !== null) return _temVencimento;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'schs2vet'
          AND column_name  = 'tipo_vencimento'
          AND table_name  IN ('tb_fornecedores', 'tb_prestadores')`);
    _temVencimento = rows.length === 2;
  } catch { _temVencimento = false; }
  return _temVencimento;
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

/**
 * 🔴 DATA DE PAGAMENTO → TEXTO, NUNCA `Date` (achado rodando o código real contra a
 * base, 2026-09-22).
 *
 * `pago_em` é `timestamp WITHOUT time zone` e o Prisma o lê/escreve como UTC NAIVE.
 * Mandar um objeto `Date` como parâmetro faz o Postgres tratá-lo como `timestamptz` e
 * convertê-lo para o fuso da SESSÃO (America/Sao_Paulo nesta base): o dia **01/09**
 * escolhido na tela era gravado como 31/08 21:00 e voltava **31/08** para o
 * comprovante — um dia antes, sem erro e sem log. É a mesma armadilha do `NOW()` puro
 * documentada na §6, pelo outro lado.
 *
 * ⚠️ A data escolhida é um DIA DE CALENDÁRIO, não um instante: "YYYY-MM-DD" vira
 * meia-noite daquele dia, sem conversão nenhuma.
 * ⚠️ Sem data informada vale AGORA em UTC — o equivalente exato de
 * `NOW() AT TIME ZONE 'UTC'`, que é o que a coluna espera.
 */
function timestampNaive(valor) {
  const agora = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (valor === null || valor === undefined || valor === '') return agora();
  const txt = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return `${txt} 00:00:00`;
  const d = new Date(txt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

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
  permitirSemValor = false,
}) {
  if (!(await temTabelas())) return null;
  const v = cent(num(valor)) ?? 0;
  // 🔴 SEM VALOR: LANÇA ZERADO EM VEZ DE NÃO LANÇAR (a pedido, 2026-09-18), e SÓ com
  // `permitirSemValor`. A regra anterior era "dívida de valor inventado é pior que
  // dívida ausente" — ela continua certa quanto a INVENTAR, e é por isso que o valor
  // vai ZERO e não um palpite. O que mudou foi a outra metade: o procedimento sem
  // preço cadastrado simplesmente DESAPARECIA da tela de Pagamentos, e o financeiro
  // não tinha como saber que devia algo a alguém — o silêncio escondia a pendência
  // em vez de evitá-la. Zerado, ele aparece, fica visível como pendência e o valor é
  // editado ali mesmo (`atualizarValorItem`).
  // ⚠️ Sem a flag o comportamento é o de sempre (não lança): quem chama precisa
  // DECLARAR que aquele zero é uma pendência a resolver, não um item de graça.
  if (v <= 0 && !permitirSemValor) return null;

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
    // ⚠️ O filtro de STATUS é aplicado em JS, DEPOIS de derivar a ATRASADA — no SQL ele
    // devolveria a conta vencida sob o rótulo FECHADA, e o chip "Atrasada" da tela viria
    // sempre vazio enquanto o "Fechada" mostraria contas que já venceram.
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
    // O vencimento vem do CADASTRO do credor, resolvido no MESMO SELECT: uma consulta
    // por conta seria uma ida ao banco por linha da tela.
    // ⚠️ As duas tabelas são INDEPENDENTES e NÃO compartilham id (2026-08-21), por isso
    // o `JOIN` carrega o `c.tipo` na condição — sem ele, o fornecedor 7 casaria com o
    // prestador 7 e a conta herdaria o vencimento de quem não é o credor dela.
    const comVencimento = await temColunasVencimento();
    const colsVenc = comVencimento
      ? `, COALESCE(f.tipo_vencimento, p.tipo_vencimento) AS tipo_vencimento,
           COALESCE(f.dia_vencimento,  p.dia_vencimento)  AS dia_vencimento`
      : `, NULL::text AS tipo_vencimento, NULL::int AS dia_vencimento`;
    const joinVenc = comVencimento
      ? `LEFT JOIN schs2vet.tb_fornecedores f ON c.tipo = 'FORNECEDOR' AND f.id = c.credor_id
         LEFT JOIN schs2vet.tb_prestadores  p ON c.tipo = 'PRESTADOR'  AND p.id = c.credor_id`
      : '';
    const contas = await client.$queryRawUnsafe(
      `SELECT c.id, c.tipo, c.credor_id, c.credor_nome, c.mes_referencia, c.total,
              c.status, c.observacao, c.pago_em, c.created_at ${colsVenc}
         FROM schs2vet.tb_contas_pagar c
         ${joinVenc}
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
    const agora = new Date();
    const lista = contas.map((c) => {
      const vencimentoEm = calcularVencimento(
        { tipoVencimento: c.tipo_vencimento, diaVencimento: c.dia_vencimento },
        c.mes_referencia,
      );
      return {
        ...normalizarConta(c),
        vencimentoEm,
        // `status` continua sendo o GRAVADO; `statusExibicao` é o que a tela mostra e
        // filtra. Sobrescrever o primeiro esconderia de quem lê a resposta que ATRASADA
        // é derivada, e a próxima tela a consumir isto tentaria gravá-la.
        statusExibicao: statusExibicao(c.status, vencimentoEm, agora),
        itens: porConta.get(c.id) ?? [],
      };
    });
    if (status && STATUS_FILTRAVEIS.includes(status)) {
      return lista.filter(c => c.statusExibicao === status);
    }
    return lista;
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
async function alterarStatus(client, empresaId, contaId, status, usuarioId, pagoEm = null) {
  if (!STATUS_VALIDOS.includes(status)) {
    // ATRASADA cai aqui de propósito — ela é DERIVADA do vencimento (STATUS_FILTRAVEIS)
    // e gravá-la criaria um segundo dono da verdade.
    return { erro: 'Status inválido.' };
  }
  if (!(await temTabelas())) return { erro: 'Recurso ainda não disponível nesta base.' };
  // 🔴 A DATA DE PAGAMENTO É INFORMADA, não deduzida do relógio. O pagamento costuma
  // ser registrado no sistema DEPOIS de acontecer no banco, e carimbar `NOW()` jogaria
  // toda quitação para o dia da digitação — o comprovante diria uma data que não foi a
  // do pagamento. Sem informar, `NOW()` continua valendo (comportamento anterior).
  const quandoPagou = status === 'PAGA' ? timestampNaive(pagoEm) : null;
  if (status === 'PAGA' && quandoPagou === null) {
    return { erro: 'Data de pagamento inválida.' };
  }
  try {
    const rows = await client.$queryRawUnsafe(
      `UPDATE schs2vet.tb_contas_pagar
          SET status      = $3,
              pago_em     = CASE WHEN $3 = 'PAGA' THEN $5::timestamp ELSE NULL END,
              -- ::int obrigatório: sem ele o Postgres infere TEXT para o
              -- parâmetro nulo e recusa com 42804 (achado ao rodar o código real
              -- contra a base). O ::timestamp abaixo existe pela mesma razão.
              pago_por_id = CASE WHEN $3 = 'PAGA' THEN $4::int ELSE NULL END,
              updated_at  = NOW() AT TIME ZONE 'UTC'
        WHERE id = $1 AND empresa_id = $2
        RETURNING id, tipo, credor_id, credor_nome, mes_referencia, total, status,
                  observacao, pago_em, created_at`,
      Number(contaId), Number(empresaId), status, usuarioId ? Number(usuarioId) : null,
      quandoPagou,
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

/**
 * Edita o VALOR de um item já lançado — é o que torna útil o lançamento zerado.
 *
 * ⚠️ Só em conta ABERTA. Conta FECHADA/PAGA é documento que o credor já recebeu;
 * mudar o valor dela por aqui reescreveria o que foi combinado (mesma regra do item
 * de fatura paga). O `JOIN` com o status é quem garante isso — não o front.
 * ⚠️ Recalcula o total: sem isso o cabeçalho da conta continuaria com a soma antiga
 * e a tela mostraria dois números diferentes para a mesma dívida.
 */
async function atualizarValorItem(client, empresaId, itemId, valor) {
  if (!(await temTabelas())) return { erro: 'Recurso indisponível nesta base.' };
  const v = cent(num(valor));
  if (v == null || v < 0) return { erro: 'Informe um valor válido.' };
  try {
    const rows = await client.$queryRawUnsafe(
      `UPDATE schs2vet.tb_conta_pagar_itens i
          SET valor = $3
         FROM schs2vet.tb_contas_pagar c
        WHERE i.id = $1 AND i.conta_id = c.id
          AND c.empresa_id = $2
          -- REABERTA é editável como a ABERTA (só ela não é a conta CORRENTE). O
          -- literal c.status = 'ABERTA' é mantido, e não trocado por um IN, porque
          -- é ele que o gate estrutural procura.
          AND (c.status = 'ABERTA' OR c.status = 'REABERTA')
    RETURNING c.id AS conta_id`,
      Number(itemId), Number(empresaId), v,
    );
    if (rows.length === 0) {
      return { erro: 'Item não encontrado ou a conta não está aberta.' };
    }
    await recalcularTotal(client, rows[0].conta_id);
    return { contaId: rows[0].conta_id, valor: v };
  } catch (err) {
    console.error('contasPagar.atualizarValorItem:', err.message);
    return { erro: 'Erro ao atualizar o valor do item.' };
  }
}

module.exports = {
  atualizarValorItem,
  TIPOS,
  ORIGENS,
  STATUS_ABERTOS,
  STATUS_FECHADOS,
  STATUS_VALIDOS,
  STATUS_FILTRAVEIS,
  temColunasVencimento,
  timestampNaive,
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

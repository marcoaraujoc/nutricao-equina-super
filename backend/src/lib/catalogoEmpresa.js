// backend/src/lib/catalogoEmpresa.js
//
// 🔴 A TELA DE PRODUTOS PASSOU A EDITAR O ITEM DO CATÁLOGO (2026-09-15).
//
// O QUE MUDOU: `/cadastro/produtos` era o cadastro do VÍNCULO com o fornecedor (de
// quem a clínica compra, por quanto). A pedido, ela virou o cadastro do ITEM —
// medicamento e vacina com forma farmacêutica, apresentação, via, unidade, controlado
// e doses por embalagem. Fornecedor, nota fiscal, preços e entrada de estoque saíram:
// quem trata disso é a Farmácia / o Estoque de Vacinas.
//
// 🔴 COPY-ON-WRITE É A REGRA, e não um detalhe de implementação. `tb_medicamentos` é
// CATÁLOGO MISTO: `empresa_id` NULO = linha GLOBAL que TODA clínica lê e NENHUMA
// escreve. Editar a linha global mudaria a forma, a via e a cobrança do item para
// todas as clínicas do SaaS. Então:
//     item GLOBAL      → nasce a CÓPIA da empresa e é ela que recebe a alteração;
//     item da EMPRESA  → alterado no lugar;
//     item de OUTRA    → 404 (nunca os dados).
// É a mesma regra de `DocumentoTemplate` e de `lib/unidadeMedicamento.js` — e é dele
// que este módulo reaproveita a cópia e o reapontamento, para não haver duas
// implementações decidindo para onde o estoque e a prescrição pendente passam a
// apontar.
//
// ⚠️ O RLS é a rede por baixo: a policy de `tb_medicamentos` é ASSIMÉTRICA (`USING` lê
// global + próprio, `WITH CHECK` só aceita `empresa_id = app_empresa_id()`), então um
// UPDATE na linha global é RECUSADO pelo banco. O que a policy NÃO impede é setar
// `empresa_id` NA linha global — e é essa escrita que nunca acontece aqui.
//
// ⚠️ `empresaId` vem SEMPRE do contexto (`req.empresaId`), nunca do corpo: tenant
// vindo do cliente jamais define escopo.
'use strict';

const {
  copiaExistente, criarCopiaDaEmpresa, reapontarParaCopia,
  normalizarUnidade, mesmaUnidade, UnidadeIndisponivelError,
} = require('./unidadeMedicamento');
// FORMA DE CÁLCULO: em que o conteúdo da embalagem é medido (mL, g, doses…).
// Ver `lib/formaCalculo.js` — é ela que faz 5 mL saírem de um frasco de 20 mL em vez
// de debitarem cinco frascos.
const {
  normalizarFormaCalculo, numeroPositivo,
  unidadeOperativa, qtdPorEmbalagemDe,
} = require('./formaCalculo');

const texto = (v, max) => {
  const t = String(v ?? '').trim();
  return t === '' ? null : t.slice(0, max);
};

// ⚠️ NÃO trunca mais para inteiro: `doses_por_embalagem` passou a ser o CONTEÚDO da
// embalagem (20 mL, 2,5 mL) e virou `double precision` na migration 20261012000000.
// Truncar aqui perderia a fração em silêncio — e é ela que divide o preço da dose.

/**
 * `classificacao` carrega o recorte "é vacina?" (`contains 'vacin'`) — é ele que
 * separa a Farmácia do Estoque de Vacinas e recorta os seletores do atendimento.
 * Item que a clínica cadastra como vacina tem de nascer do lado certo.
 */
const CLASSIFICACAO_VACINA = 'Vacina';

/**
 * 🔴 NÃO-VACINA NUNCA NASCE COM `classificacao` NULA.
 *
 * O recorte de "não é vacina" é `NOT: { classificacao: { contains: 'vacin' } }`, e em
 * SQL o NOT sobre NULL não é verdadeiro: a linha com classificação NULA fica FORA do
 * filtro. Medido nesta base: `NOT (classificacao ILIKE '%vacin%')` devolve 7.796
 * linhas; com `IS NULL OR NOT (...)`, 7.827 — as 31 de diferença são exatamente as
 * de classificação nula, e elas são INVISÍVEIS na busca da Prescrição, na lista da
 * Farmácia e na aba Medicamentos desta própria tela.
 *
 * É o MESMO precedente de `lib/catalogoManual.js#garantirMedicamentoDaEmpresa`, que
 * carimba este valor pela mesma razão — e o valor tem de ser IDÊNTICO ao dele, senão
 * o item nasceria com uma origem diferente conforme a tela que o criou.
 */
const CLASSIFICACAO_MEDICAMENTO = 'Cadastrado na clínica';

function ehVacinaPelaClassificacao(c) {
  return /vacin/i.test(String(c ?? ''));
}

/**
 * As colunas de MULTIDOSE do item (migration 20261009000000) vão por SQL CRU.
 *
 * ⚠️ Motivo de sempre (§11): no Windows o `prisma generate` falha com o backend
 * rodando, e um `data:` tipado com coluna desconhecida derrubaria o CADASTRO INTEIRO
 * de produto. Assim o pior caso é a marcação não persistir — e `false` é o
 * comportamento anterior.
 */
let _temMultidose = null;
async function temColunasMultidose(client) {
  if (_temMultidose !== null) return _temMultidose;
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_medicamentos'
          AND column_name = 'doses_por_embalagem' LIMIT 1`);
    _temMultidose = rows.length > 0;
  } catch { _temMultidose = false; }
  return _temMultidose;
}

/** A coluna `forma_calculo` existe? (migration 20261012000000) — detectada à parte
 *  porque uma base pode ter a de multidose e não ter esta. */
let _temForma = null;
async function temColunaFormaCalculo(client) {
  if (_temForma !== null) return _temForma;
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_medicamentos'
          AND column_name = 'forma_calculo' LIMIT 1`);
    _temForma = rows.length > 0;
  } catch { _temForma = false; }
  return _temForma;
}

async function gravarMultidose(client, medicamentoId, { multidose, dosesPorEmbalagem, formaCalculo }) {
  if (multidose === undefined && dosesPorEmbalagem === undefined && formaCalculo === undefined) return;
  if (!(await temColunasMultidose(client))) return;
  const temForma = await temColunaFormaCalculo(client);

  // 🔴 ESTADO ANTES DA GRAVAÇÃO — necessário para `reconverterEstoqueAtivo` saber
  // qual era a unidade operativa ANTIGA do item (ver o comentário da função). Sem
  // isto, a única forma de comparar seria confiar num "antes" implícito que o
  // chamador nem sempre tem (o cadastro rápido do atendimento, por exemplo, só
  // conhece os campos do FORMULÁRIO, nunca o que já estava gravado).
  const antesRows = await client.$queryRawUnsafe(
    temForma
      ? `SELECT multidose, doses_por_embalagem AS "dosesPorEmbalagem",
                forma_calculo AS "formaCalculo", unidade, empresa_id AS "empresaId"
           FROM schs2vet.tb_medicamentos WHERE id = $1`
      : `SELECT multidose, doses_por_embalagem AS "dosesPorEmbalagem", unidade,
                empresa_id AS "empresaId"
           FROM schs2vet.tb_medicamentos WHERE id = $1`,
    Number(medicamentoId),
  ).catch(() => []);
  const antes = antesRows[0] ?? null;

  // 🔴 DESMARCAR LIMPA A FORMA, MAS NÃO MAIS O NÚMERO (2026-09-19). O número passou a
  // ter significado nos DOIS estados, e são significados diferentes:
  //
  //   multidose ON  → quanto a embalagem contém NA FORMA DE CÁLCULO (20 mL). É a chave
  //                   do multidose: muda a unidade operativa, o estoque passa a ser
  //                   contado em mL e a cobrança é proporcional ao prescrito.
  //   multidose OFF → quanto a embalagem contém NA UNIDADE DO PRODUTO (100 mL). NÃO
  //                   muda unidade nenhuma — o estoque segue em 'Un.' — e responde uma
  //                   pergunta só: quantas embalagens o curso gasta (125 mL de um
  //                   frasco de 100 são DOIS). Ver `lib/formaCalculo.conteudoDaEmbalagem`.
  //
  // ⚠️ A razão de limpar (o item "voltar a ser multidose sozinho") continua coberta, e
  // por quem sempre a cobriu: `qtdPorEmbalagemDe` exige `multidose === true`, então o
  // número sozinho nunca reativa a divisão do preço. Quem precisa sumir é a FORMA — ela
  // é que, ao lado do número, faz `unidadeOperativa` devolver mL no lugar de 'Un.'.
  // ⚠️ Quem TROCA o estado limpa o número na TELA (`FormProduto.trocarMultidose`): ele
  // estava expresso na outra unidade, e reaproveitá-lo afirmaria um conteúdo que
  // ninguém declarou.
  const marcado = multidose === true;
  const qtd     = numeroPositivo(dosesPorEmbalagem);
  const forma   = marcado ? normalizarFormaCalculo(formaCalculo) : null;
  await client.$executeRawUnsafe(
    temForma
      ? `UPDATE schs2vet.tb_medicamentos
            SET multidose = $2, doses_por_embalagem = $3, forma_calculo = $4
          WHERE id = $1`
      : `UPDATE schs2vet.tb_medicamentos
            SET multidose = $2, doses_por_embalagem = $3
          WHERE id = $1`,
    ...(temForma
      ? [Number(medicamentoId), marcado, qtd, forma]
      : [Number(medicamentoId), marcado, qtd]),
  ).catch(() => {});

  // 🔴 RECONVERTE O ESTOQUE ATIVO — fora do `.catch` acima: se isto falhar, a
  // transação inteira do controller precisa reverter (nunca deixar a marcação nova
  // gravada com o estoque na interpretação antiga). Sem `antes` (coluna ausente ou
  // item inexistente) não há o que comparar.
  // ⚠️ `antes.empresaId == null` = item GLOBAL: por construção, `salvarItemDoCatalogo`
  // nunca chama `gravarMultidose` sobre um id global (o copy-on-write sempre resolve
  // para a cópia da empresa antes) — mas a checagem AQUI é o que faz essa garantia não
  // depender só da disciplina de quem chama. Reconverter um item global bagunçaria o
  // estoque de TODAS as clínicas que o têm em estoque de uma vez só.
  if (antes && antes.empresaId != null) {
    await reconverterEstoqueAtivo(
      client,
      medicamentoId,
      {
        multidose: antes.multidose === true,
        dosesPorEmbalagem: antes.dosesPorEmbalagem != null ? Number(antes.dosesPorEmbalagem) : null,
        formaCalculo: antes.formaCalculo ?? null,
        unidade: antes.unidade,
      },
      { multidose: marcado, dosesPorEmbalagem: qtd, formaCalculo: forma, unidade: antes.unidade },
      antes.empresaId,
    );
  }
}

/**
 * 🔴 RECONVERTE O ESTOQUE ATIVO quando editar o produto muda a UNIDADE OPERATIVA —
 * multidose ligado/desligado, ou o conteúdo da embalagem alterado (2026-09-29).
 *
 * `EstoqueClinica.qtdEstoque` é lido em runtime na unidade operativa ATUAL do
 * catálogo (`lib/formaCalculo.js#unidadeOperativa`), nunca na que valia quando a
 * entrada foi gravada — é assim que a prescrição e a Farmácia sempre souberam ler o
 * saldo certo sem reler a entrada inteira. Sem reconverter aqui, o MESMO número
 * passa a SIGNIFICAR outra coisa: 3 frascos de 20 mL (`qtdEstoque = 60`, unidade
 * 'mL') viram "60 unidades" — 60 FRASCOS — assim que o multidose é desligado, e o
 * preço, que era R$/mL, passa a ser lido como R$/Un. É a MESMA conta que os
 * backfills de 2026-09-17/19 (`20261013000000`/`20261014000000`) fizeram uma única
 * vez para consertar dado legado — só que agora ela roda a cada edição do produto,
 * não apenas naquele dia.
 *
 * A quantidade FÍSICA de embalagens é preservada: `qtdEstoque ÷ renderAntes` dá o
 * número de embalagens abertas (com fração — 2,5 frascos abertos não viram 2 nem 3,
 * mesma regra do backfill), e `× renderDepois` reexpressa esse mesmo físico na
 * unidade NOVA. `pesoPorEmbalagem` é regravado com o conteúdo novo — o que uma
 * entrada criada agora traria — e `precoUnitarioBase` é recalculado pela MESMA
 * função que a entrada de estoque usa (`calcPrecoUnitarioBase`), nunca dividido
 * pelo saldo, que é o que faz o preço subir a cada dose aplicada.
 *
 * ⚠️ **O "conteúdo" aqui é SEMPRE `qtdPorEmbalagemDe` — o do MULTIDOSE — nunca
 * `conteudoDaEmbalagem` (o do não-multidose).** Este último, por desenho
 * (`lib/formaCalculo.js`), NÃO muda a unidade em que o estoque é contado — o
 * não-multidose está SEMPRE em 'Un.', declare ele conteúdo ou não; o conteúdo ali
 * serve só para o cálculo de "quantas embalagens o curso gasta" na prescrição,
 * lido direto do catálogo em cada uso. Misturar os dois faria uma alteração no
 * "Conteúdo da embalagem" de um produto NÃO-multidose reconverter o estoque como
 * se ele tivesse virado multidose — e `unidadeOperativa` (a mesma fonte que a
 * prescrição e a Farmácia leem) concorda: só reage a `qtdPorEmbalagemDe`.
 * ⚠️ `tb_movimentos_estoque` NÃO é tocado — ele registra o que aconteceu, na
 * unidade em que aconteceu (mesma decisão do backfill).
 * ⚠️ Só entradas ATIVAS: a inativa é histórico na unidade em que foi encerrada,
 * mesma decisão de `reapontarParaCopia` (lib/unidadeMedicamento.js).
 * ⚠️ Roda DENTRO da mesma transaction do chamador e propaga erro — reconversão
 * parcial é pior que a edição do produto falhar inteira.
 *
 * 🔴 `empresaId` é OBRIGATÓRIO e ENTRA NO FILTRO — `tb_estoque_clinica` ainda está em
 * AGUARDANDO_RLS (sem policy de banco; ver `__tests__/tenancyRls.test.js`), então este
 * `where` é a ÚNICA barreira entre o estoque de uma empresa e o de outra. Sem ele, um
 * `medicamentoId` que por engano deixasse de ser exclusivo de uma empresa (item
 * GLOBAL, ou um bug num chamador futuro) reconverteria — e RECALCULARIA O PREÇO — do
 * estoque de TODAS as clínicas que o têm, numa chamada só. `medicamentoId` sozinho
 * não é garantia: é o filtro por empresa que faz.
 */
async function reconverterEstoqueAtivo(tx, medicamentoId, produtoAntes, produtoDepois, empresaId) {
  if (empresaId == null) {
    throw new Error('reconverterEstoqueAtivo: empresaId é obrigatório (nunca reconverte item global).');
  }
  const unidadeAntes   = unidadeOperativa(produtoAntes);
  const unidadeDepois  = unidadeOperativa(produtoDepois);
  const conteudoAntes  = qtdPorEmbalagemDe(produtoAntes);
  const conteudoDepois = qtdPorEmbalagemDe(produtoDepois);
  if (unidadeAntes === unidadeDepois && conteudoAntes === conteudoDepois) return;

  const entradas = await tx.estoqueClinica.findMany({
    where: { medicamentoId: Number(medicamentoId), empresaId: Number(empresaId), ativo: true },
  });
  if (entradas.length === 0) return;

  const renderAntes  = numeroPositivo(conteudoAntes)  ?? 1;
  const renderDepois = numeroPositivo(conteudoDepois) ?? 1;
  // require TARDIO: EstoqueController já importa este módulo no topo — um require
  // no topo daqui fecharia o ciclo com o export ainda incompleto (§11-adjacente).
  const { calcPrecoUnitarioBase } = require('../controllers/EstoqueController');

  for (const e of entradas) {
    const fisico    = Number(e.qtdEstoque) / renderAntes;
    const novoPreco = calcPrecoUnitarioBase(Number(e.valorRepassado), renderDepois, unidadeDepois);
    await tx.estoqueClinica.update({
      where: { id: e.id },
      data: {
        qtdEstoque:       fisico * renderDepois,
        estoqueMinimo:    (Number(e.estoqueMinimo)    / renderAntes) * renderDepois,
        estoqueAlarmante: (Number(e.estoqueAlarmante)  / renderAntes) * renderDepois,
        pesoPorEmbalagem: numeroPositivo(conteudoDepois),
        ...(novoPreco !== null ? { precoUnitarioBase: novoPreco } : {}),
      },
    });
  }
}

/** Lê multidose de VÁRIOS itens de uma vez (a lista da tela). */
async function multidosePorItem(client, ids) {
  const lista = [...new Set((ids ?? []).map(Number).filter(Number.isInteger))];
  const vazio = new Map();
  if (lista.length === 0) return vazio;
  if (!(await temColunasMultidose(client))) return vazio;
  try {
    const temForma = await temColunaFormaCalculo(client);
    const ph = lista.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      // ⚠️ `unidade` entra porque `formaCalculo.unidadeOperativa` precisa dela para o
      // LEGADO "multidose com quantidade e sem forma" — ali o estoque foi contado no
      // CONTEÚDO, e a unidade do catálogo é o que o descreve.
      `SELECT id, multidose, doses_por_embalagem, unidade${temForma ? ', forma_calculo' : ''}
         FROM schs2vet.tb_medicamentos WHERE id IN (${ph})`, ...lista);
    const mapa = new Map();
    for (const r of rows) {
      mapa.set(Number(r.id), {
        multidose: r.multidose === true,
        dosesPorEmbalagem: r.doses_por_embalagem != null ? Number(r.doses_por_embalagem) : null,
        formaCalculo: normalizarFormaCalculo(r.forma_calculo),
        unidade: r.unidade ?? null,
      });
    }
    return mapa;
  } catch { return vazio; }
}

/** Substitui as vias do item pelas informadas. `undefined` não toca em nada. */
async function sincronizarVias(tx, medicamentoId, vias) {
  if (vias === undefined) return;
  const lista = [...new Set(
    (Array.isArray(vias) ? vias : []).map(v => String(v ?? '').trim()).filter(Boolean),
  )];
  // Apaga e recria: é o único jeito de REMOVER uma via que saiu da escolha —
  // `createMany({ skipDuplicates })` só sabe acrescentar.
  await tx.medicamentoVia.deleteMany({ where: { medicamentoId: Number(medicamentoId) } });
  if (lista.length > 0) {
    await tx.medicamentoVia.createMany({
      data: lista.map(via => ({ medicamentoId: Number(medicamentoId), via })),
      skipDuplicates: true,
    });
  }
}

/** Vincula as espécies informadas, sem remover as que já existem. */
async function garantirEspecies(tx, medicamentoId, especieIds) {
  const ids = [...new Set((especieIds ?? []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return;
  await tx.medicamentoEspecie.createMany({
    data: ids.map(especieId => ({ medicamentoId: Number(medicamentoId), especieId })),
    skipDuplicates: true,
  });
}

/**
 * Cria ou ALTERA um item do catálogo DA EMPRESA, com copy-on-write.
 *
 * @param {object} tx        client Prisma (use o `tx` da transaction do controller)
 * @param {object} args
 * @param {number|null} args.medicamentoId  item que está sendo editado (null = novo)
 * @param {number} args.empresaId           SEMPRE do contexto
 * @param {boolean} args.vacina             o item é vacina?
 * @param {object} args.dados               campos do formulário
 * @param {number[]} [args.especieIds]      espécies a vincular no item NOVO/cópia
 * @returns {Promise<{id:number, copiado:boolean, criado:boolean}>}
 *   ⚠️ Quem chama ADOTA o `id` devolvido: numa cópia ele é DIFERENTE do enviado, e
 *   continuar usando o antigo faria a tela reeditar o global na gravação seguinte.
 * @throws {UnidadeIndisponivelError}
 */
async function salvarItemDoCatalogo(tx, { medicamentoId, empresaId, vacina = false, dados = {}, especieIds = [] }) {
  if (!empresaId) {
    throw new UnidadeIndisponivelError('SEM_EMPRESA', 400,
      'Sem empresa ativa no contexto: não é possível cadastrar o produto.');
  }
  const empresa = Number(empresaId);

  const campos = {
    nome:              texto(dados.nome, 90),
    formaFarmaceutica: texto(dados.formaFarmaceutica, 255),
    unidade:           normalizarUnidade(dados.unidade),
    apresentacao:      texto(dados.apresentacao, 255),
    fabricante:        texto(dados.fabricante, 150),
    controlado:        dados.controlado === true || dados.controlado === 'true',
  };

  // ── Item NOVO ───────────────────────────────────────────────────────────────
  if (!medicamentoId) {
    // Reaproveita o item da PRÓPRIA empresa com o mesmo nome — é o que impede o
    // catálogo dela encher de linhas iguais quando o mesmo produto é cadastrado
    // duas vezes (mesma chave de `garantirMedicamentoDaEmpresa`: nome + empresa).
    const ja = await copiaExistente(tx, campos.nome ?? '', empresa);
    if (ja) {
      const atualizado = await aplicarCampos(tx, ja.id, campos, vacina, dados, { reativar: true });
      await sincronizarVias(tx, ja.id, dados.vias);
      await garantirEspecies(tx, ja.id, especieIds);
      return { id: atualizado, copiado: false, criado: false };
    }
    const criado = await tx.medicamento.create({
      data: {
        nome:              campos.nome ?? '',
        formaFarmaceutica: campos.formaFarmaceutica ?? '',
        unidade:           campos.unidade ?? '',
        apresentacao:      campos.apresentacao ?? '',
        classificacao:     vacina ? CLASSIFICACAO_VACINA : CLASSIFICACAO_MEDICAMENTO,
        fabricante:        campos.fabricante,
        controlado:        campos.controlado,
        empresaId:         empresa,
        ativo:             true,
      },
      select: { id: true },
    });
    await gravarMultidose(tx, criado.id, dados);
    await sincronizarVias(tx, criado.id, dados.vias);
    await garantirEspecies(tx, criado.id, especieIds);
    return { id: criado.id, copiado: false, criado: true };
  }

  // ── Item EXISTENTE ──────────────────────────────────────────────────────────
  const id  = Number(medicamentoId);
  const med = await tx.medicamento.findUnique({
    where:  { id },
    select: {
      id: true, nome: true, unidade: true, empresaId: true, formaFarmaceutica: true,
      apresentacao: true, classificacao: true, fabricante: true, controlado: true,
    },
  });
  if (!med) throw new UnidadeIndisponivelError('MEDICAMENTO_NAO_ENCONTRADO', 404, 'Item não encontrado no catálogo.');
  // Item PRIVADO de outra clínica. O RLS já o esconderia (o findUnique voltaria
  // null); o guard existe para o ADMIN de plataforma, que não passa por ele.
  if (med.empresaId != null && Number(med.empresaId) !== empresa) {
    throw new UnidadeIndisponivelError('MEDICAMENTO_DE_OUTRA_EMPRESA', 404, 'Item não encontrado no catálogo.');
  }

  // 🔴 A UNIDADE é a única alteração com GUARD, e o motivo não é burocrático:
  // `EstoqueClinica.qtdEstoque` está expresso na unidade ANTIGA, e trocá-la com
  // saldo gravado transformaria 5.000 g em "5.000 Un.". Vale só quando a unidade
  // MUDA de verdade — abrir e salvar sem mexer nela nunca é recusado.
  const trocouUnidade = !!campos.unidade && !mesmaUnidade(med.unidade, campos.unidade);
  if (trocouUnidade) await guardsDeUnidade(tx, med, empresa);

  // Já é da empresa: altera no lugar.
  if (med.empresaId != null) {
    await aplicarCampos(tx, med.id, campos, vacina, dados);
    await sincronizarVias(tx, med.id, dados.vias);
    await garantirEspecies(tx, med.id, especieIds);
    return { id: med.id, copiado: false, criado: false };
  }

  // GLOBAL: copy-on-write.
  const ja = await copiaExistente(tx, med.nome, empresa);
  let novoId;
  if (ja) {
    // Cópia anterior da mesma empresa (editou, voltou, editou de novo) — reaproveita
    // e REATIVA: cópia inativa reaproveitada sem isso ficaria fora de toda busca, e o
    // estoque reapontado para ela desapareceria da tela.
    novoId = ja.id;
    await aplicarCampos(tx, novoId, campos, vacina, dados, { reativar: true });
  } else {
    novoId = await criarCopiaDaEmpresa(tx, med, campos.unidade ?? med.unidade, empresa);
    await aplicarCampos(tx, novoId, campos, vacina, dados);
  }
  await sincronizarVias(tx, novoId, dados.vias);
  await garantirEspecies(tx, novoId, especieIds);
  // Reaponta o que a EMPRESA tem no item antigo — estoque ativo, prescrição pendente
  // e produto de fornecedor. Sem isso a baixa da dose procuraria o estoque pelo
  // medicamento antigo, não acharia, e a dose sairia SEM baixa e SEM linha na fatura.
  await reapontarParaCopia(tx, med.id, novoId, empresa);
  return { id: novoId, copiado: true, criado: false };
}

/** Grava os campos escalares + a classificação (vacina × medicamento) + multidose. */
async function aplicarCampos(tx, id, campos, vacina, dados, { reativar = false } = {}) {
  const atual = await tx.medicamento.findUnique({
    where: { id: Number(id) }, select: { classificacao: true },
  });
  const data = {};
  for (const [k, v] of Object.entries(campos)) {
    if (v === null && k !== 'fabricante') continue;   // não apaga com vazio
    data[k] = v;
  }
  data.controlado = campos.controlado;
  // A classificação só é reescrita quando o LADO muda (medicamento ↔ vacina): o
  // catálogo global traz classificações descritivas ("Vacina viral inativada") que
  // não devem virar o genérico "Vacina" por uma edição que nem tocou nisso.
  if (ehVacinaPelaClassificacao(atual?.classificacao) !== !!vacina) {
    data.classificacao = vacina ? CLASSIFICACAO_VACINA : CLASSIFICACAO_MEDICAMENTO;
  }
  // Item legado com classificação NULA é consertado ao ser salvo: ele está hoje FORA
  // do filtro de "não é vacina" e some das telas sem que nada acuse.
  if (!vacina && atual?.classificacao == null) data.classificacao = CLASSIFICACAO_MEDICAMENTO;
  if (reativar) data.ativo = true;
  await tx.medicamento.update({ where: { id: Number(id) }, data });
  await gravarMultidose(tx, id, dados);
  return Number(id);
}

/** Os dois guards da troca de unidade — extraídos de `definirUnidadeDoMedicamento`. */
async function guardsDeUnidade(tx, med, empresa) {
  const entradas = await tx.estoqueClinica.count({
    where: { medicamentoId: med.id, empresaId: empresa, ativo: true },
  });
  if (entradas > 0) {
    const uma = entradas === 1;
    throw new UnidadeIndisponivelError('OUTRAS_ENTRADAS_DE_ESTOQUE', 400,
      `Este item tem ${uma ? 'uma entrada' : `${entradas} entradas`} de estoque ativa${uma ? '' : 's'} `
      + `com a quantidade na unidade atual (${med.unidade}). Inative-a${uma ? '' : 's'} antes de trocar a unidade.`);
  }
  const saidas = await tx.movimentoEstoque.count({
    where: { tipo: 'SAIDA', estoque: { medicamentoId: med.id, empresaId: empresa } },
  });
  if (saidas > 0) {
    throw new UnidadeIndisponivelError('ESTOQUE_JA_MOVIMENTADO', 400,
      `Este item já teve saída de estoque na unidade atual (${med.unidade}) — a unidade não pode ser alterada.`);
  }
}

module.exports = {
  salvarItemDoCatalogo,
  CLASSIFICACAO_MEDICAMENTO,
  multidosePorItem,
  temColunasMultidose,
  temColunaFormaCalculo,
  ehVacinaPelaClassificacao,
  CLASSIFICACAO_VACINA,
  gravarMultidose,
  reconverterEstoqueAtivo,
};

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
const { normalizarFormaCalculo, numeroPositivo } = require('./formaCalculo');

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
  // Desmarcar LIMPA número E forma: deixá-los faria o item voltar a ser multidose na
  // gravação seguinte sem ninguém ter pedido — e com ele volta a divisão do preço.
  const marcado = multidose === true;
  const qtd     = marcado ? numeroPositivo(dosesPorEmbalagem) : null;
  const forma   = marcado ? normalizarFormaCalculo(formaCalculo) : null;
  const temForma = await temColunaFormaCalculo(client);
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
      `SELECT id, multidose, doses_por_embalagem${temForma ? ', forma_calculo' : ''}
         FROM schs2vet.tb_medicamentos WHERE id IN (${ph})`, ...lista);
    const mapa = new Map();
    for (const r of rows) {
      mapa.set(Number(r.id), {
        multidose: r.multidose === true,
        dosesPorEmbalagem: r.doses_por_embalagem != null ? Number(r.doses_por_embalagem) : null,
        formaCalculo: normalizarFormaCalculo(r.forma_calculo),
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
};

// backend/src/lib/unidadeMedicamento.js
//
// 🔴 A UNIDADE DO MEDICAMENTO PASSOU A SER ESCOLHIDA PELA CLÍNICA (2026-09-12).
//
// POR QUE EXISTE: `Medicamento.unidade` vem do CATÁLOGO GLOBAL (mantido pelo ADMIN) e
// quase sempre é de PESO/VOLUME ('g', 'mg', 'ml'). A clínica, porém, compra e consome o
// item em EMBALAGENS (frasco, comprimido, ampola) — e era a unidade do catálogo que
// governava tudo a jusante:
//   • `EstoqueClinica.qtdEstoque` (nº de embalagens × peso por embalagem → 5.000 g);
//   • `precoUnitarioBase` (R$/g), que é o preço que vai para a FATURA do cliente.
// Resultado relatado: estoque e fatura saíam "em gramas" onde a clínica conta unidades.
//
// 🔴 ALTERAR A UNIDADE NÃO PODE TOCAR O CATÁLOGO GLOBAL. `tb_medicamentos` é CATÁLOGO
// MISTO (`empresa_id` NULO = linha global que TODA clínica lê e NENHUMA escreve), então
// mudar a unidade de uma linha global mudaria a unidade — e o preço — de todas as outras
// clínicas do SaaS. Por isso a regra é COPY-ON-WRITE, a mesma de `DocumentoTemplate`:
// medicamento GLOBAL vira uma CÓPIA da empresa, e é a cópia que recebe a unidade nova.
// Medicamento que já é da empresa é alterado no lugar.
// ⚠️ O RLS é a rede por baixo disso, não uma formalidade: a policy de `tb_medicamentos`
// é ASSIMÉTRICA (`USING` lê global + próprio, `WITH CHECK` só aceita
// `empresa_id = app_empresa_id()`), então um UPDATE na linha global seria RECUSADO pelo
// banco. O que a policy NÃO impede é o pior caso — um UPDATE que setasse
// `empresa_id = <minha empresa>` na linha global passaria pelo `WITH CHECK` e ROUBARIA
// para uma clínica o medicamento que é de todas. É essa escrita que nunca acontece aqui.
//
// ⚠️ QUEM USA ISTO PASSA `empresaId` DO CONTEXTO (`req.empresaId`), nunca do corpo da
// requisição — tenant vindo do cliente jamais define escopo.
'use strict';

/**
 * Unidade oferecida quando o catálogo da empresa não tem nenhuma equivalente a "avulsa".
 *
 * ⚠️ NÃO é uma lista fixa de unidades: o seletor da tela continua saindo do CATÁLOGO
 * (`/medicamentos/opcoes-catalogo`), e esta constante só ENTRA quando falta. Uma lista
 * fixa no código divergiria do banco no primeiro item novo — é a mesma razão pela qual
 * `opcoesCatalogo` nasceu lendo o catálogo em vez de trazer constantes.
 */
const UNIDADE_AVULSA = 'Un.';

/** "un", "Un", "UN.", "unidade" — todas dizem a mesma coisa. */
const RE_AVULSA = /^(un\.?|unid\.?|unidade)$/i;

/** Texto limpo e no teto da coluna (`VarChar(100)`). Vazio devolve null. */
function normalizarUnidade(u) {
  const t = String(u ?? '').trim().slice(0, 100);
  return t === '' ? null : t;
}

/**
 * Duas grafias da MESMA unidade ('kg' × 'Kg', 'un' × 'Un.').
 *
 * 🔴 É o que impede a cópia nascer por nada: sem isso, abrir e salvar a tela sem mexer
 * em nada criaria uma cópia da empresa a cada gravação, porque o `<select>` devolve a
 * grafia da opção e o catálogo pode ter a outra.
 */
function mesmaUnidade(a, b) {
  const x = String(a ?? '').trim().toLocaleLowerCase('pt-BR');
  const y = String(b ?? '').trim().toLocaleLowerCase('pt-BR');
  if (x === y) return true;
  return RE_AVULSA.test(x) && RE_AVULSA.test(y);
}

/**
 * Garante a opção "avulsa" na lista do seletor — o pedido "caso não tenha, coloque a
 * opção Un.".
 *
 * ⚠️ Só ACRESCENTA quando NENHUMA das existentes já significa isso. Com 'un' no
 * catálogo, somar 'Un.' criaria DUAS opções para a mesma unidade — exatamente a
 * duplicata que `dedupPorCaixa` existe para resolver, e cada cadastro passaria a
 * escolher uma das duas grafias ao acaso.
 *
 * @param {string[]} unidades  saída de `dedupPorCaixa`
 * @returns {string[]}
 */
function garantirUnidadeAvulsa(unidades) {
  const lista = Array.isArray(unidades) ? unidades : [];
  if (lista.some((u) => RE_AVULSA.test(String(u ?? '').trim()))) return lista;
  return [...lista, UNIDADE_AVULSA].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

/** Erro de regra de negócio, com o status HTTP que o controller deve responder. */
class UnidadeIndisponivelError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name   = 'UnidadeIndisponivelError';
    this.code   = code;
    this.status = status;
  }
}

/**
 * Uma linha do catálogo da empresa com o mesmo nome do medicamento informado.
 *
 * Serve à IDEMPOTÊNCIA: mudar a unidade duas vezes (ou mudar e voltar) não pode
 * empilhar cópias do mesmo medicamento no catálogo da clínica. O critério é o MESMO
 * que `garantirMedicamentoDaEmpresa` já usa como chave — nome + empresa, sem
 * diferenciar maiúsculas.
 */
async function copiaExistente(tx, nome, empresaId) {
  return tx.medicamento.findFirst({
    where: {
      nome:      { equals: nome, mode: 'insensitive' },
      empresaId: Number(empresaId),
    },
    select: { id: true, ativo: true },
  });
}

/** Cria a cópia da empresa a partir da linha global, já com a unidade nova. */
async function criarCopiaDaEmpresa(tx, med, unidade, empresaId) {
  const copia = await tx.medicamento.create({
    data: {
      nome:              med.nome,
      formaFarmaceutica: med.formaFarmaceutica,
      unidade,
      apresentacao:      med.apresentacao,
      // A classificação carrega o recorte "é vacina?" (`contains 'vacin'`) que separa a
      // Farmácia do Estoque de Vacinas — copiar o valor mantém o item do mesmo lado.
      classificacao:     med.classificacao,
      fabricante:        med.fabricante,
      controlado:        med.controlado,
      empresaId:         Number(empresaId),
      ativo:             true,
    },
    select: { id: true },
  });

  // Vias e espécies vêm JUNTO, e não por conveniência: sem o vínculo de ESPÉCIE o
  // medicamento nasce INVISÍVEL na busca do atendimento (`paraAtendimento` filtra por
  // `especies.some`) e no filtro `especieDaEmpresa` da Farmácia — a clínica trocaria a
  // unidade e o item desapareceria das telas, sem erro nenhum.
  const [vias, especies] = await Promise.all([
    tx.medicamentoVia.findMany({ where: { medicamentoId: med.id }, select: { via: true } }),
    tx.medicamentoEspecie.findMany({ where: { medicamentoId: med.id }, select: { especieId: true } }),
  ]);

  if (vias.length > 0) {
    await tx.medicamentoVia.createMany({
      data: vias.map((v) => ({ medicamentoId: copia.id, via: v.via })),
      skipDuplicates: true,
    });
  }
  if (especies.length > 0) {
    await tx.medicamentoEspecie.createMany({
      data: especies.map((e) => ({ medicamentoId: copia.id, especieId: e.especieId })),
      skipDuplicates: true,
    });
  }

  return copia.id;
}

/**
 * Reaponta o que a EMPRESA tem apontado para o medicamento antigo.
 *
 * ⚠️ SÓ O QUE É DA EMPRESA. Cada `updateMany` leva o `empresaId` no `where` — o RLS já
 * recusaria linha de outra clínica, mas depender só dele deixaria a intenção implícita
 * num `updateMany` que parece global.
 *
 * ⚠️ ESTOQUE: apenas as entradas ATIVAS. A entrada INATIVA é histórico com a quantidade
 * expressa na unidade ANTIGA (5.000 g); arrastá-la para a unidade nova reescreveria o
 * que aquele registro afirma.
 *
 * ⚠️ PRESCRIÇÃO: apenas o item de grupo AINDA NÃO EXECUTADO. É necessário, não
 * cosmético — `consumirReservas`/`debitarEstoqueDia` acham o estoque por
 * `medicamentoId: item.medicamentoCatId`; deixando o item apontado para o medicamento
 * antigo enquanto o estoque foi para a cópia, o `findFirst` devolve null, o
 * `if (!estoque) continue` engole o caso e a dose é executada SEM baixa de estoque e
 * SEM linha na fatura — falha silenciosa, o pior resultado possível. Grupo já
 * EXECUTADO/CANCELADO fica intocado: é histórico.
 */
async function reapontarParaCopia(tx, deId, paraId, empresaId) {
  const empresa = Number(empresaId);

  await tx.estoqueClinica.updateMany({
    where: { medicamentoId: deId, empresaId: empresa, ativo: true },
    data:  { medicamentoId: paraId },
  });

  await tx.prescricao.updateMany({
    where: {
      medicamentoCatId: deId,
      ativo:            true,
      grupo:            { empresaId: empresa, status: { in: ['SALVO', 'FINALIZADO'] } },
    },
    data: { medicamentoCatId: paraId },
  });

  // PRODUTO DE FORNECEDOR (o item que a clínica não estoca e pede ao fornecedor) —
  // tabela da migration 20261006000000, que o client pode não conhecer (§11). O
  // `catch` mantém a troca de unidade funcionando numa base sem ela; o pior caso é o
  // vínculo com o fornecedor continuar no medicamento antigo.
  await tx.$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_produtos_fornecedor"
        SET "medicamento_id" = $1
      WHERE "medicamento_id" = $2 AND "empresa_id" = $3`,
    paraId, deId, empresa,
  ).catch(() => {});
}

/**
 * Define a UNIDADE do medicamento para a empresa do contexto e devolve o id a usar.
 *
 * @param {object} tx                 client Prisma — passe o `tx` da transaction do estoque
 * @param {object} args
 * @param {number} args.medicamentoId
 * @param {string} args.unidade
 * @param {number|null} args.empresaId           SEMPRE do contexto (`req.empresaId`)
 * @param {number|null} [args.ignorarEstoqueId]  entrada de estoque que está sendo salva
 *   agora (ela não conta como "outra entrada" no guard abaixo)
 * @returns {Promise<{id:number, copiado:boolean, alterado:boolean, unidade:string}>}
 *   `id` é o medicamento a gravar no estoque — DIFERENTE do informado quando houve
 *   cópia. Quem chama ADOTA o id devolvido; sem isso o estoque continuaria apontando
 *   para o global e a unidade nova não valeria para nada.
 * @throws {UnidadeIndisponivelError}
 */
async function definirUnidadeDoMedicamento(tx, { medicamentoId, unidade, empresaId, ignorarEstoqueId = null }) {
  const id   = Number(medicamentoId);
  const unid = normalizarUnidade(unidade);

  const med = await tx.medicamento.findUnique({
    where:  { id },
    select: {
      id: true, nome: true, unidade: true, empresaId: true, formaFarmaceutica: true,
      apresentacao: true, classificacao: true, fabricante: true, controlado: true,
    },
  });
  if (!med) {
    throw new UnidadeIndisponivelError('MEDICAMENTO_NAO_ENCONTRADO', 404, 'Medicamento não encontrado no catálogo.');
  }

  // Unidade não informada, ou a MESMA que já está gravada: nada a fazer. Sai ANTES de
  // qualquer guard — abrir e salvar a tela sem mexer na unidade não pode ser recusado
  // por uma regra que só existe para a TROCA.
  if (!unid || mesmaUnidade(med.unidade, unid)) {
    return { id: med.id, copiado: false, alterado: false, unidade: med.unidade };
  }

  if (!empresaId) {
    throw new UnidadeIndisponivelError('SEM_EMPRESA', 400,
      'Sem empresa ativa no contexto: não é possível definir a unidade do medicamento.');
  }
  // Medicamento PRIVADO de outra clínica. O RLS já o esconderia (o `findUnique` acima
  // voltaria null); o guard existe para o ADMIN de plataforma, que não passa por ele.
  if (med.empresaId != null && Number(med.empresaId) !== Number(empresaId)) {
    throw new UnidadeIndisponivelError('MEDICAMENTO_DE_OUTRA_EMPRESA', 404, 'Medicamento não encontrado no catálogo.');
  }

  // ── Guards: a unidade é do MEDICAMENTO, logo vale para TODO o estoque dele ──────
  //
  // 🔴 `qtdEstoque` está expresso na unidade ANTIGA. Trocar 'g' por 'Un.' com 5.000 em
  // estoque transformaria 5.000 g em "5.000 Un." — número absurdo que passaria a valer
  // no alerta de mínimo e no preço unitário. Quem reexpressa a quantidade é a
  // calculadora de embalagens da tela, e ela só alcança a entrada que está aberta.
  const outrasEntradas = await tx.estoqueClinica.count({
    where: {
      medicamentoId: med.id,
      empresaId:     Number(empresaId),
      ativo:         true,
      ...(ignorarEstoqueId ? { id: { not: Number(ignorarEstoqueId) } } : {}),
    },
  });
  if (outrasEntradas > 0) {
    const uma = outrasEntradas === 1;
    throw new UnidadeIndisponivelError('OUTRAS_ENTRADAS_DE_ESTOQUE', 400,
      `Este medicamento tem ${uma ? 'outra entrada' : `outras ${outrasEntradas} entradas`} de estoque ativa${uma ? '' : 's'}, `
      + `com a quantidade na unidade atual (${med.unidade}). Inative-a${uma ? '' : 's'} antes de trocar a unidade — `
      + 'senão a quantidade dela' + (uma ? '' : 's') + ' passaria a ser lida na unidade nova.');
  }

  // 🔴 Saída já registrada = quantidade consumida e, quando houve cobrança, FATURA
  // emitida na unidade antiga. Trocar a unidade aqui reescreveria o significado do que
  // já foi entregue ao cliente.
  const saidas = await tx.movimentoEstoque.count({
    where: { tipo: 'SAIDA', estoque: { medicamentoId: med.id, empresaId: Number(empresaId) } },
  });
  if (saidas > 0) {
    throw new UnidadeIndisponivelError('ESTOQUE_JA_MOVIMENTADO', 400,
      `Este medicamento já teve saída de estoque na unidade atual (${med.unidade}) — a unidade não pode ser alterada. `
      + 'Cadastre o item com a unidade correta em uma nova entrada.');
  }

  // ── Já é da empresa: altera no lugar ─────────────────────────────────────────
  if (med.empresaId != null) {
    await tx.medicamento.update({ where: { id: med.id }, data: { unidade: unid } });
    return { id: med.id, copiado: false, alterado: true, unidade: unid };
  }

  // ── Global: COPY-ON-WRITE ────────────────────────────────────────────────────
  const ja = await copiaExistente(tx, med.nome, empresaId);
  let novoId;
  if (ja) {
    // Cópia anterior desta mesma empresa (trocou a unidade, voltou, trocou de novo).
    // Reativar junto: uma cópia inativa reaproveitada sem isso ficaria fora de todas
    // as buscas, e o estoque reapontado para ela desapareceria da tela.
    await tx.medicamento.update({ where: { id: ja.id }, data: { unidade: unid, ativo: true } });
    novoId = ja.id;
  } else {
    novoId = await criarCopiaDaEmpresa(tx, med, unid, empresaId);
  }

  await reapontarParaCopia(tx, med.id, novoId, empresaId);
  return { id: novoId, copiado: true, alterado: true, unidade: unid };
}

module.exports = {
  UNIDADE_AVULSA,
  UnidadeIndisponivelError,
  normalizarUnidade,
  mesmaUnidade,
  garantirUnidadeAvulsa,
  definirUnidadeDoMedicamento,
};

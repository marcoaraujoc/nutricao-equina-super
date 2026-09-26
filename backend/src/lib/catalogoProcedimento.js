// backend/src/lib/catalogoProcedimento.js
//
// 🔴 COPY-ON-WRITE para `tb_procedimentos_vet` (2026-09-25) — mesma regra de
// `lib/catalogoEmpresa.js` (Medicamento) e do `garantirCopiaDaEmpresa` de
// `DocumentoTemplateController.js`, adaptada: aqui o único gatilho do fork é
// ATIVAR/INATIVAR um item GLOBAL. Renomear/recategorizar continua recusado para
// item de origem global — o nome só muda em procedimento CRIADO PELA CLÍNICA.
//
// `origemId` (migration 20261024000000) aponta para a linha GLOBAL da qual a
// cópia nasceu — é o que permite, depois do fork, ESCONDER o item global da
// empresa que já o forkou (ela foi substituída pela cópia, sem duplicata).
//
// ⚠️ Coluna NOVA: o client Prisma pode não estar regenerado (EPERM no Windows
// com o backend rodando, CLAUDE.md §11) — por isso `origem_id` é lido/gravado
// por SQL CRU aqui, nunca no `data:` do `create` tipado (que derrubaria a
// criação da cópia inteira se o client não conhecer o campo).
'use strict';

const SELECT_BASE = {
  id: true, codigo: true, nome: true, nomeAbreviado: true, descricao: true,
  categoria: true, subcategoria: true, especialidade: true, tipoProcedimento: true,
  duracao: true, requerAnestesia: true, requerInternacao: true, risco: true,
  valorCusto: true, valorVenda: true, especie: true, empresaId: true, ativo: true,
};

/** Cópia que ESTA empresa já fez deste item global, se houver (idempotente). */
async function copiaExistente(tx, empresaId, globalId) {
  const rows = await tx.$queryRaw`
    SELECT id FROM schs2vet.tb_procedimentos_vet
     WHERE empresa_id = ${empresaId} AND origem_id = ${globalId}
     LIMIT 1`;
  if (!rows.length) return null;
  return tx.procedimentoVeterinario.findUnique({ where: { id: Number(rows[0].id) }, select: SELECT_BASE });
}

/**
 * Reaponta, para a cópia recém-criada, os registros ESCOPADOS A ESTA EMPRESA
 * que ainda apontam para o id do item GLOBAL — sem isso, o vínculo de prestador
 * ou o item de combo ficam "pendurados" num id que sai da listagem depois do
 * fork, e pareceriam ter sumido.
 */
async function reapontarParaCopiaProcedimento(tx, globalId, novoId, empresaId) {
  await tx.procedimentoPrestador.updateMany({
    where: { empresaId, procedimentoId: globalId },
    data: { procedimentoId: novoId },
  });
  await tx.procedimentoComboItem.updateMany({
    where: { procedimentoId: globalId, combo: { empresaId } },
    data: { procedimentoId: novoId },
  });
}

/**
 * Garante uma linha do procedimento que a EMPRESA pode escrever.
 *
 * @param {object} tx        client Prisma da transaction do controller
 * @param {object} base      linha atual (select: SELECT_BASE ou superset dela)
 * @param {number} empresaId SEMPRE de `req.empresaId`
 * @returns {Promise<{item: object, copiado: boolean}>}
 *   `item.empresaId` já vem setado quando `copiado`. Quem chama ADOTA o `id`
 *   devolvido — numa cópia ele é DIFERENTE do enviado.
 */
async function garantirCopiaProcedimento(tx, base, empresaId) {
  if (base.empresaId === empresaId) return { item: base, copiado: false };
  if (base.empresaId != null) {
    const err = new Error('Procedimento não encontrado.');
    err.status = 404;
    throw err;
  }

  const existente = await copiaExistente(tx, empresaId, base.id);
  if (existente) return { item: existente, copiado: true };

  // Valor que a empresa já tinha definido para o item global (se houver) — lido
  // AQUI só para saber se existe; ele MIGRA para a cópia depois de criada (ver
  // abaixo), nunca vira `valorVenda`: quem exibe/edita o valor da empresa é
  // SEMPRE `ProcedimentoValorEmpresa` (`listarComValores` lê só dali), com ou
  // sem fork — gravá-lo em `valorVenda` faria o valor "sumir" da tela assim que
  // a empresa reabrisse o item, porque nada mais o leria de lá.
  const override = await tx.procedimentoValorEmpresa.findUnique({
    where: { empresaId_procedimentoId: { empresaId, procedimentoId: base.id } },
  });

  const copia = await tx.procedimentoVeterinario.create({
    data: {
      nome: base.nome, nomeAbreviado: base.nomeAbreviado, descricao: base.descricao,
      categoria: base.categoria, subcategoria: base.subcategoria,
      especialidade: base.especialidade, tipoProcedimento: base.tipoProcedimento,
      duracao: base.duracao, requerAnestesia: base.requerAnestesia,
      requerInternacao: base.requerInternacao, risco: base.risco,
      valorCusto: base.valorCusto, valorVenda: base.valorVenda,
      especie: base.especie, empresaId, ativo: base.ativo,
      // `codigo` NÃO é copiado — é a chave estável do catálogo GLOBAL (@unique);
      // a cópia nasce sem código próprio.
    },
    select: SELECT_BASE,
  });

  await tx.$executeRaw`
    UPDATE schs2vet.tb_procedimentos_vet SET origem_id = ${base.id} WHERE id = ${copia.id}`;

  // Move o overlay para a cópia — MESMA linha lógica, id NOVO — e só então apaga
  // o antigo. Nunca os dois passos trocados: apagar primeiro e a criação falhar
  // depois (raríssimo, mas a transaction existe por isto) perderia o valor.
  if (override) {
    await tx.procedimentoValorEmpresa.create({
      data: { empresaId, procedimentoId: copia.id, valor: override.valor },
    });
    await tx.procedimentoValorEmpresa.delete({
      where: { empresaId_procedimentoId: { empresaId, procedimentoId: base.id } },
    });
  }

  await reapontarParaCopiaProcedimento(tx, base.id, copia.id, empresaId);

  return { item: copia, copiado: true };
}

/**
 * `origemId`s de itens globais já forkados por esta empresa — usado para
 * esconder da listagem o item global que a cópia substituiu.
 */
async function origensJaForkadas(tx, empresaId) {
  if (!empresaId) return [];
  const rows = await tx.$queryRaw`
    SELECT origem_id FROM schs2vet.tb_procedimentos_vet
     WHERE empresa_id = ${empresaId} AND origem_id IS NOT NULL`;
  return rows.map(r => Number(r.origem_id));
}

module.exports = {
  garantirCopiaProcedimento,
  origensJaForkadas,
};

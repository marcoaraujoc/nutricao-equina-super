// backend/src/lib/cancelamentoPendencias.js
//
// Cascata de CANCELAMENTO das pendências clínicas em aberto quando um Animal é
// INATIVADO (exclusão lógica, Animal.ativo=false) — seja diretamente
// (AnimalController.excluir) ou em lote, pela inativação do PROPRIETÁRIO
// (ProprietarioController.removerDaEmpresa, que inativa os animais dele).
//
// POR QUÊ: inativar o paciente já o tira de toda tela do sistema
// (lib/visibilidade.js) — inclusive da fila de Execução de Prescrição, que filtra
// por `animal.ativo`. Mas até aqui isso só ESCONDIA a pendência: o registro
// clínico (agendamento, vacina/prescrição ainda não executada, exame/
// encaminhamento pendente) continuava com o status de "em aberto". Reativar o
// animal fazia esses registros reaparecerem como se nada tivesse acontecido
// enquanto ele esteve inativo — sintoma relatado: vacina "sumiu da execução" mas
// seguia "Em Execução" na tela do paciente.
//
// Regra: inativar o animal (ou o proprietário, que inativa os animais dele) agora
// CANCELA de verdade tudo que está pendente — não só esconde. Chamar SEMPRE
// dentro da MESMA transaction que inativa o animal: se a inativação falha, os
// cancelamentos não podem ter acontecido sozinhos, e vice-versa.
//
// FaturaPagaError (fatura já PAGA) NUNCA aborta o cancelamento inteiro — ver
// `estornarFaturaSeExistir`: o item já cobrado/pago fica como está na fatura, só o
// REGISTRO CLÍNICO é cancelado. Abortar a inativação do animal inteira por causa
// de UMA fatura antiga já paga tornaria a ação imprevisível para o gestor.
//
// ⚠️ Reativar o animal/proprietário NÃO desfaz nada disto — cancelamento aqui é
// tão terminal quanto o cancelamento manual em qualquer outra tela (mesma
// categoria de auditoria CANCELAMENTO). Quem precisar do registro de volta cria um
// novo, com o paciente já ativo.
//
// MESMA cascata reaproveitada para cancelar o ATENDIMENTO em andamento (2026-08-18):
// `cancelarPendenciasDaEvolucao` (escopo por evolucaoId, usada por
// `EvolucaoController.cancelar`/`excluir`) e `cancelarEvolucoesDoAgendamento`
// (escopo por agendamentoId, usada por `AgendamentoController.atualizarStatus` ao
// cancelar) — as quatro funções "…Pendentes" abaixo (vacinas/prescrições/
// encaminhamentos/exames) aceitam um `where` genérico (`{animalId}` ou
// `{evolucaoId}`) e leem o `animalId` de CADA REGISTRO para a auditoria, em vez de
// receber um `animalId` fixo — é o que permite reusá-las nos dois escopos sem
// duplicar a lógica de estorno/reversão de estoque.
'use strict';

const { removerFaturaItensDaOrigem } = require('./faturaUtils');
const { registrarAuditoria } = require('./auditoria');

/** Estorna o FaturaItem de origem, exceto quando a fatura já está PAGA — nesse caso
 * o item cobrado permanece como está, e só o cancelamento do registro segue. */
async function estornarFaturaSeExistir(tx, campo, id) {
  try {
    await removerFaturaItensDaOrigem(tx, campo, id);
  } catch (err) {
    if (err.code !== 'FATURA_PAGA') throw err;
  }
}

async function cancelarAgendamentosPendentes(tx, animalId, req, motivo) {
  const abertos = await tx.agendamentoClinico.findMany({
    where:  { animalId, ativo: true, status: { in: ['AGENDADO', 'EM_ANDAMENTO', 'ATRASADA'] } },
    select: { id: true, tipo: true, titulo: true },
  });
  for (const ag of abertos) {
    await tx.agendamentoClinico.update({ where: { id: ag.id }, data: { status: 'CANCELADO', observacao: motivo } });
    await registrarAuditoria(tx, req, {
      categoria:  'CANCELAMENTO',
      entidade:   'AGENDAMENTO',
      entidadeId: ag.id,
      animalId,
      motivo,
      detalhes:   `${ag.tipo} — ${ag.titulo ?? ''}`.trim(),
    });
  }
  return abertos.length;
}

// Só EM_ANDAMENTO — evolução FINALIZADA é histórico fechado (mesmo critério do resto
// do módulo de atendimento: registro encerrado não se cancela sozinho). Mesma lógica
// de `EvolucaoController.cancelar`: reatribui a autoria a quem cancelou e, se havia
// agendamento vinculado ainda em EM_ANDAMENTO/FINALIZADO, libera-o — na prática é
// sempre um no-op aqui, porque `cancelarAgendamentosPendentes` já rodou antes e o
// deixou CANCELADO (a ordem de chamada em `cancelarPendenciasDoAnimal` importa).
async function cancelarEvolucoesPendentes(tx, animalId, req, motivo) {
  const evolucoes = await tx.evolucaoClinica.findMany({
    where:  { animalId, ativo: true, status: 'EM_ANDAMENTO' },
    select: { id: true, titulo: true, agendamentoId: true, status: true },
  });
  for (const ev of evolucoes) {
    await tx.evolucaoClinica.update({
      where: { id: ev.id },
      data: {
        status:                'CANCELADA',
        veterinarioId:         req.user.id,
        modificadoPorId:       req.user.id,
        dataModificacao:       new Date(),
        justificativaExclusao: motivo,
      },
    });

    if (ev.agendamentoId) {
      await tx.agendamentoClinico.updateMany({
        where: { id: ev.agendamentoId, status: { in: ['EM_ANDAMENTO', 'FINALIZADO'] } },
        data:  { status: 'AGENDADO' },
      });
    }

    await registrarAuditoria(tx, req, {
      categoria:  'CANCELAMENTO',
      entidade:   'EVOLUCAO',
      entidadeId: ev.id,
      animalId,
      motivo,
      detalhes:   `status anterior: ${ev.status}${ev.titulo ? ` — ${ev.titulo}` : ''}`,
    });
  }
  return evolucoes.length;
}

// SALVA/FINALIZADA = ainda não passou pela Execução (EXECUTADA já debitou estoque e
// faturou — não se mexe nela). Mesmo padrão de estorno de `VacinaClinicaController.excluir`.
// `where` escopa a busca — `{animalId}` (inativação do paciente) ou `{evolucaoId}`
// (cancelamento do atendimento); o `animalId` da AUDITORIA vem de CADA REGISTRO, não
// de um parâmetro fixo, para a função servir aos dois escopos sem duplicar lógica.
async function cancelarVacinasPendentes(tx, where, req, motivo) {
  const vacinas = await tx.vacinaClinica.findMany({
    where: { ...where, ativo: true, status: { in: ['SALVA', 'FINALIZADA'] } },
  });
  for (const v of vacinas) {
    await estornarFaturaSeExistir(tx, 'vacinaClinicaId', v.id);

    if (v.loteId) {
      const lote = await tx.loteVacina.findUnique({ where: { id: v.loteId } });
      if (lote) {
        await tx.loteVacina.update({
          where: { id: lote.id },
          data:  { qtdDisponivel: lote.qtdDisponivel + Math.max(1, Number(v.quantidade) || 1) },
        });
      }
    }

    await tx.vacinaClinica.update({
      where: { id: v.id },
      data:  { ativo: false, motivoInativacao: motivo },
    });

    await registrarAuditoria(tx, req, {
      categoria:  'CANCELAMENTO',
      entidade:   'VACINA',
      entidadeId: v.id,
      animalId:   v.animalId,
      motivo,
      detalhes:   v.nome ?? null,
    });
  }
  return vacinas.length;
}

// Mesma trava de `PrescricaoGrupoController.cancelar`: grupo já EXECUTADO (mesmo
// parcialmente — algum item com `executadoEm`) não se cancela sozinho, fica para
// decisão manual de quem atende. Cobre MEDICAMENTO e PROCEDIMENTO — os dois tipos
// de item moram no mesmo grupo.
async function cancelarPrescricoesPendentes(tx, where, req, motivo) {
  const grupos = await tx.prescricaoGrupo.findMany({
    where:   { ...where, status: { in: ['SALVO', 'FINALIZADO', 'CANCELADO_PARCIALMENTE'] } },
    include: { itens: { where: { ativo: true } } },
  });
  let n = 0;
  for (const grupo of grupos) {
    if (grupo.status === 'EXECUTADO' || grupo.executadoEm || grupo.itens.some(i => i.executadoEm)) continue;

    await tx.reservaEstoque.deleteMany({ where: { prescricaoGrupoId: grupo.id } });
    for (const item of grupo.itens) {
      await estornarFaturaSeExistir(tx, 'prescricaoId', item.id);
    }

    await tx.prescricao.updateMany({ where: { grupoId: grupo.id, ativo: true }, data: { status: 'CANCELADA' } });
    await tx.prescricaoGrupo.update({
      where: { id: grupo.id },
      data:  { status: 'CANCELADO', motivoCancelamento: motivo },
    });

    await registrarAuditoria(tx, req, {
      categoria:  'CANCELAMENTO',
      entidade:   'PRESCRICAO',
      entidadeId: grupo.id,
      animalId:   grupo.animalId,
      motivo,
      detalhes:   `status anterior: ${grupo.status} — ${grupo.itens.length} item(ns)`,
    });
    n++;
  }
  return n;
}

async function cancelarEncaminhamentosPendentes(tx, where, req, motivo) {
  const pendentes = await tx.encaminhamentoClinico.findMany({
    where: { ...where, ativo: true, status: 'PENDENTE' },
  });
  for (const enc of pendentes) {
    await estornarFaturaSeExistir(tx, 'encaminhamentoClinicoId', enc.id);

    await tx.encaminhamentoClinico.update({ where: { id: enc.id }, data: { status: 'CANCELADO' } });
    await tx.designacaoPrestador.updateMany({
      where: { encaminhamentoId: enc.id, ativo: true },
      data:  { ativo: false, dataFim: new Date() },
    });

    await registrarAuditoria(tx, req, {
      categoria:  'CANCELAMENTO',
      entidade:   'ENCAMINHAMENTO',
      entidadeId: enc.id,
      animalId:   enc.animalId,
      motivo,
      detalhes:   [enc.especialidade, enc.motivo].filter(Boolean).join(' — ') || null,
    });
  }
  return pendentes.length;
}

// ExameClinico não tem status CANCELADO (só SOLICITADO|REALIZADO|CONCLUIDO) — o
// cancelamento é o mesmo soft delete de `ExameClinicoController.excluir`. Só o
// SOLICITADO conta como pendência; resultado já lançado (REALIZADO/CONCLUIDO) fica.
async function cancelarExamesPendentes(tx, where, req, motivo) {
  const pendentes = await tx.exameClinico.findMany({
    where: { ...where, ativo: true, status: 'SOLICITADO' },
  });
  for (const ex of pendentes) {
    await estornarFaturaSeExistir(tx, 'exameClinicoId', ex.id);
    await tx.exameClinico.update({ where: { id: ex.id }, data: { ativo: false } });
    await registrarAuditoria(tx, req, {
      categoria:  'CANCELAMENTO',
      entidade:   'EXAME_CLINICO',
      entidadeId: ex.id,
      animalId:   ex.animalId,
      motivo,
      detalhes:   [ex.tipo, ex.descricao].filter(Boolean).join(' — ') || null,
    });
  }
  return pendentes.length;
}

/**
 * Cancela TODAS as pendências clínicas em aberto de um animal — agendamentos,
 * evolução em andamento, vacinas/prescrições ainda não executadas, exames e
 * encaminhamentos pendentes. Chamar sempre dentro da MESMA transaction (`tx`) que
 * inativa o animal.
 *
 * ⚠️ ORDEM importa: agendamentos ANTES de evolução — `cancelarEvolucoesPendentes`
 * pode reabrir o agendamento vinculado à evolução (mesma regra do cancelar manual),
 * e isso só é inofensivo (no-op) se aquele agendamento já tiver sido cancelado antes.
 *
 * @returns {{agendamentos:number, evolucoes:number, vacinas:number, prescricoes:number, encaminhamentos:number, exames:number}}
 */
async function cancelarPendenciasDoAnimal(tx, animalId, req, motivo) {
  const agendamentos    = await cancelarAgendamentosPendentes(tx, animalId, req, motivo);
  const evolucoes       = await cancelarEvolucoesPendentes(tx, animalId, req, motivo);
  const vacinas         = await cancelarVacinasPendentes(tx, { animalId }, req, motivo);
  const prescricoes     = await cancelarPrescricoesPendentes(tx, { animalId }, req, motivo);
  const encaminhamentos = await cancelarEncaminhamentosPendentes(tx, { animalId }, req, motivo);
  const exames          = await cancelarExamesPendentes(tx, { animalId }, req, motivo);
  return { agendamentos, evolucoes, vacinas, prescricoes, encaminhamentos, exames };
}

/**
 * Cancela o que está ATRELADO a uma evolução — vacina, prescrição (medicamento E
 * procedimento, que moram no mesmo grupo), exame e encaminhamento ainda pendentes
 * DAQUELA evolução (nunca de outra evolução do mesmo animal). Não mexe na evolução
 * em si nem no agendamento vinculado — isso é decisão de quem chama (a evolução
 * pode ser cancelada, ou pode ter sido a origem de um agendamento que está sendo
 * cancelado por fora; os dois fluxos reusam esta função com uma consequência
 * diferente para o registro-pai).
 *
 * Chamar sempre dentro da MESMA transaction que muda o status da evolução/agendamento.
 *
 * @returns {{vacinas:number, prescricoes:number, encaminhamentos:number, exames:number}}
 */
async function cancelarPendenciasDaEvolucao(tx, evolucaoId, req, motivo) {
  const vacinas         = await cancelarVacinasPendentes(tx, { evolucaoId }, req, motivo);
  const prescricoes     = await cancelarPrescricoesPendentes(tx, { evolucaoId }, req, motivo);
  const encaminhamentos = await cancelarEncaminhamentosPendentes(tx, { evolucaoId }, req, motivo);
  const exames          = await cancelarExamesPendentes(tx, { evolucaoId }, req, motivo);
  return { vacinas, prescricoes, encaminhamentos, exames };
}

/**
 * Cancela a(s) evolução(ões) EM_ANDAMENTO vinculada(s) a um AGENDAMENTO que está
 * sendo cancelado — e, com cada uma, tudo que está atrelado a ela (via
 * `cancelarPendenciasDaEvolucao`). Ao contrário do cancelamento manual da evolução
 * (`EvolucaoController.cancelar`, que REABRE o agendamento — o atendimento pode
 * recomeçar), aqui o agendamento NÃO é reaberto: é ele que está sendo cancelado,
 * então não há "para onde reabrir" — o atendimento inteiro foi desmarcado.
 *
 * Chamar sempre dentro da MESMA transaction que cancela o agendamento.
 *
 * @returns {number} evoluções canceladas
 */
async function cancelarEvolucoesDoAgendamento(tx, agendamentoId, req, motivo) {
  const evolucoes = await tx.evolucaoClinica.findMany({
    where:  { agendamentoId, ativo: true, status: 'EM_ANDAMENTO' },
    select: { id: true, animalId: true, titulo: true, status: true },
  });
  for (const ev of evolucoes) {
    await cancelarPendenciasDaEvolucao(tx, ev.id, req, motivo);

    await tx.evolucaoClinica.update({
      where: { id: ev.id },
      data: {
        status:                'CANCELADA',
        veterinarioId:         req.user.id,
        modificadoPorId:       req.user.id,
        dataModificacao:       new Date(),
        justificativaExclusao: motivo,
      },
    });

    await registrarAuditoria(tx, req, {
      categoria:  'CANCELAMENTO',
      entidade:   'EVOLUCAO',
      entidadeId: ev.id,
      animalId:   ev.animalId,
      motivo,
      detalhes:   `cancelada junto com o agendamento — status anterior: ${ev.status}${ev.titulo ? ` — ${ev.titulo}` : ''}`,
    });
  }
  return evolucoes.length;
}

module.exports = {
  cancelarPendenciasDoAnimal,
  cancelarPendenciasDaEvolucao,
  cancelarEvolucoesDoAgendamento,
};

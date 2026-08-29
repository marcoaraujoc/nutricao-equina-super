// backend/src/services/prescricaoCronService.js
// Rotina corporativa (global) executada no fim do dia: encerra prescrições cuja
// janela de tratamento (dataInicio + duracaoDias de TODOS os itens) já passou e
// que não foram totalmente executadas.
//   - Nenhum item executado      → grupo CANCELADO (cancelamento automático)
//   - Execução parcial           → grupo CANCELADO_PARCIALMENTE (parcialmente
//     executada); os itens ainda NÃO executados são cancelados automaticamente
//     e os executados/faturados são preservados.
// Reservas de estoque remanescentes do grupo são liberadas nos dois casos.
// Registrada como job em server.ts via cronManager — agenda e liga/desliga sob
// controle do ADMIN na tela de Configuração (CronAgenda).
'use strict';

const prisma = require('../lib/prisma').default;
const {
  elegivelParaFluxoNovo, primeiraDoseEsperada, semAncoraDeHorario, dentroDaJanelaDoCurso,
} = require('../lib/agendaDoses');
// "Que dia é hoje" tem de ser o dia DA CLÍNICA. Ver a regra abaixo, em `hojeDaEmpresa`.
const { fusoDaEmpresa, hojeNaEmpresa } = require('../lib/fusoEmpresa');
// Mesmas funções que `removerItem` (cancelamento manual de UM item) usa para
// recalcular a reserva de estoque do grupo sem deixar sobra órfã para os
// demais itens — reusadas aqui em vez de duplicadas (armadilha conhecida:
// duas cópias divergem na primeira correção).
const {
  criarReservas, liberarReservas, anexarAplicadaProprietario,
} = require('../controllers/PrescricaoGrupoController');

const MOTIVO_NAO_EXECUTADA =
  'Cancelada automaticamente pelo sistema — prescrição não executada dentro do período de tratamento.';
const MOTIVO_PARCIAL =
  'Encerrada automaticamente pelo sistema — prescrição parcialmente executada; itens não executados foram cancelados.';
const MOTIVO_DOSE_PERDIDA =
  'Cancelada automaticamente pelo sistema — a dose não foi executada na data prevista.';

/**
 * 'YYYY-MM-DD' de HOJE no fuso da EMPRESA que está sendo varrida.
 *
 * 🔴 NUNCA `new Date().toISOString().split('T')[0]` aqui — era o que este arquivo fazia
 * (contra a própria advertência de `dataLocalStr`, logo abaixo, que existia e não era
 * usada). Este job roda às 23:40 em Brasília, ou seja, 02:40 UTC do DIA SEGUINTE: o
 * `hojeStr` saía adiantado e a comparação `hoje > últimoDia` cancelava prescrição cuja
 * janela termina HOJE, um dia antes do previsto. Passava despercebido porque às 23:40 o
 * dia está acabando de qualquer forma — mas o botão "Executar agora" da tela de
 * Configuração dispara o MESMO código a qualquer hora, e às 22:00 ele cancelava
 * documento clínico ainda válido, sem volta.
 *
 * O fuso é o da empresa (Brasil tem 4 — §6 do CLAUDE.md); sem empresa no contexto cai
 * no padrão, que é o comportamento anterior a esta correção para o servidor em SP.
 */
async function hojeDaEmpresa(db, empresa) {
  const fuso = await fusoDaEmpresa(empresa?.id ?? null, db);
  return hojeNaEmpresa(fuso);
}

// Data LOCAL (YYYY-MM-DD) de um instante — NUNCA `toISOString()` para "hoje"/datas
// de referência: vira o dia seguinte a partir das 21h no horário de Brasília.
function dataLocalStr(d) {
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// Último dia válido da janela do item (dataInicio + duracaoDias − 1), em 'YYYY-MM-DD'.
// Mesmo cálculo do janelaDoItem do PrescricaoGrupoController (UTC).
function ultimoDiaDoItem(item) {
  const fim = new Date(new Date(item.dataInicio).toISOString().split('T')[0]);
  fim.setUTCDate(fim.getUTCDate() + Math.max(Number(item.duracaoDias) || 1, 1) - 1);
  return fim.toISOString().split('T')[0];
}

/**
 * Cancela/encerra grupos de prescrição FINALIZADO cuja janela de todos os itens
 * ativos já passou. Não toca em grupos EXECUTADO, CANCELADO ou dentro da janela.
 *
 * @returns ResultadoCron para o comAlerta/reportarCron (Monitoração + e-mail ADMIN).
 */
async function cancelarPrescricoesNaoExecutadas(db = prisma, diario = null, empresa = null) {
  const hojeStr = await hojeDaEmpresa(db, empresa);

  const grupos = await db.prescricaoGrupo.findMany({
    where:   { status: 'FINALIZADO' },
    include: {
      // `numero` e o animal entram para IDENTIFICAR o documento no diário de execução:
      // quem abre a Monitoração precisa saber QUAL prescrição foi cancelada, não só quantas.
      animal: { select: { nome: true } },
      itens: { where: { ativo: true }, select: { id: true, dataInicio: true, duracaoDias: true, executadoEm: true } },
    },
  });

  let canceladas = 0;
  let parciais   = 0;

  for (const grupo of grupos) {
    if (grupo.itens.length === 0) continue;
    // Só encerra quando NENHUM item pode mais ser executado (janela passou para todos)
    const expirado = grupo.itens.every(item => hojeStr > ultimoDiaDoItem(item));
    if (!expirado) continue;

    const houveExecucao = grupo.itens.some(item => item.executadoEm);

    // ⚠️ SEM `$transaction` aqui. O cron já roda DENTRO de uma (uma por empresa, aberta
    // por `paraCadaEmpresa`), e o Prisma NÃO suporta transação aninhada (§13.1 do plano):
    // a interna abriria OUTRA conexão, sem o `set_config` do tenant, e o RLS devolveria
    // zero linha — ou travaria em deadlock esperando lock que a externa segura.
    //
    // Efeito colateral aceito: a atomicidade deixou de ser POR GRUPO e passou a ser POR
    // EMPRESA. Se um grupo falhar, o lote inteiro daquela clínica volta atrás e o cron
    // registra a falha (as demais empresas seguem). Para uma limpeza noturna isso é
    // preferível ao estado anterior, em que metade dos grupos ficava aplicada.
    await db.reservaEstoque.deleteMany({ where: { prescricaoGrupoId: grupo.id } });
    await db.prescricao.updateMany({
      where: { grupoId: grupo.id, ativo: true, executadoEm: null },
      data:  { status: 'CANCELADA', ativo: false },
    });
    await db.prescricaoGrupo.update({
      where: { id: grupo.id },
      data:  {
        status:             houveExecucao ? 'CANCELADO_PARCIALMENTE' : 'CANCELADO',
        motivoCancelamento: houveExecucao ? MOTIVO_PARCIAL : MOTIVO_NAO_EXECUTADA,
      },
    });

    if (houveExecucao) parciais++; else canceladas++;

    if (diario) {
      const naoExecutados = grupo.itens.filter(i => !i.executadoEm).length;
      diario.ok(empresa,
        `prescrição #${String(grupo.numero ?? grupo.id).padStart(3, '0')} · ${grupo.animal?.nome ?? 'animal ?'} — `
        + (houveExecucao
            ? `CANCELADA PARCIALMENTE (${naoExecutados} de ${grupo.itens.length} item(ns) não executado(s))`
            : `CANCELADA (${grupo.itens.length} item(ns), nenhum executado)`));
    }
  }

  if (canceladas === 0 && parciais === 0) return { ok: true, notificar: false };

  return {
    ok: true,
    notificar: true,
    resumo:
      `Prescrições com período de tratamento vencido: ${canceladas} não executada(s) cancelada(s), ` +
      `${parciais} parcialmente executada(s) encerrada(s) (itens restantes cancelados).`,
  };
}

/**
 * Cancela o ITEM (não o grupo) de rolling schedule cuja dose NUNCA foi dada e
 * cuja data prevista já passou — regra de produto (2026-08-18): "mesmo sem
 * executar não pode mostrar em outros dias; se não executar, será cancelada
 * automaticamente no dia seguinte."
 *
 * Só alcança itens com `dosesExecutadas === 0` — mesma cautela do cron irmão
 * (`cancelarPrescricoesNaoExecutadas`): item que JÁ teve alguma dose real dada
 * tem fatura/estoque associados a essa dose e nunca é tocado por um cron
 * automático. Se a 2ª dose de um curso em andamento for perdida, ela
 * simplesmente some da fila (não fica "atrasada, ainda pendente") — não há,
 * hoje, fechamento automático para esse caso; decisão de produto em aberto.
 *
 * Cancela só ESTE item — os demais itens do mesmo grupo (outro medicamento,
 * outra frequência) NÃO são afetados; o grupo muda de status apenas se ESTE
 * era o último item ainda ativo.
 */
async function cancelarDosesPrescricaoPerdidas(db = prisma, diario = null, empresa = null) {
  // Mesmo motivo do `cancelarPrescricoesNaoExecutadas`: o dia de referencia e' o da
  // CLINICA. Aqui ja era data local (fuso do servidor), o que so acerta quem esta em
  // Brasilia -- na clinica em Manaus a dose das 22h caia no dia seguinte.
  const hojeStr = await hojeDaEmpresa(db, empresa);

  const itens = await db.prescricao.findMany({
    where: {
      ativo: true,
      dosesExecutadas: 0,
      grupo: { status: { in: ['FINALIZADO', 'CANCELADO_PARCIALMENTE'] } },
    },
    include: {
      animal: { select: { nome: true } },
      grupo:  { select: { id: true, numero: true, empresaId: true } },
    },
  });

  let canceladas = 0;

  for (const item of itens) {
    // Explica no diário POR QUE o item foi cancelado. Declarado aqui porque os dois
    // ramos abaixo chegam a ele: item SEM âncora de horário não tem data prevista
    // nenhuma (é a janela do curso que venceu), e ler a variável do outro ramo era
    // `ReferenceError` — `const` dentro do `else` não existe fora dele. Só não
    // estourava porque, até hoje, todo item cancelado veio pelo ramo com âncora.
    let porQue = 'janela do curso encerrada';
    if (!elegivelParaFluxoNovo(item)) continue; // legado — fica com a janela do curso, sem mudança
    // 🔴 Item SEM Hora Início e sem nenhuma dose dada não tem horário previsto: o
    // prazo dele é a JANELA DO CURSO inteira, não o dia de `dataInicio` (é a 1ª
    // execução que fixa a grade — ver lib/agendaDoses.js#semAncoraDeHorario). Sem
    // esta ressalva, tornar Hora Início opcional faria este cron cancelar no dia
    // seguinte todo item sem hora de um curso de vários dias.
    if (semAncoraDeHorario(item)) {
      if (dentroDaJanelaDoCurso(item, hojeStr)) continue; // ainda dá tempo
    } else {
      // dosesExecutadas === 0 → a próxima dose esperada É a 1ª do curso.
      const previstoStr = dataLocalStr(primeiraDoseEsperada(item));
      if (previstoStr >= hojeStr) continue; // é hoje ou ainda no futuro — não perdeu o prazo
      porQue = `dose prevista para ${previstoStr} não foi executada`;
    }

    await db.prescricao.update({
      where: { id: item.id },
      data:  { ativo: false, status: 'CANCELADA' },
    });

    // Recalcula a reserva de estoque do GRUPO com os itens que sobraram — mesma
    // lógica multi-lote de `removerItem` (cancelamento manual de um item), para
    // não deixar a fatia deste item reservada e bloqueando outras prescrições.
    const restantes = await db.prescricao.findMany({
      where: { grupoId: item.grupoId, ativo: true, id: { not: item.id } },
    });
    if (restantes.length === 0) {
      await liberarReservas(db, item.grupoId);
      const houveExecucaoNoGrupo = await db.prescricao.count({
        where: { grupoId: item.grupoId, executadoEm: { not: null } },
      });
      await db.prescricaoGrupo.update({
        where: { id: item.grupoId },
        data:  { status: houveExecucaoNoGrupo > 0 ? 'CANCELADO_PARCIALMENTE' : 'CANCELADO' },
      });
    } else if (item.medicamentoCatId) {
      // ⚠️ `db`, NÃO o `prisma` global. Ler por fora da transaction do tenant parecia
      // inofensivo ("a flag não muda dentro dela"), mas `anexarAplicadaProprietario`
      // consulta `tb_prescricoes` por SQL cru — e sem `app.empresa_id` o RLS devolve
      // zero linha e ENGOLE o erro no `catch` interno da função. O resultado era todo
      // item voltando com `aplicadaPeloProprietario: false`: o medicamento que o
      // proprietário aplica em casa voltava a ocupar reserva de estoque na clínica.
      const itensRestantes = await anexarAplicadaProprietario(db, restantes);
      const aindaUsaMedicamento = itensRestantes.some(i => i.medicamentoCatId === item.medicamentoCatId);
      if (!aindaUsaMedicamento) {
        const estoquesDoMed = await db.estoqueClinica.findMany({
          where:  { medicamentoId: item.medicamentoCatId, ...(item.grupo?.empresaId != null ? { empresaId: item.grupo.empresaId } : {}), ativo: true },
          select: { id: true },
        });
        if (estoquesDoMed.length > 0) {
          await db.reservaEstoque.deleteMany({
            where: { prescricaoGrupoId: item.grupoId, estoqueId: { in: estoquesDoMed.map(e => e.id) } },
          });
        }
      }
      await criarReservas(db, item.grupoId, item.animalId, itensRestantes, item.grupo?.empresaId ?? null);
    }

    canceladas++;
    if (diario) {
      diario.ok(empresa,
        `prescrição #${String(item.grupo?.numero ?? item.grupoId).padStart(3, '0')} · ${item.animal?.nome ?? 'animal ?'} — `
        + `item "${item.medicamento}" CANCELADO (${porQue})`);
    }
  }

  if (canceladas === 0) return { ok: true, notificar: false };
  return {
    ok: true,
    notificar: true,
    resumo: `${canceladas} item(ns) de prescrição cancelado(s) por dose perdida (não executada na data prevista).`,
  };
}

module.exports = {
  cancelarPrescricoesNaoExecutadas, MOTIVO_NAO_EXECUTADA, MOTIVO_PARCIAL,
  cancelarDosesPrescricaoPerdidas, MOTIVO_DOSE_PERDIDA,
};

// backend/src/controllers/RelatoriosController.js
// Relatórios por categoria (Financeiro, Atendimento, Cadastro, Farmácia).
// Escopo por empresa ativa via resolverEscopo + janela de tempo via resolverPeriodo
// (mesmo contrato do RelatorioGerencialController: query params granularidade + data).
// Todas as rotas exigem relatorios.gerencial.ler (nível gestor).
//
// Princípio: métricas de JANELA (faturamento, atendimentos, novos cadastros, consumo,
// giro) agregam por [inicio, fim] do período. Métricas de ESTADO ATUAL (base ativa,
// posição de estoque, alertas de validade) são snapshot "as-of" refDate.
'use strict';

const prisma = require('../lib/prisma').default;
const { totalComissaoNoPeriodo } = require('../lib/procedimentoPrestador');
const {
  resolverEscopo,
  resolverPeriodo,
  somaEmMapa,
  mapaParaLista,
  nomeLocalizacao,
  SEM_LOCALIZACAO,
} = require('./RelatorioGerencialController');

const { valorLiquidoItem } = require('../lib/faturaUtils');
const { motivosDeOrcamentos, motivosDeItens } = require('../lib/orcamentoRecusa');

// Receita = valor líquido do item (bruto − desconto). Toda query que alimenta este
// helper precisa trazer descontoTipo/descontoValor no select.
const receitaDoItem = (i) => valorLiquidoItem(i);

// ── FINANCEIRO ──────────────────────────────────────────────────────────────

// Resolve a especialidade da evolução de origem de cada item faturado.
// Retorna Map<faturaItemId, especialidade|null>.
async function especialidadePorItem(itens) {
  const exameIds = new Set(), prescIds = new Set(), vacIds = new Set(), encIds = new Set();
  for (const i of itens) {
    if (i.exameClinicoId)          exameIds.add(i.exameClinicoId);
    if (i.prescricaoId)            prescIds.add(i.prescricaoId);
    if (i.vacinaClinicaId)         vacIds.add(i.vacinaClinicaId);
    if (i.encaminhamentoClinicoId) encIds.add(i.encaminhamentoClinicoId);
  }

  const [exames, prescricoes, vacinas, encaminhamentos] = await Promise.all([
    exameIds.size ? prisma.exameClinico.findMany({ where: { id: { in: [...exameIds] } }, select: { id: true, evolucaoId: true } }) : [],
    prescIds.size ? prisma.prescricao.findMany({ where: { id: { in: [...prescIds] } }, select: { id: true, grupo: { select: { evolucaoId: true } } } }) : [],
    vacIds.size   ? prisma.vacinaClinica.findMany({ where: { id: { in: [...vacIds] } }, select: { id: true, evolucaoId: true } }) : [],
    encIds.size   ? prisma.encaminhamentoClinico.findMany({ where: { id: { in: [...encIds] } }, select: { id: true, evolucaoId: true } }) : [],
  ]);

  // origemChave → evolucaoId
  const evoDeExame = new Map(exames.map(e => [e.id, e.evolucaoId]));
  const evoDePresc = new Map(prescricoes.map(p => [p.id, p.grupo?.evolucaoId ?? null]));
  const evoDeVac   = new Map(vacinas.map(v => [v.id, v.evolucaoId]));
  const evoDeEnc   = new Map(encaminhamentos.map(e => [e.id, e.evolucaoId]));

  const evoIds = new Set([...evoDeExame.values(), ...evoDePresc.values(), ...evoDeVac.values(), ...evoDeEnc.values()].filter(Boolean));
  const evolucoes = evoIds.size
    ? await prisma.evolucaoClinica.findMany({ where: { id: { in: [...evoIds] } }, select: { id: true, especialidade: true } })
    : [];
  const espDeEvo = new Map(evolucoes.map(e => [e.id, e.especialidade]));

  const resolveEvo = (i) =>
    (i.exameClinicoId          && evoDeExame.get(i.exameClinicoId)) ??
    (i.prescricaoId            && evoDePresc.get(i.prescricaoId)) ??
    (i.vacinaClinicaId         && evoDeVac.get(i.vacinaClinicaId)) ??
    (i.encaminhamentoClinicoId && evoDeEnc.get(i.encaminhamentoClinicoId)) ?? null;

  const out = new Map();
  for (const i of itens) {
    const evo = resolveEvo(i);
    out.set(i.id, evo ? (espDeEvo.get(evo) ?? null) : null);
  }
  return out;
}

function categoriaDoItem(i) {
  if (i.vacinaClinicaId)         return 'Vacinas';
  if (i.exameClinicoId)          return 'Exames';
  if (i.encaminhamentoClinicoId) return 'Encaminhamentos';
  if (i.tipo === 'ASSISTENCIA')  return 'Consultas';
  if (i.tipo === 'MEDICAMENTO')  return 'Farmácia';
  if (i.tipo === 'PROCEDIMENTO') return 'Procedimentos';
  return 'Outros';
}

// Apuração financeira do período. Extraída do handler para ser reusada pela
// análise de IA (AnaliseFinanceiraController) sem duplicar regra de cálculo.
const computarFinanceiro = async (req) => {
  {
    const { empresaId, propWhere } = await resolverEscopo(req);
    const { inicio, fim, refDate, mesRef, granularidade } = resolverPeriodo(req);
    const anoInicio = new Date(refDate.getFullYear(), 0, 1, 0, 0, 0, 0);
    const anoFim    = new Date(refDate.getFullYear(), 11, 31, 23, 59, 59, 999);
    const faturaAtiva = { status: { not: 'CANCELADA' }, ...propWhere };

    // Itens do ano (para o acumulado do ano + faturamento no período) e itens da
    // janela com origem (especialidade/categoria). A janela está sempre dentro do
    // ano do refDate, então itensAno é superconjunto e evita uma query extra.
    const [itensAno, itensPeriodo, evolucoesPeriodo, faturasReceber] = await Promise.all([
      prisma.faturaItem.findMany({
        where:  { criadoEm: { gte: anoInicio, lte: anoFim }, fatura: faturaAtiva },
        select: { valor: true, quantidade: true, descontoTipo: true, descontoValor: true, criadoEm: true },
      }),
      prisma.faturaItem.findMany({
        where:  { criadoEm: { gte: inicio, lte: fim }, fatura: faturaAtiva },
        select: {
          id: true, valor: true, quantidade: true, descontoTipo: true, descontoValor: true, tipo: true,
          exameClinicoId: true, prescricaoId: true, vacinaClinicaId: true, encaminhamentoClinicoId: true,
          fatura: { select: { proprietarioId: true } },
        },
      }),
      prisma.evolucaoClinica.count({
        where: { ativo: true, status: 'FINALIZADA', dataFim: { gte: inicio, lte: fim }, ...(empresaId ? { animal: { empresaId } } : {}) },
      }),
      prisma.fatura.findMany({
        // REABERTA conta como fatura em aberto — ver DashboardController.
        where:  { status: { in: ['ABERTA', 'REABERTA', 'FECHADA'] }, ...propWhere },
        select: { total: true, mesReferencia: true },
      }),
    ]);

    // Faturamento no período + acumulado do ano do refDate
    let faturamentoPeriodo = 0, faturamentoAno = 0;
    const iniMs = inicio.getTime(), fimMs = fim.getTime();
    for (const i of itensAno) {
      const v = receitaDoItem(i);
      faturamentoAno += v;
      const t = new Date(i.criadoEm).getTime();
      if (t >= iniMs && t <= fimMs) faturamentoPeriodo += v;
    }

    // Ticket médio (janela)
    const clientesDoPeriodo = new Set(itensPeriodo.map(i => i.fatura?.proprietarioId).filter(Boolean));
    const ticketPorAtendimento = evolucoesPeriodo > 0 ? faturamentoPeriodo / evolucoesPeriodo : 0;
    const ticketPorCliente     = clientesDoPeriodo.size > 0 ? faturamentoPeriodo / clientesDoPeriodo.size : 0;

    // Receita por especialidade (janela) + por categoria (janela)
    const espMap = await especialidadePorItem(itensPeriodo);
    const porEspecialidade = new Map();
    const porCategoria     = new Map();
    for (const i of itensPeriodo) {
      const v = receitaDoItem(i);
      somaEmMapa(porEspecialidade, espMap.get(i.id) ?? 'Sem especialidade', v);
      somaEmMapa(porCategoria,     categoriaDoItem(i), v);
    }

    // Contas a receber / vencidas — vencidas relativas ao mês de referência do período
    let contasReceber = 0, contasVencidas = 0;
    for (const f of faturasReceber) {
      contasReceber += f.total ?? 0;
      if (f.mesReferencia && f.mesReferencia < mesRef) contasVencidas += f.total ?? 0;
    }
    const inadimplencia = contasReceber > 0 ? (contasVencidas / contasReceber) * 100 : 0;

    // Fluxo de caixa projetado — média dos últimos 3 meses recebidos, relativo ao refDate
    const pagas = await prisma.fatura.groupBy({
      by:    ['mesReferencia'],
      where: { status: 'PAGA', mesReferencia: { not: null }, ...propWhere },
      _sum:  { total: true },
    });
    const recebidoPorMes = new Map(pagas.map(p => [p.mesReferencia, p._sum.total ?? 0]));
    const ultimos3 = [];
    for (let k = 1; k <= 3; k++) {
      const d = new Date(refDate.getFullYear(), refDate.getMonth() - k, 1);
      const ref = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      ultimos3.push({ mes: ref, valor: recebidoPorMes.get(ref) ?? 0, tipo: 'realizado' });
    }
    const mediaMensal = ultimos3.reduce((s, r) => s + r.valor, 0) / 3;
    const projecao = [];
    for (let k = 1; k <= 3; k++) {
      const d = new Date(refDate.getFullYear(), refDate.getMonth() + k, 1);
      const ref = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      projecao.push({ mes: ref, valor: mediaMensal, tipo: 'projetado' });
    }

    // Lucro bruto estimado (janela) = receita − custo dos produtos consumidos
    const [saidas, vacinasPeriodo] = await Promise.all([
      prisma.movimentoEstoque.findMany({
        where:  { tipo: 'SAIDA', createdAt: { gte: inicio, lte: fim }, ...(empresaId ? { estoque: { empresaId } } : {}) },
        select: { quantidade: true, estoque: { select: { precoUnitarioBase: true } } },
      }),
      prisma.vacinaClinica.findMany({
        where:  { ativo: true, cliente: false, dataAplicacao: { gte: inicio, lte: fim }, loteId: { not: null }, ...(empresaId ? { animal: { empresaId } } : {}) },
        select: { quantidade: true, loteVacina: { select: { valorUnitario: true } } },
      }),
    ]);
    let custoProdutos = 0;
    for (const s of saidas) custoProdutos += (s.quantidade ?? 0) * (s.estoque?.precoUnitarioBase ?? 0);
    for (const v of vacinasPeriodo) custoProdutos += (v.quantidade ?? 1) * (v.loteVacina?.valorUnitario ?? 0);
    // 🔴 COMISSÃO DE PRESTADOR SAI DA LINHA "Procedimentos" (a pedido, 2026-09-15).
    //
    // O valor INTEIRO do procedimento vai para a fatura do cliente — é o que ele paga,
    // e não muda. Mas parte dele pertence a quem executou e sai da clínica; deixar a
    // receita bruta na categoria afirmaria que a clínica ficou com tudo. O que aparece
    // no relatório é o que SOBROU.
    //
    // ⚠️ Sai só de "Procedimentos", nunca do FATURAMENTO do período: faturamento é o
    // que foi cobrado, e abatê-lo ali faria o total do relatório discordar da soma das
    // faturas emitidas.
    // ⚠️ A categoria nunca fica NEGATIVA: com o cadastro pela metade (comissão
    // registrada e procedimento sem valor na fatura) o piso é zero — receita negativa
    // seria lida como estorno, que não é o que aconteceu.
    const comissaoPrestadores = await totalComissaoNoPeriodo(empresaId, inicio, fim);
    if (comissaoPrestadores > 0) {
      const bruto = porCategoria.get('Procedimentos') ?? 0;
      porCategoria.set('Procedimentos', Math.max(bruto - comissaoPrestadores, 0));
    }

    const lucroBruto = faturamentoPeriodo - custoProdutos - comissaoPrestadores;
    const margemPct  = faturamentoPeriodo > 0 ? (lucroBruto / faturamentoPeriodo) * 100 : 0;

    return {
      faturamento: { periodo: faturamentoPeriodo, ano: faturamentoAno, granularidade },
      ticketMedio: { porAtendimento: ticketPorAtendimento, porCliente: ticketPorCliente, atendimentosPeriodo: evolucoesPeriodo, clientesPeriodo: clientesDoPeriodo.size },
      porEspecialidade: mapaParaLista(porEspecialidade, 'especialidade', 'receita'),
      porCategoria:     mapaParaLista(porCategoria,     'categoria',     'receita'),
      contasReceber, contasVencidas, inadimplencia,
      fluxoCaixa: { mediaMensal, historico: ultimos3.reverse(), projecao },
      lucroBruto: { receita: faturamentoPeriodo, custoProdutos, comissaoPrestadores, lucro: lucroBruto, margemPct },
    };
  }
};

const financeiro = async (req, res) => {
  try {
    return res.json({ dados: await computarFinanceiro(req) });
  } catch (err) {
    console.error('RelatoriosController.financeiro:', err);
    return res.status(500).json({ error: 'Erro ao gerar relatório financeiro.' });
  }
};

// ── ATENDIMENTO ─────────────────────────────────────────────────────────────

/**
 * 🔴 O NÚMERO DO CARD PRECISA MOSTRAR DE ONDE VEIO (a pedido, 2026-09-08).
 *
 * Até aqui cada indicador era um LINK para a Agenda filtrada — o que muda de tela,
 * perde o período do relatório e obriga a pessoa a reconstruir o recorte lá. Agora o
 * card ABRE A LISTA logo abaixo, no mesmo lugar em que o Histórico do Atendimento já
 * faz isso.
 *
 * As linhas viajam JUNTO do relatório, não numa rota por card: são os mesmos
 * registros que já foram lidos para CONTAR, e uma segunda ida ao banco por clique
 * pagaria de novo o mesmo `where` — com o risco de contar 7 e listar 6 se algo mudar
 * entre as duas chamadas.
 *
 * ⚠️ Colunas fixadas pelo pedido: animal, LOCAL do animal, veterinário responsável,
 * data do último atendimento e — nas consultas — o status.
 */
const linhaDeAgendamento = (a) => ({
  animalId:    a.animal?.id ?? null,
  animal:      a.animal?.nome ?? 'Sem animal vinculado',
  localizacao: a.animal ? nomeLocalizacao(a.animal) : SEM_LOCALIZACAO,
  veterinario: a.veterinario?.fullName ?? null,
  data:        a.dataHora ?? null,
  status:      a.status ?? null,
});

// Select comum das quatro consultas — o mesmo `where` que conta é o que lista.
const SELECT_AGENDAMENTO = {
  id: true, dataHora: true, status: true,
  animal:      { select: { id: true, nome: true, local: true, localizacao: { select: { nome: true } } } },
  veterinario: { select: { fullName: true } },
};

const atendimento = async (req, res) => {
  try {
    const { empresaId } = await resolverEscopo(req);
    const { inicio, fim, refDate } = resolverPeriodo(req);
    const escopoAnimal = empresaId ? { animal: { empresaId } } : {};

    // Todas as 4 métricas de consulta vêm de AgendamentoClinico (mesma fonte, mesma
    // janela de dataHora) — evita misturar "agendadas" (agenda) com "realizadas"
    // (evolução), que podiam divergir. "agendadas" = total marcado no período,
    // qualquer status; os outros 3 são subconjuntos por status.
    // "canceladas" soma CANCELADO (desistência humana) + CANCELADO_AUTOMATICAMENTE (a
    // rotina noturna encerrou sozinha) — para este número gerencial as duas são a MESMA
    // coisa: o atendimento não aconteceu. A distinção entre quem cancelou fica para a
    // Auditoria, não para este agregado.
    // ⚠️ `findMany` no lugar de `count` nas quatro consultas: a contagem passou a ser
    // o TAMANHO da lista que a tela mostra ao clicar no card. Contar de um jeito e
    // listar de outro é como um card passa a exibir 7 e abrir 6 — sem ninguém notar.
    const janela = { ativo: true, dataHora: { gte: inicio, lte: fim }, ...escopoAnimal };
    const [linhasAgendadas, linhasRealizadas, linhasCanceladas, linhasNaoRealizadas, procedimentos, exames] = await Promise.all([
      prisma.agendamentoClinico.findMany({ where: janela, select: SELECT_AGENDAMENTO, orderBy: { dataHora: 'desc' } }),
      prisma.agendamentoClinico.findMany({ where: { ...janela, status: { in: ['CONCLUIDO', 'FINALIZADO'] } }, select: SELECT_AGENDAMENTO, orderBy: { dataHora: 'desc' } }),
      prisma.agendamentoClinico.findMany({ where: { ...janela, status: { in: ['CANCELADO', 'CANCELADO_AUTOMATICAMENTE'] } }, select: SELECT_AGENDAMENTO, orderBy: { dataHora: 'desc' } }),
      // ATRASADA = já passou do horário (+30min) e ainda não foi concluída nem cancelada
      prisma.agendamentoClinico.findMany({ where: { ...janela, status: 'ATRASADA' }, select: SELECT_AGENDAMENTO, orderBy: { dataHora: 'desc' } }),
      prisma.prescricao.count({   where: { ativo: true, tipo: 'PROCEDIMENTO', executadoEm:     { gte: inicio, lte: fim }, ...escopoAnimal } }),
      prisma.exameClinico.count({ where: { ativo: true, dataSolicitacao: { gte: inicio, lte: fim }, ...escopoAnimal } }),
    ]);
    const agendadas     = linhasAgendadas.length;
    const realizadas    = linhasRealizadas.length;
    const canceladas    = linhasCanceladas.length;
    const naoRealizadas = linhasNaoRealizadas.length;

    // Atendimentos por animal e localidade: um "atendimento" = uma evolução clínica
    // FINALIZADA no período (mesmo critério de "atendido" usado no Mapa de
    // Atendimento — agendado/em andamento não conta, só depois de finalizar).
    // Ex.: na semana o Haras Centauro teve 5 atendimentos, 4 do Dentinho.
    const evolucoesFinalizadas = await prisma.evolucaoClinica.findMany({
      where: { ativo: true, status: 'FINALIZADA', dataFim: { gte: inicio, lte: fim }, ...escopoAnimal },
      select: { animal: { select: { id: true, nome: true, local: true, localizacao: { select: { nome: true } } } } },
    });
    const porLocalAnimal = new Map(); // localizacao → Map(animalNome → total)
    // `animalId` por nome — o front usa para transformar cada chip de animal em link
    // para a ficha dele (/animal/:id). Sem o id, o chip mostraria um nome que não
    // leva a lugar nenhum. Homônimos caíriam no mesmo chip de qualquer forma (a
    // agregação é por nome); aqui vence o ÚLTIMO id visto, e o link ao menos abre um
    // dos dois — melhor que nenhum, e a contagem já era agregada antes disto.
    const idPorAnimal = new Map();
    for (const ev of evolucoesFinalizadas) {
      const localNome  = ev.animal ? nomeLocalizacao(ev.animal) : SEM_LOCALIZACAO;
      const animalNome = ev.animal?.nome ?? 'Sem animal vinculado';
      if (ev.animal?.id) idPorAnimal.set(animalNome, ev.animal.id);
      if (!porLocalAnimal.has(localNome)) porLocalAnimal.set(localNome, new Map());
      const porAnimal = porLocalAnimal.get(localNome);
      somaEmMapa(porAnimal, animalNome, 1);
    }
    const atendimentosPorLocalidade = [...porLocalAnimal.entries()]
      .map(([localizacao, porAnimal]) => {
        const animais = mapaParaLista(porAnimal, 'animal', 'total')
          .map(a => ({ ...a, animalId: idPorAnimal.get(a.animal) ?? null }))
          .sort((a, b) => b.total - a.total);
        const total = animais.reduce((s, a) => s + a.total, 0);
        return { localizacao, total, animais };
      })
      .sort((a, b) => b.total - a.total);

    // ── ANIMAIS SEM ATENDIMENTO (a pedido, 2026-09-08) ──
    //
    // Os três cards vieram do Mapa de Atendimento, onde só existia o "no dia". Aqui
    // eles ganham as faixas de 3 e 7 dias, contadas a partir da MESMA data de
    // referência do período escolhido no seletor — não do relógio de agora. Um
    // relatório de julho aberto em setembro tem de responder sobre julho.
    //
    // ⚠️ "Atendido" é EVOLUÇÃO FINALIZADA, o mesmo critério do resto desta tela e do
    // Mapa. Consulta agendada, ou em andamento, não conta como atendimento — dizer que
    // conta transformaria a agenda cheia em "paciente atendido".
    const animaisDoEscopo = empresaId
      ? await prisma.animal.findMany({
          where:  { empresaId, ativo: true },
          select: {
            id: true, nome: true, local: true,
            localizacao: { select: { nome: true } },
            evolucoes: {
              where:   { ativo: true, status: 'FINALIZADA' },
              orderBy: { dataFim: 'desc' },
              take:    1,
              select:  { dataFim: true, veterinario: { select: { fullName: true } } },
            },
          },
        })
      : [];

    const fimDoDia = new Date(refDate); fimDoDia.setHours(23, 59, 59, 999);
    const linhasSemAtendimento = animaisDoEscopo.map(a => {
      const ult = a.evolucoes[0] ?? null;
      const data = ult?.dataFim ?? null;
      // `null` = nunca atendido. Ele entra em TODAS as faixas: um paciente que nunca
      // foi atendido está, por definição, sem atendimento há mais de 7 dias — e é
      // justamente o que ninguém quer perder de vista.
      const dias = data ? Math.floor((fimDoDia.getTime() - new Date(data).getTime()) / 86400000) : null;
      return {
        animalId:    a.id,
        animal:      a.nome,
        localizacao: nomeLocalizacao(a),
        veterinario: ult?.veterinario?.fullName ?? null,
        data,
        status:      null,
        dias,
      };
    });
    const semAtendimentoDesde = (minDias) =>
      linhasSemAtendimento.filter(l => l.dias === null || l.dias >= minDias)
        .sort((a, b) => (b.dias ?? Infinity) - (a.dias ?? Infinity));

    const semAtendimentoDia  = semAtendimentoDesde(1); // nada finalizado NO dia de referência
    const semAtendimento3    = semAtendimentoDesde(4); // mais de 3 dias
    const semAtendimento7    = semAtendimentoDesde(8); // mais de 7 dias

    return res.json({
      dados: {
        periodo: {
          agendadas, realizadas, canceladas, naoRealizadas, procedimentos, exames,
          semAtendimentoDia: semAtendimentoDia.length,
          semAtendimento3:   semAtendimento3.length,
          semAtendimento7:   semAtendimento7.length,
        },
        atendimentosPorLocalidade,
        // As linhas de cada card, na mesma resposta que traz os números.
        detalhes: {
          agendadas:         linhasAgendadas.map(linhaDeAgendamento),
          realizadas:        linhasRealizadas.map(linhaDeAgendamento),
          naoRealizadas:     linhasNaoRealizadas.map(linhaDeAgendamento),
          canceladas:        linhasCanceladas.map(linhaDeAgendamento),
          semAtendimentoDia,
          semAtendimento3,
          semAtendimento7,
        },
      },
    });
  } catch (err) {
    console.error('RelatoriosController.atendimento:', err);
    return res.status(500).json({ error: 'Erro ao gerar relatório de atendimento.' });
  }
};

// ── CADASTRO (Pacientes + Clientes) ─────────────────────────────────────────

const cadastro = async (req, res) => {
  try {
    const { empresaId, animalWhere } = await resolverEscopo(req);
    const { inicio, fim, refDate } = resolverPeriodo(req);
    const clienteBase = { userType: 'PROPRIETARIO', ativo: true, ...(empresaId ? { animais: { some: { empresaId, ativo: true } } } : {}) };

    // Série de novos por mês — 6 meses terminando no mês do refDate
    const seisMesesAtras = new Date(refDate.getFullYear(), refDate.getMonth() - 5, 1, 0, 0, 0, 0);
    const fimSerie       = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0, 23, 59, 59, 999);

    // Animal usa `dataCadastro` como timestamp de criação; User usa `createdAt`.
    const [pacientesAtivos, pacientesNovos, clientesAtivos, clientesNovos, animaisRecentes, clientesRecentes] = await Promise.all([
      prisma.animal.count({ where: animalWhere }),
      prisma.animal.count({ where: { ...animalWhere, dataCadastro: { gte: inicio, lte: fim } } }),
      prisma.user.count({ where: clienteBase }),
      prisma.user.count({ where: { ...clienteBase, createdAt: { gte: inicio, lte: fim } } }),
      prisma.animal.findMany({ where: { ...animalWhere, dataCadastro: { gte: seisMesesAtras, lte: fimSerie } }, select: { dataCadastro: true } }),
      prisma.user.findMany({ where: { ...clienteBase, createdAt: { gte: seisMesesAtras, lte: fimSerie } }, select: { createdAt: true } }),
    ]);

    const bucketMeses = (registros) => {
      const mapa = new Map();
      for (let k = 5; k >= 0; k--) {
        const d = new Date(refDate.getFullYear(), refDate.getMonth() - k, 1);
        mapa.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
      }
      for (const r of registros) {
        const d = new Date(r.createdAt);
        const ref = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (mapa.has(ref)) mapa.set(ref, mapa.get(ref) + 1);
      }
      return [...mapa.entries()].map(([mes, total]) => ({ mes, total }));
    };

    // ── INATIVAÇÕES E REATIVAÇÕES DO PERÍODO (a pedido, 2026-09-08) ──
    //
    // 🔴 A FONTE É O AUDITLOG, e não uma coluna do cadastro. `Animal.inativo_em`
    // guarda só a ÚLTIMA vez, então um paciente inativado em julho e de novo em agosto
    // sumiria de julho; e o cadastro do cliente não tem data de inativação nenhuma. O
    // AuditLog é o ledger: guarda QUANDO, POR QUE e por QUEM, uma linha por ato — que
    // é exatamente o que o relatório pede.
    //
    // ⚠️ Linha gravada ANTES de 2026-09-08 continua com a categoria antiga
    // (`ALTERACAO`/`EXCLUSAO` no caso do cliente) — o AuditLog é imutável, e
    // reescrevê-lo seria adulterar a auditoria. O recorte enxerga daqui em diante.
    const auditoriaCadastro = await prisma.auditLog.findMany({
      where: {
        categoria: { in: ['INATIVACAO', 'ATIVACAO'] },
        entidade:  { in: ['ANIMAL', 'PROPRIETARIO'] },
        timestamp: { gte: inicio, lte: fim },
        ...(empresaId ? { empresaId } : {}),
      },
      orderBy: { timestamp: 'desc' },
      select: {
        categoria: true, entidade: true, entidadeId: true, animalId: true,
        motivo: true, detalhes: true, timestamp: true, userName: true,
      },
    });

    // Nome/local/veterinário de cada alvo — o relatório pede as colunas do paciente,
    // e o AuditLog só guarda o id (ele sobrevive à exclusão do registro, de propósito).
    const idsAnimais = [...new Set(auditoriaCadastro
      .filter(a => a.entidade === 'ANIMAL')
      .map(a => a.entidadeId ?? a.animalId).filter(Boolean))];
    const idsClientes = [...new Set(auditoriaCadastro
      .filter(a => a.entidade === 'PROPRIETARIO').map(a => a.entidadeId).filter(Boolean))];

    const [animaisAud, clientesAud] = await Promise.all([
      idsAnimais.length ? prisma.animal.findMany({
        where:  { id: { in: idsAnimais } },
        select: {
          id: true, nome: true, local: true,
          localizacao: { select: { nome: true } },
          evolucoes: {
            where: { ativo: true, status: 'FINALIZADA' }, orderBy: { dataFim: 'desc' }, take: 1,
            select: { veterinario: { select: { fullName: true } } },
          },
        },
      }) : [],
      idsClientes.length ? prisma.user.findMany({
        where: { id: { in: idsClientes } }, select: { id: true, fullName: true },
      }) : [],
    ]);
    const porIdAnimal  = new Map(animaisAud.map(a => [a.id, a]));
    const porIdCliente = new Map(clientesAud.map(c => [c.id, c]));

    const linhaDeAuditoria = (a) => {
      const ehAnimal = a.entidade === 'ANIMAL';
      const alvo = ehAnimal ? porIdAnimal.get(a.entidadeId ?? a.animalId) : porIdCliente.get(a.entidadeId);
      return {
        animalId:    ehAnimal ? (alvo?.id ?? null) : null,
        // Registro já excluído do banco ainda aparece: o ATO aconteceu, e omiti-lo
        // faria a contagem do card não bater com a lista.
        nome:        alvo?.fullName ?? alvo?.nome ?? (ehAnimal ? 'Paciente removido' : 'Cliente removido'),
        localizacao: ehAnimal ? nomeLocalizacao(alvo ?? {}) : null,
        veterinario: ehAnimal ? (alvo?.evolucoes?.[0]?.veterinario?.fullName ?? null) : null,
        data:        a.timestamp,
        // O motivo é OBRIGATÓRIO em inativação (§33); `detalhes` cobre os atos que o
        // sistema faz sozinho e não têm motivo digitado.
        motivo:      a.motivo || a.detalhes || null,
        por:         a.userName ?? null,
      };
    };

    const doTipo = (categoria, entidade) =>
      auditoriaCadastro.filter(a => a.categoria === categoria && a.entidade === entidade).map(linhaDeAuditoria);

    const pacientesInativados = doTipo('INATIVACAO', 'ANIMAL');
    const pacientesReativados = doTipo('ATIVACAO',   'ANIMAL');
    const clientesInativados  = doTipo('INATIVACAO', 'PROPRIETARIO');
    const clientesReativados  = doTipo('ATIVACAO',   'PROPRIETARIO');

    // Linhas dos quatro cards que já existiam. "Ativos" é a base inteira do escopo —
    // por isso a listagem é do MESMO `where` que conta, e não de uma consulta paralela.
    const detalheAnimal = (a) => ({
      animalId: a.id, nome: a.nome, localizacao: nomeLocalizacao(a),
      veterinario: a.evolucoes?.[0]?.veterinario?.fullName ?? null,
      data: a.dataCadastro ?? null, motivo: null, por: null,
    });
    const SELECT_ANIMAL_DETALHE = {
      id: true, nome: true, local: true, dataCadastro: true,
      localizacao: { select: { nome: true } },
      evolucoes: {
        where: { ativo: true, status: 'FINALIZADA' }, orderBy: { dataFim: 'desc' }, take: 1,
        select: { veterinario: { select: { fullName: true } } },
      },
    };
    const [linhasPacAtivos, linhasPacNovos, linhasCliAtivos, linhasCliNovos] = await Promise.all([
      prisma.animal.findMany({ where: animalWhere, select: SELECT_ANIMAL_DETALHE, orderBy: { nome: 'asc' } }),
      prisma.animal.findMany({ where: { ...animalWhere, dataCadastro: { gte: inicio, lte: fim } }, select: SELECT_ANIMAL_DETALHE, orderBy: { dataCadastro: 'desc' } }),
      prisma.user.findMany({ where: clienteBase, select: { id: true, fullName: true, createdAt: true }, orderBy: { fullName: 'asc' } }),
      prisma.user.findMany({ where: { ...clienteBase, createdAt: { gte: inicio, lte: fim } }, select: { id: true, fullName: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    const detalheCliente = (c) => ({
      animalId: null, nome: c.fullName, localizacao: null, veterinario: null,
      data: c.createdAt, motivo: null, por: null,
    });

    return res.json({
      dados: {
        pacientes: {
          ativos: pacientesAtivos, novos: pacientesNovos,
          inativados: pacientesInativados.length, reativados: pacientesReativados.length,
          novosPorMes: bucketMeses(animaisRecentes.map(r => ({ createdAt: r.dataCadastro }))),
        },
        clientes: {
          ativos: clientesAtivos, novos: clientesNovos,
          inativados: clientesInativados.length, reativados: clientesReativados.length,
          novosPorMes: bucketMeses(clientesRecentes),
        },
        detalhes: {
          pacientesAtivos:     linhasPacAtivos.map(detalheAnimal),
          pacientesNovos:      linhasPacNovos.map(detalheAnimal),
          pacientesInativados,
          pacientesReativados,
          clientesAtivos:      linhasCliAtivos.map(detalheCliente),
          clientesNovos:       linhasCliNovos.map(detalheCliente),
          clientesInativados,
          clientesReativados,
        },
      },
    });
  } catch (err) {
    console.error('RelatoriosController.cadastro:', err);
    return res.status(500).json({ error: 'Erro ao gerar relatório de cadastro.' });
  }
};

// ── FARMÁCIA E ESTOQUE ──────────────────────────────────────────────────────

const valorItemEstoque = (i) =>
  i.precoUnitarioBase != null ? (i.qtdEstoque ?? 0) * i.precoUnitarioBase : (i.valorRepassado || i.valor || 0);

const farmacia = async (req, res) => {
  try {
    const { empresaId, propWhere } = await resolverEscopo(req);
    const { inicio, fim, refDate } = resolverPeriodo(req);
    // Posição de estoque e validade são snapshot "as-of" refDate.
    const agora = refDate;
    const em30dias = new Date(refDate.getTime() + 30 * 86400000);
    const estoqueEmpresa = empresaId ? { empresaId } : {};
    const faturaAtiva = { status: { not: 'CANCELADA' }, ...propWhere };

    const [estoque, saidasPeriodo, medTop, procTop, vacinasTop, lotesVacina] = await Promise.all([
      prisma.estoqueClinica.findMany({
        where:  { ativo: true, ...estoqueEmpresa },
        select: {
          id: true, qtdEstoque: true, precoUnitarioBase: true, valorRepassado: true, valor: true,
          estoqueMinimo: true, lote: true, validade: true, medicamento: { select: { nome: true } },
        },
      }),
      prisma.movimentoEstoque.findMany({
        where:  { tipo: 'SAIDA', createdAt: { gte: inicio, lte: fim }, ...(empresaId ? { estoque: { empresaId } } : {}) },
        select: { estoqueId: true, quantidade: true, estoque: { select: { precoUnitarioBase: true } } },
      }),
      prisma.faturaItem.groupBy({
        by: ['descricao'], where: { tipo: 'MEDICAMENTO', criadoEm: { gte: inicio, lte: fim }, fatura: faturaAtiva },
        _sum: { quantidade: true }, orderBy: { _sum: { quantidade: 'desc' } }, take: 10,
      }),
      prisma.faturaItem.groupBy({
        by: ['descricao'], where: { tipo: 'PROCEDIMENTO', criadoEm: { gte: inicio, lte: fim }, fatura: faturaAtiva },
        _sum: { quantidade: true }, orderBy: { _sum: { quantidade: 'desc' } }, take: 10,
      }),
      prisma.vacinaClinica.groupBy({
        by: ['nome'], where: { ativo: true, dataAplicacao: { gte: inicio, lte: fim }, ...(empresaId ? { animal: { empresaId } } : {}) },
        _count: { _all: true }, orderBy: { _count: { nome: 'desc' } }, take: 10,
      }),
      prisma.loteVacina.findMany({
        where:  { ativo: true, ...(empresaId ? { empresaId } : {}) },
        select: { lote: true, validade: true, qtdDisponivel: true, vacina: { select: { nome: true } } },
      }),
    ]);

    // Valor total + listas de alerta (medicamentos)
    let valorTotalEstoque = 0;
    const abaixoMinimo = [], vencidos = [], vencendo = [];
    for (const i of estoque) {
      valorTotalEstoque += valorItemEstoque(i);
      const nome = i.medicamento?.nome ?? '—';
      if ((i.qtdEstoque ?? 0) <= (i.estoqueMinimo ?? 0)) {
        abaixoMinimo.push({ nome, qtd: i.qtdEstoque, minimo: i.estoqueMinimo, lote: i.lote });
      }
      if (i.validade) {
        const val = new Date(i.validade);
        if (val < agora)            vencidos.push({ categoria: 'Medicamento', nome, lote: i.lote, validade: i.validade, qtd: i.qtdEstoque });
        else if (val <= em30dias)   vencendo.push({ categoria: 'Medicamento', nome, lote: i.lote, validade: i.validade, qtd: i.qtdEstoque });
      }
    }
    // Lotes de vacina nas listas de validade
    for (const l of lotesVacina) {
      const val = new Date(l.validade);
      const reg = { categoria: 'Vacina', nome: l.vacina?.nome ?? '—', lote: l.lote, validade: l.validade, qtd: l.qtdDisponivel };
      if (val < agora)          vencidos.push(reg);
      else if (val <= em30dias) vencendo.push(reg);
    }
    const ordValidade = (a, b) => new Date(a.validade) - new Date(b.validade);
    vencidos.sort(ordValidade); vencendo.sort(ordValidade);
    abaixoMinimo.sort((a, b) => (a.qtd ?? 0) - (b.qtd ?? 0));

    // Produtos sem movimentação (sem SAIDA no período)
    const comSaida = new Set(saidasPeriodo.map(s => s.estoqueId));
    const semMovimentacao = estoque
      .filter(i => !comSaida.has(i.id))
      .map(i => ({ nome: i.medicamento?.nome ?? '—', qtd: i.qtdEstoque, lote: i.lote, validade: i.validade }))
      .sort((a, b) => (b.qtd ?? 0) - (a.qtd ?? 0));

    // Giro de estoque (no período) = valor de saídas ÷ valor atual em estoque
    let valorSaidas = 0;
    for (const s of saidasPeriodo) valorSaidas += (s.quantidade ?? 0) * (s.estoque?.precoUnitarioBase ?? 0);
    const giro = valorTotalEstoque > 0 ? valorSaidas / valorTotalEstoque : 0;

    // ── Ajustes de estoque no período (produtos com ajuste manual) ──────────
    // Fonte: AuditLog (categoria AJUSTE, entidade ESTOQUE_FARMACIA), gravado por
    // EstoqueController.ajustarEstoque — é ele que traz QUEM/QUANDO/O QUÊ (o
    // MovimentoEstoque não guarda o autor). Agrupado por MEDICAMENTO (produto,
    // não por lote), em ORDEM DECRESCENTE de quantidade de alterações.
    const ajustesLog = await prisma.auditLog.findMany({
      where: {
        categoria: 'AJUSTE', entidade: 'ESTOQUE_FARMACIA',
        ...(empresaId ? { empresaId } : {}),
        timestamp: { gte: inicio, lte: fim },
      },
      select:  { entidadeId: true, userName: true, timestamp: true, detalhes: true, motivo: true },
      orderBy: { timestamp: 'desc' },
    });
    const idsEstoqueAjuste = [...new Set(ajustesLog.map(a => a.entidadeId).filter(v => v != null))];
    const estoquesAjuste = idsEstoqueAjuste.length
      ? await prisma.estoqueClinica.findMany({
          where:  { id: { in: idsEstoqueAjuste } },
          select: { id: true, medicamentoId: true, medicamento: { select: { nome: true } } },
        })
      : [];
    const nomeMedPorEstoque  = new Map(estoquesAjuste.map(e => [e.id, e.medicamento?.nome ?? null]));
    const chaveMedPorEstoque = new Map(estoquesAjuste.map(e => [e.id, e.medicamentoId]));
    const gruposAjuste = new Map(); // chave = medicamentoId (agrega lotes do mesmo produto)
    for (const a of ajustesLog) {
      const nome  = nomeMedPorEstoque.get(a.entidadeId) ?? 'Produto removido';
      const chave = chaveMedPorEstoque.get(a.entidadeId) ?? `estoque:${a.entidadeId}`;
      if (!gruposAjuste.has(chave)) gruposAjuste.set(chave, { medicamento: nome, total: 0, itens: [] });
      const g = gruposAjuste.get(chave);
      g.total += 1;
      g.itens.push({
        quando:    a.timestamp,
        quem:      a.userName || '—',
        alteracao: a.detalhes || '—',
        motivo:    a.motivo || null,
      });
    }
    const ajustes = [...gruposAjuste.values()].sort((a, b) => b.total - a.total);

    return res.json({
      dados: {
        valorTotalEstoque,
        totais: { abaixoMinimo: abaixoMinimo.length, vencidos: vencidos.length, vencendo: vencendo.length, semMovimentacao: semMovimentacao.length },
        abaixoMinimo, vencidos, vencendo, semMovimentacao,
        ajustes,
        consumo: {
          medicamentosMaisVendidos: medTop.map(m => ({ nome: m.descricao, quantidade: m._sum.quantidade ?? 0 })),
          procedimentosMaisRealizados: procTop.map(p => ({ nome: p.descricao, quantidade: p._sum.quantidade ?? 0 })),
          vacinasMaisAplicadas: vacinasTop.map(v => ({ nome: v.nome, quantidade: v._count._all })),
          giroEstoque: giro,
        },
      },
    });
  } catch (err) {
    console.error('RelatoriosController.farmacia:', err);
    return res.status(500).json({ error: 'Erro ao gerar relatório de farmácia.' });
  }
};

// ── Orçamentos ────────────────────────────────────────────────────────────────
// Orçamentos por status (aprovado / parcial / rejeitado), com quebra por
// proprietário e por animal, no período. Escopo pela empresa ativa.
const orcamentos = async (req, res) => {
  try {
    const { empresaId } = await resolverEscopo(req);
    const { inicio, fim } = resolverPeriodo(req);

    // ⚠️ `ativo: true` sai daqui: o CANCELADO é justamente um dos recortes pedidos, e
    // o cancelamento (manual ou pelo cron de validade) é o que o relatório precisa
    // mostrar com o MOTIVO. Filtrar por ativo escondia o card inteiro.
    const lista = await prisma.orcamento.findMany({
      where: {
        ...(empresaId ? { empresaId } : {}),
        createdAt: { gte: inicio, lte: fim },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, numero: true, status: true, createdAt: true, ativo: true,
        // O motivo do cancelamento é ACRESCENTADO à observação (mesmo padrão do
        // `orcamentoCronService`) — é de lá que sai a coluna "Motivo" da lista.
        observacao: true,
        proprietario: { select: { id: true, fullName: true } },
        itens: {
          select: {
            id: true, valorTotal: true, statusItem: true, descricao: true, tipo: true,
            animal: { select: { id: true, nome: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });

    const contagem = { RASCUNHO: 0, APROVADO: 0, APROVADO_PARCIALMENTE: 0, REJEITADO: 0, CANCELADO: 0 };
    let valorTotal = 0, valorAprovado = 0, valorRejeitado = 0;
    const porProp   = new Map(); // id → { nome, quantidade, total, aceito }
    const porAnimal = new Map(); // nome → { nome, total, aceito }

    for (const o of lista) {
      const total  = o.itens.reduce((s, i) => s + (i.valorTotal ?? 0), 0);
      const aceito = o.itens.filter(i => i.statusItem === 'ACEITO').reduce((s, i) => s + (i.valorTotal ?? 0), 0);
      // O rejeitado é o que o cliente recusou de fato — item REJEITADO. Item PENDENTE
      // não entra: ele ainda não foi decidido, e contá-lo como recusa inventaria uma
      // decisão que ninguém tomou.
      const recusado = o.itens.filter(i => i.statusItem === 'REJEITADO').reduce((s, i) => s + (i.valorTotal ?? 0), 0);
      contagem[o.status] = (contagem[o.status] ?? 0) + 1;
      valorTotal     += total;
      valorAprovado  += aceito;
      valorRejeitado += recusado;

      const p = porProp.get(o.proprietario.id) ?? { nome: o.proprietario.fullName, quantidade: 0, total: 0, aceito: 0 };
      p.quantidade++; p.total += total; p.aceito += aceito;
      porProp.set(o.proprietario.id, p);

      for (const i of o.itens) {
        const nome = i.animal?.nome ?? 'Proprietário (sem animal)';
        const a = porAnimal.get(nome) ?? { nome, total: 0, aceito: 0 };
        a.total += (i.valorTotal ?? 0);
        if (i.statusItem === 'ACEITO') a.aceito += (i.valorTotal ?? 0);
        porAnimal.set(nome, a);
      }
    }

    // O motivo mora nas colunas novas, lidas por SQL cru (§11) — ver
    // `lib/orcamentoRecusa.js`. Uma consulta para os orçamentos, outra para os itens.
    //
    // 🔴 O MOTIVO POR ITEM É O QUE FAZ O "APROVADO PARCIALMENTE" TER SENTIDO (a pedido,
    // 2026-09-08): saber que 3 de 7 caíram, sem saber QUAIS e POR QUÊ, não permite
    // renegociar nada. Por isso a linha do orçamento carrega a quebra por item.
    const motivosOrc = await motivosDeOrcamentos(lista.map(o => o.id));
    const motivosItem = await motivosDeItens(
      lista.flatMap(o => o.itens.filter(i => i.statusItem === 'REJEITADO').map(i => i.id)),
    );

    /**
     * Linha do detalhe, na forma que o pedido fixou: proprietário, animal, data do
     * orçamento, valor e o MOTIVO.
     *
     * ⚠️ O motivo vem de três lugares distintos, nesta ordem, porque são três atos:
     *   1. recusa do orçamento inteiro (`motivo_recusa`);
     *   2. cancelamento — manual ou pelo cron de validade —, que o sistema ACRESCENTA
     *      à `observacao` (mesmo padrão do `orcamentoCronService`);
     *   3. nada disso: o orçamento não foi recusado, e a coluna sai vazia.
     */
    const linhaDeOrcamento = (o) => {
      const total  = o.itens.reduce((s, i) => s + (i.valorTotal ?? 0), 0);
      // Um orçamento pode ter itens de vários animais — a coluna diz quantos, em vez
      // de escolher um e esconder os outros.
      const nomes  = [...new Set(o.itens.map(i => i.animal?.nome).filter(Boolean))];
      const motivoDoOrcamento = motivosOrc.get(o.id) || null;
      // O item recusado SEM motivo próprio herda o do orçamento — é assim que a
      // decisão é gravada (um motivo só quando a razão é uma só), e a tela precisa
      // mostrar o mesmo que foi decidido, não uma lacuna.
      const doItem = (i) => ({
        id:        i.id,
        descricao: i.descricao,
        tipo:      i.tipo,
        animal:    i.animal?.nome ?? null,
        valor:     i.valorTotal ?? 0,
        motivo:    i.statusItem === 'REJEITADO'
          ? (motivosItem.get(i.id) || motivoDoOrcamento || null)
          : null,
      });
      const aprovados = o.itens.filter(i => i.statusItem === 'ACEITO');
      const recusados = o.itens.filter(i => i.statusItem === 'REJEITADO');
      // PENDENTE existe enquanto ninguém decidiu (rascunho). Somá-lo a um dos dois
      // lados afirmaria uma decisão que não houve.
      const pendentes = o.itens.filter(i => i.statusItem === 'PENDENTE');

      return {
        id:           o.id,
        numero:       o.numero,
        proprietario: o.proprietario?.fullName ?? '—',
        animal:       nomes.length === 0 ? null
                    : nomes.length === 1 ? nomes[0]
                    : `${nomes[0]} +${nomes.length - 1}`,
        data:         o.createdAt,
        valor:        total,
        status:       o.status,
        motivo:       motivoDoOrcamento || (o.status === 'CANCELADO' ? (o.observacao || null) : null),
        // Quebra por item — o que o card "Aprovados parcial." precisa mostrar.
        itens: {
          total:      o.itens.length,
          aprovados:  aprovados.length,
          recusados:  recusados.length,
          pendentes:  pendentes.length,
          valorAprovado: aprovados.reduce((s, i) => s + (i.valorTotal ?? 0), 0),
          valorRecusado: recusados.reduce((s, i) => s + (i.valorTotal ?? 0), 0),
          lista: [...aprovados.map(doItem), ...recusados.map(doItem), ...pendentes.map(doItem)]
            .map((it, idx) => ({
              ...it,
              // O status vem da posição na concatenação acima — mais barato que
              // reprocessar, e a ordem é a que a tela mostra: aprovados primeiro.
              statusItem: idx < aprovados.length ? 'ACEITO'
                        : idx < aprovados.length + recusados.length ? 'REJEITADO'
                        : 'PENDENTE',
            })),
        },
      };
    };

    const linhas = lista.map(linhaDeOrcamento);
    const doStatus = (st) => linhas.filter(l => l.status === st);
    // "Valor" é o do card: nos de VALOR a lista é a mesma do recorte que o número soma.
    const comValorRejeitado = linhas.filter(l => l.status === 'REJEITADO' || l.status === 'APROVADO_PARCIALMENTE');

    return res.json({ dados: {
      resumo: {
        total:       lista.length,
        aprovados:   contagem.APROVADO,
        parciais:    contagem.APROVADO_PARCIALMENTE,
        rejeitados:  contagem.REJEITADO,
        rascunhos:   contagem.RASCUNHO,
        cancelados:  contagem.CANCELADO,
        valorTotal, valorAprovado, valorRejeitado,
      },
      detalhes: {
        valorTotal:     linhas,
        valorAprovado:  linhas.filter(l => l.status === 'APROVADO' || l.status === 'APROVADO_PARCIALMENTE'),
        valorRejeitado: comValorRejeitado,
        aprovados:      doStatus('APROVADO'),
        parciais:       doStatus('APROVADO_PARCIALMENTE'),
        rejeitados:     doStatus('REJEITADO'),
        cancelados:     doStatus('CANCELADO'),
        rascunhos:      doStatus('RASCUNHO'),
      },
      porStatus: [
        { status: 'Aprovado',              quantidade: contagem.APROVADO },
        { status: 'Aprovado Parcialmente', quantidade: contagem.APROVADO_PARCIALMENTE },
        { status: 'Rejeitado',             quantidade: contagem.REJEITADO },
        { status: 'Rascunho',              quantidade: contagem.RASCUNHO },
        { status: 'Cancelado',             quantidade: contagem.CANCELADO },
      ],
      porProprietario: [...porProp.values()].sort((a, b) => b.total - a.total),
      porAnimal:       [...porAnimal.values()].sort((a, b) => b.total - a.total),
    }});
  } catch (err) {
    console.error('RelatoriosController.orcamentos:', err);
    return res.status(500).json({ error: 'Erro ao gerar relatório de orçamentos.' });
  }
};

module.exports = { financeiro, computarFinanceiro, atendimento, cadastro, farmacia, orcamentos };

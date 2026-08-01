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
const {
  resolverEscopo,
  resolverPeriodo,
  somaEmMapa,
  mapaParaLista,
  nomeLocalizacao,
  SEM_LOCALIZACAO,
} = require('./RelatorioGerencialController');

const { valorLiquidoItem } = require('../lib/faturaUtils');

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
        where:  { status: { in: ['ABERTA', 'FECHADA'] }, ...propWhere },
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
    const lucroBruto = faturamentoPeriodo - custoProdutos;
    const margemPct  = faturamentoPeriodo > 0 ? (lucroBruto / faturamentoPeriodo) * 100 : 0;

    return {
      faturamento: { periodo: faturamentoPeriodo, ano: faturamentoAno, granularidade },
      ticketMedio: { porAtendimento: ticketPorAtendimento, porCliente: ticketPorCliente, atendimentosPeriodo: evolucoesPeriodo, clientesPeriodo: clientesDoPeriodo.size },
      porEspecialidade: mapaParaLista(porEspecialidade, 'especialidade', 'receita'),
      porCategoria:     mapaParaLista(porCategoria,     'categoria',     'receita'),
      contasReceber, contasVencidas, inadimplencia,
      fluxoCaixa: { mediaMensal, historico: ultimos3.reverse(), projecao },
      lucroBruto: { receita: faturamentoPeriodo, custoProdutos, lucro: lucroBruto, margemPct },
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

const atendimento = async (req, res) => {
  try {
    const { empresaId } = await resolverEscopo(req);
    const { inicio, fim } = resolverPeriodo(req);
    const escopoAnimal = empresaId ? { animal: { empresaId } } : {};

    // Todas as 4 métricas de consulta vêm de AgendamentoClinico (mesma fonte, mesma
    // janela de dataHora) — evita misturar "agendadas" (agenda) com "realizadas"
    // (evolução), que podiam divergir. "agendadas" = total marcado no período,
    // qualquer status; os outros 3 são subconjuntos por status.
    const [agendadas, realizadas, canceladas, naoRealizadas, procedimentos, exames] = await Promise.all([
      prisma.agendamentoClinico.count({ where: { ativo: true, dataHora: { gte: inicio, lte: fim }, ...escopoAnimal } }),
      prisma.agendamentoClinico.count({ where: { ativo: true, status: { in: ['CONCLUIDO', 'FINALIZADO'] }, dataHora: { gte: inicio, lte: fim }, ...escopoAnimal } }),
      prisma.agendamentoClinico.count({ where: { ativo: true, status: 'CANCELADO', dataHora: { gte: inicio, lte: fim }, ...escopoAnimal } }),
      // ATRASADA = já passou do horário (+30min) e ainda não foi concluída nem cancelada
      prisma.agendamentoClinico.count({ where: { ativo: true, status: 'ATRASADA', dataHora: { gte: inicio, lte: fim }, ...escopoAnimal } }),
      prisma.prescricao.count({         where: { ativo: true, tipo: 'PROCEDIMENTO', executadoEm:     { gte: inicio, lte: fim }, ...escopoAnimal } }),
      prisma.exameClinico.count({       where: { ativo: true, dataSolicitacao: { gte: inicio, lte: fim }, ...escopoAnimal } }),
    ]);

    // Atendimentos por animal e localidade: um "atendimento" = uma evolução clínica
    // FINALIZADA no período (mesmo critério de "atendido" usado no Mapa de
    // Atendimento — agendado/em andamento não conta, só depois de finalizar).
    // Ex.: na semana o Haras Centauro teve 5 atendimentos, 4 do Dentinho.
    const evolucoesFinalizadas = await prisma.evolucaoClinica.findMany({
      where: { ativo: true, status: 'FINALIZADA', dataFim: { gte: inicio, lte: fim }, ...escopoAnimal },
      select: { animal: { select: { id: true, nome: true, local: true, localizacao: { select: { nome: true } } } } },
    });
    const porLocalAnimal = new Map(); // localizacao → Map(animalNome → total)
    for (const ev of evolucoesFinalizadas) {
      const localNome  = ev.animal ? nomeLocalizacao(ev.animal) : SEM_LOCALIZACAO;
      const animalNome = ev.animal?.nome ?? 'Sem animal vinculado';
      if (!porLocalAnimal.has(localNome)) porLocalAnimal.set(localNome, new Map());
      const porAnimal = porLocalAnimal.get(localNome);
      somaEmMapa(porAnimal, animalNome, 1);
    }
    const atendimentosPorLocalidade = [...porLocalAnimal.entries()]
      .map(([localizacao, porAnimal]) => {
        const animais = mapaParaLista(porAnimal, 'animal', 'total').sort((a, b) => b.total - a.total);
        const total = animais.reduce((s, a) => s + a.total, 0);
        return { localizacao, total, animais };
      })
      .sort((a, b) => b.total - a.total);

    return res.json({
      dados: {
        periodo: { agendadas, realizadas, canceladas, naoRealizadas, procedimentos, exames },
        atendimentosPorLocalidade,
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

    return res.json({
      dados: {
        pacientes: { ativos: pacientesAtivos, novos: pacientesNovos, novosPorMes: bucketMeses(animaisRecentes.map(r => ({ createdAt: r.dataCadastro }))) },
        clientes:  { ativos: clientesAtivos,  novos: clientesNovos,  novosPorMes: bucketMeses(clientesRecentes) },
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

    return res.json({
      dados: {
        valorTotalEstoque,
        totais: { abaixoMinimo: abaixoMinimo.length, vencidos: vencidos.length, vencendo: vencendo.length, semMovimentacao: semMovimentacao.length },
        abaixoMinimo, vencidos, vencendo, semMovimentacao,
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

    const lista = await prisma.orcamento.findMany({
      where: {
        ativo: true,
        ...(empresaId ? { empresaId } : {}),
        createdAt: { gte: inicio, lte: fim },
      },
      select: {
        id: true, numero: true, status: true, createdAt: true,
        proprietario: { select: { id: true, fullName: true } },
        itens: { select: { valorTotal: true, statusItem: true, animal: { select: { nome: true } } } },
      },
    });

    const contagem = { RASCUNHO: 0, APROVADO: 0, APROVADO_PARCIALMENTE: 0, REJEITADO: 0 };
    let valorTotal = 0, valorAprovado = 0;
    const porProp   = new Map(); // id → { nome, quantidade, total, aceito }
    const porAnimal = new Map(); // nome → { nome, total, aceito }

    for (const o of lista) {
      const total  = o.itens.reduce((s, i) => s + (i.valorTotal ?? 0), 0);
      const aceito = o.itens.filter(i => i.statusItem === 'ACEITO').reduce((s, i) => s + (i.valorTotal ?? 0), 0);
      contagem[o.status] = (contagem[o.status] ?? 0) + 1;
      valorTotal    += total;
      valorAprovado += aceito;

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

    return res.json({ dados: {
      resumo: {
        total:       lista.length,
        aprovados:   contagem.APROVADO,
        parciais:    contagem.APROVADO_PARCIALMENTE,
        rejeitados:  contagem.REJEITADO,
        rascunhos:   contagem.RASCUNHO,
        valorTotal, valorAprovado,
      },
      porStatus: [
        { status: 'Aprovado',              quantidade: contagem.APROVADO },
        { status: 'Aprovado Parcialmente', quantidade: contagem.APROVADO_PARCIALMENTE },
        { status: 'Rejeitado',             quantidade: contagem.REJEITADO },
        { status: 'Rascunho',              quantidade: contagem.RASCUNHO },
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

// backend/src/controllers/RelatoriosController.js
// Relatórios por categoria (Financeiro, Atendimento, Cadastro, Farmácia).
// Escopo por empresa ativa via resolverEscopo (mesmo padrão do RelatorioGerencialController).
// Todas as rotas exigem relatorios.gerencial.ler (nível gestor).
'use strict';

const prisma = require('../lib/prisma').default;
const {
  resolverEscopo,
  mesReferenciaAtual,
  somaEmMapa,
  mapaParaLista,
} = require('./RelatorioGerencialController');

// ── Datas ───────────────────────────────────────────────────────────────────
function janelas() {
  const agora = new Date();
  const y = agora.getFullYear();
  const m = agora.getMonth();
  const inicioDia = new Date(y, m, agora.getDate(), 0, 0, 0, 0);
  const fimDia    = new Date(y, m, agora.getDate(), 23, 59, 59, 999);
  const inicioMes = new Date(y, m, 1, 0, 0, 0, 0);
  const inicioAno = new Date(y, 0, 1, 0, 0, 0, 0);
  return { agora, inicioDia, fimDia, inicioMes, inicioAno };
}

const receitaDoItem = (i) => (i.valor ?? 0) * (i.quantidade ?? 1);

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

const financeiro = async (req, res) => {
  try {
    const { empresaId, propWhere } = await resolverEscopo(req);
    const { inicioDia, fimDia, inicioMes, inicioAno } = janelas();
    const mesAtual = mesReferenciaAtual();
    const faturaAtiva = { status: { not: 'CANCELADA' }, ...propWhere };

    // Itens do ano (faturamento dia/mês/ano) + itens do mês com origem (especialidade/categoria)
    const [itensAno, itensMes, evolucoesMes, faturasReceber] = await Promise.all([
      prisma.faturaItem.findMany({
        where:  { criadoEm: { gte: inicioAno }, fatura: faturaAtiva },
        select: { valor: true, quantidade: true, criadoEm: true },
      }),
      prisma.faturaItem.findMany({
        where:  { criadoEm: { gte: inicioMes }, fatura: faturaAtiva },
        select: {
          id: true, valor: true, quantidade: true, tipo: true,
          exameClinicoId: true, prescricaoId: true, vacinaClinicaId: true, encaminhamentoClinicoId: true,
          fatura: { select: { proprietarioId: true } },
        },
      }),
      prisma.evolucaoClinica.count({
        where: { ativo: true, status: 'FINALIZADA', dataFim: { gte: inicioMes }, ...(empresaId ? { animal: { empresaId } } : {}) },
      }),
      prisma.fatura.findMany({
        where:  { status: { in: ['ABERTA', 'FECHADA'] }, ...propWhere },
        select: { total: true, mesReferencia: true },
      }),
    ]);

    // Faturamento por janela
    let faturamentoDia = 0, faturamentoMes = 0, faturamentoAno = 0;
    for (const i of itensAno) {
      const v = receitaDoItem(i);
      faturamentoAno += v;
      const t = new Date(i.criadoEm).getTime();
      if (t >= inicioMes.getTime()) faturamentoMes += v;
      if (t >= inicioDia.getTime() && t <= fimDia.getTime()) faturamentoDia += v;
    }

    // Ticket médio (mês)
    const clientesDoMes = new Set(itensMes.map(i => i.fatura?.proprietarioId).filter(Boolean));
    const ticketPorAtendimento = evolucoesMes > 0 ? faturamentoMes / evolucoesMes : 0;
    const ticketPorCliente     = clientesDoMes.size > 0 ? faturamentoMes / clientesDoMes.size : 0;

    // Receita por especialidade (mês) + por categoria (mês)
    const espMap = await especialidadePorItem(itensMes);
    const porEspecialidade = new Map();
    const porCategoria     = new Map();
    for (const i of itensMes) {
      const v = receitaDoItem(i);
      somaEmMapa(porEspecialidade, espMap.get(i.id) ?? 'Sem especialidade', v);
      somaEmMapa(porCategoria,     categoriaDoItem(i), v);
    }

    // Contas a receber / vencidas / inadimplência
    let contasReceber = 0, contasVencidas = 0;
    for (const f of faturasReceber) {
      contasReceber += f.total ?? 0;
      if (f.mesReferencia && f.mesReferencia < mesAtual) contasVencidas += f.total ?? 0;
    }
    const inadimplencia = contasReceber > 0 ? (contasVencidas / contasReceber) * 100 : 0;

    // Fluxo de caixa projetado — média dos últimos 3 meses recebidos (faturas PAGA)
    const pagas = await prisma.fatura.groupBy({
      by:    ['mesReferencia'],
      where: { status: 'PAGA', mesReferencia: { not: null }, ...propWhere },
      _sum:  { total: true },
    });
    const recebidoPorMes = new Map(pagas.map(p => [p.mesReferencia, p._sum.total ?? 0]));
    const ultimos3 = [];
    const base = new Date();
    for (let k = 1; k <= 3; k++) {
      const d = new Date(base.getFullYear(), base.getMonth() - k, 1);
      const ref = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      ultimos3.push({ mes: ref, valor: recebidoPorMes.get(ref) ?? 0, tipo: 'realizado' });
    }
    const mediaMensal = ultimos3.reduce((s, r) => s + r.valor, 0) / 3;
    const projecao = [];
    for (let k = 1; k <= 3; k++) {
      const d = new Date(base.getFullYear(), base.getMonth() + k, 1);
      const ref = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      projecao.push({ mes: ref, valor: mediaMensal, tipo: 'projetado' });
    }

    // Lucro bruto estimado (mês) = receita − custo dos produtos consumidos
    const [saidas, vacinasMes] = await Promise.all([
      prisma.movimentoEstoque.findMany({
        where:  { tipo: 'SAIDA', createdAt: { gte: inicioMes }, ...(empresaId ? { estoque: { empresaId } } : {}) },
        select: { quantidade: true, estoque: { select: { precoUnitarioBase: true } } },
      }),
      prisma.vacinaClinica.findMany({
        where:  { ativo: true, cliente: false, dataAplicacao: { gte: inicioMes }, loteId: { not: null }, ...(empresaId ? { animal: { empresaId } } : {}) },
        select: { quantidade: true, loteVacina: { select: { valorUnitario: true } } },
      }),
    ]);
    let custoProdutos = 0;
    for (const s of saidas) custoProdutos += (s.quantidade ?? 0) * (s.estoque?.precoUnitarioBase ?? 0);
    for (const v of vacinasMes) custoProdutos += (v.quantidade ?? 1) * (v.loteVacina?.valorUnitario ?? 0);
    const lucroBruto = faturamentoMes - custoProdutos;
    const margemPct  = faturamentoMes > 0 ? (lucroBruto / faturamentoMes) * 100 : 0;

    return res.json({
      dados: {
        faturamento: { dia: faturamentoDia, mes: faturamentoMes, ano: faturamentoAno },
        ticketMedio: { porAtendimento: ticketPorAtendimento, porCliente: ticketPorCliente, atendimentosMes: evolucoesMes, clientesMes: clientesDoMes.size },
        porEspecialidade: mapaParaLista(porEspecialidade, 'especialidade', 'receita'),
        porCategoria:     mapaParaLista(porCategoria,     'categoria',     'receita'),
        contasReceber, contasVencidas, inadimplencia,
        fluxoCaixa: { mediaMensal, historico: ultimos3.reverse(), projecao },
        lucroBruto: { receita: faturamentoMes, custoProdutos, lucro: lucroBruto, margemPct },
      },
    });
  } catch (err) {
    console.error('RelatoriosController.financeiro:', err);
    return res.status(500).json({ error: 'Erro ao gerar relatório financeiro.' });
  }
};

// ── ATENDIMENTO ─────────────────────────────────────────────────────────────

const atendimento = async (req, res) => {
  try {
    const { empresaId } = await resolverEscopo(req);
    const { inicioDia, fimDia, inicioMes } = janelas();
    const escopoAnimal = empresaId ? { animal: { empresaId } } : {};

    const [
      agendadasHoje, realizadasHoje, canceladasMes,
      atendimentosMes, procedimentosMes, examesMes,
    ] = await Promise.all([
      prisma.agendamentoClinico.count({ where: { ativo: true, status: 'AGENDADO', dataHora: { gte: inicioDia, lte: fimDia }, ...escopoAnimal } }),
      prisma.evolucaoClinica.count({ where: { ativo: true, status: 'FINALIZADA', dataFim: { gte: inicioDia, lte: fimDia }, ...escopoAnimal } }),
      prisma.agendamentoClinico.count({ where: { ativo: true, status: 'CANCELADO', dataHora: { gte: inicioMes }, ...escopoAnimal } }),
      prisma.evolucaoClinica.count({ where: { ativo: true, dataInicio: { gte: inicioMes }, ...escopoAnimal } }),
      prisma.prescricao.count({ where: { ativo: true, tipo: 'PROCEDIMENTO', executadoEm: { gte: inicioMes }, ...escopoAnimal } }),
      prisma.exameClinico.count({ where: { ativo: true, dataSolicitacao: { gte: inicioMes }, ...escopoAnimal } }),
    ]);

    return res.json({
      dados: {
        hoje: { agendadas: agendadasHoje, realizadas: realizadasHoje },
        mes:  { atendimentos: atendimentosMes, canceladas: canceladasMes, procedimentos: procedimentosMes, exames: examesMes },
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
    const { inicioMes } = janelas();
    const clienteBase = { userType: 'PROPRIETARIO', ativo: true, ...(empresaId ? { animais: { some: { empresaId, ativo: true } } } : {}) };

    // Série de novos por mês (últimos 6 meses)
    const seisMesesAtras = new Date();
    seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 5);
    seisMesesAtras.setDate(1); seisMesesAtras.setHours(0, 0, 0, 0);

    const [pacientesAtivos, pacientesNovosMes, clientesAtivos, clientesNovosMes, animaisRecentes, clientesRecentes] = await Promise.all([
      prisma.animal.count({ where: animalWhere }),
      prisma.animal.count({ where: { ...animalWhere, createdAt: { gte: inicioMes } } }),
      prisma.user.count({ where: clienteBase }),
      prisma.user.count({ where: { ...clienteBase, createdAt: { gte: inicioMes } } }),
      prisma.animal.findMany({ where: { ...animalWhere, createdAt: { gte: seisMesesAtras } }, select: { createdAt: true } }),
      prisma.user.findMany({ where: { ...clienteBase, createdAt: { gte: seisMesesAtras } }, select: { createdAt: true } }),
    ]);

    const bucketMeses = (registros) => {
      const mapa = new Map();
      for (let k = 5; k >= 0; k--) {
        const d = new Date();
        d.setMonth(d.getMonth() - k);
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
        pacientes: { ativos: pacientesAtivos, novosMes: pacientesNovosMes, novosPorMes: bucketMeses(animaisRecentes) },
        clientes:  { ativos: clientesAtivos,  novosMes: clientesNovosMes,  novosPorMes: bucketMeses(clientesRecentes) },
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
    const agora = new Date();
    const em30dias = new Date(agora.getTime() + 30 * 86400000);
    const inicio90 = new Date(agora.getTime() - 90 * 86400000);
    const estoqueEmpresa = empresaId ? { empresaId } : {};

    const [estoque, saidas90, medTop, procTop, vacinasTop, lotesVacina] = await Promise.all([
      prisma.estoqueClinica.findMany({
        where:  { ativo: true, ...estoqueEmpresa },
        select: {
          id: true, qtdEstoque: true, precoUnitarioBase: true, valorRepassado: true, valor: true,
          estoqueMinimo: true, lote: true, validade: true, medicamento: { select: { nome: true } },
        },
      }),
      prisma.movimentoEstoque.findMany({
        where:  { tipo: 'SAIDA', createdAt: { gte: inicio90 }, ...(empresaId ? { estoque: { empresaId } } : {}) },
        select: { estoqueId: true, quantidade: true, estoque: { select: { precoUnitarioBase: true } } },
      }),
      prisma.faturaItem.groupBy({
        by: ['descricao'], where: { tipo: 'MEDICAMENTO', fatura: { status: { not: 'CANCELADA' }, ...propWhere } },
        _sum: { quantidade: true }, orderBy: { _sum: { quantidade: 'desc' } }, take: 10,
      }),
      prisma.faturaItem.groupBy({
        by: ['descricao'], where: { tipo: 'PROCEDIMENTO', fatura: { status: { not: 'CANCELADA' }, ...propWhere } },
        _sum: { quantidade: true }, orderBy: { _sum: { quantidade: 'desc' } }, take: 10,
      }),
      prisma.vacinaClinica.groupBy({
        by: ['nome'], where: { ativo: true, ...(empresaId ? { animal: { empresaId } } : {}) },
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

    // Produtos sem movimentação (sem SAIDA nos últimos 90 dias)
    const comSaida = new Set(saidas90.map(s => s.estoqueId));
    const semMovimentacao = estoque
      .filter(i => !comSaida.has(i.id))
      .map(i => ({ nome: i.medicamento?.nome ?? '—', qtd: i.qtdEstoque, lote: i.lote, validade: i.validade }))
      .sort((a, b) => (b.qtd ?? 0) - (a.qtd ?? 0));

    // Giro de estoque (estimado) = valor de saídas (90d) ÷ valor atual em estoque
    let valorSaidas90 = 0;
    for (const s of saidas90) valorSaidas90 += (s.quantidade ?? 0) * (s.estoque?.precoUnitarioBase ?? 0);
    const giro = valorTotalEstoque > 0 ? valorSaidas90 / valorTotalEstoque : 0;

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

module.exports = { financeiro, atendimento, cadastro, farmacia };

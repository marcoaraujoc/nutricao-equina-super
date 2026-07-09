// backend/src/controllers/RelatorioGerencialController.js
// Módulo Relatórios — indicadores gerenciais da empresa ativa (req.empresaId).
// Um único endpoint agrega todos os blocos; cada bloco é calculado de forma
// independente em Promise.all. Escopo segue o padrão do DashboardController:
// filtro por empresaId quando presente (ADMIN sem contexto → visão global).
//
// Definições adotadas:
// - Atendimento emergencial: FaturaItem cuja descrição contém "emergen"
//   (lançamento "Atd. Emergencial" do Faturamento), em fatura não cancelada.
// - Receita bruta  = soma de valor×qtd dos itens em faturas ABERTA/FECHADA/PAGA (faturado).
// - Receita líquida = soma de valor×qtd dos itens em faturas PAGA (efetivamente recebido).
// - Devedor: proprietário com fatura ABERTA/FECHADA de mês anterior ao atual;
//   meses em atraso = distância em meses do mês devido mais antigo até o mês atual.
// - Fatura corrigida: qtdCorrecoes > 0 (item existente alterado/removido — ver faturaUtils).
// - Evolução editada: FINALIZADA com dataModificacao > dataFim + 60s
//   (alterada DEPOIS de finalizada — edições durante o atendimento não contam).
'use strict';

const prisma = require('../lib/prisma').default;
const { formatAtendimentoNum } = require('../lib/faturaUtils');

const SEM_LOCALIZACAO = 'Sem localização';

function nomeLocalizacao(animal) {
  return animal?.localizacao?.nome ?? animal?.local ?? SEM_LOCALIZACAO;
}

function mesReferenciaAtual() {
  return new Date().toISOString().slice(0, 7); // "2026-07"
}

/** Distância em meses entre "YYYY-MM" e o mês atual (ex: 2026-05 → 2026-07 = 2). */
function mesesDesde(mesRef, mesAtual) {
  if (!mesRef) return 0;
  const [ano, mes]   = mesRef.split('-').map(Number);
  const [anoA, mesA] = mesAtual.split('-').map(Number);
  return Math.max((anoA - ano) * 12 + (mesA - mes), 0);
}

function somaEmMapa(mapa, chave, valor) {
  mapa.set(chave, (mapa.get(chave) ?? 0) + valor);
}

function mapaParaLista(mapa, chaveNome, valorNome) {
  return [...mapa.entries()]
    .map(([k, v]) => ({ [chaveNome]: k, [valorNome]: v }))
    .sort((a, b) => b[valorNome] - a[valorNome]);
}

// ── Blocos ────────────────────────────────────────────────────────────────────

async function blocoEmergencias(propWhere) {
  const itens = await prisma.faturaItem.findMany({
    where: {
      descricao: { contains: 'emergen', mode: 'insensitive' },
      fatura:    { status: { not: 'CANCELADA' }, ...propWhere },
    },
    select: {
      quantidade: true,
      animal: { select: { id: true, nome: true, local: true, localizacao: { select: { nome: true } } } },
    },
  });

  let total = 0;
  const porCavalo      = new Map();
  const porLocalizacao = new Map();
  for (const item of itens) {
    const qtd = item.quantidade || 1;
    total += qtd;
    somaEmMapa(porCavalo,      item.animal?.nome ?? 'Sem animal vinculado', qtd);
    somaEmMapa(porLocalizacao, item.animal ? nomeLocalizacao(item.animal) : SEM_LOCALIZACAO, qtd);
  }
  return {
    total,
    porCavalo:      mapaParaLista(porCavalo,      'nome',        'quantidade'),
    porLocalizacao: mapaParaLista(porLocalizacao, 'localizacao', 'quantidade'),
  };
}

async function blocoReceitaPorLocalidade(propWhere) {
  const itens = await prisma.faturaItem.findMany({
    where:  { fatura: { status: { in: ['ABERTA', 'FECHADA', 'PAGA'] }, ...propWhere } },
    select: {
      valor: true, quantidade: true,
      fatura: { select: { status: true } },
      animal: { select: { local: true, localizacao: { select: { nome: true } } } },
    },
  });

  const porLocal = new Map(); // nome → { bruta, liquida }
  for (const item of itens) {
    const chave = item.animal ? nomeLocalizacao(item.animal) : SEM_LOCALIZACAO;
    const valor = (item.valor ?? 0) * (item.quantidade ?? 1);
    const atual = porLocal.get(chave) ?? { bruta: 0, liquida: 0 };
    atual.bruta += valor;
    if (item.fatura.status === 'PAGA') atual.liquida += valor;
    porLocal.set(chave, atual);
  }
  return [...porLocal.entries()]
    .map(([localizacao, v]) => ({ localizacao, receitaBruta: v.bruta, receitaLiquida: v.liquida }))
    .sort((a, b) => b.receitaBruta - a.receitaBruta);
}

async function blocoDevedores(propWhere, mesAtual) {
  const faturas = await prisma.fatura.findMany({
    where: {
      status:        { in: ['ABERTA', 'FECHADA'] },
      mesReferencia: { lt: mesAtual },
      proprietarioId: { not: null },
      ...propWhere,
    },
    select: {
      proprietarioId: true, total: true, mesReferencia: true,
      proprietario: { select: { fullName: true, phone: true } },
    },
  });

  const porProp = new Map();
  for (const f of faturas) {
    const atual = porProp.get(f.proprietarioId) ?? {
      proprietarioId: f.proprietarioId,
      nome:           f.proprietario?.fullName ?? '—',
      telefone:       f.proprietario?.phone ?? null,
      qtdFaturas:     0,
      totalDevido:    0,
      mesMaisAntigo:  f.mesReferencia,
    };
    atual.qtdFaturas  += 1;
    atual.totalDevido += f.total ?? 0;
    if (f.mesReferencia && (!atual.mesMaisAntigo || f.mesReferencia < atual.mesMaisAntigo)) {
      atual.mesMaisAntigo = f.mesReferencia;
    }
    porProp.set(f.proprietarioId, atual);
  }

  return [...porProp.values()]
    .map(d => ({ ...d, mesesEmAtraso: mesesDesde(d.mesMaisAntigo, mesAtual) }))
    .sort((a, b) => b.mesesEmAtraso - a.mesesEmAtraso || b.totalDevido - a.totalDevido);
}

async function blocoMelhoresPagadores(propWhere, devedores) {
  const grupos = await prisma.fatura.groupBy({
    by:      ['proprietarioId'],
    where:   { status: 'PAGA', proprietarioId: { not: null }, ...propWhere },
    _sum:    { total: true },
    _count:  { _all: true },
    orderBy: { _sum: { total: 'desc' } },
    take:    15,
  });
  if (grupos.length === 0) return [];

  const users = await prisma.user.findMany({
    where:  { id: { in: grupos.map(g => g.proprietarioId) } },
    select: { id: true, fullName: true },
  });
  const nomePorId    = new Map(users.map(u => [u.id, u.fullName]));
  const devedoresSet = new Set(devedores.map(d => d.proprietarioId));

  return grupos.map(g => ({
    proprietarioId:  g.proprietarioId,
    nome:            nomePorId.get(g.proprietarioId) ?? '—',
    totalPago:       g._sum.total ?? 0,
    qtdFaturasPagas: g._count._all,
    emDia:           !devedoresSet.has(g.proprietarioId),
  }));
}

/** Animais do escopo com a data do último atendimento (evolução não cancelada). */
async function carregarAnimaisComUltimoAtendimento(animalWhere) {
  return prisma.animal.findMany({
    where:  animalWhere,
    select: {
      id: true, nome: true, local: true,
      localizacao: { select: { nome: true } },
      user:        { select: { fullName: true } },
      evolucoes: {
        where:   { ativo: true, status: { not: 'CANCELADA' } },
        orderBy: { dataInicio: 'desc' },
        take:    1,
        select:  { dataInicio: true },
      },
    },
  });
}

function blocoSemAtendimento(animais) {
  const agora = Date.now();
  const lista = [];
  for (const a of animais) {
    const ultimo = a.evolucoes[0]?.dataInicio ?? null;
    const dias   = ultimo ? Math.floor((agora - new Date(ultimo).getTime()) / 86400000) : null;
    if (dias !== null && dias <= 3) continue; // atendido nos últimos 3 dias
    const faixa = dias === null || dias > 30 ? '30' : dias > 15 ? '15' : dias > 7 ? '7' : '3';
    lista.push({
      id:                a.id,
      nome:              a.nome,
      localizacao:       nomeLocalizacao(a),
      proprietario:      a.user?.fullName ?? '—',
      ultimoAtendimento: ultimo,
      diasSemAtendimento: dias, // null = nunca atendido
      faixa,                    // '3' (3–7d) | '7' (7–15d) | '15' (15–30d) | '30' (>30d ou nunca)
    });
  }
  lista.sort((a, b) => (b.diasSemAtendimento ?? Infinity) - (a.diasSemAtendimento ?? Infinity));
  return {
    totais: {
      mais3dias:  lista.length,
      mais7dias:  lista.filter(i => i.faixa !== '3').length,
      mais15dias: lista.filter(i => i.faixa === '15' || i.faixa === '30').length,
      mais30dias: lista.filter(i => i.faixa === '30').length,
    },
    animais: lista,
  };
}

function blocoAnimaisPorLocalizacao(animais) {
  const porLocal = new Map();
  for (const a of animais) somaEmMapa(porLocal, nomeLocalizacao(a), 1);
  return mapaParaLista(porLocal, 'localizacao', 'quantidade');
}

async function blocoFaturasCorrigidas(propWhere) {
  const where = { qtdCorrecoes: { gt: 0 }, ...propWhere };
  const [total, faturas] = await Promise.all([
    prisma.fatura.count({ where }),
    prisma.fatura.findMany({
      where,
      orderBy: { ultimaCorrecaoEm: 'desc' },
      take:    50,
      select: {
        id: true, mesReferencia: true, status: true, total: true,
        qtdCorrecoes: true, ultimaCorrecaoEm: true,
        proprietario: { select: { fullName: true } },
      },
    }),
  ]);
  return {
    total,
    faturas: faturas.map(f => ({
      id:               f.id,
      proprietario:     f.proprietario?.fullName ?? '—',
      mesReferencia:    f.mesReferencia,
      status:           f.status,
      total:            f.total,
      qtdCorrecoes:     f.qtdCorrecoes,
      ultimaCorrecaoEm: f.ultimaCorrecaoEm,
    })),
  };
}

async function blocoEvolucoesEditadas(empresaId) {
  const evolucoes = await prisma.evolucaoClinica.findMany({
    where: {
      ativo:           true,
      status:          'FINALIZADA',
      dataFim:         { not: null },
      dataModificacao: { not: null },
      ...(empresaId ? { animal: { empresaId } } : {}),
    },
    select: {
      id: true, titulo: true, especialidade: true, tipoAtendimento: true, numero: true,
      dataFim: true, dataModificacao: true,
      animal:        { select: { nome: true } },
      veterinario:   { select: { fullName: true } },
      modificadoPor: { select: { fullName: true } },
    },
  });

  // Editada DEPOIS de finalizar (60s de tolerância — finalizar seta os dois campos juntos)
  const editadas = evolucoes.filter(e =>
    new Date(e.dataModificacao).getTime() - new Date(e.dataFim).getTime() > 60000
  );
  editadas.sort((a, b) => new Date(b.dataModificacao) - new Date(a.dataModificacao));

  return {
    total: editadas.length,
    evolucoes: editadas.slice(0, 50).map(e => ({
      id:                 e.id,
      atendimentoNumero:  formatAtendimentoNum(e.tipoAtendimento, e.numero),
      titulo:             e.titulo ?? e.especialidade,
      animal:             e.animal?.nome ?? '—',
      responsavelOriginal: e.veterinario?.fullName ?? '—',
      editadoPor:         e.modificadoPor?.fullName ?? '—',
      finalizadaEm:       e.dataFim,
      editadaEm:          e.dataModificacao,
    })),
  };
}

// ── Endpoint ──────────────────────────────────────────────────────────────────

const gerencial = async (req, res) => {
  try {
    const empresaId   = req.empresaId ?? null;
    const mesAtual    = mesReferenciaAtual();
    const animalWhere = { ativo: true, ...(empresaId ? { empresaId } : {}) };

    // Faturas não têm empresaId — o escopo é via proprietários com animal ativo na empresa
    let propWhere = {};
    if (empresaId) {
      const donos = await prisma.animal.findMany({
        where:    { empresaId, ativo: true },
        select:   { userId: true },
        distinct: ['userId'],
      });
      propWhere = { proprietarioId: { in: donos.map(d => d.userId) } };
    }

    const [
      emergencias,
      receitaPorLocalidade,
      devedores,
      animais,
      faturasCorrigidas,
      evolucoesEditadas,
    ] = await Promise.all([
      blocoEmergencias(propWhere),
      blocoReceitaPorLocalidade(propWhere),
      blocoDevedores(propWhere, mesAtual),
      carregarAnimaisComUltimoAtendimento(animalWhere),
      blocoFaturasCorrigidas(propWhere),
      blocoEvolucoesEditadas(empresaId),
    ]);

    const melhoresPagadores = await blocoMelhoresPagadores(propWhere, devedores);

    return res.json({
      dados: {
        emergencias,
        receitaPorLocalidade,
        devedores,
        melhoresPagadores,
        semAtendimento:        blocoSemAtendimento(animais),
        animaisPorLocalizacao: blocoAnimaisPorLocalizacao(animais),
        faturasCorrigidas,
        evolucoesEditadas,
      },
    });
  } catch (err) {
    console.error('RelatorioGerencialController.gerencial:', err);
    return res.status(500).json({ error: 'Erro ao gerar relatórios gerenciais.' });
  }
};

module.exports = { gerencial };

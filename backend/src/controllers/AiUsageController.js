// src/controllers/AiUsageController.js
// Retorna métricas de uso de LLM para o dashboard de monitoramento

const prisma = require('../lib/prisma').default;
const { situacao, inicioDoMes } = require('../services/iaQuotaService');

// ISOLAMENTO ENTRE EMPRESAS no consumo de IA.
//
// `resumo`, `evolucaoDiaria` e `projecaoMensal` são abertas a QUALQUER autenticado
// (rotas sem `authorize('ADMIN')`) e agregavam `AiUsageLog` sem filtro nenhum: cada
// clínica enxergava o volume, o custo e as operações de IA da plataforma inteira —
// dado de negócio das concorrentes.
//
// ADMIN da plataforma continua vendo o consolidado (é o dono da conta única no
// provedor). Sem empresa resolvida, `empresaId: null` bate só com os registros sem
// tenant — fail-closed, nunca a base toda.
// As rotas `porModelo`, `logRecente` e `porEmpresa` já são ADMIN-only e seguem globais.
function escopoEmpresaIA(req) {
  if (req.user?.userType === 'ADMIN' || req.user?.role === 'ADMIN') return {};
  return { empresaId: req.empresaId ? Number(req.empresaId) : null };
}

const AiUsageController = {

  // ── Resumo geral (cards do dashboard) ─────────────────────────────────────
  resumo: async (req, res) => {
    try {
      const { periodo = '30d' } = req.query;

      const dataInicio = calcularDataInicio(periodo);

      const [
        totalChamadas,
        totalTokens,
        totalCustoResult,
        mediaLatencia,
        taxaErro,
        topOperacoes,
        porModulo,
      ] = await Promise.all([

        // Total de chamadas no período
        prisma.aiUsageLog.count({
          where: { createdAt: { gte: dataInicio }, ...escopoEmpresaIA(req) },
        }),

        // Total de tokens
        prisma.aiUsageLog.aggregate({
          _sum: { tokensTotal: true },
          where: { createdAt: { gte: dataInicio }, ...escopoEmpresaIA(req) },
        }),

        // Custo total
        prisma.aiUsageLog.aggregate({
          _sum: { custoUsd: true },
          where: { createdAt: { gte: dataInicio }, ...escopoEmpresaIA(req) },
        }),

        // Latência média
        prisma.aiUsageLog.aggregate({
          _avg: { latenciaMs: true },
          where: { createdAt: { gte: dataInicio }, sucesso: true, ...escopoEmpresaIA(req) },
        }),

        // Taxa de erro
        prisma.aiUsageLog.count({
          where: { createdAt: { gte: dataInicio }, sucesso: false, ...escopoEmpresaIA(req) },
        }),

        // Top operações por custo
        prisma.aiUsageLog.groupBy({
          by: ['operacao'],
          _sum: { custoUsd: true, tokensTotal: true },
          _count: { id: true },
          where: { createdAt: { gte: dataInicio }, ...escopoEmpresaIA(req) },
          orderBy: { _sum: { custoUsd: 'desc' } },
          take: 5,
        }),

        // Consumo por MÓDULO — quem chamou a LLM no período
        prisma.aiUsageLog.groupBy({
          by: ['modulo'],
          _sum: { custoUsd: true, tokensTotal: true, tokensEntrada: true, tokensSaida: true },
          _count: { id: true },
          where: { createdAt: { gte: dataInicio }, ...escopoEmpresaIA(req) },
          orderBy: { _sum: { custoUsd: 'desc' } },
        }),
      ]);

      const custoTotalUsd = totalCustoResult._sum.custoUsd ?? 0;

      res.json({
        sucesso: true,
        dados: {
          periodo,
          totalChamadas,
          totalTokens:   totalTokens._sum.tokensTotal ?? 0,
          custoTotalUsd: Number(custoTotalUsd.toFixed(6)),
          custoTotalBrl: Number((custoTotalUsd * 5.2).toFixed(4)), // taxa aproximada
          mediaLatenciaMs: Math.round(mediaLatencia._avg.latenciaMs ?? 0),
          totalErros: taxaErro,
          taxaErroPercent: totalChamadas > 0
            ? Number(((taxaErro / totalChamadas) * 100).toFixed(1))
            : 0,
          topOperacoes: topOperacoes.map(op => ({
            operacao:    op.operacao,
            chamadas:    op._count.id,
            tokens:      op._sum.tokensTotal ?? 0,
            custoUsd:    Number((op._sum.custoUsd ?? 0).toFixed(6)),
          })),
          porModulo: porModulo.map(m => ({
            modulo:        m.modulo,
            chamadas:      m._count.id,
            tokens:        m._sum.tokensTotal   ?? 0,
            tokensEntrada: m._sum.tokensEntrada ?? 0,
            tokensSaida:   m._sum.tokensSaida   ?? 0,
            custoUsd:      Number((m._sum.custoUsd ?? 0).toFixed(6)),
            mediaTokens:   m._count.id > 0
              ? Math.round((m._sum.tokensTotal ?? 0) / m._count.id)
              : 0,
          })),
        },
      });
    } catch (error) {
      console.error('Erro ao buscar resumo de uso de IA:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Evolução diária (gráfico de linha) ────────────────────────────────────
  evolucaoDiaria: async (req, res) => {
    try {
      const { periodo = '30d' } = req.query;
      const dataInicio = calcularDataInicio(periodo);

      const logs = await prisma.aiUsageLog.findMany({
        where: { createdAt: { gte: dataInicio }, ...escopoEmpresaIA(req) },
        select: { createdAt: true, tokensTotal: true, custoUsd: true, sucesso: true },
        orderBy: { createdAt: 'asc' },
      });

      // Agrupar por dia
      const porDia = {};
      logs.forEach(log => {
        const dia = log.createdAt.toISOString().split('T')[0];
        if (!porDia[dia]) {
          porDia[dia] = { data: dia, chamadas: 0, tokens: 0, custoUsd: 0, erros: 0 };
        }
        porDia[dia].chamadas++;
        porDia[dia].tokens  += log.tokensTotal ?? 0;
        porDia[dia].custoUsd += log.custoUsd ?? 0;
        if (!log.sucesso) porDia[dia].erros++;
      });

      const series = Object.values(porDia).map(d => ({
        ...d,
        custoUsd: Number(d.custoUsd.toFixed(6)),
      }));

      res.json({ sucesso: true, dados: series });
    } catch (error) {
      console.error('Erro ao buscar evolução diária:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Por modelo (gráfico de pizza) ─────────────────────────────────────────
  porModelo: async (req, res) => {
    try {
      const { periodo = '30d' } = req.query;
      const dataInicio = calcularDataInicio(periodo);

      const dados = await prisma.aiUsageLog.groupBy({
        by: ['modelo', 'provedor'],
        _sum: { custoUsd: true, tokensTotal: true },
        _count: { id: true },
        where: { createdAt: { gte: dataInicio }, ...escopoEmpresaIA(req) },
        orderBy: { _sum: { custoUsd: 'desc' } },
      });

      res.json({
        sucesso: true,
        dados: dados.map(d => ({
          modelo:   d.modelo,
          provedor: d.provedor,
          chamadas: d._count.id,
          tokens:   d._sum.tokensTotal ?? 0,
          custoUsd: Number((d._sum.custoUsd ?? 0).toFixed(6)),
        })),
      });
    } catch (error) {
      console.error('Erro ao buscar dados por modelo:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Log recente (tabela) ───────────────────────────────────────────────────
  logRecente: async (req, res) => {
    try {
      const { page = 1, limit = 50, operacao, modulo, sucesso, periodo } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const where = {};
      if (operacao) where.operacao = operacao;
      if (modulo)   where.modulo   = modulo;
      if (periodo)  where.createdAt = { gte: calcularDataInicio(periodo) };
      if (sucesso !== undefined) where.sucesso = sucesso === 'true';

      const [logs, total] = await Promise.all([
        prisma.aiUsageLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: Number(limit),
          skip,
          include: { user: { select: { fullName: true, email: true } } },
        }),
        prisma.aiUsageLog.count({ where }),
      ]);

      res.json({
        sucesso: true,
        dados: logs.map(log => ({
          id:          log.id,
          createdAt:   log.createdAt,
          operacao:      log.operacao,
          modulo:        log.modulo,
          modelo:        log.modelo,
          provedor:      log.provedor,
          tokensEntrada: log.tokensEntrada,
          tokensSaida:   log.tokensSaida,
          tokensTotal:   log.tokensTotal,
          custoUsd:    Number(log.custoUsd.toFixed(6)),
          latenciaMs:  log.latenciaMs,
          sucesso:     log.sucesso,
          erroMensagem:log.erroMensagem,
          usuario:     log.user?.fullName ?? '—',
        })),
        paginacao: {
          total,
          pagina: Number(page),
          totalPaginas: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      console.error('Erro ao buscar log recente:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Consumo por CLIENTE (empresa) — base do metering ──────────────────────
  // Modelo "conta única + medição interna": o custo é centralizado no Google e
  // atribuído aqui a cada tenant, junto do plano contratado e do % consumido.
  porEmpresa: async (req, res) => {
    try {
      const { periodo = 'mes' } = req.query;
      const dataInicio = calcularDataInicio(periodo);

      const agregados = await prisma.aiUsageLog.groupBy({
        by: ['empresaId'],
        _sum: { custoUsd: true, tokensTotal: true, tokensEntrada: true, tokensSaida: true },
        _count: { id: true },
        where: { createdAt: { gte: dataInicio }, sucesso: true, ...escopoEmpresaIA(req) },
        orderBy: { _sum: { tokensTotal: 'desc' } },
      });

      const ids = agregados.map(a => a.empresaId).filter(Boolean);
      const [empresas, planos] = await Promise.all([
        ids.length ? prisma.empresa.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, cnpj: true } }) : [],
        ids.length ? prisma.iaPlanoEmpresa.findMany({ where: { empresaId: { in: ids } } }) : [],
      ]);
      const nomePorId  = new Map(empresas.map(e => [e.id, e]));
      const planoPorId = new Map(planos.map(p => [p.empresaId, p]));

      // O plano é apurado no MÊS corrente; quando o período pedido é o mês, o
      // consumo exibido é o mesmo que o gate usa — os números batem com a quota.
      const noMes = periodo === 'mes';

      const dados = agregados.map(a => {
        const plano  = a.empresaId ? planoPorId.get(a.empresaId) : null;
        const tokens = a._sum.tokensTotal ?? 0;
        const chamadas = a._count.id ?? 0;
        const pct = (usado, limite) =>
          limite && limite > 0 ? Number(((usado / limite) * 100).toFixed(1)) : null;
        return {
          empresaId:         a.empresaId,
          empresaNome:       a.empresaId ? (nomePorId.get(a.empresaId)?.nome ?? `Empresa #${a.empresaId}`) : 'Sem empresa (ADMIN/legado)',
          cnpj:              a.empresaId ? (nomePorId.get(a.empresaId)?.cnpj ?? null) : null,
          chamadas,
          tokens,
          tokensEntrada:     a._sum.tokensEntrada ?? 0,
          tokensSaida:       a._sum.tokensSaida   ?? 0,
          custoUsd:          Number((a._sum.custoUsd ?? 0).toFixed(6)),
          mediaTokens:       chamadas > 0 ? Math.round(tokens / chamadas) : 0,
          plano:             plano?.plano ?? null,
          limiteTokensMes:   plano?.limiteTokensMes   ?? null,
          limiteChamadasMes: plano?.limiteChamadasMes ?? null,
          bloquearAoExceder: plano?.bloquearAoExceder ?? null,
          planoAtivo:        plano?.ativo ?? null,
          pctTokens:         noMes ? pct(tokens, plano?.limiteTokensMes) : null,
          pctChamadas:       noMes ? pct(chamadas, plano?.limiteChamadasMes) : null,
        };
      });

      res.json({
        sucesso: true,
        dados,
        meta: { periodo, apuracaoDoPlano: noMes, desde: dataInicio, mesCorrenteDesde: inicioDoMes() },
      });
    } catch (error) {
      console.error('Erro ao buscar consumo por empresa:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Plano de IA de uma empresa (ADMIN) ────────────────────────────────────
  obterPlano: async (req, res) => {
    try {
      const empresaId = Number(req.params.empresaId);
      if (!Number.isInteger(empresaId)) {
        return res.status(400).json({ sucesso: false, mensagem: 'empresaId inválido' });
      }
      res.json({ sucesso: true, dados: await situacao(empresaId) });
    } catch (error) {
      console.error('Erro ao obter plano de IA:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  salvarPlano: async (req, res) => {
    try {
      const empresaId = Number(req.params.empresaId);
      if (!Number.isInteger(empresaId)) {
        return res.status(400).json({ sucesso: false, mensagem: 'empresaId inválido' });
      }

      const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true } });
      if (!empresa) return res.status(404).json({ sucesso: false, mensagem: 'Empresa não encontrada' });

      // null/'' = sem limite naquela dimensão. Valor negativo é rejeitado.
      const limite = (v) => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return undefined; // sinaliza inválido
        return Math.floor(n);
      };

      const limiteTokensMes   = limite(req.body.limiteTokensMes);
      const limiteChamadasMes = limite(req.body.limiteChamadasMes);
      if (limiteTokensMes === undefined || limiteChamadasMes === undefined) {
        return res.status(400).json({ sucesso: false, mensagem: 'Limites devem ser números não negativos' });
      }

      const dados = {
        plano:             String(req.body.plano ?? 'PADRAO').slice(0, 40),
        limiteTokensMes,
        limiteChamadasMes,
        bloquearAoExceder: req.body.bloquearAoExceder !== false,
        ativo:             req.body.ativo !== false,
      };

      await prisma.iaPlanoEmpresa.upsert({
        where:  { empresaId },
        create: { empresaId, ...dados },
        update: dados,
      });

      res.json({ sucesso: true, dados: await situacao(empresaId) });
    } catch (error) {
      console.error('Erro ao salvar plano de IA:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Projeção mensal ───────────────────────────────────────────────────────
  projecaoMensal: async (req, res) => {
    try {
      // Pega os últimos 7 dias como base
      const dataInicio = new Date();
      dataInicio.setDate(dataInicio.getDate() - 7);

      const resultado = await prisma.aiUsageLog.aggregate({
        _sum: { custoUsd: true, tokensTotal: true },
        _count: { id: true },
        where: { createdAt: { gte: dataInicio }, sucesso: true, ...escopoEmpresaIA(req) },
      });

      const diasObservados = 7;
      const mediaDiaria = {
        chamadas: (resultado._count.id ?? 0) / diasObservados,
        tokens:   (resultado._sum.tokensTotal ?? 0) / diasObservados,
        custoUsd: (resultado._sum.custoUsd ?? 0) / diasObservados,
      };

      res.json({
        sucesso: true,
        dados: {
          baseObservada: `últimos ${diasObservados} dias`,
          mediaDiaria: {
            chamadas: Number(mediaDiaria.chamadas.toFixed(1)),
            tokens:   Math.round(mediaDiaria.tokens),
            custoUsd: Number(mediaDiaria.custoUsd.toFixed(6)),
          },
          projecao30dias: {
            chamadas: Math.round(mediaDiaria.chamadas * 30),
            tokens:   Math.round(mediaDiaria.tokens * 30),
            custoUsd: Number((mediaDiaria.custoUsd * 30).toFixed(4)),
            custoBrl: Number((mediaDiaria.custoUsd * 30 * 5.2).toFixed(2)),
          },
        },
      });
    } catch (error) {
      console.error('Erro ao calcular projeção:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function calcularDataInicio(periodo) {
  const d = new Date();
  switch (periodo) {
    case '7d':  d.setDate(d.getDate() - 7);   break;
    case '30d': d.setDate(d.getDate() - 30);  break;
    case '90d': d.setDate(d.getDate() - 90);  break;
    case 'mes': d.setDate(1);                  break; // início do mês atual
    default:    d.setDate(d.getDate() - 30);
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

module.exports = AiUsageController;
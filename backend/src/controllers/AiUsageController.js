// src/controllers/AiUsageController.js
// Retorna métricas de uso de LLM para o dashboard de monitoramento

const prisma = require('../lib/prisma').default;

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
      ] = await Promise.all([

        // Total de chamadas no período
        prisma.aiUsageLog.count({
          where: { createdAt: { gte: dataInicio } },
        }),

        // Total de tokens
        prisma.aiUsageLog.aggregate({
          _sum: { tokensTotal: true },
          where: { createdAt: { gte: dataInicio } },
        }),

        // Custo total
        prisma.aiUsageLog.aggregate({
          _sum: { custoUsd: true },
          where: { createdAt: { gte: dataInicio } },
        }),

        // Latência média
        prisma.aiUsageLog.aggregate({
          _avg: { latenciaMs: true },
          where: { createdAt: { gte: dataInicio }, sucesso: true },
        }),

        // Taxa de erro
        prisma.aiUsageLog.count({
          where: { createdAt: { gte: dataInicio }, sucesso: false },
        }),

        // Top operações por custo
        prisma.aiUsageLog.groupBy({
          by: ['operacao'],
          _sum: { custoUsd: true, tokensTotal: true },
          _count: { id: true },
          where: { createdAt: { gte: dataInicio } },
          orderBy: { _sum: { custoUsd: 'desc' } },
          take: 5,
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
        where: { createdAt: { gte: dataInicio } },
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
        where: { createdAt: { gte: dataInicio } },
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
      const { page = 1, limit = 50, operacao, sucesso } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const where = {};
      if (operacao) where.operacao = operacao;
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
          operacao:    log.operacao,
          modelo:      log.modelo,
          provedor:    log.provedor,
          tokensTotal: log.tokensTotal,
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

  // ── Projeção mensal ───────────────────────────────────────────────────────
  projecaoMensal: async (req, res) => {
    try {
      // Pega os últimos 7 dias como base
      const dataInicio = new Date();
      dataInicio.setDate(dataInicio.getDate() - 7);

      const resultado = await prisma.aiUsageLog.aggregate({
        _sum: { custoUsd: true, tokensTotal: true },
        _count: { id: true },
        where: { createdAt: { gte: dataInicio }, sucesso: true },
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
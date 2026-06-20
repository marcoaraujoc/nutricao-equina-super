// backend/src/controllers/DashboardController.js
'use strict';

const prisma = require('../lib/prisma').default;

const stats = async (req, res) => {
  try {
    const empresaId = req.empresaId ?? null;

    const hoje = new Date();
    const inicioDia = new Date(hoje);
    inicioDia.setHours(0, 0, 0, 0);
    const fimDia = new Date(hoje);
    fimDia.setHours(23, 59, 59, 999);

    const inicioJanela = new Date(hoje);
    inicioJanela.setDate(inicioJanela.getDate() - 29);
    inicioJanela.setHours(0, 0, 0, 0);

    const animalWhere      = { ativo: true,  ...(empresaId ? { empresaId } : {}) };
    const evolucaoWhere    = { ativo: true,  ...(empresaId ? { animal: { empresaId } } : {}) };
    const prescricaoWhere  = { ativo: true,  ...(empresaId ? { animal: { empresaId } } : {}) };

    const [
      atendimentosHoje,
      pacientesAtivos,
      clientesAtivos,
      estoqueItens,
      topMedicamentos,
      topProcedimentos,
    ] = await Promise.all([
      prisma.evolucaoClinica.count({
        where: { ...evolucaoWhere, dataInicio: { gte: inicioDia, lte: fimDia } },
      }),
      prisma.animal.count({ where: animalWhere }),
      prisma.user.count({
        where: {
          userType: 'PROPRIETARIO',
          ativo: true,
          ...(empresaId
            ? { animais: { some: { empresaId, ativo: true } } }
            : {}),
        },
      }),
      prisma.estoqueClinica.findMany({
        where: { ativo: true, ...(empresaId ? { empresaId } : {}) },
        select: { qtdEstoque: true, estoqueMinimo: true },
      }),
      prisma.prescricao.groupBy({
        by: ['medicamento'],
        where: { ...prescricaoWhere, tipo: 'MEDICAMENTO' },
        _count: { medicamento: true },
        orderBy: { _count: { medicamento: 'desc' } },
        take: 10,
      }),
      prisma.prescricao.groupBy({
        by: ['medicamento'],
        where: { ...prescricaoWhere, tipo: 'PROCEDIMENTO' },
        _count: { medicamento: true },
        orderBy: { _count: { medicamento: 'desc' } },
        take: 10,
      }),
    ]);

    const estoqueCritico = estoqueItens.filter(
      (i) => i.qtdEstoque <= i.estoqueMinimo
    ).length;

    // Atendimentos por dia (últimos 30 dias) — raw SQL para DATE_TRUNC
    let atendimentosPorDia = [];
    if (empresaId) {
      atendimentosPorDia = await prisma.$queryRaw`
        SELECT DATE_TRUNC('day', e."dataInicio" AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
               COUNT(*)::int AS total
        FROM schs2vet.tb_evolucoes_clinicas e
        JOIN schs2vet.tb_animais a ON a.id = e."animalId"
        WHERE e.ativo = true
          AND a."empresaId" = ${empresaId}
          AND e."dataInicio" >= ${inicioJanela}
        GROUP BY dia
        ORDER BY dia ASC
      `;
    } else {
      atendimentosPorDia = await prisma.$queryRaw`
        SELECT DATE_TRUNC('day', "dataInicio" AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
               COUNT(*)::int AS total
        FROM schs2vet.tb_evolucoes_clinicas
        WHERE ativo = true
          AND "dataInicio" >= ${inicioJanela}
        GROUP BY dia
        ORDER BY dia ASC
      `;
    }

    return res.json({
      dados: {
        atendimentosHoje,
        pacientesAtivos,
        clientesAtivos,
        estoqueCritico,
        atendimentosPorDia: atendimentosPorDia.map((r) => ({
          dia: r.dia instanceof Date ? r.dia.toISOString().slice(0, 10) : String(r.dia),
          total: Number(r.total),
        })),
        topMedicamentos: topMedicamentos.map((r) => ({
          nome:  r.medicamento,
          total: r._count.medicamento,
        })),
        topProcedimentos: topProcedimentos.map((r) => ({
          nome:  r.medicamento,
          total: r._count.medicamento,
        })),
      },
    });
  } catch (err) {
    console.error('DashboardController.stats:', err);
    return res.status(500).json({ error: 'Erro ao carregar estatísticas do dashboard.' });
  }
};

module.exports = { stats };

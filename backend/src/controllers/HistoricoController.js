// backend/src/controllers/HistoricoController.js
// Histórico unificado do animal — agrega evoluções, vacinas, exames clínicos,
// prescrições (grupos) e encaminhamentos numa única linha do tempo.
// Exibido no painel "Histórico" da tela do animal (AnimalDetail).

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { resumirHistorico } = require('../services/clinicaLLMService');

const VET_SELECT = { select: { id: true, fullName: true } };

const HistoricoController = {

  // GET /clinica/historico/animal/:animalId?limit=100
  listarPorAnimal: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);
      const limit    = Math.min(Number(req.query.limit) || 100, 300);

      const acesso = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const whereAtivo = { animalId, ativo: true };

      const [evolucoes, vacinas, exames, encaminhamentos, grupos] = await Promise.all([
        prisma.evolucaoClinica.findMany({
          where: { ...whereAtivo, status: { in: ['FINALIZADA', 'CONCLUIDO'] } },
          select: { id: true, titulo: true, especialidade: true, texto: true, status: true, dataInicio: true, veterinario: VET_SELECT },
          orderBy: { dataInicio: 'desc' }, take: limit,
        }),
        prisma.vacinaClinica.findMany({
          where: whereAtivo,
          select: { id: true, nome: true, lote: true, fabricante: true, observacao: true, dataAplicacao: true, dataReforco: true, veterinario: VET_SELECT },
          orderBy: { dataAplicacao: 'desc' }, take: limit,
        }),
        prisma.exameClinico.findMany({
          where: { ...whereAtivo, status: 'CONCLUIDO' },
          select: { id: true, tipo: true, descricao: true, status: true, resultado: true, dataSolicitacao: true, veterinario: VET_SELECT },
          orderBy: { dataSolicitacao: 'desc' }, take: limit,
        }),
        prisma.encaminhamentoClinico.findMany({
          where: { ...whereAtivo, status: 'CONCLUIDO' },
          select: { id: true, especialidade: true, motivo: true, urgencia: true, status: true, dataEncaminhamento: true, veterinario: VET_SELECT, prestador: VET_SELECT },
          orderBy: { dataEncaminhamento: 'desc' }, take: limit,
        }),
        prisma.prescricaoGrupo.findMany({
          where: { animalId, status: { in: ['FINALIZADO', 'EXECUTADO'] } },
          select: {
            id: true, numero: true, status: true, createdAt: true, veterinario: VET_SELECT,
            itens: { where: { ativo: true }, select: { medicamento: true }, take: 5 },
          },
          orderBy: { createdAt: 'desc' }, take: limit,
        }),
      ]);

      const eventos = [
        ...evolucoes.map(e => ({
          id:          `evolucao-${e.id}`,
          origem:      'EVOLUCAO',
          data:        e.dataInicio,
          titulo:      e.titulo?.trim() || 'Evolução clínica',
          badge:       e.especialidade || 'Clínica Geral',
          status:      e.status,
          responsavel: e.veterinario?.fullName ?? null,
          resumo:      e.texto,
        })),
        ...vacinas.map(v => ({
          id:          `vacina-${v.id}`,
          origem:      'VACINA',
          data:        v.dataAplicacao,
          titulo:      v.nome,
          badge:       'Vacina',
          status:      null,
          responsavel: v.veterinario?.fullName ?? null,
          resumo:      [
            v.fabricante ? `Fabricante: ${v.fabricante}` : null,
            v.lote ? `Lote: ${v.lote}` : null,
            v.dataReforco ? `Reforço: ${new Date(v.dataReforco).toLocaleDateString('pt-BR')}` : null,
            v.observacao,
          ].filter(Boolean).join(' · '),
        })),
        ...exames.map(x => ({
          id:          `exame-${x.id}`,
          origem:      'EXAME',
          data:        x.dataSolicitacao,
          titulo:      x.tipo,
          badge:       'Exame',
          status:      x.status,
          responsavel: x.veterinario?.fullName ?? null,
          resumo:      x.resultado || x.descricao,
        })),
        ...encaminhamentos.map(en => ({
          id:          `encaminhamento-${en.id}`,
          origem:      'ENCAMINHAMENTO',
          data:        en.dataEncaminhamento,
          titulo:      `Encaminhamento — ${en.especialidade}`,
          badge:       en.urgencia === 'NORMAL' ? 'Encaminhamento' : en.urgencia,
          status:      en.status,
          responsavel: en.veterinario?.fullName ?? null,
          resumo:      en.prestador ? `Para ${en.prestador.fullName}. ${en.motivo}` : en.motivo,
        })),
        ...grupos.map(g => ({
          id:          `prescricao-${g.id}`,
          origem:      'PRESCRICAO',
          data:        g.createdAt,
          titulo:      `Prescrição nº ${String(g.numero).padStart(3, '0')}`,
          badge:       'Prescrição',
          status:      g.status,
          responsavel: g.veterinario?.fullName ?? null,
          resumo:      g.itens.map(i => i.medicamento).join(', '),
        })),
      ];

      eventos.sort((a, b) => new Date(b.data) - new Date(a.data));

      res.json({ dados: eventos.slice(0, limit), total: eventos.length });
    } catch (err) {
      console.error('Erro ao montar histórico do animal:', err);
      res.status(500).json({ error: 'Erro ao montar histórico' });
    }
  },
  // GET /clinica/historico/animal/:animalId/resumo
  // Retorna os últimos N eventos com resumo de uma linha gerado por LLM.
  resumirPorAnimal: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);
      const limit    = Math.min(Number(req.query.limit) || 10, 20);

      const acesso = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const whereAtivo = { animalId, ativo: true };

      const [evolucoes, vacinas, exames, encaminhamentos, grupos] = await Promise.all([
        prisma.evolucaoClinica.findMany({
          where: { ...whereAtivo, status: { in: ['FINALIZADA', 'CONCLUIDO'] } },
          select: { id: true, titulo: true, especialidade: true, texto: true, status: true, dataInicio: true, veterinario: VET_SELECT },
          orderBy: { dataInicio: 'desc' }, take: limit,
        }),
        prisma.vacinaClinica.findMany({
          where: whereAtivo,
          select: { id: true, nome: true, fabricante: true, observacao: true, dataAplicacao: true, dataReforco: true, veterinario: VET_SELECT },
          orderBy: { dataAplicacao: 'desc' }, take: limit,
        }),
        prisma.exameClinico.findMany({
          where: { ...whereAtivo, status: 'CONCLUIDO' },
          select: { id: true, tipo: true, descricao: true, status: true, resultado: true, dataSolicitacao: true, veterinario: VET_SELECT },
          orderBy: { dataSolicitacao: 'desc' }, take: limit,
        }),
        prisma.encaminhamentoClinico.findMany({
          where: { ...whereAtivo, status: 'CONCLUIDO' },
          select: { id: true, especialidade: true, motivo: true, urgencia: true, status: true, dataEncaminhamento: true, veterinario: VET_SELECT, prestador: VET_SELECT },
          orderBy: { dataEncaminhamento: 'desc' }, take: limit,
        }),
        prisma.prescricaoGrupo.findMany({
          where: { animalId, status: { in: ['FINALIZADO', 'EXECUTADO'] } },
          select: {
            id: true, numero: true, status: true, createdAt: true, veterinario: VET_SELECT,
            itens: { where: { ativo: true }, select: { medicamento: true }, take: 5 },
          },
          orderBy: { createdAt: 'desc' }, take: limit,
        }),
      ]);

      const eventos = [
        ...evolucoes.map(e => ({
          id:      `evolucao-${e.id}`,
          origem:  'EVOLUCAO',
          data:    e.dataInicio,
          titulo:  e.titulo?.trim() || 'Evolução clínica',
          resumo:  e.texto,
        })),
        ...vacinas.map(v => ({
          id:      `vacina-${v.id}`,
          origem:  'VACINA',
          data:    v.dataAplicacao,
          titulo:  v.nome,
          resumo:  [v.fabricante ? `Fabricante: ${v.fabricante}` : null, v.observacao].filter(Boolean).join('. '),
        })),
        ...exames.map(x => ({
          id:      `exame-${x.id}`,
          origem:  'EXAME',
          data:    x.dataSolicitacao,
          titulo:  x.tipo,
          resumo:  x.resultado || x.descricao,
        })),
        ...encaminhamentos.map(en => ({
          id:      `encaminhamento-${en.id}`,
          origem:  'ENCAMINHAMENTO',
          data:    en.dataEncaminhamento,
          titulo:  `Encaminhamento — ${en.especialidade}`,
          resumo:  en.prestador ? `Para ${en.prestador.fullName}. ${en.motivo}` : en.motivo,
        })),
        ...grupos.map(g => ({
          id:      `prescricao-${g.id}`,
          origem:  'PRESCRICAO',
          data:    g.createdAt,
          titulo:  `Prescrição nº ${String(g.numero).padStart(3, '0')}`,
          resumo:  g.itens.map(i => i.medicamento).join(', '),
        })),
      ];

      eventos.sort((a, b) => new Date(b.data) - new Date(a.data));
      const recentes = eventos.slice(0, limit);

      // Gera resumos via LLM (fallback para titulo em caso de falha)
      const resumos = await resumirHistorico(recentes, req.user.id, animalId);

      const dados = recentes.map((ev, i) => ({
        data:   new Date(ev.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        resumo: resumos[i] || ev.titulo,
        origem: ev.origem,
      }));

      res.json({ dados });
    } catch (err) {
      console.error('Erro ao gerar resumo do histórico:', err);
      res.status(500).json({ error: 'Erro ao gerar resumo' });
    }
  },
};

module.exports = HistoricoController;

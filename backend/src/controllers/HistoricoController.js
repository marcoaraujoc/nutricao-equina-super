// backend/src/controllers/HistoricoController.js
// Histórico unificado do animal — agrega evoluções, vacinas, exames clínicos,
// prescrições (grupos) e encaminhamentos numa única linha do tempo.
// Exibido no painel "Histórico" da tela do animal (AnimalDetail).

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { escopoEvolucaoWhere, escopoFilhoEvolucaoWhere, escopoPrescricaoGrupoWhere } = require('../lib/clinicalScope');
const { resumirHistorico } = require('../services/clinicaLLMService');
const { formatAtendimentoNum } = require('../lib/faturaUtils');

const VET_SELECT = { select: { id: true, fullName: true } };

const EXAM_ORIGEM = {
  'Laboratorial': 'EXAME_LAB',
  'Bioquímico':   'EXAME_BIO',
  'Imagem':       'EXAME_IMG',
  'Compra':       'EXAME_COMPRA',
};

const EXAM_ABREV = {
  'Laboratorial': 'Lab',
  'Bioquímico':   'Bioquím',
  'Imagem':       'Img',
  'Compra':       'Compra',
};

const HistoricoController = {

  // GET /clinica/historico/animal/:animalId?limit=100
  listarPorAnimal: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);
      const busca    = (req.query.busca || '').toString().trim();
      const buscando = busca.length > 0;
      // Sem busca: retorna os N mais recentes (padrão 100; o painel pede 10).
      // Com busca: filtra por palavra em TODO o histórico (server-side, contains
      // insensitive), com teto amplo por origem para não sobrecarregar.
      const limit    = buscando ? 500 : Math.min(Number(req.query.limit) || 100, 300);
      const like     = { contains: busca, mode: 'insensitive' };

      const acesso = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const whereAtivo = { animalId, ativo: true };

      // Segregação multi-clínica: cada empresa/equipe vê só os próprios registros
      const escopoEvo    = escopoEvolucaoWhere(req);
      const escopoFilho  = escopoFilhoEvolucaoWhere(req);
      const escopoPresc  = escopoPrescricaoGrupoWhere(req);

      const [evolucoes, vacinas, exames, encaminhamentos, grupos] = await Promise.all([
        prisma.evolucaoClinica.findMany({
          where: { ...whereAtivo, status: { in: ['EM_ANDAMENTO', 'FINALIZADA', 'CONCLUIDO'] }, AND: [escopoEvo], ...(buscando ? { OR: [{ titulo: like }, { especialidade: like }, { texto: like }] } : {}) },
          select: { id: true, titulo: true, especialidade: true, texto: true, status: true, dataInicio: true, dataFim: true, numero: true, tipoAtendimento: true, veterinario: VET_SELECT },
          orderBy: { dataInicio: 'desc' }, take: limit,
        }),
        prisma.vacinaClinica.findMany({
          where: { ...whereAtivo, AND: [escopoFilho], ...(buscando ? { OR: [{ nome: like }, { fabricante: like }, { lote: like }, { observacao: like }] } : {}) },
          select: { id: true, nome: true, numero: true, lote: true, fabricante: true, observacao: true, dataAplicacao: true, dataReforco: true, evolucaoId: true, veterinario: VET_SELECT },
          orderBy: { dataAplicacao: 'desc' }, take: limit,
        }),
        prisma.exameClinico.findMany({
          where: { ...whereAtivo, status: { in: ['SOLICITADO', 'CONCLUIDO'] }, AND: [escopoFilho], ...(buscando ? { OR: [{ descricao: like }, { resultado: like }, { tipo: like }, { observacao: like }] } : {}) },
          select: { id: true, tipo: true, descricao: true, status: true, resultado: true, dataSolicitacao: true, numero: true, observacao: true, evolucaoId: true, veterinario: VET_SELECT },
          orderBy: { dataSolicitacao: 'desc' }, take: limit,
        }),
        prisma.encaminhamentoClinico.findMany({
          // PENDENTE incluído: o encaminhamento deve aparecer no Histórico assim que
          // criado (ao fechar a evolução), não só depois de marcado CONCLUIDO — mesmo
          // padrão de exames (SOLICITADO+CONCLUIDO) e evoluções (EM_ANDAMENTO+FINALIZADA).
          where: { ...whereAtivo, status: { in: ['PENDENTE', 'CONCLUIDO'] }, AND: [escopoFilho], ...(buscando ? { OR: [{ especialidade: like }, { motivo: like }] } : {}) },
          select: { id: true, especialidade: true, motivo: true, urgencia: true, status: true, dataEncaminhamento: true, evolucaoId: true, veterinario: VET_SELECT, prestador: VET_SELECT },
          orderBy: { dataEncaminhamento: 'desc' }, take: limit,
        }),
        prisma.prescricaoGrupo.findMany({
          where: { animalId, status: { in: ['FINALIZADO', 'EXECUTADO', 'CANCELADO_PARCIALMENTE'] }, AND: [escopoPresc], ...(buscando ? { OR: [{ itens: { some: { ativo: true, medicamento: like } } }] } : {}) },
          select: {
            id: true, numero: true, status: true, createdAt: true, evolucaoId: true, veterinario: VET_SELECT,
            itens: { where: { ativo: true }, select: { medicamento: true, tipo: true }, take: 20 },
          },
          orderBy: { createdAt: 'desc' }, take: limit,
        }),
      ]);

      const eventos = [
        ...evolucoes.map(e => ({
          id:                `evolucao-${e.id}`,
          origem:            'EVOLUCAO',
          data:              e.dataInicio,
          titulo:            e.titulo?.trim() || 'Evolução clínica',
          badge:             e.especialidade || 'Clínica Geral',
          status:            e.status,
          responsavel:       e.veterinario?.fullName ?? null,
          veterinarioId:     e.veterinario?.id ?? null,
          resumo:            e.texto,
          evolucaoId:        e.id,
          dataFim:           e.dataFim,
          atendimentoNumero: formatAtendimentoNum(e.tipoAtendimento, e.numero),
        })),
        ...vacinas.map(v => ({
          id:          `vacina-${v.id}`,
          origem:      'VACINA',
          data:        v.dataAplicacao,
          titulo:      v.numero != null ? `Vacina nº ${String(v.numero).padStart(3, '0')} — ${v.nome}` : v.nome,
          badge:       'Vacina',
          status:      null,
          responsavel: v.veterinario?.fullName ?? null,
          resumo:      [
            v.fabricante ? `Fabricante: ${v.fabricante}` : null,
            v.lote ? `Lote: ${v.lote}` : null,
            v.dataReforco ? `Reforço: ${new Date(v.dataReforco).toLocaleDateString('pt-BR')}` : null,
            v.observacao,
          ].filter(Boolean).join(' · '),
          evolucaoId: v.evolucaoId,
        })),
        ...exames.map(x => {
          const origemEx = EXAM_ORIGEM[x.tipo] ?? 'EXAME';

          // Extrai todos os tipos únicos dos grupos salvos no observacao (JSON)
          let tipos = [x.tipo];
          try {
            if (x.observacao) {
              const extra = JSON.parse(x.observacao);
              if (Array.isArray(extra.grupos) && extra.grupos.length > 0) {
                const fromGrupos = [...new Set(extra.grupos.map(g => g.tipo).filter(Boolean))];
                if (fromGrupos.length > 0) tipos = fromGrupos;
              }
            }
          } catch { /* JSON inválido — mantém tipo do registro */ }

          const tiposLabel = tipos.map(t => EXAM_ABREV[t] ?? t).join('/');
          const titulo     = x.numero != null
            ? `Exame nº ${String(x.numero).padStart(3, '0')} — ${tiposLabel}`
            : tiposLabel;

          return {
            id:          `${origemEx.toLowerCase()}-${x.id}`,
            origem:      origemEx,
            data:        x.dataSolicitacao,
            titulo,
            badge:       tiposLabel,
            status:      x.status,
            responsavel: x.veterinario?.fullName ?? null,
            resumo:      x.descricao || x.resultado || null,
            evolucaoId:  x.evolucaoId,
          };
        }),
        ...encaminhamentos.map(en => ({
          id:          `encaminhamento-${en.id}`,
          origem:      'ENCAMINHAMENTO',
          data:        en.dataEncaminhamento,
          titulo:      `Encaminhamento — ${en.especialidade}`,
          badge:       en.urgencia === 'NORMAL' ? 'Encaminhamento' : en.urgencia,
          status:      en.status,
          responsavel: en.veterinario?.fullName ?? null,
          resumo:      en.prestador ? `Para ${en.prestador.fullName}. ${en.motivo}` : en.motivo,
          evolucaoId:  en.evolucaoId,
        })),
        // Uma entrada POR TIPO presente no grupo (Medicamento, Procedimento, ...) — uma
        // prescrição com itens de tipos diferentes aparece como N entradas separadas
        // no Histórico, cada uma só com os itens do seu tipo.
        ...grupos.flatMap(g => {
          const numeroFmt = String(g.numero).padStart(3, '0');
          const porTipo = new Map();
          for (const item of g.itens) {
            const tipo = item.tipo || 'MEDICAMENTO';
            if (!porTipo.has(tipo)) porTipo.set(tipo, []);
            porTipo.get(tipo).push(item.medicamento);
          }
          const tipos = [...porTipo.keys()];
          const tipoLabel = { MEDICAMENTO: 'Medicamento', PROCEDIMENTO: 'Procedimento' };
          return tipos.map(tipo => ({
            id:          `prescricao-${g.id}-${tipo}`,
            origem:      'PRESCRICAO',
            data:        g.createdAt,
            titulo:      tipos.length > 1
              ? `Prescrição nº ${numeroFmt} — ${tipoLabel[tipo] ?? tipo}`
              : `Prescrição nº ${numeroFmt}`,
            badge:       'Prescrição',
            status:      g.status,
            responsavel: g.veterinario?.fullName ?? null,
            resumo:      porTipo.get(tipo).join(', '),
            evolucaoId:  g.evolucaoId,
          }));
        }),
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

      // Mesma segregação multi-clínica do histórico completo
      const escopoEvo    = escopoEvolucaoWhere(req);
      const escopoFilho  = escopoFilhoEvolucaoWhere(req);
      const escopoPresc  = escopoPrescricaoGrupoWhere(req);

      const [evolucoes, vacinas, exames, encaminhamentos, grupos] = await Promise.all([
        prisma.evolucaoClinica.findMany({
          where: { ...whereAtivo, status: { in: ['EM_ANDAMENTO', 'FINALIZADA', 'CONCLUIDO'] }, AND: [escopoEvo] },
          select: { id: true, titulo: true, especialidade: true, texto: true, status: true, dataInicio: true, veterinario: VET_SELECT },
          orderBy: { dataInicio: 'desc' }, take: limit,
        }),
        prisma.vacinaClinica.findMany({
          where: { ...whereAtivo, AND: [escopoFilho] },
          select: { id: true, nome: true, numero: true, fabricante: true, observacao: true, dataAplicacao: true, dataReforco: true, veterinario: VET_SELECT },
          orderBy: { dataAplicacao: 'desc' }, take: limit,
        }),
        prisma.exameClinico.findMany({
          where: { ...whereAtivo, status: { in: ['SOLICITADO', 'CONCLUIDO'] }, AND: [escopoFilho] },
          select: { id: true, tipo: true, descricao: true, status: true, resultado: true, dataSolicitacao: true, numero: true, observacao: true, veterinario: VET_SELECT },
          orderBy: { dataSolicitacao: 'desc' }, take: limit,
        }),
        prisma.encaminhamentoClinico.findMany({
          where: { ...whereAtivo, status: { in: ['PENDENTE', 'CONCLUIDO'] }, AND: [escopoFilho] },
          select: { id: true, especialidade: true, motivo: true, urgencia: true, status: true, dataEncaminhamento: true, veterinario: VET_SELECT, prestador: VET_SELECT },
          orderBy: { dataEncaminhamento: 'desc' }, take: limit,
        }),
        prisma.prescricaoGrupo.findMany({
          where: { animalId, status: { in: ['FINALIZADO', 'EXECUTADO', 'CANCELADO_PARCIALMENTE'] }, AND: [escopoPresc] },
          select: {
            id: true, numero: true, status: true, createdAt: true, veterinario: VET_SELECT,
            itens: { where: { ativo: true }, select: { medicamento: true, tipo: true }, take: 20 },
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
          titulo:  v.numero != null ? `Vacina nº ${String(v.numero).padStart(3, '0')} — ${v.nome}` : v.nome,
          resumo:  [v.fabricante ? `Fabricante: ${v.fabricante}` : null, v.observacao].filter(Boolean).join('. '),
        })),
        ...exames.map(x => {
          const origemEx = EXAM_ORIGEM[x.tipo] ?? 'EXAME';

          let tipos = [x.tipo];
          try {
            if (x.observacao) {
              const extra = JSON.parse(x.observacao);
              if (Array.isArray(extra.grupos) && extra.grupos.length > 0) {
                const fromGrupos = [...new Set(extra.grupos.map(g => g.tipo).filter(Boolean))];
                if (fromGrupos.length > 0) tipos = fromGrupos;
              }
            }
          } catch { /* mantém tipo do registro */ }

          const tiposLabel = tipos.map(t => EXAM_ABREV[t] ?? t).join('/');
          const titulo     = x.numero != null
            ? `Exame nº ${String(x.numero).padStart(3, '0')} — ${tiposLabel}`
            : tiposLabel;

          return {
            id:     `${origemEx.toLowerCase()}-${x.id}`,
            origem: origemEx,
            data:   x.dataSolicitacao,
            titulo,
            resumo: x.descricao || x.resultado || null,
          };
        }),
        ...encaminhamentos.map(en => ({
          id:      `encaminhamento-${en.id}`,
          origem:  'ENCAMINHAMENTO',
          data:    en.dataEncaminhamento,
          titulo:  `Encaminhamento — ${en.especialidade}`,
          resumo:  en.prestador ? `Para ${en.prestador.fullName}. ${en.motivo}` : en.motivo,
        })),
        ...grupos.flatMap(g => {
          const numeroFmt = String(g.numero).padStart(3, '0');
          const porTipo = new Map();
          for (const item of g.itens) {
            const tipo = item.tipo || 'MEDICAMENTO';
            if (!porTipo.has(tipo)) porTipo.set(tipo, []);
            porTipo.get(tipo).push(item.medicamento);
          }
          const tipos = [...porTipo.keys()];
          const tipoLabel = { MEDICAMENTO: 'Medicamento', PROCEDIMENTO: 'Procedimento' };
          return tipos.map(tipo => ({
            id:     `prescricao-${g.id}-${tipo}`,
            origem: 'PRESCRICAO',
            data:   g.createdAt,
            titulo: tipos.length > 1
              ? `Prescrição nº ${numeroFmt} — ${tipoLabel[tipo] ?? tipo}`
              : `Prescrição nº ${numeroFmt}`,
            resumo: porTipo.get(tipo).join(', '),
          }));
        }),
      ];

      eventos.sort((a, b) => new Date(b.data) - new Date(a.data));
      const recentes = eventos.slice(0, limit);

      // Gera resumos via LLM (fallback para titulo em caso de falha)
      const resumos = await resumirHistorico(recentes, req.user.id, animalId, req.empresaId ?? null);

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

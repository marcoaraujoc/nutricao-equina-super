// backend/src/controllers/MapaAtendimentoController.js
// Dados agregados para o Mapa de Atendimento (tela principal).

const prisma = require('../lib/prisma').default;

const MapaAtendimentoController = {

  // GET /api/mapa-atendimento/resumo
  // Query params: data (YYYY-MM-DD), localizacaoId, veterinarioId (só GESTOR/ADMIN)
  resumo: async (req, res) => {
    try {
      const { data, localizacaoId, veterinarioId: vetIdParam } = req.query;
      const { user, empresaId, equipeId, membroCargo } = req;
      const { id: userId, userType } = user;

      const isAdmin  = userType === 'ADMIN';
      const isGestor = isAdmin || membroCargo === 'GESTOR';

      // ── Data de referência ────────────────────────────────────────────
      const dataRef = data ? new Date(data + 'T00:00:00') : new Date();
      const dataStr = dataRef.toISOString().slice(0, 10);
      const inicioDia = new Date(dataStr + 'T00:00:00');
      const fimDia    = new Date(dataStr + 'T23:59:59.999');

      // ── Escopo base de animais (empresa/equipe ativa, sem filtro de localização)
      const whereAnimalBase = { ativo: true };
      if (!isAdmin) {
        if (empresaId) whereAnimalBase.empresaId = Number(empresaId);
        if (equipeId)  whereAnimalBase.equipeId  = Number(equipeId);
      }
      if (userType === 'PROPRIETARIO') {
        whereAnimalBase.userId = Number(userId);
      }

      // Todos os animais do escopo — usados para distribuição e lista de localizações
      const todosAnimais = await prisma.animal.findMany({
        where: whereAnimalBase,
        select: {
          id: true,
          nome: true,
          localizacaoId: true,
          localizacao: { select: { id: true, nome: true } },
        },
      });

      // ── 1. Distribuição por Haras (todos os animais, sem filtro de localização) ──
      const distribuicaoMap = {};
      for (const a of todosAnimais) {
        const id   = a.localizacaoId ?? 0;
        const nome = a.localizacao?.nome ?? 'Sem Localização';
        if (!distribuicaoMap[id]) distribuicaoMap[id] = { id, nome, total: 0 };
        distribuicaoMap[id].total++;
      }
      const distribuicaoHaras = Object.values(distribuicaoMap).sort((a, b) => b.total - a.total);

      // ── IDs de animais para agendamentos (aplica filtro de localização aqui) ──
      let animalIds = todosAnimais.map(a => a.id);
      if (localizacaoId) {
        const locId = Number(localizacaoId);
        animalIds = todosAnimais
          .filter(a => a.localizacaoId === locId)
          .map(a => a.id);
      }

      // ── Veterinário: GESTOR/ADMIN usam param; não-GESTOR sempre vêem só o próprio
      const vetFiltroId = isGestor
        ? (vetIdParam ? Number(vetIdParam) : undefined)
        : Number(userId);

      // ── 2. Agendamentos do dia ────────────────────────────────────────
      const whereAgend = {
        ativo:    true,
        animalId: { in: animalIds },
        dataHora: { gte: inicioDia, lte: fimDia },
      };
      if (vetFiltroId !== undefined) whereAgend.veterinarioId = vetFiltroId;

      const agendamentos = await prisma.agendamentoClinico.findMany({
        where:   whereAgend,
        include: {
          veterinario: { select: { id: true, fullName: true } },
          animal: {
            select: {
              id:            true,
              nome:          true,
              localizacaoId: true,
              localizacao:   { select: { id: true, nome: true } },
              especie:       { select: { nome: true } },
            },
          },
        },
        orderBy: { dataHora: 'asc' },
      });

      // ── 3. Consultas clínicas (agendamentos por status) ───────────────
      const porStatus = { AGENDADO: 0, CONCLUIDO: 0, CANCELADO: 0 };
      for (const ag of agendamentos) {
        porStatus[ag.status] = (porStatus[ag.status] ?? 0) + 1;
      }
      const totalAgend  = porStatus.AGENDADO + porStatus.CONCLUIDO + porStatus.CANCELADO;
      const totalValidos = porStatus.AGENDADO + porStatus.CONCLUIDO;
      const progressoConsultas = totalValidos > 0 ? Math.round((porStatus.CONCLUIDO / totalValidos) * 100) : 0;

      // ── 4. Prescrições ativas no dia ──────────────────────────────────
      const prescricoes = animalIds.length > 0 ? await prisma.prescricao.findMany({
        where: {
          animalId:   { in: animalIds },
          status:     'ATIVA',
          ativo:      true,
          dataInicio: { lte: fimDia },
          dataFim:    { gte: inicioDia },
        },
        select: { id: true, animalId: true },
      }) : [];

      // ── 5. Animais sem atendimento hoje ───────────────────────────────
      const animalIdsComAgend = new Set(agendamentos.map(ag => ag.animalId));
      const semAtendimento    = animalIds.filter(id => !animalIdsComAgend.has(id)).length;
      const comAtendimento    = animalIds.length - semAtendimento;

      // ── 6. Cronograma ─────────────────────────────────────────────────
      const cronograma = agendamentos.map(ag => ({
        id:            ag.id,
        tipo:          'agendamento',
        animal:        { id: ag.animal.id, nome: ag.animal.nome, especie: ag.animal.especie?.nome },
        localizacao:   ag.animal.localizacao ?? null,
        procedimento:  ag.tipo,
        descricao:     ag.titulo ?? ag.tipo,
        status:        ag.status,
        dataHora:      ag.dataHora,
        responsavel:   ag.veterinario?.fullName ?? null,
        responsavelId: ag.veterinario?.id ?? null,
      }));

      // Animais sem atendimento — incluídos no cronograma para filtragem client-side.
      // Usam animalIds (já filtrado por localização) para não incluir animais de outros locais.
      const animalMap = new Map(todosAnimais.map(a => [a.id, a]));
      const semAtendimentoItems = animalIds
        .filter(id => !animalIdsComAgend.has(id))
        .map(id => {
          const a = animalMap.get(id);
          return {
            id:            -(id),
            tipo:          'sem_atendimento',
            animal:        { id, nome: a?.nome ?? '' },
            localizacao:   a?.localizacao ?? null,
            procedimento:  'SEM_ATENDIMENTO',
            descricao:     'Sem atendimento programado',
            status:        'SEM_ATENDIMENTO',
            dataHora:      null,
            responsavel:   null,
            responsavelId: null,
          };
        });

      // ── 7. Veterinários do contexto (só para GESTOR/ADMIN) ───────────
      let veterinarios = [];
      if (isGestor && empresaId) {
        const membros = await prisma.membroEquipe.findMany({
          where: {
            equipe: { empresaId: Number(empresaId) },
            user:   { userType: { in: ['VETERINARIO', 'ESTAGIARIO'] }, ativo: true },
            ...(equipeId ? { equipeId: Number(equipeId) } : {}),
          },
          select: { user: { select: { id: true, fullName: true } } },
        });
        const seen = new Set();
        veterinarios = membros
          .map(m => m.user)
          .filter(u => { if (seen.has(u.id)) return false; seen.add(u.id); return true; })
          .sort((a, b) => a.fullName.localeCompare(b.fullName));
      }

      return res.json({
        data: {
          isGestor,
          distribuicaoHaras,
          consultasClinicas: {
            agendado:  porStatus.AGENDADO,
            concluido: porStatus.CONCLUIDO,
            cancelado: porStatus.CANCELADO,
            total:     totalAgend,
            progresso: progressoConsultas,
          },
          prescricoes: {
            total:  prescricoes.length,
            ativas: prescricoes.length,
          },
          animaisSemAtendimento: {
            semAtendimento,
            comAtendimento,
            total: animalIds.length,
          },
          cronograma: [...cronograma, ...semAtendimentoItems],
          filtros: {
            // Localizações onde há animais da equipe (exclui "Sem Localização")
            localizacoes: Object.values(distribuicaoMap)
              .filter(l => l.id !== 0)
              .sort((a, b) => a.nome.localeCompare(b.nome)),
            // Veterinários só para GESTOR/ADMIN; não-GESTOR recebe lista vazia
            veterinarios,
          },
        },
      });
    } catch (err) {
      console.error('Erro ao carregar mapa de atendimento:', err);
      return res.status(500).json({ error: 'Erro ao carregar mapa de atendimento' });
    }
  },
};

module.exports = MapaAtendimentoController;

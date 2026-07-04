// backend/src/controllers/MapaAtendimentoController.js
// Dados agregados para o Mapa de Atendimento (tela principal).

const prisma = require('../lib/prisma').default;

const ANIMAL_SELECT = {
  id:            true,
  nome:          true,
  localizacaoId: true,
  localizacao:   { select: { id: true, nome: true } },
  especie:       { select: { nome: true } },
};

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

      // ── Escopo base de animais ────────────────────────────────────────
      const whereAnimalBase = { ativo: true };
      if (!isAdmin) {
        if (empresaId) whereAnimalBase.empresaId = Number(empresaId);
        if (equipeId)  whereAnimalBase.equipeId  = Number(equipeId);
      }
      if (userType === 'PROPRIETARIO') whereAnimalBase.userId = Number(userId);

      const todosAnimais = await prisma.animal.findMany({
        where: whereAnimalBase,
        select: {
          id:            true,
          nome:          true,
          localizacaoId: true,
          localizacao:   { select: { id: true, nome: true } },
        },
      });

      // ── 1. Distribuição por Haras ─────────────────────────────────────
      const distribuicaoMap = {};
      for (const a of todosAnimais) {
        const id   = a.localizacaoId ?? 0;
        const nome = a.localizacao?.nome ?? 'Sem Localização';
        if (!distribuicaoMap[id]) distribuicaoMap[id] = { id, nome, total: 0 };
        distribuicaoMap[id].total++;
      }
      const distribuicaoHaras = Object.values(distribuicaoMap).sort((a, b) => b.total - a.total);

      // ── IDs filtrados por localização (para agendamentos/atividades) ──
      let animalIds = todosAnimais.map(a => a.id);
      if (localizacaoId) {
        const locId = Number(localizacaoId);
        animalIds = todosAnimais.filter(a => a.localizacaoId === locId).map(a => a.id);
      }

      if (animalIds.length === 0) {
        return res.json({ data: {
          isGestor, distribuicaoHaras,
          consultasClinicas: { agendado: 0, concluido: 0, cancelado: 0, total: 0, progresso: 0 },
          prescricoes: { total: 0, ativas: 0 },
          animaisSemAtendimento: { semAtendimento: 0, comAtendimento: 0, total: 0 },
          cronograma: [],
          filtros: { localizacoes: Object.values(distribuicaoMap).filter(l => l.id !== 0).sort((a,b) => a.nome.localeCompare(b.nome)), veterinarios: [] },
        }});
      }

      // Filtro de vet: para GESTOR com param → filtra; não-GESTOR → não filtra
      // (animalIds já está escopado ao usuário; filtro de vet só é opção de GESTOR)
      const vetParamFilter = isGestor && vetIdParam ? { veterinarioId: Number(vetIdParam) } : {};

      // Para agendamentos, não-GESTOR ainda vê apenas os seus (comportamento original)
      const vetAgendFilter = isGestor
        ? (vetIdParam ? { veterinarioId: Number(vetIdParam) } : {})
        : { veterinarioId: Number(userId) };

      // ── 2. Agendamentos do dia ────────────────────────────────────────
      const agendamentos = await prisma.agendamentoClinico.findMany({
        where: {
          ativo:    true,
          animalId: { in: animalIds },
          dataHora: { gte: inicioDia, lte: fimDia },
          ...vetAgendFilter,
        },
        include: {
          veterinario: { select: { id: true, fullName: true } },
          animal: { select: ANIMAL_SELECT },
        },
        orderBy: { dataHora: 'asc' },
      });

      // ── 3. Grupos de prescrição FINALIZADO/CANCELADO_PARCIALMENTE com janela ativa no dia ──
      // Usa PrescricaoGrupo (não Prescricao individual) para alinhar com
      // listarParaExecucao — mesmo algoritmo de janela: dataInicio + duracaoDias.
      const gruposCandidate = await prisma.prescricaoGrupo.findMany({
        where: {
          animalId: { in: animalIds },
          status:   { in: ['FINALIZADO', 'CANCELADO_PARCIALMENTE'] },
          OR: [
            { evolucaoId: null },
            { evolucao: { aprovado: true } },
          ],
          ...vetParamFilter,
        },
        include: {
          animal:      { select: ANIMAL_SELECT },
          veterinario: { select: { id: true, fullName: true } },
          itens: {
            where:  { ativo: true },
            select: { id: true, medicamento: true, tipo: true, dataInicio: true, duracaoDias: true, horaInicio: true, executadoEm: true },
          },
        },
        orderBy: { numero: 'asc' },
      });

      // Janela de um item (mesmo algoritmo de listarParaExecucao/executar)
      const itemDentroDoDia = (item) => {
        const inicioStr = new Date(item.dataInicio).toISOString().split('T')[0];
        const fim = new Date(inicioStr + 'T00:00:00Z');
        fim.setUTCDate(fim.getUTCDate() + Math.max(Number(item.duracaoDias) || 1, 1));
        const fimStr = fim.toISOString().split('T')[0];
        return inicioStr <= dataStr && dataStr < fimStr;
      };

      // Mantém apenas grupos cuja janela inclui dataStr (mesmo filtro JS do listarParaExecucao)
      const prescricoesDoDia = gruposCandidate.filter(g => g.itens.some(itemDentroDoDia));

      // ── 4. Vacinas do dia (aplicação ou reforço) ──────────────────────
      const vacinasDoDia = await prisma.vacinaClinica.findMany({
        where: {
          ativo:    true,
          animalId: { in: animalIds },
          OR: [
            { dataAplicacao: { gte: inicioDia, lte: fimDia } },
            { dataReforco:   { gte: inicioDia, lte: fimDia } },
          ],
          ...vetParamFilter,
        },
        include: {
          animal:      { select: ANIMAL_SELECT },
          veterinario: { select: { id: true, fullName: true } },
        },
        orderBy: { dataAplicacao: 'asc' },
      });

      // ── 5. Exames clínicos solicitados no dia ─────────────────────────
      const examesDoDia = await prisma.exameClinico.findMany({
        where: {
          ativo:           true,
          animalId:        { in: animalIds },
          dataSolicitacao: { gte: inicioDia, lte: fimDia },
          ...vetParamFilter,
        },
        include: {
          animal:      { select: ANIMAL_SELECT },
          veterinario: { select: { id: true, fullName: true } },
        },
        orderBy: { dataSolicitacao: 'asc' },
      });

      // ── KPIs ──────────────────────────────────────────────────────────
      // EM_ANDAMENTO conta como pendente (ainda não concluído); FINALIZADO conta
      // como concluído (equivalente a CONCLUIDO, mas veio do fluxo de evolução clínica).
      const porStatus = { AGENDADO: 0, EM_ANDAMENTO: 0, CONCLUIDO: 0, FINALIZADO: 0, CANCELADO: 0 };
      for (const ag of agendamentos) porStatus[ag.status] = (porStatus[ag.status] ?? 0) + 1;
      const agendadoTotal  = porStatus.AGENDADO + porStatus.EM_ANDAMENTO;
      const concluidoTotal = porStatus.CONCLUIDO + porStatus.FINALIZADO;
      const totalAgend   = agendadoTotal + concluidoTotal + porStatus.CANCELADO;
      const totalValidos = agendadoTotal + concluidoTotal;
      const progressoConsultas = totalValidos > 0 ? Math.round((concluidoTotal / totalValidos) * 100) : 0;

      // Animais com qualquer atividade no dia
      const animalIdsComAtiv = new Set([
        ...agendamentos.map(ag => ag.animalId),
        ...prescricoesDoDia.map(p => p.animalId),
        ...vacinasDoDia.map(v => v.animalId),
        ...examesDoDia.map(e => e.animalId),
      ]);
      const semAtendimento = animalIds.filter(id => !animalIdsComAtiv.has(id)).length;
      const comAtendimento = animalIds.length - semAtendimento;

      // ── Montar cronograma ─────────────────────────────────────────────

      const cronogramaAgend = agendamentos.map(ag => ({
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

      // prescricoesDoDia agora são PrescricaoGrupo — um item por grupo (não por Prescricao individual)
      const cronogramaPresc = prescricoesDoDia.map(g => {
        const nomes = g.itens.map(i => i.medicamento).filter(Boolean).join(' · ');
        const primeiroHorario = g.itens.find(i => i.horaInicio)?.horaInicio ?? null;

        let dataHora = null;
        if (primeiroHorario) {
          const [hh, mm] = primeiroHorario.split(':').map(Number);
          dataHora = new Date(dataStr + 'T00:00:00');
          dataHora.setHours(hh, mm, 0, 0);
        }

        // Itens cuja dose de hoje já foi dada (executadoEm registrado no próprio dia
        // de referência — executar() atualiza a data a cada execução diária).
        const itensDoDia = g.itens.filter(itemDentroDoDia);
        const jaExecutadoHoje = itensDoDia.length > 0 && itensDoDia.every(i =>
          i.executadoEm && new Date(i.executadoEm).toISOString().split('T')[0] === dataStr
        );

        return {
          id:            `grupo-${g.id}`,
          grupoId:       g.id,            // id direto do PrescricaoGrupo
          tipo:          'prescricao',
          animal:        { id: g.animal.id, nome: g.animal.nome, especie: g.animal.especie?.nome },
          localizacao:   g.animal.localizacao ?? null,
          procedimento:  'PRESCRICAO',
          descricao:     nomes || 'Prescrição',
          status:        jaExecutadoHoje ? 'EXECUTADO' : 'AGENDADO',
          dataHora,
          responsavel:   g.veterinario?.fullName ?? null,
          responsavelId: g.veterinario?.id ?? null,
        };
      });

      const cronogramaVacina = [];
      for (const v of vacinasDoDia) {
        const aplicHoje = v.dataAplicacao >= inicioDia && v.dataAplicacao <= fimDia;
        const reforHoje = v.dataReforco && v.dataReforco >= inicioDia && v.dataReforco <= fimDia;
        const animal    = { id: v.animal.id, nome: v.animal.nome, especie: v.animal.especie?.nome };
        const loc       = v.animal.localizacao ?? null;
        const resp      = v.veterinario?.fullName ?? null;
        const respId    = v.veterinario?.id ?? null;

        if (aplicHoje) {
          cronogramaVacina.push({
            id:            `vac-${v.id}`,
            tipo:          'vacina',
            animal,
            localizacao:   loc,
            procedimento:  'VACINA',
            descricao:     v.nome + (v.dose ? ` — ${v.dose}` : '') + (v.via ? ` · ${v.via}` : ''),
            status:        'CONCLUIDO',
            dataHora:      v.dataAplicacao,
            responsavel:   resp,
            responsavelId: respId,
          });
        }
        if (reforHoje) {
          cronogramaVacina.push({
            id:            `reforco-${v.id}`,
            tipo:          'vacina_reforco',
            animal,
            localizacao:   loc,
            procedimento:  'VACINA',
            descricao:     `Reforço: ${v.nome}`,
            status:        'AGENDADO',
            dataHora:      v.dataReforco,
            responsavel:   resp,
            responsavelId: respId,
          });
        }
      }

      const cronogramaExame = examesDoDia.map(e => ({
        id:            `exam-${e.id}`,
        tipo:          'exame',
        animal:        { id: e.animal.id, nome: e.animal.nome, especie: e.animal.especie?.nome },
        localizacao:   e.animal.localizacao ?? null,
        procedimento:  'EXAME',
        descricao:     e.descricao ?? e.tipo,
        status:        e.status === 'CONCLUIDO' ? 'CONCLUIDO' : e.status === 'CANCELADO' ? 'CANCELADO' : 'AGENDADO',
        dataHora:      e.dataSolicitacao,
        responsavel:   e.veterinario?.fullName ?? null,
        responsavelId: e.veterinario?.id ?? null,
      }));

      // Animais sem nenhuma atividade
      const animalMap = new Map(todosAnimais.map(a => [a.id, a]));
      const semAtendimentoItems = animalIds
        .filter(id => !animalIdsComAtiv.has(id))
        .map(id => {
          const a = animalMap.get(id);
          return {
            id:            `sem-${id}`,
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

      // Junta tudo e ordena por horário
      const cronograma = [
        ...cronogramaAgend,
        ...cronogramaPresc,
        ...cronogramaVacina,
        ...cronogramaExame,
        ...semAtendimentoItems,
      ].sort((a, b) => {
        if (!a.dataHora && !b.dataHora) return 0;
        if (!a.dataHora) return 1;
        if (!b.dataHora) return -1;
        return new Date(a.dataHora) - new Date(b.dataHora);
      });

      // ── Veterinários (GESTOR/ADMIN) ───────────────────────────────────
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
            agendado:  agendadoTotal,
            concluido: concluidoTotal,
            cancelado: porStatus.CANCELADO,
            total:     totalAgend,
            progresso: progressoConsultas,
          },
          prescricoes: {
            total:  prescricoesDoDia.length,
            ativas: prescricoesDoDia.length,
          },
          animaisSemAtendimento: { semAtendimento, comAtendimento, total: animalIds.length },
          cronograma,
          filtros: {
            localizacoes: Object.values(distribuicaoMap)
              .filter(l => l.id !== 0)
              .sort((a, b) => a.nome.localeCompare(b.nome)),
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

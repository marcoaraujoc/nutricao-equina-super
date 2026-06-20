// backend/src/controllers/AgendamentoController.js
// Agendamentos do animal (consulta, vacina, retorno, exame, procedimento).
// Exibidos no painel "Agendamentos" da tela do animal (AnimalDetail).

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal }                   = require('../lib/animalAccess');
const { formatAtendimentoNum }                    = require('../lib/faturaUtils');
const emailService                                = require('../services/emailService');
const whatsappService                             = require('../services/whatsappService');
const { interpretarAgendamento, HORARIOS_PADRAO } = require('../services/agendamentoLLMService');

const TIPOS_VALIDOS  = ['CONSULTA', 'VACINA', 'RETORNO', 'EXAME', 'PROCEDIMENTO'];
const STATUS_VALIDOS = ['AGENDADO', 'CONCLUIDO', 'CANCELADO'];
// Proprietário e fornecedor visualizam; quem agenda é a equipe clínica
const PODE_GERENCIAR = ['ADMIN', 'VETERINARIO', 'ESTAGIARIO'];

const INCLUDE = {
  veterinario: { select: { id: true, fullName: true } },
};

function podeGerenciar(user) {
  return user.role === 'ADMIN' || PODE_GERENCIAR.includes(user.userType);
}

const INCLUDE_GLOBAL = {
  veterinario: { select: { id: true, fullName: true } },
  animal: {
    select: {
      id:      true,
      nome:    true,
      especie: { select: { nome: true } },
      user:    { select: { id: true, fullName: true } },
    },
  },
};

const AgendamentoController = {

  // GET /clinica/agendamentos?data=YYYY-MM-DD&mesAno=YYYY-MM&status=STATUS
  listarGlobal: async (req, res) => {
    try {
      const { data, mesAno, status } = req.query;
      const { userType, role, id: userId } = req.user;
      const isAdmin = role === 'ADMIN' && userType !== 'PROPRIETARIO';

      const where = { ativo: true };

      if (data) {
        where.dataHora = {
          gte: new Date(data + 'T00:00:00'),
          lte: new Date(data + 'T23:59:59.999'),
        };
      } else if (mesAno) {
        const [ano, mes] = mesAno.split('-').map(Number);
        where.dataHora = {
          gte: new Date(ano, mes - 1, 1),
          lte: new Date(ano, mes, 0, 23, 59, 59, 999),
        };
      }

      if (status && STATUS_VALIDOS.includes(status)) {
        where.status = status;
      }

      if (!isAdmin) {
        if (userType === 'PROPRIETARIO') {
          where.animal = { userId: Number(userId) };
        } else if (userType === 'FORNECEDOR') {
          where.animal = {
            designacoesPrestador: {
              some: {
                prestadorId: Number(userId),
                ativo:       true,
                OR: [{ dataFim: null }, { dataFim: { gte: new Date() } }],
              },
            },
          };
        } else {
          // VETERINARIO / ESTAGIARIO
          // GESTOR vê todos os agendamentos da equipe; demais profissionais só os seus próprios.
          let isGestor = false;
          if (req.empresaId) {
            const membroWhere = { userId: Number(userId), cargo: 'GESTOR' };
            if (req.equipeId) membroWhere.equipeId = Number(req.equipeId);
            else              membroWhere.equipe   = { empresaId: Number(req.empresaId) };
            isGestor = !!(await prisma.membroEquipe.findFirst({ where: membroWhere, select: { id: true } }));
          }

          if (isGestor) {
            // GESTOR: todos os agendamentos da empresa/equipe ativa
            const animalWhere = { empresaId: Number(req.empresaId) };
            if (req.equipeId) animalWhere.equipeId = Number(req.equipeId);
            where.animal = animalWhere;
          } else if (req.empresaId) {
            // VET/ESTAGIÁRIO com contexto de empresa: apenas os próprios agendamentos
            where.veterinarioId = Number(userId);
          } else if (userType === 'VETERINARIO') {
            // Sem contexto de empresa: agendamentos via vínculo direto com o animal
            where.OR = [
              {
                animal: {
                  solicitacoes: {
                    some: {
                      vetUserId: Number(userId),
                      OR: [
                        { tipo: 'VINCULO',    status: 'ACEITO'   },
                        { tipo: 'DESVINCULO', status: 'PENDENTE' },
                        { tipo: 'TROCA_VET',  status: 'PENDENTE' },
                      ],
                    },
                  },
                },
              },
              { veterinarioId: Number(userId) },
            ];
          } else {
            // ESTAGIÁRIO sem contexto: apenas os explicitamente atribuídos
            where.veterinarioId = Number(userId);
          }
        }
      } else if (req.empresaId) {
        where.animal = { empresaId: Number(req.empresaId) };
      }

      const itens = await prisma.agendamentoClinico.findMany({
        where,
        include: INCLUDE_GLOBAL,
        orderBy: { dataHora: 'asc' },
        take:    500,
      });

      res.json({ dados: itens });
    } catch (err) {
      console.error('Erro ao listar agendamentos globais:', err);
      res.status(500).json({ error: 'Erro ao listar agendamentos' });
    }
  },

  // GET /clinica/agendamentos/animal/:animalId?futuros=1
  listarPorAnimal: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);

      const acesso = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const where = { animalId, ativo: true };
      if (req.query.futuros === '1') {
        where.status   = 'AGENDADO';
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        where.dataHora = { gte: hoje };
      } else if (req.query.status && STATUS_VALIDOS.includes(req.query.status)) {
        where.status = req.query.status;
      }

      const itens = await prisma.agendamentoClinico.findMany({
        where,
        include: INCLUDE,
        orderBy: { dataHora: 'asc' },
      });

      res.json({ dados: itens });
    } catch (err) {
      console.error('Erro ao listar agendamentos:', err);
      res.status(500).json({ error: 'Erro ao listar agendamentos' });
    }
  },

  // POST /clinica/agendamentos
  // body: { animalId, tipo, titulo, dataHora, observacao?, veterinarioId? }
  criar: async (req, res) => {
    try {
      if (!podeGerenciar(req.user)) {
        return res.status(403).json({ error: 'Sem permissão para criar agendamentos' });
      }

      const { animalId, tipo = 'CONSULTA', titulo, dataHora, observacao, veterinarioId } = req.body;

      if (!animalId || !titulo?.trim() || !dataHora) {
        return res.status(400).json({ error: 'animalId, titulo e dataHora são obrigatórios' });
      }
      if (!TIPOS_VALIDOS.includes(tipo)) {
        return res.status(400).json({ error: `tipo deve ser um de: ${TIPOS_VALIDOS.join(', ')}` });
      }
      const quando = new Date(dataHora);
      if (isNaN(quando.getTime())) {
        return res.status(400).json({ error: 'dataHora inválida' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const item = await prisma.$transaction(async (tx) => {
        const maxResult = await tx.agendamentoClinico.aggregate({
          where:   { animalId: Number(animalId), ativo: true },
          _max:    { numero: true },
        });
        const proximoNumero = (maxResult._max.numero ?? 0) + 1;

        return tx.agendamentoClinico.create({
          data: {
            animalId:      Number(animalId),
            tipo,
            titulo:        titulo.trim(),
            dataHora:      quando,
            observacao:    observacao?.trim() || null,
            numero:        proximoNumero,
            veterinarioId: veterinarioId
              ? Number(veterinarioId)
              : (req.user.userType === 'VETERINARIO' ? req.user.id : null),
            criadoPorId:   req.user.id,
          },
          include: INCLUDE,
        });
      });

      res.status(201).json({
        dados: {
          ...item,
          atendimentoNumero: formatAtendimentoNum('AG', item.numero),
        },
      });

      // Fire-and-forget: notifica via email + WhatsApp
      setImmediate(async () => {
        try {
          const vet = item.veterinarioId
            ? await prisma.user.findUnique({ where: { id: item.veterinarioId }, select: { email: true, fullName: true, phone: true } })
            : null;

          let animalNome = 'Paciente', proprietarioNome = '', proprietarioPhone = '', proprietarioEmail = '';
          if (item.animalId) {
            const animal = await prisma.animal.findUnique({
              where:   { id: item.animalId },
              include: { user: { select: { fullName: true, phone: true, email: true } } },
            });
            animalNome        = animal?.nome           ?? 'Paciente';
            proprietarioNome  = animal?.user?.fullName ?? '';
            proprietarioPhone = animal?.user?.phone    ?? '';
            proprietarioEmail = animal?.user?.email    ?? '';
          }

          const d        = new Date(item.dataHora);
          const dataFmt  = d.toLocaleDateString('pt-BR',  { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
          const horaFmt  = d.toLocaleTimeString('pt-BR',  { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
          const tipoLabel = { CONSULTA: 'Consulta', VACINA: 'Vacina', RETORNO: 'Retorno', EXAME: 'Exame', PROCEDIMENTO: 'Procedimento' }[item.tipo] ?? item.tipo;

          // E-mail ao veterinário
          if (vet?.email) {
            await emailService.enviarNotificacaoAgendamentoProfissional({
              vetEmail: vet.email, vetNome: vet.fullName,
              animalNome, proprietarioNome, proprietarioPhone,
              dataHora: item.dataHora, tipo: item.tipo,
            }).catch(() => {});
          }

          // WhatsApp ao veterinário
          if (vet?.phone) {
            const msgVet = [
              `🐴 *S2Vet — Novo agendamento*`,
              `📋 ${tipoLabel} · ${horaFmt} · ${dataFmt}`,
              `🐎 Paciente: *${animalNome}*`,
              proprietarioNome  ? `👤 Proprietário: ${proprietarioNome}` : '',
              proprietarioPhone ? `📱 Contato: ${proprietarioPhone}`     : '',
            ].filter(Boolean).join('\n');
            await whatsappService.sendWhatsApp(vet.phone, msgVet).catch(() => {});
          }

          // WhatsApp ao proprietário
          if (proprietarioPhone) {
            const vetNome  = vet?.fullName ?? 'Veterinário';
            const appUrl   = process.env.APP_URL || 'http://localhost:5173';
            const msgPropr = [
              `🐴 *S2Vet — Consulta agendada!*`,
              `📅 ${dataFmt} às *${horaFmt}*`,
              `🐎 Paciente: *${animalNome}*`,
              `🩺 Dr(a). ${vetNome}`,
              ``,
              `Acompanhe em: ${appUrl}`,
            ].join('\n');
            await whatsappService.sendWhatsApp(proprietarioPhone, msgPropr).catch(() => {});
          }
        } catch { /* silencioso — notificações não bloqueiam o fluxo */ }
      });
    } catch (err) {
      console.error('Erro ao criar agendamento:', err);
      res.status(500).json({ error: 'Erro ao criar agendamento' });
    }
  },

  // PATCH /clinica/agendamentos/:id/status — body: { status, motivo? }
  atualizarStatus: async (req, res) => {
    try {
      if (!podeGerenciar(req.user)) {
        return res.status(403).json({ error: 'Sem permissão para alterar agendamentos' });
      }

      const { status, motivo } = req.body;
      if (!STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ error: `status deve ser um de: ${STATUS_VALIDOS.join(', ')}` });
      }

      const item = await prisma.agendamentoClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Agendamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const updateData = { status };
      if (status === 'CANCELADO' && motivo?.trim()) {
        updateData.observacao = motivo.trim();
      }

      const atualizado = await prisma.agendamentoClinico.update({
        where:   { id: item.id },
        data:    updateData,
        include: INCLUDE,
      });

      res.json({ dados: atualizado });
    } catch (err) {
      console.error('Erro ao atualizar agendamento:', err);
      res.status(500).json({ error: 'Erro ao atualizar agendamento' });
    }
  },

  // PATCH /clinica/agendamentos/:id — body: { titulo?, tipo?, dataHora?, observacao? }
  atualizar: async (req, res) => {
    try {
      if (!podeGerenciar(req.user)) {
        return res.status(403).json({ error: 'Sem permissão para alterar agendamentos' });
      }

      const item = await prisma.agendamentoClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Agendamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const { titulo, tipo, dataHora, observacao, veterinarioId } = req.body;
      const data = {};

      if (titulo?.trim()) data.titulo = titulo.trim();
      if (tipo && TIPOS_VALIDOS.includes(tipo)) data.tipo = tipo;
      if (dataHora) {
        const quando = new Date(dataHora);
        if (!isNaN(quando.getTime())) data.dataHora = quando;
      }
      if (observacao !== undefined) data.observacao = observacao?.trim() || null;
      if (veterinarioId !== undefined) data.veterinarioId = veterinarioId === null ? null : Number(veterinarioId);

      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
      }

      const atualizado = await prisma.agendamentoClinico.update({
        where:   { id: item.id },
        data,
        include: INCLUDE_GLOBAL,
      });

      res.json({ dados: atualizado });
    } catch (err) {
      console.error('Erro ao atualizar agendamento:', err);
      res.status(500).json({ error: 'Erro ao atualizar agendamento' });
    }
  },

  // POST /clinica/agendamentos/interpretar — LLM interpreta texto de voz e verifica disponibilidade
  interpretarVoz: async (req, res) => {
    try {
      const { texto, dataReferencia, vetHint, horaHint } = req.body;
      if (!texto?.trim()) return res.status(400).json({ error: 'texto é obrigatório' });

      const { empresaId, equipeId, user } = req;

      // Busca vets da empresa/equipe ativa
      const membroWhere = {};
      if (empresaId) {
        membroWhere.equipe = { empresaId: Number(empresaId) };
        if (equipeId) membroWhere.equipeId = Number(equipeId);
      }
      const membros = await prisma.membroEquipe.findMany({
        where:   { ...membroWhere, user: { userType: 'VETERINARIO', ativo: true } },
        include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
        take:    50,
      });
      const vets = membros.map(m => ({ id: m.user.id, fullName: m.user.fullName }));

      // Fallback: inclui o próprio usuário se for vet
      if (vets.length === 0 && user.userType === 'VETERINARIO') {
        const u = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, fullName: true } });
        if (u) vets.push(u);
      }

      // Busca animais da empresa/equipe ativa
      const animalWhere = { ativo: true };
      if (empresaId) animalWhere.empresaId = Number(empresaId);
      if (equipeId)  animalWhere.equipeId  = Number(equipeId);
      const animaisDb = await prisma.animal.findMany({
        where:   animalWhere,
        include: { especie: { select: { nome: true } } },
        take:    200,
      });
      const animais = animaisDb.map(a => ({ id: a.id, nome: a.nome, especie: a.especie }));

      // Chama LLM
      const dataRef = dataReferencia ?? new Date().toISOString().slice(0, 10);
      const interpretacao = await interpretarAgendamento({
        texto: texto.trim(),
        vets,
        animais,
        dataReferencia: dataRef,
        vetHint:  vetHint  ? Number(vetHint)  : undefined,
        horaHint: horaHint ?? undefined,
      });

      if (!interpretacao) {
        return res.json({ sucesso: false, mensagem: 'Não foi possível interpretar a solicitação. Tente novamente com mais detalhes.' });
      }

      const { data, hora, animalId, vetId, animalNomeNaoEncontrado, vetNomeNaoEncontrado, confianca, resumo } = interpretacao;

      if (!data || !hora) {
        return res.json({
          sucesso:  false,
          mensagem: 'Não consegui identificar a data e o horário. Mencione quando deseja agendar.',
          resumo,
          confianca,
        });
      }

      const dataHoraISO = new Date(`${data}T${hora}:00`);
      if (isNaN(dataHoraISO.getTime())) {
        return res.json({ sucesso: false, mensagem: 'Data ou hora inválida. Tente novamente.', resumo });
      }

      if (!animalId) {
        return res.json({
          sucesso: false,
          animalNomeNaoEncontrado: animalNomeNaoEncontrado ?? null,
          mensagem: animalNomeNaoEncontrado
            ? `"${animalNomeNaoEncontrado}" não está nos cadastros desta equipe.`
            : 'Não consegui identificar o animal. Mencione o nome do paciente.',
          resumo,
          confianca,
        });
      }

      // Bloqueia se o usuário mencionou um vet que não existe na equipe
      if (!vetId && vetNomeNaoEncontrado && !vetHint) {
        return res.json({
          sucesso: false,
          vetNomeNaoEncontrado,
          mensagem: `O especialista "${vetNomeNaoEncontrado}" não faz parte da equipe.`,
          resumo,
          confianca,
        });
      }

      // Verifica disponibilidade do vet
      const vetIdFinal = vetId ?? (vetHint ? Number(vetHint) : null);
      let disponivel = true;
      let conflito   = null;

      if (vetIdFinal) {
        const existente = await prisma.agendamentoClinico.findFirst({
          where: {
            veterinarioId: vetIdFinal,
            ativo:         true,
            status:        { not: 'CANCELADO' },
            dataHora:      { gte: new Date(`${data}T00:00:00`), lte: new Date(`${data}T23:59:59`) },
          },
          include: { animal: { select: { nome: true } } },
        });
        if (existente) {
          const existHora = new Date(existente.dataHora);
          const diffMin   = Math.abs(existHora.getTime() - dataHoraISO.getTime()) / 60000;
          if (diffMin < 60) {
            disponivel = false;
            conflito   = {
              hora:       `${String(existHora.getHours()).padStart(2,'0')}:${String(existHora.getMinutes()).padStart(2,'0')}`,
              animalNome: existente.animal?.nome ?? null,
            };
          }
        }
      }

      // Horários livres do vet na mesma data
      const ocupadosDb = vetIdFinal ? await prisma.agendamentoClinico.findMany({
        where: {
          veterinarioId: vetIdFinal,
          ativo:  true,
          status: { not: 'CANCELADO' },
          dataHora: { gte: new Date(`${data}T00:00:00`), lte: new Date(`${data}T23:59:59`) },
        },
        select: { dataHora: true },
      }) : [];
      const ocupadosSet = new Set(ocupadosDb.map(h => {
        const d = new Date(h.dataHora);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      }));
      const horariosLivres = HORARIOS_PADRAO.filter(h => !ocupadosSet.has(h));

      // Detalhes do animal
      const animalDetalhado = await prisma.animal.findUnique({
        where:   { id: animalId },
        include: {
          especie: { select: { nome: true } },
          user:    { select: { id: true, fullName: true, email: true, phone: true } },
        },
      });

      // Detalhes do vet
      const vetDetalhado = vetIdFinal ? await prisma.user.findUnique({
        where:  { id: vetIdFinal },
        select: { id: true, fullName: true, email: true, phone: true },
      }) : null;

      return res.json({
        sucesso:    true,
        disponivel,
        dataHora:   dataHoraISO.toISOString(),
        data,
        hora,
        animalId,
        animal: animalDetalhado ? {
          id:          animalDetalhado.id,
          nome:        animalDetalhado.nome,
          especie:     animalDetalhado.especie?.nome ?? null,
          proprietario: animalDetalhado.user ? {
            fullName: animalDetalhado.user.fullName,
            email:    animalDetalhado.user.email,
            phone:    animalDetalhado.user.phone ?? '',
          } : null,
        } : null,
        vetId:   vetDetalhado?.id    ?? null,
        vet:     vetDetalhado        ?? null,
        confianca,
        resumo,
        conflito,
        horariosLivres,
      });
    } catch (err) {
      console.error('[AgendamentoController] interpretarVoz:', err);
      res.status(500).json({ error: 'Erro ao interpretar solicitação' });
    }
  },

  // DELETE /clinica/agendamentos/:id — soft delete
  excluir: async (req, res) => {
    try {
      if (!podeGerenciar(req.user)) {
        return res.status(403).json({ error: 'Sem permissão para excluir agendamentos' });
      }

      const item = await prisma.agendamentoClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Agendamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      await prisma.agendamentoClinico.update({ where: { id: item.id }, data: { ativo: false } });

      res.json({ dados: { id: item.id, excluido: true } });
    } catch (err) {
      console.error('Erro ao excluir agendamento:', err);
      res.status(500).json({ error: 'Erro ao excluir agendamento' });
    }
  },

  // PATCH /clinica/agendamentos/transferir-dia — body: { data, deVetId, paraVetId }
  transferirDia: async (req, res) => {
    try {
      if (!podeGerenciar(req.user)) {
        return res.status(403).json({ error: 'Sem permissão para alterar agendamentos' });
      }

      const { data, deVetId, paraVetId } = req.body;
      if (!data || !deVetId || !paraVetId) {
        return res.status(400).json({ error: 'data, deVetId e paraVetId são obrigatórios' });
      }
      if (Number(deVetId) === Number(paraVetId)) {
        return res.status(400).json({ error: 'Profissional de origem e destino devem ser diferentes' });
      }

      const result = await prisma.agendamentoClinico.updateMany({
        where: {
          ativo:         true,
          status:        'AGENDADO',
          veterinarioId: Number(deVetId),
          dataHora: {
            gte: new Date(data + 'T00:00:00'),
            lte: new Date(data + 'T23:59:59.999'),
          },
        },
        data: { veterinarioId: Number(paraVetId) },
      });

      res.json({ dados: { transferidos: result.count } });
    } catch (err) {
      console.error('Erro ao transferir agenda do dia:', err);
      res.status(500).json({ error: 'Erro ao transferir agenda do dia' });
    }
  },
};

module.exports = AgendamentoController;

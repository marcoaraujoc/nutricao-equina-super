// backend/src/controllers/AgendamentoController.js
// Agendamentos do animal (consulta, vacina, retorno, exame, procedimento).
// Exibidos no painel "Agendamentos" da tela do animal (AnimalDetail).

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal }                   = require('../lib/animalAccess');
const { formatAtendimentoNum }                    = require('../lib/faturaUtils');
const { registrarAuditoria }                      = require('../lib/auditoria');
const { podeOperarRegistro, NIVEL_ORDINAL }       = require('../middlewares/permissao.middleware');
const emailService                                = require('../services/emailService');
const whatsappService                             = require('../services/whatsappService');
const { interpretarAgendamento, HORARIOS_PADRAO } = require('../services/agendamentoLLMService');

const TIPOS_VALIDOS  = ['CONSULTA', 'VACINA', 'RETORNO', 'EXAME', 'PROCEDIMENTO'];
// EM_ANDAMENTO/FINALIZADO são setados automaticamente pelo fluxo de evolução clínica
// (EvolucaoController.criar/atualizar/cancelar) — CONCLUIDO permanece disponível para o
// "Concluir" manual (confirmação de comparecimento sem abrir uma evolução).
// ATRASADA é setada automaticamente pelo cron marcarAgendamentosAtrasados (agendamentoCronService)
// 30min após o horário sem conclusão — status informativo, incluído aqui só para permitir
// exibição/filtro; a rotina noturna de cancelamento (server.ts) também a varre.
const STATUS_VALIDOS = ['AGENDADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'FINALIZADO', 'CANCELADO', 'ATRASADA'];
// Quem pode agendar/alterar é decidido pela matriz RBAC (checkPermission nas rotas
// de agenda.js — atendimento.agendamentos.*). Nenhuma checagem de role aqui.
// Autoria: "próprio" = veterinário responsável OU quem criou o agendamento.
const INCLUDE = {
  veterinario: { select: { id: true, fullName: true } },
};

function podeOperarAgendamento(req, item) {
  return podeOperarRegistro(req.permissaoNivel, item.veterinarioId, req.user.id)
      || podeOperarRegistro(req.permissaoNivel, item.criadoPorId,   req.user.id);
}

// Dia da semana (0=Dom…6=Sáb) e HH:MM de um instante, sempre no fuso de Brasília —
// independe do timezone do processo Node (mesma lógica de dateUtils.ts no frontend).
function diaEHoraBrasilia(data) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(data);
  const mapa = Object.fromEntries(partes.map(p => [p.type, p.value]));
  const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hora = mapa.hour === '24' ? '00' : mapa.hour; // Intl pode devolver "24:00"
  return { diaSemana: DIAS[mapa.weekday], hhmm: `${hora}:${mapa.minute}` };
}

// Expediente EFETIVO do profissional no instante `quando`: próprio (qualquer vínculo em
// que tenha sido configurado) > herdado da empresa/equipe do contexto > sem restrição.
async function dentroDoExpediente(vetId, quando, req) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "diasTrabalho", "horaInicioTrabalho", "horaFimTrabalho"
       FROM schs2vet.tb_membros_equipe
      WHERE "userId" = $1 AND ("diasTrabalho" IS NOT NULL OR "horaInicioTrabalho" IS NOT NULL)
      ORDER BY id DESC LIMIT 1`,
    Number(vetId),
  );
  let dias = rows?.[0]?.diasTrabalho ?? null;
  let horaIni = rows?.[0]?.horaInicioTrabalho ?? null;
  let horaFim = rows?.[0]?.horaFimTrabalho ?? null;

  if (!dias && !horaIni && req.empresaId) {
    const config = await prisma.empresaConfiguracao.findFirst({
      where: { empresaId: req.empresaId, ...(req.equipeId ? { equipeId: req.equipeId } : {}) },
    });
    dias = config?.diasAtendimento ?? null;
    horaIni = config?.horaInicioAtendimento ?? null;
    horaFim = config?.horaFimAtendimento ?? null;
  }

  // Nada configurado em lugar nenhum → sem restrição
  if (!dias && !horaIni) return true;

  const { diaSemana, hhmm } = diaEHoraBrasilia(quando);
  if (dias) {
    const permitidos = String(dias).split(',').map(Number).filter(Number.isInteger);
    if (permitidos.length > 0 && !permitidos.includes(diaSemana)) return false;
  }
  if (horaIni && horaFim && (hhmm < horaIni || hhmm >= horaFim)) return false;
  return true;
}

const INCLUDE_GLOBAL = {
  veterinario: { select: { id: true, fullName: true } },
  criadoPor:   { select: { id: true, fullName: true } },
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

      let inicio = null, fim = null;
      if (data) {
        inicio = new Date(data + 'T00:00:00');
        fim    = new Date(data + 'T23:59:59.999');
      } else if (mesAno) {
        const [ano, mes] = mesAno.split('-').map(Number);
        inicio = new Date(ano, mes - 1, 1);
        fim    = new Date(ano, mes, 0, 23, 59, 59, 999);
      }
      if (inicio && fim) where.dataHora = { gte: inicio, lte: fim };

      if (status && STATUS_VALIDOS.includes(status)) {
        where.status = status;
      }

      // IDs dos agendamentos do CONTEXTO ATIVO (empresa/equipe) — agendas independentes
      // por equipe. Colunas novas → via SQL raw. NÃO filtra por data aqui (o Prisma
      // envia Date ao raw em horário local, o que descasaria da janela UTC do
      // where.dataHora); o filtro de data fica no where.dataHora tipado do Prisma.
      const idsDoContexto = async () => {
        const rows = req.equipeId
          ? await prisma.$queryRawUnsafe(
              `SELECT id FROM schs2vet.tb_agendamentos_clinicos WHERE ativo = true AND equipe_id = $1`,
              Number(req.equipeId))
          : await prisma.$queryRawUnsafe(
              `SELECT id FROM schs2vet.tb_agendamentos_clinicos WHERE ativo = true AND empresa_id = $1`,
              Number(req.empresaId));
        return rows.map(r => r.id);
      };

      // Regra: equipes/agendas são INDEPENDENTES em tudo. Cada agendamento pertence ao
      // contexto em que foi criado. Um profissional vê apenas os agendamentos DAQUELE
      // contexto — GESTOR vê todos do contexto; os demais veem só os SEUS (vet responsável
      // ou criador), mesmo que o animal seja compartilhado com outra equipe.
      if (isAdmin) {
        if (req.empresaId) where.id = { in: await idsDoContexto() };
      } else if (userType === 'PROPRIETARIO') {
        where.animal = { userId: Number(userId) };
      } else if (req.empresaId) {
        const ids = await idsDoContexto();
        const membroWhere = { userId: Number(userId), cargo: 'GESTOR' };
        if (req.equipeId) membroWhere.equipeId = Number(req.equipeId);
        else              membroWhere.equipe   = { empresaId: Number(req.empresaId) };
        const isGestor = !!(await prisma.membroEquipe.findFirst({ where: membroWhere, select: { id: true } }));
        where.id = { in: ids };
        if (!isGestor) where.OR = [{ veterinarioId: Number(userId) }, { criadoPorId: Number(userId) }];
      } else {
        // Sem contexto de empresa ativo: apenas os próprios (vet responsável ou criador)
        where.OR = [{ veterinarioId: Number(userId) }, { criadoPorId: Number(userId) }];
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

  // GET /clinica/agendamentos/ocupacao?data=YYYY-MM-DD&vetIds=1,2,3
  // Ocupação GLOBAL dos profissionais no dia (TODAS as empresas) — usada pela grade de
  // horários para descontar os slots em que o profissional já está agendado em qualquer
  // empresa (janela por empresa, mas ocupação global — evita duplo agendamento).
  // Retorna somente { veterinarioId, dataHora } (sem dados do paciente) e apenas para os
  // vetIds pedidos (os profissionais já visíveis na grade) — não vaza dados de outra empresa.
  ocupacaoDoDia: async (req, res) => {
    try {
      const { data, vetIds } = req.query;
      if (!data) return res.json({ dados: [] });
      const inicio = new Date(data + 'T00:00:00');
      const fim    = new Date(data + 'T23:59:59.999');
      if (isNaN(inicio.getTime())) return res.json({ dados: [] });

      const ids = String(vetIds ?? '')
        .split(',').map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0);
      if (ids.length === 0) return res.json({ dados: [] });

      // Sem filtro de empresa/equipe: a ocupação do profissional é GLOBAL. Todo status
      // exceto CANCELADO conta como ocupado (AGENDADO/EM_ANDAMENTO/CONCLUIDO/FINALIZADO).
      const itens = await prisma.agendamentoClinico.findMany({
        where: {
          ativo:         true,
          veterinarioId: { in: ids },
          dataHora:      { gte: inicio, lte: fim },
          status:        { not: 'CANCELADO' },
        },
        select: { veterinarioId: true, dataHora: true },
      });

      res.json({ dados: itens });
    } catch (err) {
      console.error('Erro ao obter ocupação do dia:', err);
      res.status(500).json({ error: 'Erro ao obter ocupação' });
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
        // Futuros AGENDADOS + todos os CANCELADOS (para histórico/relatórios)
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        where.OR = [
          { status: 'AGENDADO', dataHora: { gte: hoje } },
          { status: 'CANCELADO' },
        ];
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

      // Um animal pode ter vários agendamentos, mas NUNCA dois no mesmo horário
      // (independe de vet/equipe). Bloqueia duplicidade no mesmo dataHora.
      const mesmoHorario = await prisma.agendamentoClinico.findFirst({
        where: { animalId: Number(animalId), dataHora: quando, ativo: true, status: { not: 'CANCELADO' } },
        select: { id: true },
      });
      if (mesmoHorario) {
        return res.status(409).json({ error: 'Este animal já tem um agendamento neste horário.', code: 'HORARIO_OCUPADO' });
      }

      // Disponibilidade do profissional: sem conflito de horário e dentro do expediente
      // (próprio do vet ou herdado da empresa/equipe).
      if (veterinarioId) {
        const vetIdNum = Number(veterinarioId);
        const conflitoVet = await prisma.agendamentoClinico.findFirst({
          where: {
            ativo: true, status: { in: ['AGENDADO', 'EM_ANDAMENTO', 'ATRASADA'] },
            veterinarioId: vetIdNum, dataHora: quando,
          },
          select: { id: true, animal: { select: { nome: true } } },
        });
        if (conflitoVet) {
          return res.status(409).json({
            error: `O profissional já tem um agendamento neste horário (${conflitoVet.animal?.nome ?? 'outro paciente'}).`,
            code: 'PROFISSIONAL_OCUPADO',
          });
        }
        if (!(await dentroDoExpediente(vetIdNum, quando, req))) {
          return res.status(409).json({ error: 'Horário fora do expediente do profissional selecionado.', code: 'FORA_EXPEDIENTE' });
        }
      }

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

      // Contexto (empresa/equipe) em que o agendamento foi criado — agendas independentes
      // por equipe. Usa o contexto ativo; se ausente, herda o do animal. (SQL raw — colunas novas.)
      await prisma.$executeRawUnsafe(
        `UPDATE schs2vet.tb_agendamentos_clinicos ag
            SET empresa_id = COALESCE($1::int, a."empresaId"), equipe_id = COALESCE($2::int, a."equipeId")
           FROM schs2vet.tb_animais a
          WHERE ag.id = $3::int AND ag.animal_id = a.id`,
        req.empresaId ? Number(req.empresaId) : null,
        req.equipeId  ? Number(req.equipeId)  : null,
        item.id,
      );

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
      const { status, motivo } = req.body;
      if (!STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ error: `status deve ser um de: ${STATUS_VALIDOS.join(', ')}` });
      }

      // Cancelamento exige justificativa (auditoria)
      if (status === 'CANCELADO' && !motivo?.trim()) {
        return res.status(400).json({ error: 'É obrigatório informar o motivo do cancelamento' });
      }

      const item = await prisma.agendamentoClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Agendamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      // Autoria via RBAC: PROPRIO → só agendamentos próprios (responsável ou criador)
      if (!podeOperarAgendamento(req, item)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite alterar agendamentos próprios.' });
      }

      const updateData = { status };
      if (status === 'CANCELADO' && motivo?.trim()) {
        updateData.observacao = motivo.trim();
      }

      const atualizado = await prisma.agendamentoClinico.update({
        where:   { id: item.id },
        data:    updateData,
        include: INCLUDE,
      });

      if (status === 'CANCELADO') {
        await registrarAuditoria(null, req, {
          categoria:  'CANCELAMENTO',
          entidade:   'AGENDAMENTO',
          entidadeId: item.id,
          animalId:   item.animalId,
          motivo,
          detalhes:   `${item.tipo} — ${item.titulo ?? ''}`.trim(),
        });
      }

      res.json({ dados: atualizado });
    } catch (err) {
      console.error('Erro ao atualizar agendamento:', err);
      res.status(500).json({ error: 'Erro ao atualizar agendamento' });
    }
  },

  // PATCH /clinica/agendamentos/:id — body: { titulo?, tipo?, dataHora?, observacao? }
  atualizar: async (req, res) => {
    try {
      const item = await prisma.agendamentoClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Agendamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      // Autoria via RBAC: PROPRIO → só agendamentos próprios (responsável ou criador)
      if (!podeOperarAgendamento(req, item)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite alterar agendamentos próprios.' });
      }

      const { titulo, tipo, dataHora, observacao, veterinarioId } = req.body;
      const data = {};

      if (titulo?.trim()) data.titulo = titulo.trim();
      if (tipo && TIPOS_VALIDOS.includes(tipo)) data.tipo = tipo;
      if (dataHora) {
        const quando = new Date(dataHora);
        if (!isNaN(quando.getTime())) data.dataHora = quando;
      }
      if (observacao !== undefined) data.observacao = observacao?.trim() || null;

      // Troca de profissional (transferência de agenda): o novo vet precisa estar
      // disponível no horário do agendamento — não pode haver outro agendamento
      // ativo dele no mesmo horário.
      const novoVetId = veterinarioId !== undefined
        ? (veterinarioId === null ? null : Number(veterinarioId))
        : undefined;
      const dataHoraMudou = !!data.dataHora;
      const vetEfetivo = novoVetId !== undefined ? novoVetId : item.veterinarioId;
      if (vetEfetivo != null && (dataHoraMudou || (novoVetId !== undefined && novoVetId !== item.veterinarioId))) {
        const dataHoraAlvo = data.dataHora ?? item.dataHora;
        const conflito = await prisma.agendamentoClinico.findFirst({
          where: {
            id:            { not: item.id },
            ativo:         true,
            status:        { in: ['AGENDADO', 'EM_ANDAMENTO', 'ATRASADA'] },
            veterinarioId: vetEfetivo,
            dataHora:      dataHoraAlvo,
          },
          select: { id: true, animal: { select: { nome: true } } },
        });
        if (conflito) {
          return res.status(409).json({
            error: `O profissional selecionado já tem um agendamento neste horário (${conflito.animal?.nome ?? 'outro paciente'}). Escolha outro horário ou profissional.`,
          });
        }
        if (!(await dentroDoExpediente(vetEfetivo, dataHoraAlvo, req))) {
          return res.status(409).json({ error: 'Horário fora do expediente do profissional selecionado.', code: 'FORA_EXPEDIENTE' });
        }
      }
      if (novoVetId !== undefined) data.veterinarioId = novoVetId;

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
      const { motivo } = req.body ?? {};
      if (!motivo?.trim()) {
        return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
      }

      const item = await prisma.agendamentoClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Agendamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      // Autoria via RBAC: PROPRIO → só agendamentos próprios (responsável ou criador)
      if (!podeOperarAgendamento(req, item)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite excluir agendamentos próprios.' });
      }

      await prisma.agendamentoClinico.update({ where: { id: item.id }, data: { ativo: false } });

      await registrarAuditoria(null, req, {
        categoria:  'EXCLUSAO',
        entidade:   'AGENDAMENTO',
        entidadeId: item.id,
        animalId:   item.animalId,
        motivo,
        detalhes:   `${item.tipo} — ${item.titulo ?? ''}`.trim(),
      });

      res.json({ dados: { id: item.id, excluido: true } });
    } catch (err) {
      console.error('Erro ao excluir agendamento:', err);
      res.status(500).json({ error: 'Erro ao excluir agendamento' });
    }
  },

  // PATCH /clinica/agendamentos/transferir-dia — body: { data, deVetId, paraVetId }
  transferirDia: async (req, res) => {
    try {
      const { data, deVetId, paraVetId } = req.body;
      if (!data || !deVetId || !paraVetId) {
        return res.status(400).json({ error: 'data, deVetId e paraVetId são obrigatórios' });
      }
      if (Number(deVetId) === Number(paraVetId)) {
        return res.status(400).json({ error: 'Profissional de origem e destino devem ser diferentes' });
      }

      // Autoria via RBAC: PROPRIO transfere apenas a própria agenda;
      // EQUIPE/FULL transfere a agenda de qualquer profissional da equipe.
      if ((NIVEL_ORDINAL[req.permissaoNivel] ?? 0) < NIVEL_ORDINAL.EQUIPE && Number(deVetId) !== Number(req.user.id)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite transferir a sua própria agenda.' });
      }

      const doDia = await prisma.agendamentoClinico.findMany({
        where: {
          ativo:         true,
          status:        'AGENDADO',
          veterinarioId: Number(deVetId),
          dataHora: {
            gte: new Date(data + 'T00:00:00'),
            lte: new Date(data + 'T23:59:59.999'),
          },
        },
        select: { id: true, dataHora: true, animal: { select: { nome: true } } },
      });

      if (doDia.length === 0) {
        return res.json({ dados: { transferidos: 0, bloqueados: [] } });
      }

      // Agenda já ocupada do vet de destino no dia — cada slot só transfere se o
      // destino estiver livre naquele horário exato.
      const ocupadosDestino = await prisma.agendamentoClinico.findMany({
        where: {
          ativo:         true,
          status:        { in: ['AGENDADO', 'EM_ANDAMENTO', 'ATRASADA'] },
          veterinarioId: Number(paraVetId),
          dataHora: {
            gte: new Date(data + 'T00:00:00'),
            lte: new Date(data + 'T23:59:59.999'),
          },
        },
        select: { dataHora: true },
      });
      const horariosOcupados = new Set(ocupadosDestino.map(o => o.dataHora.getTime()));

      const transferiveis = doDia.filter(a => !horariosOcupados.has(a.dataHora.getTime()));
      const bloqueados    = doDia.filter(a => horariosOcupados.has(a.dataHora.getTime()));

      if (transferiveis.length > 0) {
        await prisma.agendamentoClinico.updateMany({
          where: { id: { in: transferiveis.map(a => a.id) } },
          data:  { veterinarioId: Number(paraVetId) },
        });
      }

      res.json({
        dados: {
          transferidos: transferiveis.length,
          bloqueados: bloqueados.map(a => ({ animalNome: a.animal?.nome ?? null, hora: a.dataHora })),
        },
      });
    } catch (err) {
      console.error('Erro ao transferir agenda do dia:', err);
      res.status(500).json({ error: 'Erro ao transferir agenda do dia' });
    }
  },
};

module.exports = AgendamentoController;

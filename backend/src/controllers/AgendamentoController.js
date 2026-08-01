// backend/src/controllers/AgendamentoController.js
// Agendamentos do animal (consulta, vacina, retorno, exame, procedimento).
// Exibidos no painel "Agendamentos" da tela do animal (AnimalDetail).

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal }                   = require('../lib/animalAccess');
// Escopo de DADOS de animal (base × convidado × prestador) — fonte única, ver §5
const { buildAnimalScopeWhere }                   = require('../lib/animalScope');
const { formatAtendimentoNum }                    = require('../lib/faturaUtils');
const { registrarAuditoria }                      = require('../lib/auditoria');
const emailService                                = require('../services/emailService');
const whatsappService                             = require('../services/whatsappService');
const { interpretarAgendamento, HORARIOS_PADRAO } = require('../services/agendamentoLLMService');
const { tempoConsultaPadraoDaEmpresa }            = require('./EquipeController');
// Autoria por NÍVEL da matriz (Controle de Acesso), não por cargo — ver CLAUDE.md #28
const { NIVEL_ORDINAL }                           = require('../middlewares/permissao.middleware');

const TIPOS_VALIDOS  = ['CONSULTA', 'VACINA', 'RETORNO', 'EXAME', 'PROCEDIMENTO'];
// EM_ANDAMENTO/FINALIZADO são setados automaticamente pelo fluxo de evolução clínica
// (EvolucaoController.criar/atualizar/cancelar) — CONCLUIDO permanece disponível para o
// "Concluir" manual (confirmação de comparecimento sem abrir uma evolução).
// ATRASADA é setada automaticamente pelo cron marcarAgendamentosAtrasados (agendamentoCronService)
// 30min após o horário sem conclusão — status informativo, incluído aqui só para permitir
// exibição/filtro; a rotina noturna de cancelamento (server.ts) também a varre.
// TRANSFERIDO: o atendimento saiu desta data/profissional porque foi REAGENDADO —
// o horário é liberado e a observação guarda para quando ele foi. Diferente de
// CANCELADO, que é a desistência do atendimento.
const STATUS_VALIDOS = ['AGENDADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'FINALIZADO', 'CANCELADO', 'ATRASADA', 'TRANSFERIDO'];
// Status que NÃO ocupam mais a grade (o slot volta a ficar livre)
const STATUS_LIVRES = ['CANCELADO', 'TRANSFERIDO'];
// Quem pode agendar/alterar é decidido pela matriz RBAC (checkPermission nas rotas
// de agenda.js — atendimento.agendamentos.*). Nenhuma checagem de role aqui.
// Autoria: "próprio" = veterinário responsável OU quem criou o agendamento.
const INCLUDE = {
  veterinario:   { select: { id: true, fullName: true } },
  especialidade: { select: { id: true, nome: true } },
};

// Agendamento anterior à migration 20260804000000 não tem duracaoMin — a agenda
// era de 1h fixa, então é assim que ele continua ocupando a grade.
const DURACAO_PADRAO_MIN = 60;
const duracaoDe = (ag) => Number(ag?.duracaoMin) > 0 ? Number(ag.duracaoMin) : DURACAO_PADRAO_MIN;

/**
 * Tempo de consulta (min) que o profissional pratica numa especialidade.
 * Vem do card "Locais de trabalho": cada local guarda { especialidadeId: minutos }.
 * O mesmo profissional pode ter tempos diferentes por local — quando há mais de um,
 * usa o MENOR (é o que cabe em qualquer um deles).
 * Não configurado → cai no padrão da empresa (Configurações) e, sem ele, em 60 min.
 * Nunca retorna null: agendar não pode travar por falta de configuração do profissional.
 */
async function tempoConsultaDoProfissional(vetId, especialidadeId, req) {
  if (vetId && especialidadeId) {
    const locais = await prisma.membroLocalTrabalho.findMany({
      where:  { membro: { userId: Number(vetId) } },
      select: { temposConsulta: true },
    });
    let menor = null;
    for (const l of locais) {
      const min = Number(l.temposConsulta?.[String(especialidadeId)]);
      if (Number.isInteger(min) && min > 0 && (menor === null || min < menor)) menor = min;
    }
    if (menor !== null) return menor;
  }
  return req ? tempoConsultaPadraoDaEmpresa(req) : DURACAO_PADRAO_MIN;
}

/**
 * Conflito do profissional considerando a DURAÇÃO dos dois lados.
 * Dois atendimentos colidem quando [inicio, fim) se cruzam — não basta comparar o
 * horário de início: uma consulta de 60min às 08:00 ocupa o slot das 08:30.
 * A janela de busca cobre o maior atendimento possível (8h) para não perder um
 * agendamento longo que começou antes e ainda está em curso.
 */
async function conflitoDeAgenda(vetId, inicio, duracaoMin, ignorarId = null) {
  const fim   = new Date(inicio.getTime() + duracaoMin * 60_000);
  const desde = new Date(inicio.getTime() - 480 * 60_000);

  const candidatos = await prisma.agendamentoClinico.findMany({
    where: {
      ativo: true,
      status: { in: ['AGENDADO', 'EM_ANDAMENTO', 'ATRASADA'] },
      veterinarioId: Number(vetId),
      dataHora: { gte: desde, lt: fim },
      ...(ignorarId ? { id: { not: Number(ignorarId) } } : {}),
    },
    select: { id: true, dataHora: true, duracaoMin: true, animal: { select: { nome: true } } },
  });

  for (const c of candidatos) {
    const cIni = new Date(c.dataHora).getTime();
    const cFim = cIni + duracaoDe(c) * 60_000;
    if (cIni < fim.getTime() && inicio.getTime() < cFim) return c;
  }
  return null;
}

// REGRA BASAL (não é permissão da matriz): NINGUÉM agenda na agenda de OUTRO
// profissional — só o GESTOR (e o ADMIN). Todo o resto da equipe, com qualquer nível
// concedido no Controle de Acesso, agenda apenas na PRÓPRIA agenda.
// É invariante de negócio: a agenda pertence a quem atende. Para o estagiário poder
// marcar, ele precisa ter coluna própria na grade — não de permissão extra.
function podeAgendarParaOutro(req) {
  return req.membroCargo === 'GESTOR'
      || req.permissaoNivel === 'FULL'
      || req.user?.userType === 'ADMIN'
      || req.user?.role === 'ADMIN';
}

// "Minha agenda" = sou o profissional responsável OU quem criou o agendamento.
function ehMinhaAgenda(req, item) {
  return Number(item.veterinarioId) === Number(req.user.id)
      || Number(item.criadoPorId)   === Number(req.user.id);
}

function podeOperarAgendamento(req, item) {
  return podeAgendarParaOutro(req) || ehMinhaAgenda(req, item);
}

/**
 * Notifica por E-MAIL e WHATSAPP o profissional afetado por uma troca de responsável.
 * Fire-and-forget: falha de notificação nunca derruba a operação.
 *
 * modo 'RECEBIDO'  → `paraVetId` GANHOU os atendimentos (transferência feita por `deVetId`).
 * modo 'ASSUMIDO'  → `paraVetId` PERDEU o atendimento, que `deVetId` assumiu para si.
 * `itens` = [{ dataHora, animalNome, tipo }].
 */
async function notificarTransferencia({ req, paraVetId, deVetId, itens, modo = 'RECEBIDO' }) {
  if (!paraVetId || !Array.isArray(itens) || itens.length === 0) return;
  setImmediate(async () => {
    try {
      const [destino, origem] = await Promise.all([
        prisma.user.findUnique({ where: { id: Number(paraVetId) }, select: { email: true, fullName: true, phone: true } }),
        deVetId ? prisma.user.findUnique({ where: { id: Number(deVetId) }, select: { fullName: true } }) : null,
      ]);
      if (!destino) return;

      await emailService.enviarTransferenciaAgenda({
        paraEmail: destino.email, paraNome: destino.fullName,
        deNome:    origem?.fullName ?? null,
        itens, modo,
      }).catch(() => {});

      if (!destino.phone) return;
      const fmtData = (dh) => new Date(dh).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
      const fmtHora = (dh) => new Date(dh).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
      const linhas  = itens.slice(0, 10)
        .map(i => `• ${fmtHora(i.dataHora)} — ${i.animalNome ?? 'Paciente'}`);
      if (itens.length > 10) linhas.push(`• +${itens.length - 10} atendimento(s)`);

      const cabecalho = modo === 'ASSUMIDO'
        ? [`🐴 *S2Vet — Atendimento assumido por outro profissional*`,
           origem?.fullName ? `🙋 ${origem.fullName} assumiu este atendimento` : '']
        : [`🐴 *S2Vet — ${itens.length > 1 ? 'Agenda transferida' : 'Atendimento transferido'}*`,
           origem?.fullName ? `🔄 De: ${origem.fullName}` : ''];

      const msg = [
        ...cabecalho,
        `📅 ${fmtData(itens[0].dataHora)}`,
        ``,
        ...linhas,
      ].filter(Boolean).join('\n');

      // Instância da clínica (Evolution). Sem instância conectada, cai no provider legado.
      const envio = await whatsappService.sendMessage(
        { empresaId: req.empresaId, equipeId: req.equipeId },
        destino.phone, msg,
      ).catch(() => ({ sucesso: false }));
      if (!envio?.sucesso) await whatsappService.sendWhatsApp(destino.phone, msg).catch(() => {});
    } catch { /* silencioso — notificação não bloqueia a transferência */ }
  });
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
  veterinario:   { select: { id: true, fullName: true } },
  criadoPor:     { select: { id: true, fullName: true } },
  especialidade: { select: { id: true, nome: true } },
  animal: {
    select: {
      id:      true,
      nome:    true,
      especie: { select: { nome: true } },
      // ONDE o animal está — é o que a agenda mostra ao lado do nome (a espécie
      // não ajuda quem vai se deslocar até ele). `local` é o campo textual legado,
      // usado como fallback de quem foi cadastrado antes do catálogo de locais.
      local:       true,
      localizacao: { select: { id: true, nome: true } },
      user:        { select: { id: true, fullName: true } },
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
      // contexto em que foi criado, e o recorte da listagem é o CONTEXTO — não a autoria.
      //
      // VER a agenda é tudo-ou-nada: quem tem `atendimento.agendamentos.ler` (a rota já
      // exige, em qualquer nível) enxerga os agendamentos de TODOS no contexto, seja
      // gestor, vet, estagiário ou secretaria. Antes, só o GESTOR via a agenda inteira e
      // os demais viam apenas os SEUS — restrição que a matriz do Controle de Acesso nem
      // oferece configurar (a tela é binária, ver armadilha 28-c) e que na prática
      // impedia a equipe de saber quem está atendendo quem.
      // O que continua limitando é ISOLAMENTO, não permissão: contexto (empresa/equipe)
      // e, para o PROPRIETARIO, os próprios animais.
      if (isAdmin) {
        if (req.empresaId) where.id = { in: await idsDoContexto() };
      } else if (userType === 'PROPRIETARIO') {
        where.animal = { userId: Number(userId) };
      } else if (req.empresaId) {
        where.id = { in: await idsDoContexto() };
        // ÚNICA exceção, e ela NÃO é permissão: o PRESTADOR (cargo FORNECEDOR) só
        // alcança animais com designação ativa — deny-by-default do
        // DesignacaoPrestador, que existe para o profissional externo (ferrador,
        // fisioterapeuta) não receber a base de pacientes inteira. É escopo de
        // DADOS/tenant, a mesma distinção que a armadilha 28 do CLAUDE.md faz.
        // Dentro do que ele alcança, vê os agendamentos de TODOS, como qualquer um.
        //
        // O `OR` com os próprios é obrigatório: a designação é INATIVADA quando o
        // encaminhamento é concluído, então sem ele o prestador perderia de vista
        // os atendimentos que ele mesmo fez (medido: um caso real ia de 5 para 0).
        if (req.membroCargo === 'FORNECEDOR') {
          const { where: escopoAnimal } = await buildAnimalScopeWhere(req);
          if (escopoAnimal && Object.keys(escopoAnimal).length > 0) {
            where.OR = [
              { animal: escopoAnimal },
              { veterinarioId: Number(userId) },
              { criadoPorId:   Number(userId) },
            ];
          }
        }
      } else {
        // Sem contexto de empresa ativo não há equipe a que pertencer: só os próprios
        // (vet responsável ou criador) — é isolamento, não regra de autoria.
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
          status:        { notIn: STATUS_LIVRES },
        },
        // `id` acompanha para a tela de reagendamento poder DESCONTAR o próprio
        // agendamento que está sendo movido (o horário dele será liberado). Continua
        // sem dado nenhum do paciente/empresa.
        select: { id: true, veterinarioId: true, dataHora: true, duracaoMin: true },
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
          { status: { in: STATUS_LIVRES } },
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
      const { animalId, tipo = 'CONSULTA', titulo, dataHora, observacao, veterinarioId, especialidadeId } = req.body;

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
      // Agenda é para o futuro: não se marca (nem se reagenda) para horário que já
      // passou. Tolerância de 1 min para o caso do usuário confirmar o slot corrente
      // no exato virar do minuto.
      if (quando.getTime() < Date.now() - 60_000) {
        return res.status(400).json({
          error: 'Não é possível agendar para uma data/horário que já passou.',
          code:  'DATA_PASSADA',
        });
      }

      // Só o gestor agenda para OUTRO profissional; os demais só para si mesmos.
      if (!podeAgendarParaOutro(req) && veterinarioId && Number(veterinarioId) !== Number(req.user.id)) {
        return res.status(403).json({ error: 'Só o gestor agenda para outro profissional. Você pode agendar na sua própria agenda.' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      // Um animal pode ter vários agendamentos, mas NUNCA dois no mesmo horário
      // (independe de vet/equipe). Bloqueia duplicidade no mesmo dataHora.
      const mesmoHorario = await prisma.agendamentoClinico.findFirst({
        where: { animalId: Number(animalId), dataHora: quando, ativo: true, status: { notIn: STATUS_LIVRES } },
        select: { id: true },
      });
      if (mesmoHorario) {
        return res.status(409).json({ error: 'Este animal já tem um agendamento neste horário.', code: 'HORARIO_OCUPADO' });
      }

      // Duração do atendimento: vem do tempo de consulta que o profissional pratica
      // NAQUELA especialidade (card "Locais de trabalho"). Não configurado → padrão da
      // empresa (Configurações). Sem especialidade informada (fluxos antigos), idem.
      const espIdNum = Number(especialidadeId);
      let duracaoMin = await tempoConsultaPadraoDaEmpresa(req);
      if (Number.isInteger(espIdNum) && espIdNum > 0) {
        if (!veterinarioId) {
          return res.status(400).json({ error: 'Selecione o profissional para agendar por especialidade.' });
        }
        duracaoMin = await tempoConsultaDoProfissional(veterinarioId, espIdNum, req);
      }

      // Disponibilidade do profissional: sem conflito de horário e dentro do expediente
      // (próprio do vet ou herdado da empresa/equipe).
      if (veterinarioId) {
        const vetIdNum = Number(veterinarioId);
        // Conflito por INTERVALO — considera a duração dos dois atendimentos
        const conflitoVet = await conflitoDeAgenda(vetIdNum, quando, duracaoMin);
        if (conflitoVet) {
          return res.status(409).json({
            error: `O profissional já tem um agendamento neste horário (${conflitoVet.animal?.nome ?? 'outro paciente'}).`,
            code: 'PROFISSIONAL_OCUPADO',
          });
        }
        if (!(await dentroDoExpediente(vetIdNum, quando, req))) {
          return res.status(409).json({ error: 'Horário fora do expediente do profissional selecionado.', code: 'FORA_EXPEDIENTE' });
        }
        // O atendimento inteiro precisa caber no expediente, não só o seu início
        const fimPrevisto = new Date(quando.getTime() + (duracaoMin - 1) * 60_000);
        if (!(await dentroDoExpediente(vetIdNum, fimPrevisto, req))) {
          return res.status(409).json({
            error: `O atendimento de ${duracaoMin} min ultrapassa o fim do expediente do profissional.`,
            code:  'FORA_EXPEDIENTE',
          });
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
            especialidadeId: Number.isInteger(espIdNum) && espIdNum > 0 ? espIdNum : null,
            duracaoMin,
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
      if (STATUS_LIVRES.includes(status) && !motivo?.trim()) {
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
      if (STATUS_LIVRES.includes(status) && motivo?.trim()) {
        updateData.observacao = motivo.trim();
      }

      const atualizado = await prisma.agendamentoClinico.update({
        where:   { id: item.id },
        data:    updateData,
        include: INCLUDE,
      });

      if (STATUS_LIVRES.includes(status)) {
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
        if (!isNaN(quando.getTime())) {
          // Reagendar ADIANTA à vontade — para mais cedo, inclusive para daqui a
          // pouco — mas nunca para trás do relógio: agendamento é compromisso
          // futuro, e marcar no passado faria a agenda mentir sobre o que ainda
          // está por acontecer. Mesmo teto e mesma tolerância do `criar`.
          //
          // Só vale quando a data MUDA: um agendamento que já passou (ninguém
          // concluiu) continua podendo ter título/observação corrigidos, e o
          // formulário reenvia a data original junto — bloquear ali seria travar
          // a correção, não o reagendamento.
          const mudou = quando.getTime() !== new Date(item.dataHora).getTime();
          if (mudou && quando.getTime() < Date.now() - 60_000) {
            return res.status(400).json({
              error: 'Não é possível reagendar para uma data/horário que já passou.',
              code:  'DATA_PASSADA',
            });
          }
          data.dataHora = quando;
        }
      }
      if (observacao !== undefined) data.observacao = observacao?.trim() || null;

      // Troca de profissional (transferência de agenda): o novo vet precisa estar
      // disponível no horário do agendamento — não pode haver outro agendamento
      // ativo dele no mesmo horário.
      const novoVetId = veterinarioId !== undefined
        ? (veterinarioId === null ? null : Number(veterinarioId))
        : undefined;
      // Transferir o atendimento: o GESTOR move o de qualquer um; o profissional move
      // o DELE (é a agenda dele que está sendo passada adiante).
      const trocaDeVet = novoVetId !== undefined && novoVetId !== item.veterinarioId;
      if (trocaDeVet && !podeAgendarParaOutro(req) && Number(item.veterinarioId) !== Number(req.user.id)) {
        return res.status(403).json({
          error: 'Você só pode transferir os atendimentos em que é o profissional responsável.',
        });
      }
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

      // Quem RECEBEU o atendimento é avisado por e-mail e WhatsApp
      if (trocaDeVet && novoVetId) {
        notificarTransferencia({
          req, paraVetId: novoVetId, deVetId: item.veterinarioId,
          itens: [{
            dataHora:   atualizado.dataHora,
            animalNome: atualizado.animal?.nome ?? null,
            tipo:       atualizado.tipo,
          }],
        });
      }

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
        userId:    req.user?.id ?? null,
        empresaId: req.empresaId ?? null,
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
            status:        { notIn: STATUS_LIVRES },
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
          status: { notIn: STATUS_LIVRES },
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

  // PATCH /clinica/agendamentos/:id/assumir
  // Qualquer VETERINÁRIO da equipe pode assumir o atendimento de outro veterinário —
  // é um "puxar para si", não depende de o outro transferir. Por isso NÃO passa por
  // `podeOperarAgendamento` (que exigiria ser o dono do agendamento).
  assumir: async (req, res) => {
    try {
      const item = await prisma.agendamentoClinico.findUnique({
        where:   { id: Number(req.params.id) },
        include: { animal: { select: { nome: true } } },
      });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Agendamento não encontrado' });

      // Quem pode assumir é quem tem a ação concedida no Controle de Acesso (o slug
      // de editar já foi verificado pela rota). Sem filtro por userType/cargo.
      if (Number(item.veterinarioId) === Number(req.user.id)) {
        return res.status(400).json({ error: 'Este atendimento já é seu.' });
      }
      if (!['AGENDADO', 'ATRASADA'].includes(item.status)) {
        return res.status(400).json({ error: 'Só é possível assumir um atendimento ainda em aberto.' });
      }

      // Acesso ao animal e disponibilidade de quem está assumindo
      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const duracao  = duracaoDe(item);
      const conflito = await conflitoDeAgenda(req.user.id, item.dataHora, duracao, item.id);
      if (conflito) {
        return res.status(409).json({
          error: `Você já tem um agendamento neste horário (${conflito.animal?.nome ?? 'outro paciente'}).`,
          code:  'PROFISSIONAL_OCUPADO',
        });
      }
      if (!(await dentroDoExpediente(req.user.id, item.dataHora, req))) {
        return res.status(409).json({ error: 'Horário fora do seu expediente.', code: 'FORA_EXPEDIENTE' });
      }

      // Assumir a AGENDA arrasta o ATENDIMENTO junto: se o agendamento já foi
      // iniciado, existe evolução vinculada com o vet anterior. Mover só o
      // agendamento deixaria o atendimento na mão de quem não o conduz mais —
      // a evolução sumiria da tela de quem assumiu e continuaria na do outro.
      const atualizado = await prisma.$transaction(async (tx) => {
        const ag = await tx.agendamentoClinico.update({
          where:   { id: item.id },
          data:    { veterinarioId: Number(req.user.id) },
          include: INCLUDE_GLOBAL,
        });
        await tx.evolucaoClinica.updateMany({
          where: { agendamentoId: item.id, ativo: true, status: 'EM_ANDAMENTO' },
          data:  { veterinarioId: Number(req.user.id), modificadoPorId: Number(req.user.id), dataModificacao: new Date() },
        });
        return ag;
      });

      // O profissional que estava com o atendimento é avisado de que ele saiu da agenda
      // dele — mesma notificação da transferência, na direção contrária.
      if (item.veterinarioId) {
        notificarTransferencia({
          req, paraVetId: item.veterinarioId, deVetId: req.user.id, modo: 'ASSUMIDO',
          itens: [{ dataHora: item.dataHora, animalNome: item.animal?.nome ?? null, tipo: item.tipo }],
        });
      }

      res.json({ dados: atualizado });
    } catch (err) {
      console.error('Erro ao assumir agendamento:', err);
      res.status(500).json({ error: 'Erro ao assumir agendamento' });
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

      // O GESTOR transfere a agenda de qualquer profissional; o profissional transfere
      // a DELE (deVetId tem de ser ele mesmo).
      if (!podeAgendarParaOutro(req) && Number(deVetId) !== Number(req.user.id)) {
        return res.status(403).json({ error: 'Você só pode transferir a sua própria agenda.' });
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
        select: { id: true, dataHora: true, tipo: true, animal: { select: { nome: true } } },
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
        // Quem RECEBEU a agenda é avisado por e-mail e WhatsApp
        notificarTransferencia({
          req, paraVetId, deVetId,
          itens: transferiveis
            .slice()
            .sort((a, b) => a.dataHora - b.dataHora)
            .map(a => ({ dataHora: a.dataHora, animalNome: a.animal?.nome ?? null, tipo: a.tipo })),
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

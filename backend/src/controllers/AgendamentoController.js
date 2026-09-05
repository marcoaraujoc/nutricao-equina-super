// backend/src/controllers/AgendamentoController.js
// Agendamentos do animal (consulta, vacina, retorno, exame, procedimento).
// Exibidos no painel "Agendamentos" da tela do animal (AnimalDetail).

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal }                   = require('../lib/animalAccess');
const { corteDePropriedade }                      = require('../lib/animalPropriedadeCorte');
// Escopo de DADOS de animal (base × convidado × prestador) — fonte única, ver §5
const { buildAnimalScopeWhere }                   = require('../lib/animalScope');
const { filhoDeAnimalVisivel, animalVisivelNaEmpresa } = require('../lib/visibilidade');
const { formatAtendimentoNum }                    = require('../lib/faturaUtils');
const { registrarAuditoria, registrarTransferencia, registrarAlteracao } = require('../lib/auditoria');
const {
  fusoDaEmpresa, FUSO_PADRAO, formatarDataNaEmpresa, formatarHoraNaEmpresa,
} = require('../lib/fusoEmpresa');
// Assumir/transferir a agenda arrasta a evolução aberta e tudo que está sob ela
const { transferirEvolucoesDoAgendamento }        = require('../lib/transferenciaAtendimento');
const emailService                                = require('../services/emailService');
const whatsappService                             = require('../services/whatsappService');
const { interpretarAgendamento, HORARIOS_PADRAO } = require('../services/agendamentoLLMService');
const { tempoConsultaPadraoDaEmpresa }            = require('./EquipeController');
// AUTORIA (2026-08-04): a ação vale sobre a PRÓPRIA agenda; só o GESTOR opera a de outro
const { ehGestorNoContexto }                      = require('../middlewares/permissao.middleware');
const { animalEstaInativo, bloquearSeAnimalInativo } = require('../lib/animalInativo');
const { animalFoiExcluido }                       = require('../lib/animalAtivacao');
// Rastro de "assumido de quem" (colunas novas lidas por SQL cru)
const { marcarAssumido, anexarAssumido, anexarAssumidoEmLista } = require('../lib/agendamentoAssumido');
// Cancelar o agendamento cancela junto a evolução EM_ANDAMENTO que ele abriu e tudo
// que está atrelado a ela (prescrição, procedimento, exame, encaminhamento, vacina)
const { cancelarEvolucoesDoAgendamento }          = require('../lib/cancelamentoPendencias');

const TIPOS_VALIDOS  = ['CONSULTA', 'VACINA', 'RETORNO', 'EXAME', 'PROCEDIMENTO'];
// EM_ANDAMENTO/FINALIZADO são setados automaticamente pelo fluxo de evolução clínica
// (EvolucaoController.criar/atualizar/cancelar) — CONCLUIDO permanece disponível para o
// "Concluir" manual (confirmação de comparecimento sem abrir uma evolução).
// ATRASADA é setada automaticamente pelo cron marcarAgendamentosAtrasados (agendamentoCronService)
// 30min após o horário sem conclusão — status informativo, incluído aqui só para permitir
// exibição/filtro; a rotina noturna de cancelamento (server.ts) também a varre.
// REAGENDADO: o atendimento saiu desta data/profissional porque foi remarcado — o
// horário é liberado e a observação guarda para quando ele foi. Diferente de
// CANCELADO, que é a desistência do atendimento.
// TRANSFERIDO é o nome ANTIGO do mesmo estado (até 2026-08-04). Continua aceito para
// não invalidar o que já está gravado; nada novo deve ser criado com ele.
// CANCELADO_AUTOMATICAMENTE (2026-08-18): mesmo efeito de CANCELADO (libera a grade),
// mas é o SISTEMA que desiste, não a pessoa — gravado só pela rotina noturna
// `cancelarAgendamentosNaoRealizados` (agendamentoCronService), inclusive para o
// AGENDADO/ATRASADA que ela já cancelava. Nunca aceito como input humano: ver o guard
// em `atualizarStatus`. Existe para a Auditoria/relatório poderem distinguir "a clínica
// desmarcou" de "ninguém tratou disso e o sistema encerrou sozinho" — antes das duas
// caíam no mesmo CANCELADO e a distinção se perdia.
const STATUS_VALIDOS = ['AGENDADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'FINALIZADO', 'CANCELADO', 'CANCELADO_AUTOMATICAMENTE', 'ATRASADA', 'REAGENDADO', 'TRANSFERIDO'];
// Status reservados à ROTINA — nunca um valor que `atualizarStatus` aceite vindo de um
// clique humano (ver o guard logo no início dela).
const STATUS_SOMENTE_SISTEMA = ['CANCELADO_AUTOMATICAMENTE'];
// Status que NÃO ocupam mais a grade (o slot volta a ficar livre)
// ⚠️ TRANSFERIDO continua aqui só por causa do LEGADO: até 2026-08-04 era o status que
// o reagendamento gravava. Tirá-lo faria os agendamentos já reagendados voltarem a
// ocupar a grade e a bloquear o horário que eles próprios liberaram.
// Registro NOVO usa REAGENDADO — ver `atualizarStatus`.
const STATUS_LIVRES = ['CANCELADO', 'CANCELADO_AUTOMATICAMENTE', 'REAGENDADO', 'TRANSFERIDO'];
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
// ⚠️ `req.permissaoNivel === 'FULL'` NÃO entra aqui (2026-08-04): FULL é um nível da
// matriz e, concedido a um perfil comum, deixaria qualquer um agendar na agenda alheia.
// Gestor é cargo, não nível — `ehGestorNoContexto` cobre GESTOR, dono e ADMIN.
function podeAgendarParaOutro(req) {
  return ehGestorNoContexto(req);
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

      // Horário no fuso da CLÍNICA — a mensagem (e-mail E WhatsApp) vai para quem
      // vai atender, que está na praça da clínica, não em Brasília.
      const fusoMsg = await fusoDaEmpresa(req?.empresaId).catch(() => FUSO_PADRAO);

      await emailService.enviarTransferenciaAgenda({
        paraEmail: destino.email, paraNome: destino.fullName,
        deNome:    origem?.fullName ?? null,
        itens, modo, fuso: fusoMsg,
      }).catch(() => {});

      if (!destino.phone) return;
      const fmtData = (dh) => formatarDataNaEmpresa(dh, fusoMsg);
      const fmtHora = (dh) => formatarHoraNaEmpresa(dh, fusoMsg);
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

/**
 * Avisa TODOS os gestores da empresa (e-mail + WhatsApp) quando um atendimento é
 * assumido FORA do expediente configurado do profissional — o assumir não bloqueia
 * mais por horário (ver `assumir`), então isto é o que substitui o bloqueio: o
 * atendimento acontece, e quem gerencia a equipe fica sabendo. Fire-and-forget,
 * mesmo padrão de `notificarTransferencia` — falha de notificação nunca derruba
 * a operação clínica.
 */
async function notificarGestoresForaExpediente({ req, empresaId, quemAssumiuNome, animalNome, dataHora }) {
  if (!empresaId) return;
  setImmediate(async () => {
    try {
      const gestores = await prisma.membroEquipe.findMany({
        where:   { equipe: { empresaId: Number(empresaId) }, cargo: 'GESTOR' },
        include: { user: { select: { id: true, email: true, fullName: true, phone: true } } },
      });
      // Fuso resolvido UMA vez, fora do laço: é o mesmo para todos os gestores desta
      // empresa. `empresaId` explícito (parâmetro da função) em vez de `req.empresaId`
      // — este alerta é sobre a agenda de UMA empresa, que nem sempre é a do contexto
      // de quem disparou a ação.
      const fusoAlerta = await fusoDaEmpresa(empresaId ?? req?.empresaId).catch(() => FUSO_PADRAO);
      for (const gestor of gestores) {
        const dest = gestor.user;
        if (!dest) continue;

        if (dest.email) {
          emailService.enviarAlertaAssumidoForaExpediente({
            paraEmail: dest.email, paraNome: dest.fullName,
            quemAssumiuNome, animalNome, dataHora, fuso: fusoAlerta,
          }).catch(() => {});
        }

        if (dest.phone) {
          const fmtData = (dh) => formatarDataNaEmpresa(dh, fusoAlerta);
          const fmtHora = (dh) => formatarHoraNaEmpresa(dh, fusoAlerta);
          const msg = [
            `🐴 *S2Vet — Atendimento assumido fora do expediente*`,
            `⚠️ ${quemAssumiuNome ?? 'Um profissional'} assumiu o atendimento de *${animalNome ?? 'paciente'}* fora do horário configurado.`,
            `📅 ${fmtData(dataHora)} às ${fmtHora(dataHora)}`,
          ].join('\n');
          whatsappService.sendMessage({ empresaId: Number(empresaId), equipeId: req.equipeId }, dest.phone, msg)
            .then(envio => { if (!envio?.sucesso) return whatsappService.sendWhatsApp(dest.phone, msg).catch(() => {}); })
            .catch(() => {});
        }
      }
    } catch { /* silencioso — alerta não bloqueia o atendimento assumido */ }
  });
}

// Dia da semana (0=Dom…6=Sáb) e HH:MM de um instante NO FUSO DA CLÍNICA — independe
// do timezone do processo Node (que roda fixo em America/Sao_Paulo, server.ts).
//
// 🔴 Era fixo em Brasília, e é ele que decide se o horário cabe no EXPEDIENTE: numa
// clínica de Manaus (UTC−4) a janela inteira saía 1h deslocada — um agendamento das
// 07:30 locais era lido como 08:30 e passava por um expediente que começa às 08:00,
// e o das 17:30 era recusado por "fora do expediente" que termina às 18:00. Pior no
// dia da semana: o atendimento de sábado 23:00 no Acre virava domingo em Brasília e
// era recusado por não ser dia de atendimento.
function diaEHoraNaEmpresa(data, fuso) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso || FUSO_PADRAO, weekday: 'short',
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

  const fuso = await fusoDaEmpresa(req.empresaId);
  const { diaSemana, hhmm } = diaEHoraNaEmpresa(quando, fuso);
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

      // EXCLUSÃO LÓGICA (lib/visibilidade.js): animal ou cliente inativado some da
      // agenda junto com os agendamentos dele. Sem isto, inativar o paciente o tirava
      // da lista de Pacientes mas ele continuava ocupando horário na agenda do dia.
      const where = { ativo: true, ...filhoDeAnimalVisivel() };

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

      // Rastro de "assumido de quem" — a agenda pinta o selo na linha que trocou de
      // responsável. Colunas lidas por SQL cru (lib/agendamentoAssumido.js).
      await anexarAssumidoEmLista(itens);

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

      const acesso = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      // Transferência de Propriedade — o PROPRIETÁRIO atual só vê agendamentos com
      // `dataHora` a partir de `propriedadeDesde` (some do histórico anterior à posse
      // dele; agendamento futuro naturalmente já cai depois da transferência).
      // GESTOR/VET/ADMIN veem tudo.
      const animalCorte = await prisma.animal.findUnique({ where: { id: animalId }, select: { propriedadeDesde: true } });
      const corte = corteDePropriedade(req, animalCorte);

      const where = { animalId, ativo: true, ...(corte ? { dataHora: { gte: corte } } : {}) };
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
      await anexarAssumidoEmLista(itens);

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

      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });
      if (await animalFoiExcluido(animalId)) {
        return res.status(400).json({ error: 'Paciente inativado — reative-o na tela de Pacientes antes de registrar algo novo.', code: 'PACIENTE_EXCLUIDO' });
      }
      if (await animalEstaInativo(animalId)) {
        return res.status(400).json({ error: 'Paciente inativo — reative com o gestor antes de registrar algo novo.', code: 'PACIENTE_INATIVO' });
      }

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
            empresaId:     Number(req.empresaId),
            equipeId:      req.equipeId ? Number(req.equipeId) : null,
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

      // Marcar um agendamento é uma alteração da agenda e entra na trilha: sem isso a
      // auditoria mostraria o cancelamento de um atendimento que, para ela, nunca existiu.
      await registrarAuditoria(null, req, {
        categoria:  'CRIACAO',
        entidade:   'AGENDAMENTO',
        entidadeId: item.id,
        animalId:   item.animalId,
        detalhes:   `${item.tipo} — ${item.titulo ?? ''} | ${quando.toISOString()}`
                  + ` | profissional: ${item.veterinario?.fullName ?? '—'}`,
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
          // Fuso da CLÍNICA: a mensagem anuncia o horário para o profissional e para
          // o proprietário, que estão na praça da clínica — não em Brasília. Formato
          // longo ("segunda-feira, 24 de agosto") preservado; só o fuso mudou.
          const fusoAg   = await fusoDaEmpresa(req.empresaId).catch(() => FUSO_PADRAO);
          const dataFmt  = d.toLocaleDateString('pt-BR',  { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: fusoAg });
          const horaFmt  = d.toLocaleTimeString('pt-BR',  { hour: '2-digit', minute: '2-digit', timeZone: fusoAg });
          const tipoLabel = { CONSULTA: 'Consulta', VACINA: 'Vacina', RETORNO: 'Retorno', EXAME: 'Exame', PROCEDIMENTO: 'Procedimento' }[item.tipo] ?? item.tipo;

          // E-mail ao veterinário
          if (vet?.email) {
            await emailService.enviarNotificacaoAgendamentoProfissional({
              vetEmail: vet.email, vetNome: vet.fullName,
              animalNome, proprietarioNome, proprietarioPhone,
              dataHora: item.dataHora, tipo: item.tipo, fuso: fusoAg,
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
      // CANCELADO_AUTOMATICAMENTE é gravado só pela rotina noturna — se um clique humano
      // pudesse setá-lo, a distinção "cancelado pela clínica" × "o sistema desistiu"
      // (o motivo de o status existir) deixaria de valer alguma coisa.
      if (STATUS_SOMENTE_SISTEMA.includes(status)) {
        return res.status(400).json({ error: 'Este status é atribuído automaticamente pelo sistema e não pode ser definido manualmente.' });
      }

      // Cancelamento exige justificativa (auditoria)
      if (STATUS_LIVRES.includes(status) && !motivo?.trim()) {
        return res.status(400).json({ error: 'É obrigatório informar o motivo do cancelamento' });
      }

      const item = await prisma.agendamentoClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Agendamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // alterado até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, item.animalId)) return;

      // Autoria via RBAC: PROPRIO → só agendamentos próprios (responsável ou criador)
      if (!podeOperarAgendamento(req, item)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite alterar agendamentos próprios.' });
      }

      const updateData = { status };
      if (STATUS_LIVRES.includes(status) && motivo?.trim()) {
        updateData.observacao = motivo.trim();
      }

      const descricao = `${item.tipo} — ${item.titulo ?? ''}`.trim();

      // TODA mudança de status entra na auditoria, na mesma transaction da escrita.
      // Antes só o CANCELAMENTO era registrado: iniciar, concluir e finalizar um
      // atendimento passavam sem rastro — e são exatamente as transições que alguém
      // vai querer reconstruir depois ("quem deu esse atendimento por concluído?").
      const atualizado = await prisma.$transaction(async (tx) => {
        const ag = await tx.agendamentoClinico.update({
          where:   { id: item.id },
          data:    updateData,
          include: INCLUDE,
        });

        if (status === 'CANCELADO') {
          // Desistência do atendimento: categoria própria, com a justificativa.
          await registrarAuditoria(tx, req, {
            categoria:  'CANCELAMENTO',
            entidade:   'AGENDAMENTO',
            entidadeId: item.id,
            animalId:   item.animalId,
            motivo,
            detalhes:   descricao,
          });

          // O agendamento pode ter uma evolução EM_ANDAMENTO aberta a partir dele
          // (o "Iniciar" da agenda cria/vincula uma) — cancelar o agendamento não
          // pode deixá-la (e tudo que está atrelado a ela: prescrição, procedimento,
          // exame, encaminhamento, vacina) conduzindo um atendimento que já foi
          // desmarcado. Ao contrário do cancelar da EVOLUÇÃO, aqui o agendamento NÃO
          // é reaberto — é ele que está sendo cancelado agora.
          await cancelarEvolucoesDoAgendamento(tx, item.id, req, motivo);
        } else {
          // Inclui o REAGENDADO: ele libera o horário, mas NÃO é desistência — marcá-lo
          // como CANCELAMENTO faria o relatório contar remarcação como cancelamento.
          await registrarAlteracao(tx, req, {
            entidade: 'AGENDAMENTO', entidadeId: item.id, animalId: item.animalId,
            donoAtualId: item.veterinarioId,
            motivo,
            campos: {
              status:     { de: item.status,     para: ag.status },
              observacao: { de: item.observacao, para: ag.observacao },
            },
          });
        }

        return ag;
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
      const item = await prisma.agendamentoClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Agendamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // alterado até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, item.animalId)) return;

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
      // Passar o atendimento para OUTRO profissional é ação EXCLUSIVA DO GESTOR
      // (2026-08-04). Regra basal, não permissão da matriz: escolher quem atende o
      // paciente é decisão de quem coordena a equipe. Quem não é gestor tem o ASSUMIR
      // (puxa para si) como caminho — nunca empurrar para terceiro.
      // ⚠️ Atribuir profissional a um agendamento SEM responsável não é transferência
      // (não há de quem tirar) e continua liberado; sem essa exceção o caso caía no
      // bloqueio porque `Number(null)` é 0 e nunca bate com o id de ninguém.
      const trocaDeVet = novoVetId !== undefined && novoVetId !== item.veterinarioId;
      const semResponsavel = item.veterinarioId == null;
      if (trocaDeVet && !podeAgendarParaOutro(req) && !semResponsavel) {
        return res.status(403).json({
          error: 'Somente o gestor pode transferir o atendimento para outro profissional.',
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

      const atualizado = await prisma.$transaction(async (tx) => {
        const ag = await tx.agendamentoClinico.update({
          where:   { id: item.id },
          data,
          include: INCLUDE_GLOBAL,
        });

        // Trocar o responsável na agenda é transferir o atendimento: a evolução
        // aberta e tudo que está sob ela vão junto, senão o novo responsável não
        // consegue operar o que recebeu (premissa de autoria).
        if (trocaDeVet && novoVetId) {
          const movidos = await transferirEvolucoesDoAgendamento(tx, item.id, novoVetId);
          await marcarAssumido(tx, item.id, item.veterinarioId);
          await registrarTransferencia(tx, req, {
            entidade: 'AGENDAMENTO', entidadeId: item.id, animalId: item.animalId,
            deVetId: item.veterinarioId, paraVetId: novoVetId,
            motivo: 'Troca de profissional responsável pelo agendamento',
          });
          for (const m of movidos) {
            await registrarTransferencia(tx, req, {
              ...m, paraVetId: novoVetId,
              motivo: 'Arrasto do atendimento transferido',
              origem: `agendamento transferido`,
            });
          }
        }

        // Antes → depois do que a edição mudou, sempre amarrado a quem responde pelo
        // atendimento (o dono muda na mesma operação quando há transferência).
        await registrarAlteracao(tx, req, {
          entidade: 'AGENDAMENTO', entidadeId: item.id, animalId: item.animalId,
          donoAnteriorId: item.veterinarioId,
          donoAtualId:    novoVetId !== undefined ? novoVetId : item.veterinarioId,
          campos: {
            titulo:     { de: item.titulo,     para: ag.titulo },
            tipo:       { de: item.tipo,       para: ag.tipo },
            dataHora:   { de: item.dataHora?.toISOString(), para: ag.dataHora?.toISOString() },
            observacao: { de: item.observacao, para: ag.observacao },
          },
        });

        return ag;
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

      // Busca animais da empresa/equipe ativa. `animalVisivelNaEmpresa` também exclui
      // o animal cujo dono foi inativado NESTA empresa — `ativo:true` sozinho deixava
      // esse caso passar (ver lib/visibilidade.js).
      const animalWhere = { ...animalVisivelNaEmpresa(empresaId) };
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

      // 🔴 A agenda é para o FUTURO: horário que já passou não é nem oferecido. Sem
      // isto o fluxo por voz respondia `disponivel: true` (e listava alternativas já
      // vencidas) para um pedido de hoje mais cedo, e a recusa só vinha do `criar`
      // (400 DATA_PASSADA) depois de a pessoa confirmar. Mesma tolerância de 1 min.
      const noPassado = (quando) => quando.getTime() < Date.now() - 60_000;
      if (noPassado(dataHoraISO)) disponivel = false;

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
      const horariosLivres = HORARIOS_PADRAO.filter(h =>
        !ocupadosSet.has(h) && !noPassado(new Date(`${data}T${h}:00`)));

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

      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // cancelado até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, item.animalId)) return;

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
  // Qualquer profissional da equipe pode assumir o atendimento de outro — é um "puxar
  // para si", não depende de o outro transferir. Por isso NÃO passa por
  // `podeOperarAgendamento` (que exigiria ser o dono do agendamento).
  //
  // Vale para atendimento JÁ INICIADO (EM_ANDAMENTO), igual ao assumir da EVOLUÇÃO
  // (`EvolucaoController.assumir`). Antes só aceitava AGENDADO/ATRASADA: bastava o
  // outro profissional clicar em "Iniciar" para o atendimento ficar preso a ele na
  // agenda — o mesmo caso que a evolução resolve sem problema, e que é justamente
  // quando assumir importa (o colega começou e precisou sair). O arrasto abaixo já
  // move a evolução aberta e tudo que está sob ela.
  //
  // 🔴 NÃO bloqueia por expediente do profissional que assume (`dentroDoExpediente`
  // só INFORMA, via `foraExpediente` na resposta) — atendimento emergencial acontece
  // a qualquer hora, e travar o assumir por horário impedia justamente esse caso.
  // Continua bloqueando por CONFLITO de agenda (`conflitoDeAgenda`): duas consultas
  // ao mesmo tempo para a mesma pessoa não é uma questão de expediente, é impossível.
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
      if (!['AGENDADO', 'ATRASADA', 'EM_ANDAMENTO'].includes(item.status)) {
        return res.status(400).json({ error: 'Só é possível assumir um atendimento ainda em aberto.' });
      }

      // Acesso ao animal e disponibilidade de quem está assumindo
      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // assumido até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, item.animalId)) return;

      const duracao  = duracaoDe(item);
      const conflito = await conflitoDeAgenda(req.user.id, item.dataHora, duracao, item.id);
      if (conflito) {
        return res.status(409).json({
          error: `Você já tem um agendamento neste horário (${conflito.animal?.nome ?? 'outro paciente'}).`,
          code:  'PROFISSIONAL_OCUPADO',
        });
      }
      // 🔴 NÃO bloqueia mais por expediente (2026-09-XX) — atendimento emergencial
      // pode acontecer a qualquer hora, e travar o "assumir" por horário impedia
      // justamente o caso em que ele mais importa. Em vez de recusar, segue e avisa
      // TODOS os gestores da empresa (e-mail + WhatsApp — ver `notificarGestoresForaExpediente`
      // logo abaixo, depois da transação) para que decidam se precisa de alguma ação.
      const foraExpediente = !(await dentroDoExpediente(req.user.id, item.dataHora, req));

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
        // Arrasta a evolução aberta E tudo que está sob ela (prescrição, exame,
        // encaminhamento, vacina) — com a premissa de autoria, deixar um filho com o
        // dono antigo é deixar quem assumiu sem poder operar o próprio atendimento.
        const movidos = await transferirEvolucoesDoAgendamento(tx, item.id, req.user.id);
        // Guarda DE QUEM veio: sem isso a troca de responsável fica invisível na tela
        await marcarAssumido(tx, item.id, item.veterinarioId);

        await registrarTransferencia(tx, req, {
          entidade: 'AGENDAMENTO', entidadeId: item.id, animalId: item.animalId,
          deVetId: item.veterinarioId, paraVetId: req.user.id,
          motivo: 'Atendimento assumido por outro profissional',
        });
        for (const m of movidos) {
          await registrarTransferencia(tx, req, {
            ...m, paraVetId: req.user.id,
            motivo: 'Arrasto do atendimento assumido',
            origem: `agendamento assumido`,
          });
        }
        return ag;
      });
      await anexarAssumido(atualizado);

      // O profissional que estava com o atendimento é avisado de que ele saiu da agenda
      // dele — mesma notificação da transferência, na direção contrária.
      if (item.veterinarioId) {
        notificarTransferencia({
          req, paraVetId: item.veterinarioId, deVetId: req.user.id, modo: 'ASSUMIDO',
          itens: [{ dataHora: item.dataHora, animalNome: item.animal?.nome ?? null, tipo: item.tipo }],
        });
      }

      // Fora do expediente: não bloqueou, mas os gestores são avisados (ver
      // `notificarGestoresForaExpediente`). `foraExpediente` na resposta é o que
      // liga o alerta na tela de quem assumiu.
      if (foraExpediente) {
        notificarGestoresForaExpediente({
          req, empresaId: req.empresaId,
          quemAssumiuNome: req.user.fullName ?? null,
          animalNome:      item.animal?.nome ?? null,
          dataHora:        item.dataHora,
        });
      }

      res.json({ dados: atualizado, foraExpediente });
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

      // Transferir agenda para outro profissional é EXCLUSIVO DO GESTOR (2026-08-04).
      // ⚠️ Reverte a regra de 2026-07-28, que deixava o profissional transferir a agenda
      // DELE: o ato é o mesmo do "Transferir" da linha, e manter os dois com regras
      // diferentes só criava confusão sobre quem pode passar paciente para quem.
      if (!podeAgendarParaOutro(req)) {
        return res.status(403).json({
          error: 'Somente o gestor pode transferir a agenda para outro profissional.',
        });
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
        select: { id: true, animalId: true, dataHora: true, tipo: true, animal: { select: { nome: true } } },
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
        await prisma.$transaction(async (tx) => {
          await tx.agendamentoClinico.updateMany({
            where: { id: { in: transferiveis.map(a => a.id) } },
            data:  { veterinarioId: Number(paraVetId) },
          });

          for (const a of transferiveis) {
            // Agendamento AGENDADO em geral não tem evolução aberta, mas o dia pode
            // conter um atendimento já iniciado — o arrasto é o mesmo do assumir.
            const movidos = await transferirEvolucoesDoAgendamento(tx, a.id, paraVetId);
            await marcarAssumido(tx, a.id, Number(deVetId));
            await registrarTransferencia(tx, req, {
              entidade: 'AGENDAMENTO', entidadeId: a.id, animalId: a.animalId,
              deVetId, paraVetId,
              motivo: `Transferência da agenda do dia ${data}`,
            });
            for (const m of movidos) {
              await registrarTransferencia(tx, req, {
                ...m, paraVetId,
                motivo: 'Arrasto do atendimento transferido',
                origem: `agendamento transferido`,
              });
            }
          }
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

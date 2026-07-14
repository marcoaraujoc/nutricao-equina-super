// backend/src/lib/cronManager.js
// Gerenciador de tarefas agendadas com reagendamento dinâmico a partir do banco.
// Cada job é registrado com uma `chave`, um nome, a expressão cron padrão e a
// função a executar. Ao iniciar, a expressão/estado vêm de CronAgenda (editável
// pelo ADMIN na tela de Configuração); alterações são aplicadas ao vivo (para o
// task antigo do node-cron e cria um novo) sem reiniciar o backend.
'use strict';

const cron   = require('node-cron');
const logger = require('./logger');
const prisma = require('./prisma').default;

// chave → { nome, exprPadrao, fn, timezone, task, expr, ativo }
const jobs = new Map();

function registrarJob(chave, { nome, exprPadrao, fn, timezone = 'America/Sao_Paulo' }) {
  jobs.set(chave, { nome, exprPadrao, fn, timezone, task: null, expr: exprPadrao, ativo: true });
}

// (Re)aplica um job: para o task atual e agenda com a expressão/estado informados.
function aplicar(chave, expr, ativo) {
  const job = jobs.get(chave);
  if (!job) return;
  if (job.task) { job.task.stop(); job.task = null; }
  job.expr  = expr;
  job.ativo = ativo;
  if (ativo && cron.validate(expr)) {
    job.task = cron.schedule(expr, () => { job.fn(); }, { timezone: job.timezone });
    logger.info(`[CronManager] "${job.nome}" agendado: ${expr}`);
  } else {
    logger.info(`[CronManager] "${job.nome}" ${ativo ? `expr inválida (${expr})` : 'desativado'} — não agendado`);
  }
}

// Carrega as agendas do banco (criando os padrões que faltarem) e agenda todos os jobs.
async function iniciarJobs() {
  let agendas = [];
  try {
    agendas = await prisma.cronAgenda.findMany();
  } catch (e) {
    logger.warn(`[CronManager] Agenda indisponível no banco (usando padrões): ${e.message}`);
  }
  const porChave = new Map(agendas.map(a => [a.chave, a]));

  for (const [chave, job] of jobs) {
    const a = porChave.get(chave);
    if (!a) {
      // Semeia o padrão para aparecer na tela de Configuração
      try {
        await prisma.cronAgenda.create({ data: { chave, nome: job.nome, cronExpr: job.exprPadrao, ativo: true } });
      } catch (e) {
        logger.warn(`[CronManager] Não foi possível semear agenda de "${job.nome}": ${e.message}`);
      }
      aplicar(chave, job.exprPadrao, true);
    } else {
      const expr = a.cronExpr && cron.validate(a.cronExpr) ? a.cronExpr : job.exprPadrao;
      aplicar(chave, expr, a.ativo);
    }
  }
}

// Reagenda um job ao vivo e persiste em CronAgenda.
async function reagendar(chave, { cronExpr, ativo }) {
  const job = jobs.get(chave);
  if (!job) { const err = new Error('Tarefa desconhecida'); err.code = 'JOB_DESCONHECIDO'; throw err; }
  if (cronExpr !== undefined && !cron.validate(cronExpr)) {
    const err = new Error('Expressão cron inválida'); err.code = 'CRON_INVALIDO'; throw err;
  }
  await prisma.cronAgenda.upsert({
    where:  { chave },
    create: { chave, nome: job.nome, cronExpr: cronExpr ?? job.exprPadrao, ativo: ativo ?? true },
    update: { ...(cronExpr !== undefined && { cronExpr }), ...(ativo !== undefined && { ativo }) },
  });
  const a = await prisma.cronAgenda.findUnique({ where: { chave } });
  aplicar(chave, a.cronExpr, a.ativo);
  return a;
}

// Estado atual de todos os jobs registrados (para a tela de Configuração).
function listarJobs() {
  return [...jobs.entries()].map(([chave, j]) => ({
    chave, nome: j.nome, expr: j.expr, exprPadrao: j.exprPadrao, ativo: j.ativo,
  }));
}

module.exports = { registrarJob, iniciarJobs, reagendar, listarJobs };

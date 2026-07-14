// backend/src/lib/cronAlert.js
// Alerta + monitoração das tarefas agendadas (cron).
// - Configuração (destinatários, política) vem de CronAlertaConfig (editável na
//   tela de Configuração pelo ADMIN) — lida ao vivo do banco a cada execução.
// - Cada evento relevante (erro, ou execução que fez trabalho) é registrado em
//   CronExecucao para a tela de Monitoração (diário/semanal/mensal).
// Tudo é resiliente: se os models ainda não existirem (antes do prisma generate),
// as falhas são logadas e o cron segue rodando.
'use strict';

const logger = require('./logger');
const prisma = require('./prisma').default;
const emailService = require('../services/emailService');

const CONFIG_PADRAO = { emails: null, notificarSucesso: true, ativo: true };

async function getConfig() {
  try {
    const row = await prisma.cronAlertaConfig.findFirst({ orderBy: { id: 'asc' } });
    if (row) return row;
  } catch (e) {
    logger.warn(`[CronAlert] Configuração indisponível (usando padrão): ${e.message}`);
  }
  return { ...CONFIG_PADRAO };
}

async function getEmailsAlerta(config) {
  if (config?.emails && String(config.emails).trim()) {
    return String(config.emails).split(',').map(s => s.trim()).filter(Boolean);
  }
  const env = process.env.ADMIN_ALERT_EMAIL;
  if (env && env.trim()) return env.split(',').map(s => s.trim()).filter(Boolean);
  try {
    const admins = await prisma.user.findMany({ where: { userType: 'ADMIN' }, select: { email: true } });
    return admins.map(a => a.email).filter(Boolean);
  } catch (e) {
    logger.error(`[CronAlert] Falha ao resolver e-mails de admin: ${e.message}`);
    return [];
  }
}

async function registrarExecucao(nome, { ok, resumo, erro, notificado }) {
  try {
    await prisma.cronExecucao.create({
      data: { nome, ok: !!ok, resumo: resumo ?? null, erro: erro ?? null, notificado: !!notificado },
    });
  } catch (e) {
    logger.warn(`[CronAlert] Não foi possível registrar execução "${nome}": ${e.message}`);
  }
}

/**
 * Decide o envio de e-mail e registra a execução para a Monitoração.
 * @param {string} nome
 * @param {{ ok?: boolean, notificar?: boolean, resumo?: string, erro?: string }} r
 *   ok:false → erro (sempre alerta se ativo); notificar:true → sucesso com trabalho.
 */
async function reportarCron(nome, r) {
  const ok = r.ok !== false;
  const relevante = !ok || !!r.notificar;      // registra só eventos com significado
  const config = await getConfig();
  const deveEmail = config.ativo && (!ok || (!!r.notificar && config.notificarSucesso));

  let notificado = false;
  if (deveEmail) {
    const para = await getEmailsAlerta(config);
    if (para.length > 0) {
      try {
        await emailService.enviarAlertaCron({ para, nome, ok, resumo: r.resumo, erro: r.erro, quando: new Date() });
        notificado = true;
      } catch (e) {
        logger.error(`[CronAlert] Falha ao enviar alerta de "${nome}": ${e.message}`);
      }
    } else {
      logger.warn(`[CronAlert] Nenhum destinatário para "${nome}" — configure na tela de Configuração ou ADMIN_ALERT_EMAIL`);
    }
  }

  if (relevante) await registrarExecucao(nome, { ok, resumo: r.resumo, erro: r.erro, notificado });
}

module.exports = { reportarCron, getConfig, getEmailsAlerta, registrarExecucao };

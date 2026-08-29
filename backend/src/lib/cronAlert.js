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

// As colunas `origem`/`duracaoMs` chegaram na migration 20260921000000. Entre aplicá-la
// e não aplicá-la o log NÃO pode parar: citar coluna inexistente faz o INSERT falhar, e
// o rastro que este módulo existe para guardar é justamente o que se perderia. A
// pergunta é feita ao BANCO (uma vez, com cache) porque o INSERT é SQL cru — quem
// recusa aqui é o Postgres, não o Prisma Client.
let colunasNovas = null;
async function temColunasNovas() {
  if (colunasNovas !== null) return colunasNovas;
  try {
    const r = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_cron_execucoes'
          AND column_name IN ('origem', 'duracaoMs')`);
    colunasNovas = Number(r?.[0]?.n) === 2;
  } catch {
    colunasNovas = false;
  }
  return colunasNovas;
}

async function registrarExecucao(nome, { ok, resumo, erro, notificado, origem, duracaoMs }) {
  try {
    if (!(await temColunasNovas())) {
      // Antes da migration: grava o que a tabela sabe guardar. O histórico fica sem
      // origem e duração, mas continua registrando TODA execução — que é a mudança
      // que importa.
      await prisma.$executeRawUnsafe(
        `INSERT INTO schs2vet.tb_cron_execucoes (nome, ok, resumo, erro, notificado, "executadoEm")
         VALUES ($1, $2, $3, $4, $5, now())`,
        String(nome), !!ok, resumo ?? null, erro ?? null, !!notificado,
      );
      return;
    }
    // SQL cru: `origem`/`duracaoMs` chegaram na migration 20260921000000 e o Prisma
    // Client pode não conhecê-las ainda (no Windows o `generate` só roda com o backend
    // parado, §11). Pelo client tipado, campo desconhecido LANÇA — e derrubar o
    // registro do log por causa disso é justamente perder o rastro que ele existe para
    // guardar. O INSERT é parametrizado.
    await prisma.$executeRawUnsafe(
      `INSERT INTO schs2vet.tb_cron_execucoes (nome, ok, resumo, erro, notificado, origem, "duracaoMs", "executadoEm")
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      String(nome),
      !!ok,
      resumo ?? null,
      erro ?? null,
      !!notificado,
      origem === 'MANUAL' ? 'MANUAL' : 'AUTOMATICA',
      Number.isFinite(Number(duracaoMs)) ? Math.round(Number(duracaoMs)) : null,
    );
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

  // 🔴 REGISTRA SEMPRE — inclusive a execução que não teve trabalho nenhum.
  // Antes só entravam erro e "fez trabalho" (`relevante = !ok || notificar`), e o
  // resultado é que "rodou e não havia o que fazer" ficava IDÊNTICO a "não rodou": o
  // histórico simplesmente não tinha a linha. Foi assim que 7 prescrições com a janela
  // vencida ficaram dias sem cancelamento sem ninguém perceber — o job não rodava, e a
  // ausência de registro parecia normal.
  // O E-MAIL continua seletivo (`deveEmail`, acima): registrar tudo não pode virar um
  // alerta por execução, senão o alerta deixa de ser lido.
  await registrarExecucao(nome, {
    ok, resumo: r.resumo, erro: r.erro, notificado,
    origem: r.origem, duracaoMs: r.duracaoMs,
  });
}

module.exports = { reportarCron, getConfig, getEmailsAlerta, registrarExecucao };

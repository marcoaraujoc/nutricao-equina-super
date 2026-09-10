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

// ⚠️ `timezone` aqui é o do AGENDAMENTO do job (a que horas ele dispara), e é da
// PLATAFORMA, não de uma clínica: cada job varre TODAS as empresas numa passada só,
// então não existe "o fuso" dele. Brasília é a referência deliberada.
// Consequência conhecida: um job de fim de dia (ex.: 23:30) roda 22:30 no horário de
// Manaus e 21:30 no do Acre. Para que cada clínica feche no PRÓPRIO fim de dia, o
// caminho é agendar por empresa (ou rodar de hora em hora e filtrar por
// `hojeNaEmpresa`) — decisão de produto em aberto, não um descuido.

/**
 * Registra um job.
 *
 * @param {object} opcoes
 * @param {boolean} [opcoes.recuperarSePerdido=false] Rodar na SUBIDA do backend quando o
 *   disparo agendado foi perdido (servidor fora do ar no horário, ou execução com erro).
 *   ⚠️ **OPT-IN, e tem de continuar sendo.** Só serve a job cuja tarefa é DECIDIDA POR
 *   DATA e portanto idempotente: rodar às 09:00 de hoje o que devia ter rodado às 23:50
 *   de ontem dá exatamente o mesmo resultado. Ligar num job de MENSAGEM (lembrete de
 *   dose, aviso de véspera, lembrete de agendamento) mandaria ao cliente um aviso sobre
 *   um prazo que já passou — pior que não mandar.
 * @param {number} [opcoes.janelaRecuperacaoMs=26h] Quanto tempo sem execução BEM-SUCEDIDA
 *   caracteriza disparo perdido. 26h para um job diário: 2h de folga cobrem variação de
 *   horário de subida sem disparar recuperação em toda reinicialização.
 */
function registrarJob(chave, { nome, exprPadrao, fn, timezone = 'America/Sao_Paulo',
                               recuperarSePerdido = false, janelaRecuperacaoMs = 26 * 60 * 60 * 1000 }) {
  jobs.set(chave, { nome, exprPadrao, fn, timezone, task: null, expr: exprPadrao, ativo: true,
                    recuperarSePerdido, janelaRecuperacaoMs });
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

/**
 * Carrega as agendas do banco (criando os padrões que faltarem) e agenda todos os jobs.
 *
 * @param {{ agendar?: boolean }} [opcoes] `agendar: false` só CARREGA o estado (expressão
 *   e liga/desliga) sem criar nenhum task do node-cron. É o que `scripts/rodarJob.js`
 *   usa: sem isso o CLI mostraria a expressão PADRÃO do código, não a que está valendo
 *   no banco — e "45 23" no lugar de "00 18" faria alguém procurar o problema no
 *   horário errado.
 */
async function iniciarJobs({ agendar = true } = {}) {
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
      // Semeia o padrão para aparecer na tela de Configuração. Só quando vamos de fato
      // agendar: o CLI apenas INSPECIONA, e não deve criar linha nova no banco.
      if (agendar) {
        try {
          await prisma.cronAgenda.create({ data: { chave, nome: job.nome, cronExpr: job.exprPadrao, ativo: true } });
        } catch (e) {
          logger.warn(`[CronManager] Não foi possível semear agenda de "${job.nome}": ${e.message}`);
        }
      }
      if (agendar) aplicar(chave, job.exprPadrao, true);
      else { job.expr = job.exprPadrao; job.ativo = true; }
    } else {
      const expr = a.cronExpr && cron.validate(a.cronExpr) ? a.cronExpr : job.exprPadrao;
      if (agendar) aplicar(chave, expr, a.ativo);
      else { job.expr = expr; job.ativo = a.ativo; }
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

/**
 * Executa um job AGORA, fora da agenda, devolvendo o rastro passo a passo.
 *
 * POR QUE EXISTE: sem isto, a única forma de conferir um job era esperar o horário dele
 * e olhar a Monitoração — que só grava quando há trabalho ou erro. Um job que decide
 * "hoje não é dia de fechar" não deixa NENHUM registro, e fica indistinguível de um job
 * que nunca rodou. Foi assim que o fechamento de faturas passou dias sem fechar nada.
 *
 * ⚠️ Roda a função REAL do job — grava no banco, manda e-mail/WhatsApp, tudo. Não é
 * simulação. O gate é ADMIN da plataforma (ver `routes/monitoracao.js`).
 *
 * ⚠️ `ativo: false` NÃO impede a execução manual: desligar a agenda é dizer "não rode
 * sozinho", e é justamente com o job desligado que se quer testar antes de religar.
 * O estado vai no retorno para que a tela mostre que a agenda segue desligada.
 *
 * ⚠️ Uma execução por vez, por job (`emExecucao`): dois disparos simultâneos do
 * fechamento de faturas processariam as mesmas faturas em paralelo. O clique repetido
 * na tela é o caso comum, não a exceção.
 */
const emExecucao = new Set();

async function executarAgora(chave) {
  const job = jobs.get(chave);
  if (!job) { const err = new Error('Tarefa desconhecida'); err.code = 'JOB_DESCONHECIDO'; throw err; }
  if (emExecucao.has(chave)) {
    const err = new Error('Esta tarefa já está em execução'); err.code = 'JOB_EM_EXECUCAO'; throw err;
  }

  // `require` tardio: `cronTrace` é leve, mas manter o topo deste módulo sem dependência
  // nova preserva o carregamento dele em teste/script (mesmo cuidado de `tenantDb`).
  const { comTrace, passo } = require('./cronTrace');

  emExecucao.add(chave);
  const inicio = Date.now();
  try {
    logger.info(`[CronManager] execução MANUAL de "${job.nome}" (${chave})`);
    const { resultado, erro, trace } = await comTrace(async () => {
      passo(`job "${job.nome}" (${chave}) — execução MANUAL`,
        { agenda: job.expr, agendaAtiva: job.ativo, fuso: job.timezone });
      return job.fn();
    });
    return {
      chave, nome: job.nome, expr: job.expr, ativo: job.ativo,
      duracaoMs: Date.now() - inicio,
      resultado, erro, trace,
    };
  } finally {
    emExecucao.delete(chave);
  }
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * RECUPERAÇÃO DO DISPARO PERDIDO — "processe o que já devia ter rodado"
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 🔴 O PROBLEMA: `node-cron` NÃO recupera disparo perdido. Um job de 23:50 com o
 * backend fora do ar nesse minuto simplesmente não acontece — e, no ambiente de
 * desenvolvimento (onde o processo raramente está no ar à meia-noite), não acontece
 * NUNCA. Foi o que manteve um orçamento de 10/08 em aberto até 08/09: o
 * `cancelar_orcamentos_vencidos` estava correto e nunca havia rodado.
 *
 * O QUE ESTA FUNÇÃO FAZ: na subida do backend, para cada job marcado com
 * `recuperarSePerdido`, pergunta ao log quando foi a última execução BEM-SUCEDIDA.
 * Passou da janela → roda AGORA, marcado como `RECUPERACAO` no histórico.
 *
 * ⚠️ **BEM-SUCEDIDA, não "última".** Execução que terminou em ERRO não conta como
 * feita — é justamente o segundo caso do pedido ("se ele falhar… deverá rodar
 * normalmente no dia seguinte"). Aceitar qualquer linha faria uma falha diária
 * silenciar a recuperação para sempre.
 *
 * ⚠️ **Sem NENHUMA execução no log, roda.** Base nova, log expurgado (15 dias) ou
 * tarefa que nunca disparou caem aqui — e o trabalho é idempotente, então rodar é
 * sempre mais seguro que supor que já foi feito.
 *
 * ⚠️ **Agenda DESLIGADA não recupera.** `ativo: false` é uma decisão do ADMIN na tela
 * de Configuração; ressuscitar o job na subida a desfaria pelas costas dele.
 *
 * ⚠️ **Nunca derruba o boot**: cada job é isolado em try/catch e o conjunto roda em
 * segundo plano, depois do `listen`.
 *
 * ⚠️ Uma reinicialização em série não multiplica trabalho: a execução vira linha no
 * log, e a próxima subida já vê a última bem-sucedida dentro da janela.
 */
async function ultimaExecucaoOk(nome) {
  // SQL cru pelo mesmo motivo do INSERT em `cronAlert.registrarExecucao`: mantém o
  // caminho funcionando com o Prisma Client ainda não regenerado (§11).
  // `tb_cron_execucoes` é CONTROL PLANE (sem RLS) — não precisa de carimbo de tenant.
  const linhas = await prisma.$queryRawUnsafe(
    'SELECT max("executadoEm") AS ultima FROM schs2vet.tb_cron_execucoes WHERE nome = $1 AND ok = true',
    String(nome),
  );
  const v = linhas?.[0]?.ultima;
  return v ? new Date(v) : null;
}

async function recuperarJobsPerdidos() {
  const { comOrigem } = require('./cronTrace');

  for (const [chave, job] of jobs) {
    if (!job.recuperarSePerdido) continue;
    if (!job.ativo) {
      logger.info(`[CronManager] "${job.nome}": agenda desligada — recuperação não se aplica.`);
      continue;
    }
    try {
      const ultima = await ultimaExecucaoOk(job.nome);
      const limite = Date.now() - job.janelaRecuperacaoMs;
      if (ultima && ultima.getTime() > limite) continue;

      const motivo = ultima
        ? `última execução bem-sucedida em ${ultima.toISOString()}`
        : 'nenhuma execução bem-sucedida registrada';
      logger.warn(`[CronManager] "${job.nome}": disparo perdido (${motivo}) — executando agora (RECUPERACAO).`);

      if (emExecucao.has(chave)) continue;
      emExecucao.add(chave);
      try {
        await comOrigem('RECUPERACAO', () => job.fn());
      } finally {
        emExecucao.delete(chave);
      }
    } catch (e) {
      // Falhar a recuperação não pode derrubar a subida do backend: o job volta a ser
      // tentado no próximo horário agendado e na próxima reinicialização.
      logger.error(`[CronManager] Falha ao recuperar "${job.nome}": ${e?.message ?? e}`);
    }
  }
}

module.exports = { registrarJob, iniciarJobs, reagendar, listarJobs, executarAgora, recuperarJobsPerdidos };

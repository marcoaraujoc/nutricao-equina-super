// backend/src/controllers/MonitoracaoController.js
// Configuração dos alertas de cron + histórico de execuções (tela de Monitoração).
// Acesso: ADMIN ou GESTOR (tarefas agendadas são globais do sistema).
'use strict';

const prisma = require('../lib/prisma').default;
const cronManager = require('../lib/cronManager');

// Tarefas agendadas são globais do sistema — acesso p/ ADMIN ou GESTOR (dono de
// empresa ou cargo GESTOR em alguma equipe).
async function podeGerenciar(req, res) {
  if (req.user?.userType === 'ADMIN') return true;
  const uid = req.user?.id;
  if (uid) {
    const [dono, gestor] = await Promise.all([
      prisma.empresa.findFirst({ where: { ownerId: uid }, select: { id: true } }),
      prisma.membroEquipe.findFirst({ where: { userId: uid, cargo: 'GESTOR' }, select: { id: true } }),
    ]);
    if (dono || gestor) return true;
  }
  res.status(403).json({ error: 'Acesso restrito a administrador ou gestor.' });
  return false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Config de alertas ────────────────────────────────────────────────────────
const getConfig = async (req, res) => {
  if (!(await podeGerenciar(req, res))) return;
  try {
    let config = await prisma.cronAlertaConfig.findFirst({ orderBy: { id: 'asc' } });
    if (!config) config = await prisma.cronAlertaConfig.create({ data: {} });
    return res.json({ dados: {
      emails:           config.emails ?? '',
      notificarSucesso: config.notificarSucesso,
      ativo:            config.ativo,
    } });
  } catch (err) {
    console.error('Monitoracao.getConfig:', err);
    return res.status(500).json({ error: 'Erro ao carregar configuração de alertas.' });
  }
};

const salvarConfig = async (req, res) => {
  if (!(await podeGerenciar(req, res))) return;
  try {
    const { emails, notificarSucesso, ativo } = req.body ?? {};

    let emailsFinal;
    if (emails !== undefined) {
      const lista = String(emails).split(',').map(s => s.trim()).filter(Boolean);
      const invalido = lista.find(e => !EMAIL_RE.test(e));
      if (invalido) return res.status(400).json({ error: `E-mail inválido: ${invalido}` });
      emailsFinal = lista.length ? lista.join(',') : null;
    }

    const data = {
      ...(emails           !== undefined && { emails: emailsFinal }),
      ...(notificarSucesso !== undefined && { notificarSucesso: Boolean(notificarSucesso) }),
      ...(ativo            !== undefined && { ativo: Boolean(ativo) }),
    };

    const existente = await prisma.cronAlertaConfig.findFirst({ orderBy: { id: 'asc' } });
    const config = existente
      ? await prisma.cronAlertaConfig.update({ where: { id: existente.id }, data })
      : await prisma.cronAlertaConfig.create({ data });

    return res.json({ dados: {
      emails:           config.emails ?? '',
      notificarSucesso: config.notificarSucesso,
      ativo:            config.ativo,
    } });
  } catch (err) {
    console.error('Monitoracao.salvarConfig:', err);
    return res.status(500).json({ error: 'Erro ao salvar configuração de alertas.' });
  }
};

// ── Histórico de execuções (dia / semana / mês) ──────────────────────────────
const listarExecucoes = async (req, res) => {
  if (!(await podeGerenciar(req, res))) return;
  try {
    const periodo = ['dia', 'semana', 'mes'].includes(req.query.periodo) ? req.query.periodo : 'dia';
    const inicio = new Date();
    if (periodo === 'dia')          inicio.setHours(0, 0, 0, 0);
    else if (periodo === 'semana') { inicio.setDate(inicio.getDate() - 6); inicio.setHours(0, 0, 0, 0); }
    else                           { inicio.setDate(inicio.getDate() - 29); inicio.setHours(0, 0, 0, 0); } // mês = últimos 30 dias

    // SQL cru: `origem`/`duracaoMs` chegaram na migration 20260921000000 e o Prisma
    // Client pode não conhecê-las (no Windows o `generate` só roda com o backend
    // parado). `to_jsonb(t)->>'origem'` devolve NULL quando a coluna não existe, em vez
    // de derrubar a consulta — assim a tela funciona antes e depois da migration.
    const execucoes = await prisma.$queryRawUnsafe(
      `SELECT id, nome, ok, resumo, erro, notificado, "executadoEm",
              to_jsonb(t) ->> 'origem'    AS origem,
              (to_jsonb(t) ->> 'duracaoMs')::int AS "duracaoMs"
         FROM schs2vet.tb_cron_execucoes t
        WHERE "executadoEm" >= $1
        ORDER BY "executadoEm" DESC
        LIMIT 1000`,
      inicio,
    );

    const porTarefa = new Map();
    let sucessos = 0, erros = 0, alertas = 0;
    for (const e of execucoes) {
      if (e.ok) sucessos++; else erros++;
      if (e.notificado) alertas++;
      const g = porTarefa.get(e.nome) ?? { nome: e.nome, execucoes: 0, sucessos: 0, erros: 0, alertas: 0, manuais: 0, ultima: null };
      g.execucoes++;
      if (e.ok) g.sucessos++; else g.erros++;
      if (e.notificado) g.alertas++;
      if (e.origem === 'MANUAL') g.manuais++;
      if (!g.ultima) g.ultima = e.executadoEm; // orderBy desc → primeira vista é a mais recente
      porTarefa.set(e.nome, g);
    }

    return res.json({ dados: {
      periodo,
      totais:    { total: execucoes.length, sucessos, erros, alertas },
      porTarefa: [...porTarefa.values()].sort((a, b) => b.erros - a.erros || b.execucoes - a.execucoes),
      execucoes: execucoes.map(e => ({
        id: e.id, nome: e.nome, ok: e.ok, resumo: e.resumo, erro: e.erro,
        notificado: e.notificado, executadoEm: e.executadoEm,
        origem: e.origem ?? 'AUTOMATICA', duracaoMs: e.duracaoMs ?? null,
      })),
    } });
  } catch (err) {
    console.error('Monitoracao.listarExecucoes:', err);
    return res.status(500).json({ error: 'Erro ao carregar a monitoração.' });
  }
};

// ── Agenda (horário) das tarefas — reagendamento dinâmico ────────────────────
const listarAgendas = async (req, res) => {
  if (!(await podeGerenciar(req, res))) return;
  try {
    return res.json({ dados: cronManager.listarJobs() });
  } catch (err) {
    console.error('Monitoracao.listarAgendas:', err);
    return res.status(500).json({ error: 'Erro ao listar agendas.' });
  }
};

const reagendar = async (req, res) => {
  if (!(await podeGerenciar(req, res))) return;
  try {
    const { chave } = req.params;
    const { cronExpr, ativo } = req.body ?? {};
    const a = await cronManager.reagendar(chave, { cronExpr, ativo });
    return res.json({ dados: { chave: a.chave, nome: a.nome, expr: a.cronExpr, ativo: a.ativo } });
  } catch (err) {
    if (err.code === 'CRON_INVALIDO')     return res.status(400).json({ error: 'Expressão cron inválida (use 5 campos: min hora dia mês diaSemana).' });
    if (err.code === 'JOB_DESCONHECIDO')  return res.status(404).json({ error: 'Tarefa desconhecida.' });
    console.error('Monitoracao.reagendar:', err);
    return res.status(500).json({ error: 'Erro ao reagendar tarefa.' });
  }
};

// ── Execução MANUAL de uma tarefa, com rastro passo a passo ──────────────────
//
// 🔴 GATE MAIS ESTREITO QUE O DO RESTO DA TELA: só ADMIN DA PLATAFORMA.
//
// `podeGerenciar` aceita GESTOR porque ler a monitoração e ajustar horário é operação
// de quem administra a própria clínica. Disparar o job é outra coisa: ele varre TODAS
// as empresas ativas — fecha fatura, cancela agendamento e manda WhatsApp em nome de
// clínicas que não são a de quem clicou. Isso é ato de plataforma.
//
// ⚠️ `role`/`userTypeGlobal`, NUNCA o `userType` de contexto: este último é o papel na
// EMPRESA ATIVA e um gestor o tem como VETERINARIO (ver CLAUDE.md §36-e).
function soAdminPlataforma(req, res) {
  const global = req.user?.role ?? req.user?.userTypeGlobal ?? req.user?.userType;
  if (global === 'ADMIN') return true;
  res.status(403).json({ error: 'Execução manual de tarefa é restrita ao administrador da plataforma.' });
  return false;
}

const executarAgora = async (req, res) => {
  if (!soAdminPlataforma(req, res)) return;
  try {
    const r = await cronManager.executarAgora(req.params.chave);
    // 200 mesmo com `erro` preenchido: a EXECUÇÃO aconteceu e o rastro é o produto da
    // chamada. Devolver 500 faria o interceptor do axios tratar como falha da rota e a
    // tela descartaria justamente o trace que explica o problema.
    return res.json({ dados: r });
  } catch (err) {
    if (err.code === 'JOB_DESCONHECIDO') return res.status(404).json({ error: 'Tarefa desconhecida.' });
    if (err.code === 'JOB_EM_EXECUCAO')  return res.status(409).json({ error: 'Esta tarefa já está em execução — aguarde terminar.' });
    console.error('Monitoracao.executarAgora:', err);
    return res.status(500).json({ error: 'Erro ao executar a tarefa.' });
  }
};

module.exports = { getConfig, salvarConfig, listarExecucoes, listarAgendas, reagendar, executarAgora };

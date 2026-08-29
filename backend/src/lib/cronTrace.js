// backend/src/lib/cronTrace.js
//
// RASTRO DE EXECUÇÃO DOS CRONS — o "set -x" das tarefas agendadas.
//
// ════════════════════════════════════════════════════════════════════════════
// POR QUE O DIÁRIO (`lib/cronTenant.js`) NÃO BASTAVA
// ════════════════════════════════════════════════════════════════════════════
//
// O diário responde "O QUE FOI FEITO": 4 faturas fechadas, 1 com erro. Ele é o resumo
// que sobrevive em `CronExecucao` e aparece na Monitoração — e é o certo para o dia a dia.
//
// Ele NÃO responde "POR QUE NADA FOI FEITO". Um job que varre 6 empresas, decide que
// nenhuma fatura fecha hoje e termina com "0 item(ns) com sucesso" é indistinguível de
// um job quebrado: os dois produzem a mesma linha. Foi exatamente esse o caso do
// fechamento de faturas — a configuração da clínica voltava vazia (RLS), o job caía no
// fallback do último dia do mês e não fechava nada, em silêncio, todo dia.
//
// O trace registra a DECISÃO, não só o resultado: qual configuração foi lida, o que ela
// determinou para hoje, e por que cada fatura foi ou não fechada. Ele existe para a
// execução MANUAL (`scripts/rodarJob.js` e `POST /monitoracao/agendas/:chave/executar`);
// no agendamento normal ninguém o liga, e `passo()` vira uma linha morta — sem store no
// AsyncLocalStorage, ela retorna na primeira instrução.
//
// ⚠️ NUNCA colocar dado de paciente/cliente no trace além do que o diário já mostra
// (nome do proprietário, número da fatura). Ele é lido pelo ADMIN da plataforma, que vê
// todas as clínicas — o mesmo critério do resumo da Monitoração.
'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const contexto = new AsyncLocalStorage();

/** Está coletando trace? Serve para pular trabalho caro de formatação. */
const ativo = () => contexto.getStore() != null;

/**
 * Registra um passo. Fora de `comTrace` não faz nada — é o caso do cron agendado.
 *
 * @param {string} texto  o que aconteceu, em uma linha
 * @param {object} [dados] pares chave=valor anexados ao fim da linha
 */
function passo(texto, dados) {
  const s = contexto.getStore();
  if (!s) return;
  const extra = dados && Object.keys(dados).length
    ? ' ' + Object.entries(dados).map(([k, v]) => `${k}=${formatar(v)}`).join(' ')
    : '';
  s.linhas.push({
    ms:    Date.now() - s.t0,
    nivel: s.nivel,
    texto: texto + extra,
  });
}

/**
 * Agrupa passos sob um cabeçalho, indentando o que acontecer dentro.
 * Fecha sozinho (inclusive quando `fn` lança) — o rastro de um job que quebrou no meio
 * é justamente o que se quer ler.
 */
async function grupo(texto, fn) {
  const s = contexto.getStore();
  if (!s) return fn();
  passo(texto);
  s.nivel++;
  try {
    return await fn();
  } finally {
    s.nivel--;
  }
}

/** Valor curto e legível numa linha só — o trace é para ler, não para parsear. */
function formatar(v) {
  if (v == null) return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Roda `fn` coletando o rastro.
 *
 * @returns {Promise<{ resultado: unknown, trace: string[], erro?: string }>}
 *   `trace` já vem formatado, uma linha por passo. Um erro em `fn` NÃO é engolido em
 *   silêncio: ele volta em `erro` junto com o rastro do que já tinha acontecido — jogar
 *   a exceção fora perderia exatamente o contexto que explica a falha.
 */
async function comTrace(fn) {
  const store = { linhas: [], nivel: 0, t0: Date.now() };
  return contexto.run(store, async () => {
    let resultado, erro;
    try {
      resultado = await fn();
    } catch (e) {
      erro = e?.stack || e?.message || String(e);
      passo(`!! EXCEÇÃO: ${e?.message ?? e}`);
    }
    return { resultado, erro, trace: store.linhas.map(formatarLinha) };
  });
}

/** `+ [  0.312s]   texto` — o `+` é a convenção do `set -x` do shell. */
function formatarLinha({ ms, nivel, texto }) {
  const seg = (ms / 1000).toFixed(3).padStart(7, ' ');
  return `+ [${seg}s] ${'  '.repeat(nivel)}${texto}`;
}

/**
 * true quando a execução em curso veio do botão "Executar agora" — é `comTrace` que
 * abre esse contexto, e só o disparo manual passa por ele. É assim que a origem chega
 * ao log sem precisar mudar a assinatura dos 12 jobs.
 */
function ehManual() {
  return ativo();
}

module.exports = { comTrace, passo, grupo, ativo, ehManual };

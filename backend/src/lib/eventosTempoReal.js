// backend/src/lib/eventosTempoReal.js
//
// EVENTOS EM TEMPO REAL — Server-Sent Events (SSE), um canal por sessão aberta.
//
// 🔴 O EVENTO NUNCA É A FONTE DA VERDADE. Ele existe para AVISAR: a tela de quem
// perdeu o registro entra em somente leitura na hora, em vez de a pessoa
// continuar digitando um texto que o backend já não vai aceitar. Se o evento se
// perder (rede caiu, aba congelada, proxy cortou), a integridade continua
// intacta — quem a garante é a trava otimista em `lib/concorrenciaRegistro.js`.
// Ver o teste "evento perdido não compromete a integridade".
//
// POR QUE SSE E NÃO WEBSOCKET:
//  1. A autenticação já é por COOKIE HttpOnly (§14). `EventSource` mesma-origem
//     manda o cookie sozinho; WebSocket exigiria um handshake de auth próprio
//     (token na query — justamente o que a §8 evita) e um segundo caminho de
//     sessão a manter em sincronia com o `authenticate`.
//  2. O fluxo é de mão ÚNICA (servidor -> tela). Nada aqui precisa que o cliente
//     escreva pelo socket: toda escrita continua sendo HTTP autenticado e
//     auditado. WebSocket traria um canal de escrita que ninguém usa.
//  3. Sem dependência nova (`ws`/`socket.io`) e sem infraestrutura paralela: é o
//     mesmo app Express, o mesmo proxy do Vite e o mesmo túnel do Cloudflare.
//
// ⚠️ ESCOPO: um processo. Rodando em VÁRIAS instâncias, cada uma só alcança as
// telas conectadas nela — e nesse dia o caminho é publicar por Redis pub/sub
// mantendo esta MESMA interface (`publicar`), sem tocar nos controllers. O
// projeto roda em processo único hoje (o `cronManager` depende disso).
'use strict';

const logger = require('./logger');

// userId -> Set de respostas SSE abertas (a mesma pessoa pode ter duas abas).
const canais = new Map();
// resposta -> função que encerra AQUELE canal (para o heartbeat junto).
// ⚠️ Sem este mapa, `res.end()` fecha o socket mas DEIXA O `setInterval` VIVO:
// o timer segue tentando escrever numa resposta morta a cada 25s, para sempre.
// Foi assim que o jest acusou 'open handle' — e em produção é vazamento de timer
// por toda conexão encerrada fora do caminho do 'close'.
const encerradores = new WeakMap();

const HEARTBEAT_MS = 25_000;   // < 30s: proxies costumam cortar conexão ociosa
const MAX_POR_USUARIO = 5;     // teto de abas por pessoa (evita vazamento de socket)

/**
 * Registra uma resposta HTTP como canal SSE do usuário.
 * @returns {Function} encerra o canal (chamar no 'close' do request)
 */
function abrirCanal(userId, res) {
  const uid = Number(userId);
  if (!canais.has(uid)) canais.set(uid, new Set());
  const doUsuario = canais.get(uid);

  // Aba mais antiga sai quando o teto estoura. Sem isto, um cliente que reconecta
  // sem fechar (mobile trocando de rede) acumula respostas mortas para sempre.
  while (doUsuario.size >= MAX_POR_USUARIO) {
    const antiga = doUsuario.values().next().value;
    doUsuario.delete(antiga);
    try { antiga.end(); } catch { /* já fechada */ }
  }
  doUsuario.add(res);

  const bater = setInterval(() => {
    // Comentário SSE (linha iniciada por ':') — mantém a conexão viva sem virar
    // um evento na tela.
    try { res.write(': ping\n\n'); } catch { fechar(); }
  }, HEARTBEAT_MS);
  // O heartbeat não é motivo para o processo continuar de pé: sem `unref`, um
  // canal aberto impede o encerramento limpo do servidor (e trava o jest).
  bater.unref?.();

  let fechado = false;
  function fechar() {
    if (fechado) return;
    fechado = true;
    clearInterval(bater);
    doUsuario.delete(res);
    if (doUsuario.size === 0) canais.delete(uid);
    try { res.end(); } catch { /* já encerrada */ }
  }
  encerradores.set(res, fechar);
  return fechar;
}

/**
 * Entrega um evento às telas de usuários específicos.
 *
 * 🔴 FIRE-AND-FORGET e NUNCA dentro de uma transaction: falha de entrega não pode
 * derrubar (nem reverter) a operação clínica que acabou de ser gravada. Publique
 * DEPOIS do commit — antes dele, um rollback avisaria a tela de algo que não
 * aconteceu.
 *
 * @param {number[]} destinatarios ids de usuário
 * @param {object}   evento        { tipo, ... } — serializado como JSON
 */
function publicar(destinatarios, evento) {
  try {
    const alvos = (Array.isArray(destinatarios) ? destinatarios : [destinatarios])
      .filter(v => v != null)
      .map(Number);
    if (alvos.length === 0) return;

    const corpo = JSON.stringify({ ...evento, em: new Date().toISOString() });
    const linha = `event: ${evento.tipo}\ndata: ${corpo}\n\n`;

    for (const uid of new Set(alvos)) {
      const doUsuario = canais.get(uid);
      if (!doUsuario) continue;                  // ninguém conectado: nada a fazer
      for (const res of [...doUsuario]) {
        try { res.write(linha); }
        catch { doUsuario.delete(res); }         // conexão morta é descartada
      }
    }
  } catch (err) {
    // Nunca propaga: o evento é conveniência, a escrita já está no banco.
    logger?.warn?.(`[eventos] falha ao publicar ${evento?.tipo}: ${err.message}`);
  }
}

/** Quantas telas estão conectadas (diagnóstico e teste). */
function estatisticas() {
  let conexoes = 0;
  for (const s of canais.values()) conexoes += s.size;
  return { usuarios: canais.size, conexoes };
}

/** Derruba todos os canais — usado em teste e no encerramento do processo. */
function encerrarTudo() {
  // Passa pelo `fechar` de cada canal, e NÃO por `res.end()` direto: é o `fechar`
  // que limpa o heartbeat. Fechar só o socket deixaria os timers rodando.
  for (const s of [...canais.values()]) {
    for (const res of [...s]) {
      const fechar = encerradores.get(res);
      if (fechar) fechar();
      else { try { res.end(); } catch { /* noop */ } }
    }
  }
  canais.clear();
}

// ── Tipos de evento ─────────────────────────────────────────────────────────
// Nomes no PASSADO e por ENTIDADE: eles descrevem um fato já gravado, não um
// pedido à tela. A tela decide o que fazer com o fato.
const EVENTOS = {
  EVOLUCAO_ASSUMIDA:    'EVOLUCAO_ASSUMIDA',
  EVOLUCAO_ATUALIZADA:  'EVOLUCAO_ATUALIZADA',
  AGENDAMENTO_ASSUMIDO: 'AGENDAMENTO_ASSUMIDO',
};

module.exports = { abrirCanal, publicar, estatisticas, encerrarTudo, EVENTOS, HEARTBEAT_MS };

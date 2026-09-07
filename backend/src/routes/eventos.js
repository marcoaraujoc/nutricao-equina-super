// backend/src/routes/eventos.js — montado em /api/eventos
//
// Canal de eventos em tempo real (SSE). Uma conexão por aba aberta; o servidor
// empurra o que aconteceu com os registros que aquela pessoa está editando.
//
// ⚠️ AUTENTICADO como qualquer outra rota: o `authenticate` resolve o usuário
// pelo cookie HttpOnly, e o canal é aberto para `req.user.id` — o cliente NUNCA
// diz para quem quer escutar. Sem isso, bastaria um `?userId=` para ouvir os
// eventos de outra pessoa.
//
// ⚠️ SEM `checkPermission`: o canal em si não expõe dado clínico. O payload de
// cada evento carrega apenas ids e o nome de quem assumiu — o mesmo que o
// destinatário já vê na tela de onde perdeu o registro. Quem decide o que a
// pessoa pode LER continua sendo o gate da rota que serve o dado.
'use strict';

const express = require('express');
const router  = express.Router();

const { authenticate }   = require('../middlewares/auth');
const { abrirCanal, estatisticas } = require('../lib/eventosTempoReal');

// GET /api/eventos/stream
router.get('/stream', authenticate, (req, res) => {
  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection:      'keep-alive',
    // Desliga o buffer do proxy (nginx e afins). Sem isto os eventos ficam
    // retidos e chegam todos juntos — um aviso que só aparece depois não avisa
    // ninguém. Mesma razão do header no envio de PDF com progresso.
    'X-Accel-Buffering': 'no',
  });
  // Manda os headers ANTES de qualquer evento: o `EventSource` do navegador só
  // dispara `onopen` (e o front só sai de "conectando") depois deles.
  res.flushHeaders?.();

  // `retry` instrui o próprio EventSource a reconectar em 5s se a conexão cair —
  // reconexão nativa, sem código de retry no front.
  res.write('retry: 5000\n\n');
  res.write(`event: conectado\ndata: ${JSON.stringify({ userId: req.user.id })}\n\n`);

  const fechar = abrirCanal(req.user.id, res);
  // 'close' cobre aba fechada, navegação e queda de rede. Sem ele o heartbeat
  // seguiria escrevendo num socket morto para sempre.
  req.on('close', fechar);
  req.on('error', fechar);
});

// GET /api/eventos/status — diagnóstico (quantas telas estão ouvindo).
// Só ADMIN da plataforma: é informação sobre a instalação, não sobre a clínica.
router.get('/status', authenticate, (req, res) => {
  if (req.user?.role !== 'ADMIN' && req.user?.userTypeGlobal !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso restrito.' });
  }
  res.json({ sucesso: true, dados: estatisticas() });
});

module.exports = router;

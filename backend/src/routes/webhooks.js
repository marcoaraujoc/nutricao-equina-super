// backend/src/routes/webhooks.js — montado em /api/webhooks
// Webhook da Evolution API: atualiza o status da instância da clínica no banco
// automaticamente. Rota PÚBLICA (a Evolution não autentica via JWT) protegida
// por token de query string (?token=EVOLUTION_WEBHOOK_TOKEN).
'use strict';

const express = require('express');
const router  = express.Router();
const logger  = require('../lib/logger');
const whatsappService = require('../services/whatsappService');

// Evolution envia eventos como 'connection.update' / 'CONNECTION_UPDATE'
const normalizarEvento = (e) => String(e ?? '').toLowerCase().replace(/_/g, '.');

router.post('/evolution', async (req, res) => {
  try {
    const esperado = process.env.EVOLUTION_WEBHOOK_TOKEN || '';
    if (esperado && req.query.token !== esperado) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const body     = req.body ?? {};
    const evento   = normalizarEvento(body.event);
    const instancia = body.instance ?? body.instanceName ?? null;
    logger.info(`[Webhook:Evolution] ${evento || 'evento'} instancia=${instancia ?? '—'}`);

    if (!instancia) return res.json({ ok: true });

    switch (evento) {
      case 'connection.update': {
        const state = body.data?.state ?? body.data?.connection ?? null;
        if (state) await whatsappService.atualizarStatusPorInstancia(instancia, whatsappService.mapearEstado(state));
        break;
      }
      case 'qrcode.updated':
        await whatsappService.atualizarStatusPorInstancia(instancia, 'AGUARDANDO_QR');
        break;
      case 'logout.instance':
      case 'logout':
        await whatsappService.atualizarStatusPorInstancia(instancia, 'DESCONECTADO');
        break;
      case 'application.startup':
      case 'startup':
        // Evolution reiniciou — o próximo obterStatus/connection.update sincroniza
        break;
      case 'messages.upsert':
        // Recebimento de mensagens: apenas registrado por ora (sem inbox na aplicação)
        logger.info(`[Webhook:Evolution] messages.upsert instancia=${instancia} (registrado)`);
        break;
      default:
        break;
    }

    // Sempre 200 — a Evolution reenvia em caso de erro e não deve acumular fila
    res.json({ ok: true });
  } catch (err) {
    logger.error(`[Webhook:Evolution] Erro ao processar: ${err.message}`);
    res.json({ ok: false });
  }
});

module.exports = router;

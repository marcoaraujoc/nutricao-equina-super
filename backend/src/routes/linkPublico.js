// backend/src/routes/linkPublico.js — montado em /api/l (rota curta e PÚBLICA)
//
// Redireciona para a página pública real (SPA, HashRouter — `/#/fatura/:token`).
// Existe SÓ porque links contendo um "#" logo após o domínio (`/#/fatura/xyz`)
// nem sempre são reconhecidos como hyperlink por clientes de mensagem/e-mail —
// o "#" inicia um FRAGMENTO de URL, e o detector de link de alguns desses
// clientes (principalmente em desktop) não considera o que vem depois dele como
// parte do link, ou não linkifica a URL inteira. Um caminho PLANO, sem "#",
// funciona em qualquer lugar.
//
// Este redirect NÃO valida o token — a página pública (lib/faturaLinkPublico.js,
// via GET /api/fatura-publica/:token/resumo) já faz a validação real (formato,
// expiração, revogação). Aqui é só o "empurrão" para a URL de verdade; um token
// inválido cai são e salvo na tela de erro de sempre.
'use strict';

const express = require('express');
const router = express.Router();

router.get('/:token', (req, res) => {
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const token  = String(req.params.token ?? '');
  res.redirect(302, `${appUrl}/#/fatura/${encodeURIComponent(token)}`);
});

module.exports = router;

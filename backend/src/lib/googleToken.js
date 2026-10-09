'use strict';

// Validação do access_token do "Entrar com Google" — FONTE ÚNICA.
//
// 🔴 POR QUE EXISTE (2026-10-08): o login aceitava QUALQUER access_token válido do
// Google. Ele só perguntava ao `/userinfo` "de quem é este token?" — e qualquer
// aplicativo com "Entrar com Google" recebe um token assim. O dono de um app qualquer
// (um quiz, uma extensão) entregava o token de quem entrou NELE ao
// `POST /api/auth/google` e abria sessão no S2Vet como aquela pessoa — sem senha e
// sem 2FA. É o ataque de "token substitution" / confused deputy do OAuth.
//
// A defesa é perguntar ao `/tokeninfo` PARA QUEM o token foi emitido (`aud`) e
// recusar o que não foi emitido para o Client ID do S2Vet.
//
// ⚠️ FAIL-CLOSED: sem `GOOGLE_CLIENT_ID` configurado o login com Google é RECUSADO.
// Aceitar "qualquer audiência" quando a variável falta reabriria exatamente o furo,
// e em silêncio. O boot avisa (`server.ts`).
// ⚠️ `GOOGLE_CLIENT_ID` aceita VÁRIOS IDs separados por vírgula — para a troca de
// cliente OAuth sem derrubar quem está com a tela antiga aberta. Em produção, um só.
// ⚠️ O ID tem de ser o MESMO do `VITE_GOOGLE_CLIENT_ID` do build da tela.

const https = require('https');

class GoogleTokenError extends Error {
  /** @param {string} message @param {'CONFIG'|'INVALIDO'|'AUDIENCIA'|'EMAIL_NAO_VERIFICADO'} code */
  constructor(message, code) {
    super(message);
    this.name = 'GoogleTokenError';
    this.code = code;
  }
}

/** IDs aceitos, lidos a cada chamada (troca de .env + reinício não exige mais nada). */
function clientIdsPermitidos() {
  return String(process.env.GOOGLE_CLIENT_ID || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Regra pura — decide se a resposta do `/tokeninfo` autoriza o login.
 * Devolve `{ email, sub }` ou lança `GoogleTokenError`.
 */
function validarTokenInfo(info, permitidos = clientIdsPermitidos()) {
  if (!permitidos.length) {
    throw new GoogleTokenError('GOOGLE_CLIENT_ID não configurado — login com Google desativado.', 'CONFIG');
  }
  if (!info || typeof info !== 'object' || info.error) {
    throw new GoogleTokenError('Token Google inválido ou expirado.', 'INVALIDO');
  }
  // Em access_token o Google devolve `aud` e `azp` iguais ao Client ID; `azp` é o
  // reserva para resposta sem `aud`. NUNCA aceitar quando os dois faltam.
  const audiencia = info.aud || info.azp;
  if (!audiencia || !permitidos.includes(audiencia)) {
    throw new GoogleTokenError('Token Google não foi emitido para este aplicativo.', 'AUDIENCIA');
  }
  if (Number(info.expires_in) <= 0) {
    throw new GoogleTokenError('Token Google inválido ou expirado.', 'INVALIDO');
  }
  // O /tokeninfo devolve o booleano como STRING ("true").
  if (!info.email || String(info.email_verified) !== 'true') {
    throw new GoogleTokenError('E-mail da conta Google não verificado.', 'EMAIL_NAO_VERIFICADO');
  }
  return { email: info.email, sub: info.sub };
}

function getJson(hostname, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Google: tempo esgotado')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Confere o access_token no Google e devolve `{ email, sub, nome }`.
 * O e-mail vem do `/tokeninfo` (já validado); o `/userinfo` só fornece o nome.
 */
async function verificarAccessTokenGoogle(accessToken) {
  const permitidos = clientIdsPermitidos();
  // Configuração antes da rede: sem ela não há o que perguntar ao Google.
  if (!permitidos.length) validarTokenInfo(null, permitidos);

  let info;
  try {
    info = await getJson('oauth2.googleapis.com',
      `/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  } catch {
    throw new GoogleTokenError('Token Google inválido ou expirado.', 'INVALIDO');
  }
  const { email, sub } = validarTokenInfo(info, permitidos);

  let nome;
  try {
    const perfil = await getJson('www.googleapis.com', '/oauth2/v3/userinfo',
      { Authorization: `Bearer ${accessToken}` });
    // Mesmo titular nos dois endpoints — o token é um só, mas a conferência é barata.
    if (perfil && perfil.sub === sub) nome = perfil.name;
  } catch { /* nome é opcional: a identidade já foi validada pelo /tokeninfo */ }

  return { email, sub, nome };
}

module.exports = { verificarAccessTokenGoogle, validarTokenInfo, clientIdsPermitidos, GoogleTokenError };

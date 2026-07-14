// backend/src/lib/authCookies.js
// Cookies HttpOnly de autenticação — o token de acesso e o refresh token deixam
// de trafegar/ficar armazenados no navegador de forma legível por JavaScript
// (defesa contra roubo de token via XSS). Usa res.cookie/res.clearCookie nativos
// do Express (não requer cookie-parser); a leitura parseia o header Cookie à mão.
'use strict';

const AT_COOKIE = 's2vet_at'; // access token  (JWT 24h)
const RT_COOKIE = 's2vet_rt'; // refresh token (JWT 30d)
// Dica de sessão legível por JS (NÃO-HttpOnly, sem segredo): apenas sinaliza ao
// front que existe uma sessão, para ele NÃO sondar /me e /refresh (evitando 401
// no console) quando o usuário nunca logou / fez logout. Vida = refresh (30d).
const HINT_COOKIE = 's2vet_auth';

const UM_DIA   = 24 * 60 * 60 * 1000;
const TRINTA_D = 30 * UM_DIA;

// secure em produção (HTTPS). Em dev pelo proxy do Vite/localhost, secure=false
// permite o cookie via http. COOKIE_SECURE força o valor quando necessário.
function isSecure() {
  if (process.env.COOKIE_SECURE === 'true')  return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function baseOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure:   isSecure(),
    path:     '/',
  };
}

function setAuthCookies(res, { accessToken, refreshToken }) {
  if (accessToken)  res.cookie(AT_COOKIE, accessToken,  { ...baseOpts(), maxAge: UM_DIA });
  if (refreshToken) res.cookie(RT_COOKIE, refreshToken, { ...baseOpts(), maxAge: TRINTA_D });
  // Dica legível por JS (httpOnly:false), sem token — front usa para decidir sondar a sessão
  res.cookie(HINT_COOKIE, '1', { ...baseOpts(), httpOnly: false, maxAge: TRINTA_D });
}

function clearAuthCookies(res) {
  const opts = baseOpts();
  res.clearCookie(AT_COOKIE, opts);
  res.clearCookie(RT_COOKIE, opts);
  res.clearCookie(HINT_COOKIE, { ...opts, httpOnly: false });
}

// Parser mínimo do header Cookie (evita dependência de cookie-parser)
function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function getAccessTokenFromCookie(req)  { return parseCookies(req)[AT_COOKIE] || null; }
function getRefreshTokenFromCookie(req) { return parseCookies(req)[RT_COOKIE] || null; }

module.exports = {
  AT_COOKIE, RT_COOKIE,
  setAuthCookies, clearAuthCookies,
  getAccessTokenFromCookie, getRefreshTokenFromCookie,
};

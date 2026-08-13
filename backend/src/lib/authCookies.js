// backend/src/lib/authCookies.js
// Cookies HttpOnly de autenticação — o token de acesso e o refresh token deixam
// de trafegar/ficar armazenados no navegador de forma legível por JavaScript
// (defesa contra roubo de token via XSS). Usa res.cookie/res.clearCookie nativos
// do Express (não requer cookie-parser); a leitura parseia o header Cookie à mão.
'use strict';

const { ACCESS_MAX_AGE_MS, REFRESH_MAX_AGE_MS } = require('./sessionTokens');

const AT_COOKIE = 's2vet_at'; // access token  (vida em sessionTokens.js)
const RT_COOKIE = 's2vet_rt'; // refresh token (janela de inatividade)
// Dica de sessão legível por JS (NÃO-HttpOnly, sem segredo): apenas sinaliza ao
// front que existe uma sessão, para ele NÃO sondar /me e /refresh (evitando 401
// no console) quando o usuário nunca logou / fez logout.
// Vida = a MESMA do refresh: com a dica sobrevivendo ao token, o front sondaria
// /me e /refresh de uma sessão já morta — 401 no console, justo o que ela evita.
const HINT_COOKIE = 's2vet_auth';

// Contexto ativo (empresa/equipe) do último request AUTENTICADO que trouxe os headers
// x-empresa-id/x-equipe-id (só o axios envia esses headers — ver CLAUDE.md armadilha
// 36-g). Requisições de ASSET sem XHR (<img src>, <video>, <link>) NUNCA carregam
// headers customizados, só cookies — então, sem isto, `authenticate` cai no fallback
// de "própria empresa"/"equipe mais recente", que diverge do contexto realmente ativo
// para qualquer usuário com mais de uma empresa/equipe. Sob RLS fail-closed, esse
// desvio faz `verificarAcessoAnimal` (e a checagem de dono da mídia) recusar o acesso
// — sintoma: foto do animal e logo da empresa não carregam para quem tem mais de um
// vínculo, mesmo sendo o vínculo certo. HttpOnly: só o servidor precisa ler.
const CTX_EMPRESA_COOKIE = 's2vet_ctx_empresa';
const CTX_EQUIPE_COOKIE  = 's2vet_ctx_equipe';

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
  if (accessToken)  res.cookie(AT_COOKIE, accessToken,  { ...baseOpts(), maxAge: ACCESS_MAX_AGE_MS });
  if (refreshToken) res.cookie(RT_COOKIE, refreshToken, { ...baseOpts(), maxAge: REFRESH_MAX_AGE_MS });
  // Dica legível por JS (httpOnly:false), sem token — front usa para decidir sondar a sessão
  res.cookie(HINT_COOKIE, '1', { ...baseOpts(), httpOnly: false, maxAge: REFRESH_MAX_AGE_MS });
}

function clearAuthCookies(res) {
  const opts = baseOpts();
  res.clearCookie(AT_COOKIE, opts);
  res.clearCookie(RT_COOKIE, opts);
  res.clearCookie(HINT_COOKIE, { ...opts, httpOnly: false });
  res.clearCookie(CTX_EMPRESA_COOKIE, opts);
  res.clearCookie(CTX_EQUIPE_COOKIE, opts);
}

// Grava o contexto ativo (chamado por `authenticate` sempre que os headers de
// contexto vierem presentes e validados) — vida igual ao refresh: o cookie precisa
// sobreviver tempo o bastante para servir os <img>/<video> que a página carrega
// bem depois do XHR que trouxe o header.
function setContextCookies(res, empresaId, equipeId) {
  const opts = { ...baseOpts(), maxAge: REFRESH_MAX_AGE_MS };
  if (empresaId) res.cookie(CTX_EMPRESA_COOKIE, String(empresaId), opts);
  else res.clearCookie(CTX_EMPRESA_COOKIE, baseOpts());
  if (equipeId) res.cookie(CTX_EQUIPE_COOKIE, String(equipeId), opts);
  else res.clearCookie(CTX_EQUIPE_COOKIE, baseOpts());
}

// Lê o contexto ativo gravado por `setContextCookies`. NÃO é fonte de verdade —
// quem chama ainda precisa validar o vínculo (mesma regra dos headers), pois é
// um cookie e pode estar desatualizado (ex.: removido da equipe depois de gravado).
function getContextCookies(req) {
  const c = parseCookies(req);
  const empresaId = Number(c[CTX_EMPRESA_COOKIE]);
  const equipeId  = Number(c[CTX_EQUIPE_COOKIE]);
  return {
    empresaId: Number.isInteger(empresaId) && empresaId > 0 ? empresaId : null,
    equipeId:  Number.isInteger(equipeId)  && equipeId  > 0 ? equipeId  : null,
  };
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
  setContextCookies, getContextCookies,
};

// backend/src/lib/sessionTokens.js
// Fonte ÚNICA da duração da sessão e da assinatura dos tokens.
//
// POR QUÊ: o access token era assinado em 4 lugares (`AuthController.refreshToken`,
// `auth/UserController.emitirSessao`, `GoogleController`, `UserController.updateMe`)
// e o refresh em 3 — todos com literais '24h'/'30d'. O refresh de 30 DIAS era o que
// mantinha o usuário dentro no dia seguinte: o access até expirava, mas o
// interceptor do axios renovava tudo em silêncio pelo cookie que sobreviveu à noite.
//
// MODELO: janela de INATIVIDADE, não prazo absoluto.
//   - access  (curto)  → expira sozinho; o 401 dispara o refresh silencioso
//   - refresh (janela) → rotacionado a CADA refresh, então quem está trabalhando
//                        nunca é interrompido; parado além da janela, a sessão morre
//                        e o próximo acesso exige login.
// O access PRECISA ser menor que a janela: fossem iguais, os dois expirariam no
// mesmo instante e o refresh nunca teria como renovar nada (logout duro a cada
// janela, no meio do atendimento).
'use strict';

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

const SECRET         = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (SECRET + '_refresh');

function minutosDoEnv(nome, padrao) {
  const bruto = Number(process.env[nome]);
  if (!Number.isFinite(bruto) || bruto <= 0) return padrao;
  return Math.floor(bruto);
}

// Janela de inatividade da sessão (minutos). Padrão 120 = 2h.
const IDLE_MINUTES   = minutosDoEnv('SESSION_IDLE_MINUTES', 120);
// Vida do access token (minutos). Padrão 30 — sempre menor que a janela.
const ACCESS_MINUTES = Math.min(minutosDoEnv('SESSION_ACCESS_MINUTES', 30), IDLE_MINUTES);

const ACCESS_MAX_AGE_MS  = ACCESS_MINUTES * 60 * 1000;
const REFRESH_MAX_AGE_MS = IDLE_MINUTES   * 60 * 1000;

/**
 * Assina o access token com o payload padrão da sessão.
 * `sessionVersion` carimba de QUAL geração de login este token nasceu — é o que
 * permite `authenticate` derrubar na hora um dispositivo antigo quando a pessoa
 * loga de novo em outro (ver `User.sessionVersion`). Passar `user` sem o campo
 * (ex.: objeto montado à mão) assina `undefined`, que NUNCA bate com o valor do
 * banco (sempre um inteiro) — o token nasceria já inválido, então todo caller
 * precisa vir de uma leitura real do usuário.
 */
function assinarAccessToken(user) {
  return jwt.sign(
    {
      id:                 user.id,
      email:              user.email,
      role:               user.role,
      fullName:           user.fullName,
      userType:           user.userType,
      mustChangePassword: user.mustChangePassword,
      sessionVersion:     user.sessionVersion,
    },
    SECRET,
    { expiresIn: `${ACCESS_MINUTES}m` }
  );
}

/**
 * Refresh token assinado (JWT). Continua salvo no banco para permitir rotação e
 * revogação (logout / troca de senha). O jti aleatório garante unicidade mesmo
 * para o mesmo usuário em momentos diferentes.
 */
function gerarRefreshToken(userId) {
  return jwt.sign(
    { id: userId, type: 'refresh', jti: crypto.randomBytes(16).toString('hex') },
    REFRESH_SECRET,
    { expiresIn: `${IDLE_MINUTES}m` }
  );
}

module.exports = {
  SECRET,
  REFRESH_SECRET,
  ACCESS_MINUTES,
  IDLE_MINUTES,
  ACCESS_MAX_AGE_MS,
  REFRESH_MAX_AGE_MS,
  assinarAccessToken,
  gerarRefreshToken,
};

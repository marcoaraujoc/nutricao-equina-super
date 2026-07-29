// backend/src/services/mfaService.js
// 2FA POR E-MAIL — segundo fator do login com senha.
//
// Fluxo: senha correta → NÃO emite cookie; cria um desafio, envia o código por
// e-mail e devolve { mfaRequerido, desafioId }. A sessão só nasce depois de
// POST /auth/2fa/verificar com o código certo.
//
// Decisões de segurança:
// - O código NUNCA é persistido em claro (SHA-256). Comparação em tempo constante.
// - Código de 6 dígitos gerado com crypto.randomInt (CSPRNG), não Math.random.
// - Expira em 10 min, 5 tentativas, 3 reenvios — depois disso o desafio morre e
//   o usuário refaz o login.
// - O desafioId é opaco (32 bytes) e NÃO revela o usuário.
// - Nunca dizemos "código errado" vs "desafio inválido" de forma que permita
//   enumerar: as duas respostas são 401 com a mesma mensagem genérica.
'use strict';

const crypto = require('crypto');
const prisma = require('../lib/prisma').default;
const emailService = require('./emailService');

const VALIDADE_MIN     = 10;
const MAX_TENTATIVAS   = 5;
const MAX_REENVIOS     = 3;
const TAMANHO_CODIGO   = 6;

// ── Chave mestra global ───────────────────────────────────────────────────────
// Ordem de resolução:
//   1. MFA_EMAIL_ENABLED=false no .env → OFF (kill-switch de emergência, vence tudo)
//   2. ConfiguracaoSeguranca.mfaEmailAtivo → chave do ADMIN (tela de Configurações)
//   3. User.mfaAtivo → exceção por usuário
//
// Cache curto: o login não pode pagar um SELECT por tentativa, mas ligar/desligar
// pela tela precisa valer rápido. `invalidarCacheGlobal()` zera na hora ao salvar.
const CACHE_MS = 30_000;
let cacheValor = null;
let cacheAte   = 0;

function invalidarCacheGlobal() {
  cacheValor = null;
  cacheAte   = 0;
}

/** Estado global do 2FA (env + banco). */
async function mfaHabilitadoGlobalmente() {
  // Kill-switch explícito: nem consulta o banco.
  if (process.env.MFA_EMAIL_ENABLED === 'false') return false;

  const agora = Date.now();
  if (cacheValor !== null && agora < cacheAte) return cacheValor;

  try {
    const cfg = await prisma.configuracaoSeguranca.findUnique({ where: { id: 1 } });
    // Sem linha = ainda não configurado → 2FA DESLIGADO (default seguro contra
    // trancar a base inteira fora por causa de um registro faltando).
    cacheValor = cfg?.mfaEmailAtivo === true;
  } catch (err) {
    // Banco indisponível não pode virar lockout nem liberação silenciosa do fator:
    // mantém o último valor conhecido; sem valor conhecido, fica desligado.
    console.error('[mfaService] Falha ao ler configuração de segurança:', err.message);
    return cacheValor ?? false;
  }

  cacheAte = agora + CACHE_MS;
  return cacheValor;
}

/** 2FA vale para este usuário? (global ligado + flag do usuário) */
async function exigeMfa(user) {
  if (user?.mfaAtivo === false) return false;
  return mfaHabilitadoGlobalmente();
}

/** Lê a configuração global (cria a linha única se ainda não existir). */
async function obterConfigSeguranca() {
  const cfg = await prisma.configuracaoSeguranca.upsert({
    where:  { id: 1 },
    create: { id: 1, mfaEmailAtivo: false },
    update: {},
    include: { atualizadoPor: { select: { id: true, fullName: true } } },
  });
  return {
    mfaEmailAtivo:   cfg.mfaEmailAtivo,
    atualizadoEm:    cfg.updatedAt,
    atualizadoPor:   cfg.atualizadoPor?.fullName ?? null,
    // Quando o kill-switch está ligado, a tela precisa avisar que o toggle não manda.
    bloqueadoPorEnv: process.env.MFA_EMAIL_ENABLED === 'false',
  };
}

/** Liga/desliga o 2FA para toda a plataforma (ADMIN). */
async function salvarConfigSeguranca({ mfaEmailAtivo, atualizadoPorId }) {
  await prisma.configuracaoSeguranca.upsert({
    where:  { id: 1 },
    create: { id: 1, mfaEmailAtivo: Boolean(mfaEmailAtivo), atualizadoPorId: atualizadoPorId ?? null },
    update: { mfaEmailAtivo: Boolean(mfaEmailAtivo), atualizadoPorId: atualizadoPorId ?? null },
  });
  invalidarCacheGlobal();
  return obterConfigSeguranca();
}

function gerarCodigo() {
  // randomInt é CSPRNG — Math.random é previsível e não serve para OTP.
  return String(crypto.randomInt(0, 10 ** TAMANHO_CODIGO)).padStart(TAMANHO_CODIGO, '0');
}

const hashCodigo = (codigo) => crypto.createHash('sha256').update(String(codigo)).digest('hex');

/** Comparação em tempo constante — evita timing attack no código. */
function hashConfere(hashArmazenado, codigoInformado) {
  const a = Buffer.from(hashArmazenado, 'utf8');
  const b = Buffer.from(hashCodigo(codigoInformado), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** l***o@dominio.com — confirma o destino sem expor o e-mail inteiro. */
function mascararEmail(email) {
  const [local, dominio] = String(email ?? '').split('@');
  if (!dominio) return '';
  const visivel = local.length <= 2
    ? local[0] ?? ''
    : `${local[0]}${'*'.repeat(Math.min(local.length - 2, 4))}${local[local.length - 1]}`;
  return `${visivel}@${dominio}`;
}

function ipDoRequest(req) {
  const ip = req?.ip ?? req?.socket?.remoteAddress ?? null;
  return ip ? String(ip).replace(/^::ffff:/, '').slice(0, 64) : null;
}

/**
 * Cria o desafio e envia o código por e-mail.
 * Lança se o e-mail não puder ser enviado — não podemos abrir sessão sem o fator.
 *
 * @returns {Promise<{ desafioId: string, emailMascarado: string, expiraEm: Date }>}
 */
async function criarDesafio(user, req) {
  const codigo   = gerarCodigo();
  const expiraEm = new Date(Date.now() + VALIDADE_MIN * 60_000);
  const id       = crypto.randomBytes(32).toString('hex');

  // Invalida desafios anteriores do usuário: só o último código vale.
  await prisma.mfaDesafio.updateMany({
    where: { userId: user.id, consumido: false },
    data:  { consumido: true },
  });

  await prisma.mfaDesafio.create({
    data: { id, userId: user.id, codigoHash: hashCodigo(codigo), expiraEm, ip: ipDoRequest(req) },
  });

  await emailService.enviarCodigoMfa({
    email:        user.email,
    nome:         user.fullName,
    codigo,
    validadeMin:  VALIDADE_MIN,
    ip:           ipDoRequest(req),
  });

  return { desafioId: id, emailMascarado: mascararEmail(user.email), expiraEm };
}

/**
 * Valida o código. Consome o desafio no acerto.
 *
 * @returns {Promise<{ ok: true, userId: number } | { ok: false, motivo: string }>}
 */
async function validarCodigo(desafioId, codigo) {
  if (!desafioId || !codigo) return { ok: false, motivo: 'DADOS_INVALIDOS' };

  const desafio = await prisma.mfaDesafio.findUnique({ where: { id: String(desafioId) } });

  if (!desafio || desafio.consumido)           return { ok: false, motivo: 'DESAFIO_INVALIDO' };
  if (desafio.expiraEm < new Date())           return { ok: false, motivo: 'EXPIRADO' };
  if (desafio.tentativas >= MAX_TENTATIVAS) {
    await prisma.mfaDesafio.update({ where: { id: desafio.id }, data: { consumido: true } });
    return { ok: false, motivo: 'TENTATIVAS_EXCEDIDAS' };
  }

  if (!hashConfere(desafio.codigoHash, String(codigo).trim())) {
    const tentativas = desafio.tentativas + 1;
    await prisma.mfaDesafio.update({ where: { id: desafio.id }, data: { tentativas } });
    return { ok: false, motivo: 'CODIGO_INCORRETO', restantes: Math.max(MAX_TENTATIVAS - tentativas, 0) };
  }

  await prisma.mfaDesafio.update({ where: { id: desafio.id }, data: { consumido: true } });
  return { ok: true, userId: desafio.userId };
}

/**
 * Reenvia o código de um desafio ainda válido (gera um NOVO código).
 * @returns {Promise<{ ok: true, emailMascarado: string } | { ok: false, motivo: string }>}
 */
async function reenviarCodigo(desafioId, req) {
  const desafio = await prisma.mfaDesafio.findUnique({
    where:   { id: String(desafioId ?? '') },
    include: { user: { select: { id: true, email: true, fullName: true, ativo: true } } },
  });

  if (!desafio || desafio.consumido)   return { ok: false, motivo: 'DESAFIO_INVALIDO' };
  if (desafio.expiraEm < new Date())   return { ok: false, motivo: 'EXPIRADO' };
  if (desafio.reenvios >= MAX_REENVIOS) return { ok: false, motivo: 'REENVIOS_EXCEDIDOS' };
  if (!desafio.user || desafio.user.ativo === false) return { ok: false, motivo: 'DESAFIO_INVALIDO' };

  const codigo = gerarCodigo();
  // Reenviar renova o código E a janela — as tentativas gastas continuam contando.
  await prisma.mfaDesafio.update({
    where: { id: desafio.id },
    data: {
      codigoHash: hashCodigo(codigo),
      expiraEm:   new Date(Date.now() + VALIDADE_MIN * 60_000),
      reenvios:   desafio.reenvios + 1,
    },
  });

  await emailService.enviarCodigoMfa({
    email:       desafio.user.email,
    nome:        desafio.user.fullName,
    codigo,
    validadeMin: VALIDADE_MIN,
    ip:          ipDoRequest(req),
  });

  return { ok: true, emailMascarado: mascararEmail(desafio.user.email) };
}

/** Higiene da tabela — remove desafios vencidos/consumidos antigos. */
async function limparDesafiosAntigos() {
  const limite = new Date(Date.now() - 24 * 60 * 60_000);
  const r = await prisma.mfaDesafio.deleteMany({
    where: { OR: [{ expiraEm: { lt: limite } }, { consumido: true, createdAt: { lt: limite } }] },
  });
  return r.count;
}

module.exports = {
  exigeMfa,
  mfaHabilitadoGlobalmente,
  obterConfigSeguranca,
  salvarConfigSeguranca,
  invalidarCacheGlobal,
  criarDesafio,
  validarCodigo,
  reenviarCodigo,
  limparDesafiosAntigos,
  mascararEmail,
  VALIDADE_MIN,
  MAX_TENTATIVAS,
  MAX_REENVIOS,
};

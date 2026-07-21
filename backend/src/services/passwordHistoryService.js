// backend/src/services/passwordHistoryService.js
// Impede reuso de senha: a nova senha não pode repetir nenhuma das últimas 6 —
// a senha atual (User.passwordHash) + as últimas 5 em PasswordHistory.
'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma').default;

const TAMANHO_HISTORICO = 5; // + a senha atual = 6 senhas lembradas
const MENSAGEM_REUSO = 'A nova senha não pode ser igual a nenhuma das últimas 6 senhas utilizadas.';

/**
 * Verifica se `novaSenhaPlain` repete a senha atual ou alguma das últimas
 * TAMANHO_HISTORICO senhas do usuário.
 * @param {number} userId
 * @param {string} novaSenhaPlain
 * @param {string|null|undefined} passwordHashAtual - User.passwordHash antes da troca
 */
async function senhaReutilizada(userId, novaSenhaPlain, passwordHashAtual) {
  if (passwordHashAtual && await bcrypt.compare(novaSenhaPlain, passwordHashAtual)) {
    return true;
  }
  const historico = await prisma.passwordHistory.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
    take:    TAMANHO_HISTORICO,
    select:  { passwordHash: true },
  });
  for (const item of historico) {
    if (await bcrypt.compare(novaSenhaPlain, item.passwordHash)) return true;
  }
  return false;
}

/**
 * Registra a troca: guarda o hash ANTIGO (que está sendo substituído) no histórico
 * e poda entradas além de TAMANHO_HISTORICO. Chamar sempre que User.passwordHash for
 * atualizado por escolha do usuário/admin (não para a senha inicial de criação, que
 * ainda não tem "antiga" para guardar).
 * @param {string|null|undefined} passwordHashAntigo
 */
async function registrarTrocaSenha(userId, passwordHashAntigo) {
  if (!passwordHashAntigo) return;
  await prisma.passwordHistory.create({ data: { userId, passwordHash: passwordHashAntigo } });
  const excedentes = await prisma.passwordHistory.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
    skip:    TAMANHO_HISTORICO,
    select:  { id: true },
  });
  if (excedentes.length > 0) {
    await prisma.passwordHistory.deleteMany({ where: { id: { in: excedentes.map(e => e.id) } } });
  }
}

module.exports = { senhaReutilizada, registrarTrocaSenha, MENSAGEM_REUSO, TAMANHO_HISTORICO };

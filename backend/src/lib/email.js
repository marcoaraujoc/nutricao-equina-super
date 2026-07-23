// backend/src/lib/email.js
// Tratamento uniforme de e-mail: SEMPRE armazenar/comparar em minúsculas (case-insensitive).
// Use normalizeEmail() em TODO ponto que grava um e-mail (User, Fornecedor, convites) e
// whereEmailInsensitive()/findUserByEmail() em TODO ponto que busca por e-mail — assim
// "Karina@gmail.com" e "karina@gmail.com" são a mesma pessoa.
'use strict';

// trim + lowercase. Vazio → null (mantém colunas nullable como null).
function normalizeEmail(email) {
  if (email == null) return null;
  const e = String(email).trim().toLowerCase();
  return e === '' ? null : e;
}

// Cláusula Prisma para busca case-insensitive por e-mail (para findFirst/findMany).
// findUnique NÃO aceita `mode`, então lookups por e-mail devem usar findFirst.
function whereEmailInsensitive(email) {
  return { email: { equals: normalizeEmail(email) ?? '', mode: 'insensitive' } };
}

// Busca um usuário por e-mail de forma case-insensitive (substitui findUnique({where:{email}})).
function findUserByEmail(prisma, email, args = {}) {
  return prisma.user.findFirst({ where: whereEmailInsensitive(email), ...args });
}

module.exports = { normalizeEmail, whereEmailInsensitive, findUserByEmail };

'use strict';

const prisma = require('../lib/prisma').default;

/**
 * Injeta req.empresaId a partir da equipe ativa do usuário autenticado.
 * Deve ser usado APÓS authenticate. Não bloqueia — apenas enriquece o contexto.
 * O enforcement real (filtrar queries por empresaId) é responsabilidade do service/repository.
 */
const injectTenant = async (req, res, next) => {
  if (!req.user?.id) return next();

  try {
    const membro = await prisma.membroEquipe.findFirst({
      where:   { userId: req.user.id, ativo: true },
      include: { equipe: { select: { empresaId: true } } },
      orderBy: { createdAt: 'desc' },
    });
    req.empresaId = membro?.equipe?.empresaId ?? null;
    next();
  } catch (err) {
    // falha silenciosa — não bloqueia a requisição
    req.empresaId = null;
    next();
  }
};

module.exports = { injectTenant };
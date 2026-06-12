'use strict';

const prisma = require('./prisma').default;

/**
 * Retorna o empresaId do vet:
 * 1. Via MembroEquipe → Equipe.empresaId
 * 2. Fallback: Empresa.ownerId (vet criou empresa mas não tem membroEquipe registrado)
 */
async function getEmpresaIdDoVet(vetUserId) {
  const { empresaId } = await getContextoDoVet(vetUserId);
  return empresaId;
}

/**
 * Resolve o contexto { empresaId, equipeId } do vet para vincular a um animal.
 * Prioridade:
 * 1. reqEquipeId (header x-equipe-id, já validado em auth.js) → define ambos
 * 2. reqEmpresaId (header x-empresa-id) → equipe do vet dentro dela (mais antiga)
 * 3. MembroEquipe mais recente do vet
 * 4. Empresa.ownerId (vet dono sem MembroEquipe) → primeira equipe da empresa
 * equipeId pode ser null (vet dono sem equipes) — caller deve tratar.
 */
async function getContextoDoVet(vetUserId, reqEmpresaId = null, reqEquipeId = null) {
  const id = Number(vetUserId);

  if (reqEquipeId) {
    const equipe = await prisma.equipe.findUnique({
      where:  { id: Number(reqEquipeId) },
      select: { id: true, empresaId: true },
    });
    if (equipe) return { empresaId: equipe.empresaId, equipeId: equipe.id };
  }

  if (reqEmpresaId) {
    const membroNaEmpresa = await prisma.membroEquipe.findFirst({
      where:   { userId: id, equipe: { empresaId: Number(reqEmpresaId) } },
      select:  { equipeId: true },
      orderBy: { createdAt: 'asc' },
    });
    return { empresaId: Number(reqEmpresaId), equipeId: membroNaEmpresa?.equipeId ?? null };
  }

  const membro = await prisma.membroEquipe.findFirst({
    where:   { userId: id },
    include: { equipe: { select: { id: true, empresaId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  if (membro?.equipe?.empresaId) {
    return { empresaId: membro.equipe.empresaId, equipeId: membro.equipe.id };
  }

  const empresa = await prisma.empresa.findFirst({ where: { ownerId: id } });
  if (!empresa) return { empresaId: null, equipeId: null };

  const equipe = await prisma.equipe.findFirst({
    where:   { empresaId: empresa.id },
    select:  { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return { empresaId: empresa.id, equipeId: equipe?.id ?? null };
}

/**
 * Escopo de equipes do usuário dentro da empresa ativa, para filtrar animais.
 * - reqEquipeId (header x-equipe-id, validado em auth.js) → só aquela equipe
 * - senão → todas as equipes em que o usuário é membro dentro da empresa
 * - retorna null = sem restrição por equipe (ex.: dono da empresa sem MembroEquipe)
 */
async function getEquipeScopeDoUsuario(userId, empresaId, reqEquipeId = null) {
  if (reqEquipeId) return [Number(reqEquipeId)];
  if (!empresaId) return null;

  const membros = await prisma.membroEquipe.findMany({
    where:  { userId: Number(userId), equipe: { empresaId: Number(empresaId) } },
    select: { equipeId: true },
  });
  return membros.length > 0 ? membros.map(m => m.equipeId) : null;
}

module.exports = { getEmpresaIdDoVet, getContextoDoVet, getEquipeScopeDoUsuario };
// src/lib/animalAccess.js
// Verificação centralizada de acesso a animal por usuário.
// Usada por EvolucaoController, PrescricaoController e AnimalController.

const prisma = require('./prisma').default;

/**
 * Verifica se o usuário tem acesso a um animal específico.
 *
 * Regras:
 *  - ADMIN (role='ADMIN' e userType!='PROPRIETARIO'): acesso total
 *  - PROPRIETARIO: somente animais cujo userId === o seu
 *  - VETERINARIO / ESTAGIARIO:
 *      1. É dono do animal (userId === userId)
 *      2. Animal pertence à empresa da equipe do usuário (empresaId)
 *      3. (só VETERINARIO) tem VetAnimalSolicitacao ACEITO/PENDENTE com o animal
 *
 * Retorna:
 *   true  → acesso autorizado
 *   false → acesso negado  → caller retorna 403
 *   null  → animal não encontrado → caller retorna 404
 */
async function verificarAcessoAnimal({ animalId, userId, empresaId = null }) {
  const u = await prisma.user.findUnique({
    where:  { id: Number(userId) },
    select: { userType: true, role: true },
  });
  const userType = u?.userType ?? 'PROPRIETARIO';
  const role     = u?.role     ?? 'USER';

  if (role === 'ADMIN' && userType !== 'PROPRIETARIO') return true;

  const animal = await prisma.animal.findUnique({
    where:  { id: Number(animalId) },
    select: { userId: true, empresaId: true },
  });

  if (!animal) return null;

  if (userType === 'PROPRIETARIO') {
    return animal.userId === Number(userId);
  }

  if (animal.userId === Number(userId)) return true;

  if (empresaId && animal.empresaId === Number(empresaId)) return true;

  if (userType === 'VETERINARIO') {
    const solicitacao = await prisma.vetAnimalSolicitacao.findFirst({
      where: {
        animalId:  Number(animalId),
        vetUserId: Number(userId),
        OR: [
          { tipo: 'VINCULO',    status: 'ACEITO'   },
          { tipo: 'DESVINCULO', status: 'PENDENTE' },
          { tipo: 'TROCA_VET',  status: 'PENDENTE' },
        ],
      },
    });
    return !!solicitacao;
  }

  return false;
}

module.exports = { verificarAcessoAnimal };

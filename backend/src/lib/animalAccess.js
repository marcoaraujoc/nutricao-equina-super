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
 *      2. Animal pertence à empresa do usuário (empresaId) E à equipe do contexto:
 *         - animal sem equipeId (legado) → empresa inteira
 *         - com x-equipe-id (equipeId): a equipe do animal deve bater
 *         - sem contexto explícito: membro da equipe do animal OU dono da empresa
 *      3. (só VETERINARIO) tem VetAnimalSolicitacao ACEITO/PENDENTE com o animal
 *         (vínculo direto sempre garante acesso ao próprio paciente)
 *
 * Retorna:
 *   true  → acesso autorizado
 *   false → acesso negado  → caller retorna 403
 *   null  → animal não encontrado → caller retorna 404
 */
async function verificarAcessoAnimal({ animalId, userId, empresaId = null, equipeId = null }) {
  const u = await prisma.user.findUnique({
    where:  { id: Number(userId) },
    select: { userType: true, role: true },
  });
  const userType = u?.userType ?? 'PROPRIETARIO';
  const role     = u?.role     ?? 'USER';

  if (role === 'ADMIN' && userType !== 'PROPRIETARIO') return true;

  const animal = await prisma.animal.findUnique({
    where:  { id: Number(animalId) },
    select: { userId: true, empresaId: true, equipeId: true },
  });

  if (!animal) return null;

  if (userType === 'PROPRIETARIO') {
    return animal.userId === Number(userId);
  }

  if (animal.userId === Number(userId)) return true;

  // FORNECEDOR (prestador): NUNCA herda o escopo da equipe — acesso somente a
  // animais com designação ativa (DesignacaoPrestador), e dentro da validade.
  if (userType === 'FORNECEDOR') {
    const designacao = await prisma.designacaoPrestador.findFirst({
      where: {
        animalId:    Number(animalId),
        prestadorId: Number(userId),
        ativo:       true,
        OR: [{ dataFim: null }, { dataFim: { gte: new Date() } }],
      },
      select: { id: true },
    });
    return !!designacao;
  }

  if (empresaId && animal.empresaId === Number(empresaId)) {
    // Animal legado sem equipe → escopo da empresa inteira
    if (!animal.equipeId) return true;

    if (equipeId) {
      // Contexto ativo explícito: equipe do animal deve bater
      if (animal.equipeId === Number(equipeId)) return true;
    } else {
      // Sem contexto: membro da equipe do animal OU dono da empresa
      const membro = await prisma.membroEquipe.findFirst({
        where:  { userId: Number(userId), equipeId: animal.equipeId },
        select: { id: true },
      });
      if (membro) return true;

      const dono = await prisma.empresa.findFirst({
        where:  { id: Number(empresaId), ownerId: Number(userId) },
        select: { id: true },
      });
      if (dono) return true;
    }
    // Mesma empresa, outra equipe → só com vínculo direto (check abaixo, vets)
  }

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

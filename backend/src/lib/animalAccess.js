// src/lib/animalAccess.js
// Verificação centralizada de acesso a animal por usuário.
// Usada por EvolucaoController, PrescricaoController e AnimalController.

const prisma = require('./prisma').default;
const { resolverTipoNoContexto } = require('./tipoContexto');

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
 *  - FORNECEDOR (prestador): só com DesignacaoPrestador ativa — nunca herda a equipe
 *
 * ⚠️ NÃO EXISTE MAIS acesso por VÍNCULO (`VetAnimalSolicitacao`). Fase 3 do
 * multi-tenancy: o paciente é da EMPRESA, e é só isso que decide. Não reintroduzir um
 * caminho "meu paciente independente de empresa" — era ele que deixava abrir pela URL o
 * animal de outra clínica.
 *
 * Retorna:
 *   true  → acesso autorizado
 *   false → acesso negado  → caller retorna 403
 *   null  → animal não encontrado → caller retorna 404
 */
async function verificarAcessoAnimal({ animalId, userId, empresaId = null, equipeId = null, userType: userTypeCtx = null }) {
  const u = await prisma.user.findUnique({
    where:  { id: Number(userId) },
    select: { userType: true, role: true },
  });
  const role = u?.role ?? 'USER';

  // TIPO POR EMPRESA (armadilha 36-e): o que decide o acesso é o tipo no CONTEXTO
  // ATIVO, não o `users.userType` global. O caller pode passar `userType` (o
  // `req.user.userType` que o authenticate já resolveu); sem ele, resolvemos aqui
  // com os mesmos empresaId/equipeId que a função já recebe.
  //
  // Era o bug de 2026-07-30: profissional com `users.userType = PROPRIETARIO` e cargo
  // VETERINARIO na empresa caía no ramo de proprietário — `animal.userId === userId` —
  // e levava 403 em TODO paciente que não fosse dela. A listagem mostrava os animais
  // (lib/animalScope), mas abrir qualquer um dava 403, e junto caíam histórico,
  // evoluções, prescrições e agendamentos daquele animal.
  const userType = userTypeCtx
    ?? (await resolverTipoNoContexto({
      userId, userType: u?.userType ?? null, role, empresaId, equipeId,
    })).tipo;

  if (role === 'ADMIN' && userType !== 'PROPRIETARIO') return true;

  const animal = await prisma.animal.findUnique({
    where:  { id: Number(animalId) },
    select: { userId: true, empresaId: true, equipeId: true },
  });

  console.error('[DEBUG-RLS] verificarAcessoAnimal', {
    animalId, userId, empresaIdParam: empresaId, equipeIdParam: equipeId,
    userType, animalEncontrado: animal,
  });

  if (!animal) return null;

  if (userType === 'PROPRIETARIO') {
    return animal.userId === Number(userId);
  }

  if (animal.userId === Number(userId)) return true;

  // Escopa a designação ao CONTEXTO ATIVO (mesmo critério de AnimalController.listar):
  // o prestador só acessa o animal quando o contexto selecionado é a equipe/empresa
  // que o designou — a designação de outro contexto NÃO concede acesso aqui.
  const escopoDesignacao = equipeId
    ? { equipeId: Number(equipeId) }
    : (empresaId ? { equipe: { empresaId: Number(empresaId) } } : {});

  // FORNECEDOR (prestador): NUNCA herda o escopo da equipe — acesso somente a
  // animais com designação ativa (DesignacaoPrestador), e dentro da validade.
  // Exceção: fornecedor que também é GESTOR no contexto ativo (assinante com
  // empresa própria) opera como gestor — cai nas regras de empresa/equipe abaixo.
  if (userType === 'FORNECEDOR') {
    const gestorNoContexto = equipeId
      ? await prisma.membroEquipe.findFirst({
          where:  { userId: Number(userId), equipeId: Number(equipeId), cargo: 'GESTOR' },
          select: { id: true },
        })
      : empresaId
        ? await prisma.membroEquipe.findFirst({
            where:  { userId: Number(userId), cargo: 'GESTOR', equipe: { empresaId: Number(empresaId) } },
            select: { id: true },
          })
        : null;
    const donoDaEmpresaAtiva = !gestorNoContexto && empresaId
      ? await prisma.empresa.findFirst({
          where:  { id: Number(empresaId), ownerId: Number(userId) },
          select: { id: true },
        })
      : null;

    if (!gestorNoContexto && !donoDaEmpresaAtiva) {
      const designacao = await prisma.designacaoPrestador.findFirst({
        where: {
          animalId:    Number(animalId),
          prestadorId: Number(userId),
          ativo:       true,
          OR: [{ dataFim: null }, { dataFim: { gte: new Date() } }],
          ...escopoDesignacao,
        },
        select: { id: true },
      });
      return !!designacao;
    }
  }

  // Espelho do prestador: VETERINARIO que atua como PRESTADOR no contexto ativo
  // (cargo FORNECEDOR na equipe ativa) NÃO herda o escopo da equipe — acesso por
  // designação ativa ou pelos próprios pacientes (vínculo direto, checado abaixo).
  let vetPrestadorNoContexto = false;
  if (userType === 'VETERINARIO' && equipeId) {
    const membroCtx = await prisma.membroEquipe.findFirst({
      where:  { userId: Number(userId), equipeId: Number(equipeId) },
      select: { cargo: true },
    });
    if (membroCtx?.cargo === 'FORNECEDOR') {
      vetPrestadorNoContexto = true;
      const designacaoVet = await prisma.designacaoPrestador.findFirst({
        where: {
          animalId:    Number(animalId),
          prestadorId: Number(userId),
          ativo:       true,
          OR: [{ dataFim: null }, { dataFim: { gte: new Date() } }],
          ...escopoDesignacao,
        },
        select: { id: true },
      });
      if (designacaoVet) return true;
    }
  }

  // ── O ANIMAL É DESTA EMPRESA? ──────────────────────────────────────────────
  //
  // Fase 3 do multi-tenancy: acabaram os vínculos e aprovações entre veterinário,
  // proprietário e empresa. O acesso ao paciente deixou de ser "existe um
  // `VetAnimalSolicitacao` aceito?" e passou a ser esta pergunta única.
  //
  // ⚠️ O que FOI REMOVIDO daqui, e por que não volta: havia um ramo final que liberava o
  // animal para o VETERINARIO com vínculo direto, INDEPENDENTE de empresa. Ele era a
  // origem do buraco documentado no CLAUDE.md — o animal de outra clínica não aparecia na
  // listagem mas ABRIA pela URL, levando junto histórico, evoluções, prescrições e agenda.
  // Com o vínculo extinto, existe uma regra só, e ela é a mesma da listagem
  // (`lib/animalScope.js`).
  if (!vetPrestadorNoContexto && empresaId && animal.empresaId === Number(empresaId)) {
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
  }

  return false;
}

module.exports = { verificarAcessoAnimal };

// backend/src/lib/animalScope.js
// Escopo de LISTAGEM de animais por usuário/contexto ativo (regra base × convidado).
// Fonte ÚNICA usada por AnimalController.listar e pela execução de prescrição, para que
// o veterinário vinculado (convidado) veja apenas os SEUS animais + os que outros vets
// liberaram a ele (designação/vínculo) DENTRO da empresa ativa; e o dono/gestor (base)
// veja todos os pacientes que trata. Ver CLAUDE.md §5 (LISTAGEM base × convidado).

const prisma = require('./prisma').default;
const { getEquipeScopeDoUsuario } = require('./vetUtils');

async function obterUserType(userId) {
  const u = await prisma.user.findUnique({
    where:  { id: Number(userId) },
    select: { userType: true, role: true },
  });
  return { userType: u?.userType ?? 'PROPRIETARIO', role: u?.role ?? 'USER' };
}

/**
 * Constrói o filtro Prisma de Animal que o usuário pode LISTAR no contexto ativo.
 * Requer que o middleware checkPermission já tenha rodado (define req.membroCargo/equipeId)
 * e o auth (req.empresaId/req.user).
 *
 * @returns {Promise<{ where: object, isAdmin: boolean, userType: string, role: string }>}
 *   `where` NÃO inclui `ativo` — o caller adiciona conforme o uso.
 */
async function buildAnimalScopeWhere(req) {
  const userId = req.user?.id;
  const { userType, role } = await obterUserType(userId);
  const isAdmin = role === 'ADMIN' && userType !== 'PROPRIETARIO';

  const CARGOS_EQUIPE = ['VETERINARIO', 'ESTAGIARIO', 'GESTOR'];
  const isProprietarioMulticargo = userType === 'PROPRIETARIO'
    && req.membroCargo && CARGOS_EQUIPE.includes(req.membroCargo);
  const isFornecedorGestorContexto = userType === 'FORNECEDOR' && req.membroCargo === 'GESTOR';
  const isVetPrestadorContexto = userType === 'VETERINARIO' && req.membroCargo === 'FORNECEDOR';
  const isDonoOuGestorContexto = req.membroCargo === 'GESTOR';

  const designacaoContextoFiltro = req.equipeId
    ? { equipeId: Number(req.equipeId) }
    : (req.empresaId ? { equipe: { empresaId: Number(req.empresaId) } } : {});

  const designacoesWhere = { designacoes: { some: {
    prestadorId: Number(userId),
    ativo:       true,
    OR: [{ dataFim: null }, { dataFim: { gte: new Date() } }],
    ...designacaoContextoFiltro,
  } } };

  const isMembroEquipe = !!req.empresaId && !isAdmin;

  const vetSolicitacoesWhere = { solicitacoes: { some: { vetUserId: Number(userId), OR: [
    { tipo: 'VINCULO',    status: 'ACEITO'   },
    { tipo: 'DESVINCULO', status: 'PENDENTE' },
    { tipo: 'TROCA_VET',  status: 'PENDENTE' },
  ] } } };

  const equipeScope = isMembroEquipe
    ? await getEquipeScopeDoUsuario(userId, req.empresaId, req.equipeId)
    : null;
  const scopeOR = equipeScope
    ? [
        { equipeId: { in: equipeScope } },
        { empresaId: req.empresaId, equipeId: null },
      ]
    : [{ empresaId: req.empresaId }];

  const vetVinculoNaEmpresa = { AND: [ vetSolicitacoesWhere, { empresaId: req.empresaId } ] };

  const where = isAdmin
    ? {}
    : userType === 'PROPRIETARIO'
      ? isProprietarioMulticargo
        ? { OR: [{ userId: Number(userId) }, ...scopeOR] }
        : { userId: Number(userId) }
      : userType === 'FORNECEDOR'
        ? isFornecedorGestorContexto
          ? { OR: scopeOR }
          : designacoesWhere
        : userType === 'VETERINARIO'
          ? isVetPrestadorContexto
            ? { OR: [designacoesWhere, vetVinculoNaEmpresa] }
            : isMembroEquipe
              ? { OR: [...scopeOR, isDonoOuGestorContexto ? vetSolicitacoesWhere : vetVinculoNaEmpresa] }
              : vetSolicitacoesWhere
          : isMembroEquipe
            ? { OR: scopeOR }
            : {};

  return { where, isAdmin, userType, role };
}

module.exports = { buildAnimalScopeWhere };

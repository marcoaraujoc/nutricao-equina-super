// backend/src/middlewares/permissao.middleware.js
// =============================================================================
// Middleware de verificação de permissão por módulo/ação.
//
// REGRAS DE OURO:
//  1. GESTOR tem bypass total — nunca bloqueado dentro da própria equipe.
//  2. Permissão é verificada no banco — nunca confiamos só no JWT.
//  3. Nível mínimo requerido é configurado por rota, não por role.
//  4. O nível resolvido é injetado em req.permissaoNivel para uso nos services.
//  5. Quando PROPRIO: o service usa req.permissaoNivel para filtrar registros
//     pelo userId do criador.
//
// HIERARQUIA DE NÍVEIS:
//  NENHUM(0) < LEITURA(1) < PROPRIO(2) < EQUIPE(3) < FULL(4)
// =============================================================================


const prisma = require('../lib/prisma').default;
const { PERMISSOES_PADRAO } = require('../seeds/002_permissoes_padrao.seed');

const NIVEL_ORDINAL = {
  NENHUM:  0,
  LEITURA: 1,
  PROPRIO: 2,
  EQUIPE:  3,
  FULL:    4,
  NEGADO:  -1, // bloqueio explícito — sempre recusado independente do nível mínimo
};

/**
 * Resolve o equipeId da requisição.
 * Prioridade: equipe ativa validada pelo authenticate (header x-equipe-id do seletor
 * de contexto) > query equipeId > equipe do usuário dentro da empresa ativa >
 * primeira equipe do usuário.
 * IMPORTANTE: cada equipe/empresa tem sua própria matriz — o nível resolvido aqui
 * é sempre o do contexto ativo, nunca uma união entre equipes.
 */
async function resolveEquipeId(req) {
  // Já validado em auth.js (membro da equipe OU dono da empresa dela)
  if (req.equipeId) return req.equipeId;

  const fromQuery = req.query.equipeId;
  if (fromQuery) return parseInt(fromQuery, 10);

  // Empresa ativa (seletor): equipe do usuário dentro dela
  if (req.empresaId) {
    const membroNaEmpresa = await prisma.membroEquipe.findFirst({
      where:   { userId: req.user.id, equipe: { empresaId: req.empresaId } },
      select:  { equipeId: true },
      orderBy: { createdAt: 'asc' },
    });
    // Sem vínculo na empresa ativa → null (caller aplica bypass de dono se for o caso)
    return membroNaEmpresa?.equipeId ?? null;
  }

  // Fallback: primeira equipe em que o usuário é membro
  const membro = await prisma.membroEquipe.findFirst({
    where: { userId: req.user.id },
    select: { equipeId: true },
    orderBy: { createdAt: 'asc' },
  });

  return membro?.equipeId ?? null;
}

/**
 * Verifica se um usuário é gestor de uma equipe.
 * Gestores têm bypass total — não consultamos a matriz de permissões.
 */
async function isGestor(userId, equipeId) {
  const membro = await prisma.membroEquipe.findUnique({
    where: { equipeId_userId: { equipeId, userId } },
    select: { cargo: true },
  });
  return membro?.cargo === 'GESTOR';
}

/**
 * Equipes vinculadas a um PROPRIETARIO via seus animais.
 * Usa Animal.equipeId (equipe responsável pelo animal) quando presente —
 * segrega as permissões por equipe, não pela empresa inteira.
 * Animais legados sem equipeId caem no escopo de todas as equipes da empresa
 * (comportamento anterior, até serem revinculados/backfilled).
 */
async function getEquipeIdsDoProprietario(userId) {
  const animais = await prisma.animal.findMany({
    where:  { userId, empresaId: { not: null } },
    select: { empresaId: true, equipeId: true },
  });

  const equipeIds        = new Set();
  const empresasSemEquipe = new Set();
  for (const a of animais) {
    if (a.equipeId) equipeIds.add(a.equipeId);
    else empresasSemEquipe.add(a.empresaId);
  }

  if (empresasSemEquipe.size > 0) {
    const equipes = await prisma.equipe.findMany({
      where:  { empresaId: { in: [...empresasSemEquipe] } },
      select: { id: true },
    });
    equipes.forEach(e => equipeIds.add(e.id));
  }

  return [...equipeIds];
}

/**
 * Resolve o nível de permissão de um PROPRIETARIO para um módulo via MatrizPerfil.
 * Política: NEGADO vence sobre qualquer nível positivo (deny-wins entre equipes).
 * Retorna 'NENHUM' se o proprietário não tiver animais vinculados a nenhuma equipe.
 */
async function getNivelPermissaoProprietario(userId, moduloSlug) {
  const equipeIds = await getEquipeIdsDoProprietario(userId);
  if (equipeIds.length === 0) return 'NENHUM';

  const matrizes = await prisma.matrizPerfil.findMany({
    where:  { equipeId: { in: equipeIds }, perfilSlug: 'PROPRIETARIO', moduloSlug },
    select: { nivel: true },
  });
  if (matrizes.length === 0) return 'NENHUM';

  // NEGADO em qualquer equipe bloqueia (deny-wins)
  if (matrizes.some(m => m.nivel === 'NEGADO')) return 'NEGADO';

  // Toma o nível máximo entre as equipes
  const positivos = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };
  return matrizes.reduce((max, m) => {
    return (positivos[m.nivel] ?? 0) > (positivos[max] ?? 0) ? m.nivel : max;
  }, 'NENHUM');
}

/**
 * Busca o nível de permissão de um usuário para um módulo específico.
 * Prioridade: PermissaoMembro (override individual) → MatrizPerfil (template do cargo) → 'NENHUM'.
 * Isso garante que o que o gestor configura em ControleAcesso (MatrizPerfil) seja respeitado
 * mesmo quando o membro entrou na equipe antes do slug existir.
 */
async function getNivelPermissao(userId, equipeId, moduloSlug, cargo = null) {
  const permissao = await prisma.permissaoMembro.findUnique({
    where: { equipeId_userId_moduloSlug: { equipeId, userId, moduloSlug } },
    select: { nivel: true },
  });
  if (permissao) return permissao.nivel;

  if (cargo) {
    const matriz = await prisma.matrizPerfil.findUnique({
      where: { equipeId_perfilSlug_moduloSlug: { equipeId, perfilSlug: cargo, moduloSlug } },
      select: { nivel: true },
    });
    if (matriz) return matriz.nivel;

    // Fallback: PERMISSOES_PADRAO quando MatrizPerfil ainda não tem o registro
    // (mesmo comportamento do ControleAcesso — mostra o padrão antes de o seed rodar)
    const defaultNivel = PERMISSOES_PADRAO[cargo]?.[moduloSlug];
    if (defaultNivel) return defaultNivel;
  }

  return 'NENHUM';
}

/**
 * Middleware factory — use nas rotas:
 * router.post('/evolucoes', auth, checkPermission('atendimento.evolucoes.criar', 'PROPRIO'), controller)
 *
 * @param {string} moduloSlug - slug do módulo (ex: 'atendimento.evolucoes.criar')
 * @param {string} nivelMinimo - nível mínimo exigido (LEITURA|PROPRIO|EQUIPE|FULL)
 */
function checkPermission(moduloSlug, nivelMinimo = 'LEITURA') {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Não autenticado.' });
      }

      // ADMIN (role sistêmica): bypass total
      if (req.user.role === 'ADMIN') {
        return next();
      }

      // PROPRIETARIO: verifica MatrizPerfil do perfil PROPRIETARIO nas equipes vinculadas
      if (req.user.userType === 'PROPRIETARIO') {
        const nivelAtual = await getNivelPermissaoProprietario(req.user.id, moduloSlug);

        if (nivelAtual === 'NEGADO') {
          return res.status(403).json({
            error:  'Acesso negado pelo administrador da equipe.',
            modulo: moduloSlug,
          });
        }

        const ordinalAtual  = NIVEL_ORDINAL[nivelAtual]  ?? 0;
        const ordinalMinimo = NIVEL_ORDINAL[nivelMinimo] ?? 0;

        if (ordinalAtual < ordinalMinimo) {
          return res.status(403).json({
            error:  `Permissão insuficiente. Requerido: ${nivelMinimo}. Atual: ${nivelAtual}.`,
            modulo: moduloSlug,
          });
        }

        req.permissaoNivel = nivelAtual;
        req.equipeId       = null;
        req.membroCargo    = 'PROPRIETARIO';
        return next();
      }

      const equipeId = await resolveEquipeId(req);

      if (!equipeId) {
        // Dono de empresa sem MembroEquipe: tem bypass total (igual a GESTOR).
        // Com contexto ativo (req.empresaId), o bypass vale APENAS se ele for dono
        // DAQUELA empresa — ser dono de outra empresa não concede nada aqui.
        const empresaOwned = await prisma.empresa.findFirst({
          where: { ownerId: req.user.id, ...(req.empresaId ? { id: req.empresaId } : {}) },
        });
        if (empresaOwned) {
          req.permissaoNivel = 'FULL';
          req.equipeId       = null;
          req.membroCargo    = 'GESTOR';
          return next();
        }

        // Veterinário autônomo (sem equipe e sem empresa): acesso filtrado por VetAnimalSolicitacao no controller
        if (req.user.userType === 'VETERINARIO') {
          req.permissaoNivel = 'PROPRIO';
          req.equipeId       = null;
          req.membroCargo    = null;
          return next();
        }

        return res.status(403).json({
          error: 'Nenhuma equipe ativa encontrada. Associe-se a uma equipe.',
        });
      }

      // Garante que o usuário é membro da equipe resolvida
      const membro = await prisma.membroEquipe.findUnique({
        where: { equipeId_userId: { equipeId, userId: req.user.id } },
        select: { cargo: true },
      });

      if (!membro) {
        // Dono da empresa da equipe sem registro de MembroEquipe → bypass de gestor
        const equipe = await prisma.equipe.findUnique({ where: { id: equipeId }, select: { empresaId: true } });
        const dono = equipe
          ? await prisma.empresa.findFirst({ where: { id: equipe.empresaId, ownerId: req.user.id }, select: { id: true } })
          : null;
        if (dono) {
          req.permissaoNivel = 'FULL';
          req.equipeId       = equipeId;
          req.membroCargo    = 'GESTOR';
          return next();
        }

        return res.status(403).json({
          error: 'Você não pertence a esta equipe.',
        });
      }

      // BYPASS para gestores — têm acesso total dentro da equipe
      if (membro.cargo === 'GESTOR') {
        req.permissaoNivel  = 'FULL';
        req.equipeId        = equipeId;
        req.membroCargo     = 'GESTOR';
        return next();
      }

      const nivelAtual = await getNivelPermissao(req.user.id, equipeId, moduloSlug, membro.cargo);
      const ordinalAtual   = NIVEL_ORDINAL[nivelAtual]   ?? 0;
      const ordinalMinimo  = NIVEL_ORDINAL[nivelMinimo]  ?? 0;

      if (ordinalAtual < ordinalMinimo) {
        return res.status(403).json({
          error: `Permissão insuficiente. Requerido: ${nivelMinimo}. Atual: ${nivelAtual}.`,
          modulo: moduloSlug,
        });
      }

      // Injeta na request para uso nos services
      req.permissaoNivel = nivelAtual;
      req.equipeId       = equipeId;
      req.membroCargo    = membro.cargo;

      next();
    } catch (err) {
      console.error('[checkPermission] Erro:', err);
      res.status(500).json({ error: 'Erro ao verificar permissão.' });
    }
  };
}

/**
 * Middleware para verificar permissão de proprietário.
 * Verifica em PermissaoProprietario se a funcionalidade está habilitada.
 *
 * @param {string} funcionalidade - ex: 'ver_prontuario'
 */
function checkPermissaoProprietario(funcionalidade) {
  return async (req, res, next) => {
    try {
      if (!req.user || req.user.userType !== 'PROPRIETARIO') {
        return res.status(403).json({ error: 'Rota exclusiva para proprietários.' });
      }

      // Verifica se alguma equipe habilitou esta funcionalidade para este proprietário
      const permissao = await prisma.permissaoProprietario.findFirst({
        where: {
          userId:        req.user.id,
          funcionalidade,
          habilitado:    true,
        },
      });

      if (!permissao) {
        return res.status(403).json({
          error: `Funcionalidade "${funcionalidade}" não habilitada pelo seu veterinário.`,
        });
      }

      req.equipeIdProprietario = permissao.equipeId;
      next();
    } catch (err) {
      console.error('[checkPermissaoProprietario] Erro:', err);
      res.status(500).json({ error: 'Erro ao verificar permissão do proprietário.' });
    }
  };
}

/**
 * Helper utilitário para uso dentro dos services:
 * Verifica se o usuário pode operar sobre um registro de outro usuário.
 *
 * Retorna true se:
 *  - nível é EQUIPE ou FULL (pode operar sobre qualquer registro)
 *  - nível é PROPRIO E o registro pertence ao próprio usuário
 */
function podeOperarRegistro(nivelPermissao, registroCriadorId, userIdAtual) {
  if (nivelPermissao === 'EQUIPE' || nivelPermissao === 'FULL') return true;
  if (nivelPermissao === 'PROPRIO') return registroCriadorId === userIdAtual;
  return false;
}

module.exports = {
  checkPermission,
  checkPermissaoProprietario,
  podeOperarRegistro,
  getEquipeIdsDoProprietario,
  NIVEL_ORDINAL,
};
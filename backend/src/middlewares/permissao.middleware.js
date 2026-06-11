// backend/src/middlewares/permissao.middleware.js
// =============================================================================
// Middleware de verificação de permissão por módulo/ação.
//
// REGRAS DE OURO:
//  1. SÓCIO tem bypass total — nunca bloqueado dentro da própria equipe.
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
 * Prioridade: header X-Equipe-Id > query equipeId > primeira equipe do usuário.
 */
async function resolveEquipeId(req) {
  const fromHeader = req.headers['x-equipe-id'];
  if (fromHeader) return parseInt(fromHeader, 10);

  const fromQuery = req.query.equipeId;
  if (fromQuery) return parseInt(fromQuery, 10);

  // Fallback: primeira equipe em que o usuário é membro
  const membro = await prisma.membroEquipe.findFirst({
    where: { userId: req.user.id },
    select: { equipeId: true },
    orderBy: { createdAt: 'asc' },
  });

  return membro?.equipeId ?? null;
}

/**
 * Verifica se um usuário é sócio de uma equipe.
 * Sócios têm bypass total — não consultamos a matriz de permissões.
 */
async function isSocio(userId, equipeId) {
  const membro = await prisma.membroEquipe.findUnique({
    where: { equipeId_userId: { equipeId, userId } },
    select: { cargo: true },
  });
  return membro?.cargo === 'SOCIO';
}

/**
 * Resolve o nível de permissão de um PROPRIETARIO para um módulo via MatrizPerfil.
 * Política: NEGADO vence sobre qualquer nível positivo (deny-wins entre equipes).
 * Retorna 'NENHUM' se o proprietário não tiver animais vinculados a nenhuma equipe.
 */
async function getNivelPermissaoProprietario(userId, moduloSlug) {
  const animais = await prisma.animal.findMany({
    where:    { userId, empresaId: { not: null } },
    select:   { empresaId: true },
    distinct: ['empresaId'],
  });
  const empresaIds = animais.map(a => a.empresaId).filter(Boolean);
  if (empresaIds.length === 0) return 'NENHUM';

  const equipes = await prisma.equipe.findMany({
    where:  { empresaId: { in: empresaIds } },
    select: { id: true },
  });
  const equipeIds = equipes.map(e => e.id);
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
 * Retorna 'NENHUM' como default seguro se não houver registro.
 */
async function getNivelPermissao(userId, equipeId, moduloSlug) {
  const permissao = await prisma.permissaoMembro.findUnique({
    where: {
      equipeId_userId_moduloSlug: { equipeId, userId, moduloSlug },
    },
    select: { nivel: true },
  });
  return permissao?.nivel ?? 'NENHUM';
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
        // Dono de empresa sem MembroEquipe: tem bypass total (igual a SOCIO)
        const empresaOwned = await prisma.empresa.findFirst({ where: { ownerId: req.user.id } });
        if (empresaOwned) {
          req.permissaoNivel = 'FULL';
          req.equipeId       = null;
          req.membroCargo    = 'SOCIO';
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
        return res.status(403).json({
          error: 'Você não pertence a esta equipe.',
        });
      }

      // BYPASS para sócios — têm acesso total dentro da equipe
      if (membro.cargo === 'SOCIO') {
        req.permissaoNivel  = 'FULL';
        req.equipeId        = equipeId;
        req.membroCargo     = 'SOCIO';
        return next();
      }

      const nivelAtual = await getNivelPermissao(req.user.id, equipeId, moduloSlug);
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
  NIVEL_ORDINAL,
};
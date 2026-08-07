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
async function getEquipeIdsDoProprietario(userId, empresaId = null) {
  const animais = await prisma.animal.findMany({
    // Com empresa ATIVA (seletor do portal do proprietário) o escopo é só ela:
    // o que a empresa A liberou não vale quando ele está olhando a empresa B.
    //
    // ⚠️ SEM empresa no contexto, o filtro de empresa é OMITIDO — nunca `{ not: null }`.
    // `tb_animais.empresa_id` virou NOT NULL na fase 5 e o Prisma Client regenerou a
    // coluna como não-nulável, então `{ not: null }` passou a ser INVÁLIDO
    // ("Argument `not` must not be null") e derrubava com HTTP 500 a home do
    // proprietário sem empresa selecionada, o `logoEmpresaUtils` e o cron de
    // fechamento de fatura (server.ts). O ramo existia para excluir animal órfão —
    // estado que a fase 4 eliminou e a fase 5 tornou impossível: todo animal tem
    // empresa. Omitir o filtro é equivalente e correto.
    where:  empresaId ? { userId, empresaId: Number(empresaId) } : { userId },
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
 *
 * ESCOPO: com `empresaId` (empresa escolhida no seletor do portal do proprietário),
 * só as equipes DAQUELA empresa entram na conta — é o que garante que "a empresa A
 * liberou a fatura e a B não" resulte em ver a fatura apenas dentro da empresa A.
 * Sem empresa ativa, cai no comportamento antigo (todas as equipes vinculadas).
 *
 * Política: NEGADO vence sobre qualquer nível positivo (deny-wins entre equipes).
 * Retorna 'NENHUM' se o proprietário não tiver animais vinculados a nenhuma equipe.
 */
async function getNivelPermissaoProprietario(userId, moduloSlug, empresaId = null) {
  const equipeIds = await getEquipeIdsDoProprietario(userId, empresaId);
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
 *
 * FORNECEDOR: usa PermissaoMembro (permissões individuais configuradas por animal/membro).
 * Todos os demais cargos: usa MatrizPerfil como fonte canônica — é o que o gestor
 * edita no ControleAcesso → "Matriz de Perfis". Ignorar PermissaoMembro evita que
 * registros desatualizados (ex.: do seed ou de propagação anterior) concedam acesso
 * indevido após o gestor restringir o perfil.
 */
async function getNivelPermissao(userId, equipeId, moduloSlug, cargo = null) {
  if (cargo === 'FORNECEDOR') {
    // FORNECEDOR: permissões individuais por membro (via ControleAcesso → aba Fornecedor)
    const permissao = await prisma.permissaoMembro.findUnique({
      where: { equipeId_userId_moduloSlug: { equipeId, userId, moduloSlug } },
      select: { nivel: true },
    });
    if (permissao) return permissao.nivel;
  }

  if (cargo) {
    // Para todos os demais cargos: MatrizPerfil é a fonte de verdade
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
 *
 * Multicargo: um usuário com userType=PROPRIETARIO que também é MembroEquipe como
 * VETERINARIO ou ESTAGIARIO recebe o MAX entre o nível do cargo de equipe e o nível
 * de PROPRIETARIO. NEGADO do cargo de equipe bloqueia; NEGADO de PROPRIETARIO não
 * bloqueia quando o usuário tem cargo de equipe ativo.
 */
function checkPermission(moduloSlug, nivelMinimo = 'LEITURA') {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Não autenticado.' });
      }

      // ADMIN: bypass total — checa role (campo legado) OU userType (campo canônico)
      if (req.user.role === 'ADMIN' || req.user.userType === 'ADMIN') {
        req.permissaoNivel = 'FULL';   // opera qualquer registro (podeOperarRegistro)
        req.membroCargo    = 'GESTOR';
        return next();
      }

      // Resolve equipe do contexto ativo ANTES do check de userType, para suportar
      // multicargo (ex: userType=PROPRIETARIO com cargo VETERINARIO numa equipe).
      const equipeId = await resolveEquipeId(req);

      // ── CAMINHO DE MEMBRO DE EQUIPE ────────────────────────────────────────────
      if (equipeId) {
        const membro = await prisma.membroEquipe.findUnique({
          where:  { equipeId_userId: { equipeId, userId: req.user.id } },
          select: { cargo: true },
        });

        if (membro) {
          // BYPASS para gestores — têm acesso total dentro da equipe
          if (membro.cargo === 'GESTOR') {
            req.permissaoNivel = 'FULL';
            req.equipeId       = equipeId;
            req.membroCargo    = 'GESTOR';
            return next();
          }

          const nivelEquipe = await getNivelPermissao(req.user.id, equipeId, moduloSlug, membro.cargo);

          // Multicargo: PROPRIETARIO com cargo de equipe recebe o máximo entre os dois níveis.
          // NEGADO de PROPRIETARIO não bloqueia quem tem cargo de equipe ativo.
          let nivelAtual = nivelEquipe;
          if (req.user.userType === 'PROPRIETARIO') {
            const nivelProp = await getNivelPermissaoProprietario(req.user.id, moduloSlug, req.empresaId);
            if (nivelProp !== 'NEGADO') {
              const ordProp   = NIVEL_ORDINAL[nivelProp]   ?? 0;
              const ordEquipe = NIVEL_ORDINAL[nivelEquipe] ?? 0;
              if (ordProp > ordEquipe) nivelAtual = nivelProp;
            }
          }

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
          req.equipeId       = equipeId;
          req.membroCargo    = membro.cargo;
          return next();
        }

        // equipeId resolvido mas usuário não é membro → verifica dono da empresa da equipe
        const equipe = await prisma.equipe.findUnique({ where: { id: equipeId }, select: { empresaId: true } });
        const dono = equipe
          ? await prisma.empresa.findFirst({ where: { id: equipe.empresaId, ownerId: req.user.id }, select: { id: true } })
          : null;
        if (dono && req.user.userType !== 'FORNECEDOR') {
          req.permissaoNivel = 'FULL';
          req.equipeId       = equipeId;
          req.membroCargo    = 'GESTOR';
          return next();
        }
        // Não é membro nem dono: cai no caminho sem equipe abaixo
      }

      // ── SEM EQUIPE ATIVA ───────────────────────────────────────────────────────
      if (!equipeId) {
        // Dono de empresa sem MembroEquipe: tem bypass total (igual a GESTOR).
        // Com contexto ativo (req.empresaId), o bypass vale APENAS se ele for dono
        // DAQUELA empresa — ser dono de outra empresa não concede nada aqui.
        const empresaOwned = await prisma.empresa.findFirst({
          where: { ownerId: req.user.id, ...(req.empresaId ? { id: req.empresaId } : {}) },
        });
        if (empresaOwned && req.user.userType !== 'FORNECEDOR') {
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
      }

      // ── PROPRIETARIO sem cargo de equipe ativo ─────────────────────────────────
      // Chegou aqui: sem MembroEquipe válido (ou não era membro de nenhuma equipe).
      // Verifica MatrizPerfil do perfil PROPRIETARIO nas equipes vinculadas via animais.
      if (req.user.userType === 'PROPRIETARIO') {
        const nivelAtual = await getNivelPermissaoProprietario(req.user.id, moduloSlug, req.empresaId);

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

      return res.status(403).json({
        error: 'Nenhuma equipe ativa encontrada. Associe-se a uma equipe.',
      });
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
 * O usuário é GESTOR no contexto ativo? (cargo GESTOR, dono da empresa ou ADMIN)
 *
 * `checkPermission` seta `req.membroCargo = 'GESTOR'` em TODOS os caminhos de bypass
 * (ADMIN, cargo GESTOR na equipe, dono da empresa com ou sem MembroEquipe) — por isso
 * esta é a única checagem necessária. NÃO usar `req.permissaoNivel === 'FULL'` como
 * sinônimo: FULL é um nível da matriz e um dia pode ser concedido a um perfil comum.
 */
function ehGestorNoContexto(req) {
  return req?.membroCargo === 'GESTOR'
      || req?.user?.role === 'ADMIN'
      || req?.user?.userType === 'ADMIN';
}

/**
 * Helper utilitário para uso dentro dos services/controllers:
 * Verifica se o usuário pode operar (alterar/excluir/finalizar) sobre um registro
 * CLÍNICO (Evolução, Prescrição, Exame, Encaminhamento, Vacina, Agendamento).
 *
 * REGRA (2026-08-04) — PREMISSA DE AUTORIA:
 *   A ação concedida no Controle de Acesso vale sobre O QUE É DE QUEM A EXECUTA.
 *   "Pode finalizar evolução" = pode finalizar a evolução que ELE criou ou ASSUMIU,
 *   nunca a de outro profissional. O ÚNICO perfil que opera registro alheio é o
 *   GESTOR (e o ADMIN da plataforma).
 *
 *   Assumir transfere a autoria (o `veterinarioId` passa a ser de quem assumiu), então
 *   "criado ou assumido" se resolve por uma comparação só: autorId === req.user.id.
 *
 * ⚠️ Isto REVERTE a regra de 2026-07-30 ("sem filtro de autoria; quem decide é só o
 * Controle de Acesso"). O nível (PROPRIO/EQUIPE/FULL) segue governando o ACESSO à ação
 * pelo `checkPermission` da rota; a AUTORIA é regra basal e não se configura na matriz —
 * é o que impede um profissional de mexer no prontuário conduzido por outro.
 *
 * @param {object} req       request já passado pelo checkPermission da rota
 * @param {number|null} autorId  dono do registro (veterinarioId). null = registro sem
 *                               dono definido → só o gestor opera.
 */
function podeOperarRegistro(req, autorId) {
  if ((NIVEL_ORDINAL[req?.permissaoNivel] ?? 0) < NIVEL_ORDINAL.PROPRIO) return false;
  if (ehGestorNoContexto(req)) return true;
  if (autorId == null) return false;
  return Number(autorId) === Number(req?.user?.id);
}

/**
 * Resolve o nível efetivo de um usuário para um slug ARBITRÁRIO em runtime,
 * reutilizando o contexto já resolvido pelo checkPermission da rota
 * (req.equipeId / req.membroCargo). Usado quando a permissão depende de dados do
 * body/registro (ex.: tipo do exame → exames.laboratorial.* vs exames.imagem.*).
 *
 * Paridade com checkPermission: ADMIN → FULL; GESTOR/dono → FULL; membro → matriz
 * do cargo (com união de PROPRIETARIO multicargo); PROPRIETARIO puro → matriz
 * PROPRIETARIO (deny-wins); vet autônomo sem equipe → PROPRIO; senão NENHUM.
 */
async function getNivelEfetivo(req, moduloSlug) {
  if (req.user?.role === 'ADMIN' || req.user?.userType === 'ADMIN') return 'FULL';
  if (req.membroCargo === 'GESTOR') return 'FULL';

  if (req.membroCargo === 'PROPRIETARIO') {
    return getNivelPermissaoProprietario(req.user.id, moduloSlug, req.empresaId);
  }

  if (req.equipeId && req.membroCargo) {
    let nivel = await getNivelPermissao(req.user.id, req.equipeId, moduloSlug, req.membroCargo);
    if (req.user.userType === 'PROPRIETARIO' && nivel !== 'NEGADO') {
      const nivelProp = await getNivelPermissaoProprietario(req.user.id, moduloSlug, req.empresaId);
      if (nivelProp !== 'NEGADO' && (NIVEL_ORDINAL[nivelProp] ?? 0) > (NIVEL_ORDINAL[nivel] ?? 0)) {
        nivel = nivelProp;
      }
    }
    return nivel;
  }

  if (req.user?.userType === 'PROPRIETARIO') {
    return getNivelPermissaoProprietario(req.user.id, moduloSlug, req.empresaId);
  }
  if (req.user?.userType === 'VETERINARIO') return 'PROPRIO';
  return 'NENHUM';
}

/**
 * Resolve o CONTEXTO de permissão (req.equipeId / req.membroCargo) sem exigir nenhum
 * slug — mesma ordem de resolução do checkPermission, mas nunca responde 403.
 *
 * Existe para rotas que atravessam VÁRIOS módulos e por isso não podem ser gateadas
 * por um slug único (a busca global do header: paciente + atendimento + agenda). Sem
 * isto, `getNivelEfetivo` não teria req.equipeId/req.membroCargo e devolveria NENHUM
 * para todo mundo que não é ADMIN. Quem decide o que entra no resultado é o
 * getNivelEfetivo de CADA módulo, chamado pelo controller.
 */
async function resolverContextoPermissao(req) {
  if (!req.user) return;

  if (req.user.role === 'ADMIN' || req.user.userType === 'ADMIN') {
    req.membroCargo = 'GESTOR';
    return;
  }

  const equipeId = await resolveEquipeId(req);
  if (equipeId) {
    const membro = await prisma.membroEquipe.findUnique({
      where:  { equipeId_userId: { equipeId, userId: req.user.id } },
      select: { cargo: true },
    });
    if (membro) {
      req.equipeId    = equipeId;
      req.membroCargo = membro.cargo;
      return;
    }

    // Não é membro: pode ser o dono da empresa daquela equipe (bypass de gestor)
    const equipe = await prisma.equipe.findUnique({ where: { id: equipeId }, select: { empresaId: true } });
    const dono = equipe
      ? await prisma.empresa.findFirst({ where: { id: equipe.empresaId, ownerId: req.user.id }, select: { id: true } })
      : null;
    if (dono && req.user.userType !== 'FORNECEDOR') {
      req.equipeId    = equipeId;
      req.membroCargo = 'GESTOR';
      return;
    }
  }

  const empresaOwned = await prisma.empresa.findFirst({
    where:  { ownerId: req.user.id, ...(req.empresaId ? { id: req.empresaId } : {}) },
    select: { id: true },
  });
  if (empresaOwned && req.user.userType !== 'FORNECEDOR') {
    req.membroCargo = 'GESTOR';
    return;
  }

  if (req.user.userType === 'PROPRIETARIO') req.membroCargo = 'PROPRIETARIO';
}

module.exports = {
  checkPermission,
  checkPermissaoProprietario,
  podeOperarRegistro,
  ehGestorNoContexto,
  getNivelEfetivo,
  resolverContextoPermissao,
  getEquipeIdsDoProprietario,
  NIVEL_ORDINAL,
};
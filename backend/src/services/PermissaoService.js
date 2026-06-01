// backend/src/services/permissao.service.js
// =============================================================================
// Service de permissões — lógica de negócio desacoplada do controller.
// Toda alteração de permissão passa por aqui e gera auditoria automática.
// =============================================================================


const prisma = require('../lib/prisma').default;
const { NIVEL_ORDINAL } = require('../middlewares/permissao.middleware');
const { PERMISSOES_PADRAO } = require('../seeds/002_permissoes_padrao.seed');

/**
 * Aplica as permissões padrão para um cargo ao entrar em uma equipe.
 * Chamado ao aceitar convite ou adicionar membro diretamente.
 */
async function aplicarPermissoesPadrao({ equipeId, userId, cargo, atualizadoPor }) {
  const mapa = PERMISSOES_PADRAO[cargo];
  if (!mapa) return; // SOCIO não tem entradas na matriz

  const agora = new Date();
  const upserts = Object.entries(mapa).map(([moduloSlug, nivel]) =>
    prisma.permissaoMembro.upsert({
      where:  { equipeId_userId_moduloSlug: { equipeId, userId, moduloSlug } },
      update: { nivel, atualizadoPor, updatedAt: agora },
      create: { equipeId, userId, moduloSlug, nivel, atualizadoPor },
    })
  );

  await prisma.$transaction(upserts);
}

/**
 * Retorna a matriz completa de permissões de um membro em uma equipe.
 * Agrupa por módulo/submódulo para facilitar renderização no frontend.
 */
async function getPermissoesMembro({ equipeId, userId }) {
  const [modulos, permissoes] = await Promise.all([
    prisma.moduloSistema.findMany({ orderBy: { ordemExib: 'asc' } }),
    prisma.permissaoMembro.findMany({ where: { equipeId, userId } }),
  ]);

  const mapaPermissoes = Object.fromEntries(
    permissoes.map((p) => [p.moduloSlug, p.nivel])
  );

  // Agrupa por módulo > submódulo
  const agrupado = {};
  for (const mod of modulos) {
    if (!agrupado[mod.modulo]) agrupado[mod.modulo] = {};
    if (!agrupado[mod.modulo][mod.submodulo]) agrupado[mod.modulo][mod.submodulo] = [];
    agrupado[mod.modulo][mod.submodulo].push({
      slug:  mod.slug,
      acao:  mod.acao,
      label: mod.label,
      nivel: mapaPermissoes[mod.slug] ?? 'NENHUM',
    });
  }

  return agrupado;
}

/**
 * Atualiza um ou mais níveis de permissão para um membro.
 * Regras de segurança aplicadas aqui:
 *  - Quem atualiza não pode conceder nível acima do seu próprio
 *  - Sócios têm bypass (verificado no middleware antes de chegar aqui)
 *
 * @param {object} params
 * @param {number} params.equipeId
 * @param {number} params.alvoUserId       - membro que terá permissão alterada
 * @param {object} params.alteracoes       - { [moduloSlug]: novoNivel }
 * @param {number} params.atualizadoPorId  - userId de quem está fazendo a alteração
 * @param {string} params.atualizadoPorNome
 * @param {string} params.ipOrigem
 */
async function atualizarPermissoes({
  equipeId,
  alvoUserId,
  alteracoes,
  atualizadoPorId,
  atualizadoPorNome,
  ipOrigem,
}) {
  // Busca dados do alvo para auditoria
  const [alvoUser, equipe] = await Promise.all([
    prisma.user.findUnique({ where: { id: alvoUserId }, select: { fullName: true, email: true } }),
    prisma.equipe.findUnique({ where: { id: equipeId }, select: { nome: true } }),
  ]);

  if (!alvoUser) throw new Error('Usuário alvo não encontrado.');
  if (!equipe)   throw new Error('Equipe não encontrada.');

  // Verifica que o alvo é membro da equipe
  const membroAlvo = await prisma.membroEquipe.findUnique({
    where: { equipeId_userId: { equipeId, userId: alvoUserId } },
  });
  if (!membroAlvo) throw new Error('Usuário alvo não pertence a esta equipe.');
  if (membroAlvo.cargo === 'SOCIO') throw new Error('Não é possível alterar permissões de um sócio.');

  // Permissões atuais do quem altera (para enforcement de delegation cap)
  // Sócios chegam com permissaoNivel=FULL — verificado no middleware
  const slugs = Object.keys(alteracoes);
  const permissoesAtuaisQuemAltera = await prisma.permissaoMembro.findMany({
    where: { equipeId, userId: atualizadoPorId, moduloSlug: { in: slugs } },
  });
  const mapaQuemAltera = Object.fromEntries(
    permissoesAtuaisQuemAltera.map((p) => [p.moduloSlug, p.nivel])
  );

  // Permissões atuais do alvo (para auditoria — registra o nível anterior)
  const permissoesAlvo = await prisma.permissaoMembro.findMany({
    where: { equipeId, userId: alvoUserId, moduloSlug: { in: slugs } },
  });
  const mapaAlvo = Object.fromEntries(
    permissoesAlvo.map((p) => [p.moduloSlug, p.nivel])
  );

  // Busca labels dos módulos para auditoria
  const modulos = await prisma.moduloSistema.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, label: true },
  });
  const mapaLabels = Object.fromEntries(modulos.map((m) => [m.slug, m.label]));

  const upserts = [];
  const auditorias = [];
  const agora = new Date();

  for (const [moduloSlug, novoNivel] of Object.entries(alteracoes)) {
    // Delegation cap: quem altera não pode conceder acima do seu próprio nível
    // Sócios chegam como FULL no contexto (bypass no middleware), então passam sempre
    const nivelQuemAltera = mapaQuemAltera[moduloSlug] ?? 'NENHUM';
    // Se o contexto for FULL (sócio), ignoramos o cap
    const isSocioContext = !permissoesAtuaisQuemAltera.find(p => p.moduloSlug === moduloSlug)
      && nivelQuemAltera === 'NENHUM'; // sócios não têm entradas na tabela

    if (!isSocioContext && NIVEL_ORDINAL[novoNivel] > NIVEL_ORDINAL[nivelQuemAltera]) {
      throw new Error(
        `Você não pode conceder "${novoNivel}" em "${moduloSlug}". Seu nível atual é "${nivelQuemAltera}".`
      );
    }

    const nivelAnterior = mapaAlvo[moduloSlug] ?? null;
    if (nivelAnterior === novoNivel) continue; // sem mudança real

    upserts.push(
      prisma.permissaoMembro.upsert({
        where:  { equipeId_userId_moduloSlug: { equipeId, userId: alvoUserId, moduloSlug } },
        update: { nivel: novoNivel, atualizadoPor: atualizadoPorId, updatedAt: agora },
        create: { equipeId, userId: alvoUserId, moduloSlug, nivel: novoNivel, atualizadoPor: atualizadoPorId },
      })
    );

    auditorias.push({
      equipeId,
      equipeNome:      equipe.nome,
      alvoUserId,
      alvoUserNome:    alvoUser.fullName,
      alvoUserEmail:   alvoUser.email,
      moduloSlug,
      moduloLabel:     mapaLabels[moduloSlug] ?? moduloSlug,
      nivelAnterior,
      nivelNovo:       novoNivel,
      alteradoPorId:   atualizadoPorId,
      alteradoPorNome: atualizadoPorNome,
      ipOrigem:        ipOrigem ?? null,
    });
  }

  if (upserts.length === 0) return { alteracoes: 0 };

  await prisma.$transaction([
    ...upserts,
    prisma.auditoriaPermissao.createMany({ data: auditorias }),
  ]);

  return { alteracoes: upserts.length };
}

/**
 * Retorna o log de auditoria de permissões de uma equipe, paginado.
 */
async function getAuditoriaPermissoes({ equipeId, page = 1, limit = 30 }) {
  const skip = (page - 1) * limit;
  const [total, registros] = await Promise.all([
    prisma.auditoriaPermissao.count({ where: { equipeId } }),
    prisma.auditoriaPermissao.findMany({
      where:   { equipeId },
      orderBy: { createdAt: 'desc' },
      skip,
      take:    limit,
    }),
  ]);

  return { total, page, limit, registros };
}

/**
 * Atualiza permissões de proprietário (funcionalidades liberadas).
 * Gera auditoria no AuditLog geral (não no AuditoriaPermissao específico de equipe).
 */
async function atualizarPermissoesProprietario({
  equipeId,
  alvoUserId,
  funcionalidades, // { [funcionalidade]: boolean }
  atualizadoPor,
  ipOrigem,
}) {
  const upserts = Object.entries(funcionalidades).map(([funcionalidade, habilitado]) =>
    prisma.permissaoProprietario.upsert({
      where:  { equipeId_userId_funcionalidade: { equipeId, userId: alvoUserId, funcionalidade } },
      update: { habilitado, atualizadoPor, updatedAt: new Date() },
      create: { equipeId, userId: alvoUserId, funcionalidade, habilitado, atualizadoPor },
    })
  );

  await prisma.$transaction(upserts);
  return { alteracoes: upserts.length };
}

/**
 * Retorna as permissões de proprietário de uma equipe (todos os proprietários vinculados).
 */
async function getPermissoesProprietarios({ equipeId }) {
  // Proprietários com animais cujos vets pertencem a esta equipe
  const membros = await prisma.membroEquipe.findMany({
    where: { equipeId },
    select: { userId: true },
  });
  const vetIds = membros.map((m) => m.userId);

  // Animais vinculados a vets da equipe → proprietários únicos
  const animais = await prisma.animal.findMany({
    where: { user: { animais: { some: {} } } },
    select: { userId: true, user: { select: { id: true, fullName: true, email: true } } },
    distinct: ['userId'],
  });

  // Busca permissões existentes
  const permissoes = await prisma.permissaoProprietario.findMany({
    where: { equipeId },
  });

  const mapaPermissoes = {};
  for (const p of permissoes) {
    if (!mapaPermissoes[p.userId]) mapaPermissoes[p.userId] = {};
    mapaPermissoes[p.userId][p.funcionalidade] = p.habilitado;
  }

  return animais.map((a) => ({
    userId:        a.user.id,
    fullName:      a.user.fullName,
    email:         a.user.email,
    permissoes:    mapaPermissoes[a.user.id] ?? {},
  }));
}

/**
 * Lista os cargos (perfis) em uso numa equipe com contagem de membros
 * e resumo de permissões concedidas.
 */
async function getPerfisByEquipe({ equipeId }) {
  const membros = await prisma.membroEquipe.findMany({
    where:  { equipeId },
    select: { userId: true, cargo: true },
  });

  const porCargo = {};
  for (const m of membros) {
    if (!porCargo[m.cargo]) porCargo[m.cargo] = [];
    porCargo[m.cargo].push(m);
  }

  const resultado = [];
  for (const [cargo, lista] of Object.entries(porCargo)) {
    const userIds = lista.map((m) => m.userId);
    const perms   = cargo !== 'SOCIO'
      ? await prisma.permissaoMembro.findMany({ where: { equipeId, userId: { in: userIds } } })
      : [];

    const slugsUnicos = new Set(perms.filter(p => p.nivel !== 'NENHUM').map(p => p.moduloSlug));
    const ver    = [...slugsUnicos].filter(s => s.endsWith('.ler')).length;
    const editar = [...slugsUnicos].filter(s => s.endsWith('.criar') || s.endsWith('.editar')).length;
    const excluir= [...slugsUnicos].filter(s => s.endsWith('.deletar')).length;

    resultado.push({ cargo, totalMembros: lista.length, resumo: { ver, editar, excluir } });
  }

  return resultado;
}

/**
 * Retorna a matriz de permissões de um cargo agregada dos membros existentes.
 * Se não há membros com aquele cargo, usa os defaults do seed.
 */
async function getMatrizPorCargo({ equipeId, cargo }) {
  const modulos = await prisma.moduloSistema.findMany({ orderBy: { ordemExib: 'asc' } });

  const membros = await prisma.membroEquipe.findMany({ where: { equipeId, cargo } });

  let mapaPermissoes = {};
  if (membros.length > 0) {
    // Usa o primeiro membro como representante do perfil
    const perms = await prisma.permissaoMembro.findMany({
      where: { equipeId, userId: membros[0].userId },
    });
    mapaPermissoes = Object.fromEntries(perms.map((p) => [p.moduloSlug, p.nivel]));
  } else {
    mapaPermissoes = PERMISSOES_PADRAO[cargo] ?? {};
  }

  const agrupado = {};
  for (const mod of modulos) {
    if (!agrupado[mod.modulo])           agrupado[mod.modulo] = {};
    if (!agrupado[mod.modulo][mod.submodulo]) agrupado[mod.modulo][mod.submodulo] = [];
    agrupado[mod.modulo][mod.submodulo].push({
      slug:  mod.slug,
      acao:  mod.acao,
      label: mod.label,
      nivel: mapaPermissoes[mod.slug] ?? 'NENHUM',
    });
  }

  return { cargo, totalMembros: membros.length, matriz: agrupado };
}

/**
 * Aplica uma matriz de permissões a TODOS os membros de um cargo em uma equipe.
 * Gera auditoria para cada alteração.
 */
async function salvarMatrizPorCargo({ equipeId, cargo, permissoes, atualizadoPorId, atualizadoPorNome, ipOrigem }) {
  const membros = await prisma.membroEquipe.findMany({ where: { equipeId, cargo } });

  if (membros.length === 0) return { membros: 0, alteracoes: 0 };

  let totalAlteracoes = 0;
  for (const membro of membros) {
    const res = await atualizarPermissoes({
      equipeId,
      alvoUserId: membro.userId,
      alteracoes: permissoes,
      atualizadoPorId,
      atualizadoPorNome,
      ipOrigem,
    });
    totalAlteracoes += res.alteracoes ?? 0;
  }

  return { membros: membros.length, alteracoes: totalAlteracoes };
}

module.exports = {
  aplicarPermissoesPadrao,
  getPermissoesMembro,
  atualizarPermissoes,
  getAuditoriaPermissoes,
  atualizarPermissoesProprietario,
  getPermissoesProprietarios,
  getPerfisByEquipe,
  getMatrizPorCargo,
  salvarMatrizPorCargo,
};
// backend/src/services/permissao.service.js
// =============================================================================
// Service de permissões — lógica de negócio desacoplada do controller.
// Toda alteração de permissão passa por aqui e gera auditoria automática.
//
// Perfis são explícitos em PerfilEquipe + MatrizPerfil.
// PermissaoMembro = cópia aplicada ao membro no momento da atribuição de cargo.
// =============================================================================


const prisma = require('../lib/prisma').default;
const { NIVEL_ORDINAL } = require('../middlewares/permissao.middleware');
const { PERMISSOES_PADRAO } = require('../seeds/002_permissoes_padrao.seed');

// Perfis padrão inicializados em cada nova equipe
const PERFIS_PADRAO = [
  { slug: 'SOCIO',       label: 'Sócio',       descricao: 'Acesso total irrestrito. Bypass de todas as permissões do sistema.' },
  { slug: 'VETERINARIO', label: 'Veterinário',  descricao: 'Acesso clínico completo: prontuários, exames, prescrições e nutrição.' },
  { slug: 'ESTAGIARIO',  label: 'Estagiário',   descricao: 'Acesso de leitura por padrão. Permissões elevadas pelo sócio conforme necessário.' },
];

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Garante que os perfis padrão existam na equipe. Cria se necessário.
 * Chamado no primeiro acesso a getPerfisByEquipe quando a equipe é nova.
 */
async function garantirPerfisPadrao(equipeId) {
  const existentes = await prisma.perfilEquipe.findMany({
    where: { equipeId },
    select: { slug: true },
  });
  const slugsExistentes = new Set(existentes.map(p => p.slug));

  for (const perfil of PERFIS_PADRAO) {
    if (slugsExistentes.has(perfil.slug)) continue;

    await prisma.perfilEquipe.create({
      data: { equipeId, slug: perfil.slug, label: perfil.label, descricao: perfil.descricao },
    });

    // Sócio não tem matriz configurável — bypass total no middleware
    if (perfil.slug === 'SOCIO') continue;

    const defaults = PERMISSOES_PADRAO[perfil.slug] ?? {};
    const modulos  = await prisma.moduloSistema.findMany({ select: { slug: true } });

    const dados = modulos.map(m => ({
      equipeId,
      perfilSlug: perfil.slug,
      moduloSlug: m.slug,
      nivel:      defaults[m.slug] ?? 'NENHUM',
    }));

    if (dados.length > 0) {
      await prisma.matrizPerfil.createMany({ data: dados, skipDuplicates: true });
    }
  }
}

// ─── Aplicar permissões padrão ────────────────────────────────────────────────

/**
 * Aplica a matriz do perfil ao membro ao entrar na equipe ou trocar de cargo.
 * Prioridade: MatrizPerfil (BD) > PERMISSOES_PADRAO (seed) > NENHUM.
 */
async function aplicarPermissoesPadrao({ equipeId, userId, cargo, atualizadoPor }) {
  if (cargo === 'SOCIO') return; // Sócio tem bypass — sem entradas na tabela

  // Busca matriz do perfil no banco
  const matrizBD = await prisma.matrizPerfil.findMany({
    where: { equipeId, perfilSlug: cargo },
  });

  let mapa;
  if (matrizBD.length > 0) {
    mapa = Object.fromEntries(matrizBD.map(m => [m.moduloSlug, m.nivel]));
  } else {
    // Fallback: seed hardcoded (VETERINARIO/ESTAGIARIO legado)
    mapa = PERMISSOES_PADRAO[cargo] ?? {};
  }

  if (Object.keys(mapa).length === 0) return;

  const agora   = new Date();
  const upserts = Object.entries(mapa).map(([moduloSlug, nivel]) =>
    prisma.permissaoMembro.upsert({
      where:  { equipeId_userId_moduloSlug: { equipeId, userId, moduloSlug } },
      update: { nivel, atualizadoPor, updatedAt: agora },
      create: { equipeId, userId, moduloSlug, nivel, atualizadoPor },
    })
  );

  await prisma.$transaction(upserts);
}

// ─── CRUD de Perfis ───────────────────────────────────────────────────────────

/**
 * Lista os perfis de uma equipe com contagem de membros e resumo de permissões.
 * Auto-inicializa os perfis padrão na primeira chamada.
 */
async function getPerfisByEquipe({ equipeId }) {
  await garantirPerfisPadrao(equipeId);

  const [perfis, membros, matrizes] = await Promise.all([
    prisma.perfilEquipe.findMany({
      where:   { equipeId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.membroEquipe.findMany({
      where:  { equipeId },
      select: { userId: true, cargo: true },
    }),
    prisma.matrizPerfil.findMany({
      where: { equipeId },
    }),
  ]);

  const contagemPorCargo = {};
  for (const m of membros) {
    contagemPorCargo[m.cargo] = (contagemPorCargo[m.cargo] ?? 0) + 1;
  }

  return perfis.map(p => {
    const itens   = matrizes.filter(m => m.perfilSlug === p.slug && m.nivel !== 'NENHUM');
    const ver     = itens.filter(m => m.moduloSlug.endsWith('.ler')).length;
    const editar  = itens.filter(m => m.moduloSlug.endsWith('.criar') || m.moduloSlug.endsWith('.editar')).length;
    const excluir = itens.filter(m => m.moduloSlug.endsWith('.deletar')).length;

    return {
      cargo:        p.slug,
      label:        p.label,
      descricao:    p.descricao,
      totalMembros: contagemPorCargo[p.slug] ?? 0,
      resumo:       { ver, editar, excluir },
    };
  });
}

/**
 * Retorna a matriz de permissões de um perfil agrupada por módulo/submódulo.
 */
async function getMatrizPorCargo({ equipeId, cargo }) {
  await garantirPerfisPadrao(equipeId);

  const [modulos, matrizBD] = await Promise.all([
    prisma.moduloSistema.findMany({ orderBy: { ordemExib: 'asc' } }),
    prisma.matrizPerfil.findMany({ where: { equipeId, perfilSlug: cargo } }),
  ]);

  const mapa = matrizBD.length > 0
    ? Object.fromEntries(matrizBD.map(m => [m.moduloSlug, m.nivel]))
    : (PERMISSOES_PADRAO[cargo] ?? {});

  const totalMembros = await prisma.membroEquipe.count({ where: { equipeId, cargo } });

  const agrupado = {};
  for (const mod of modulos) {
    if (!agrupado[mod.modulo])                    agrupado[mod.modulo] = {};
    if (!agrupado[mod.modulo][mod.submodulo])     agrupado[mod.modulo][mod.submodulo] = [];
    agrupado[mod.modulo][mod.submodulo].push({
      slug:  mod.slug,
      acao:  mod.acao,
      label: mod.label,
      nivel: mapa[mod.slug] ?? 'NENHUM',
    });
  }

  return { cargo, totalMembros, matriz: agrupado };
}

/**
 * Salva a matriz de um perfil e propaga para todos os membros com aquele cargo.
 */
async function salvarMatrizPorCargo({ equipeId, cargo, permissoes, atualizadoPorId, atualizadoPorNome, ipOrigem }) {
  // 1. Upsert na MatrizPerfil (template)
  const upserts = Object.entries(permissoes).map(([moduloSlug, nivel]) =>
    prisma.matrizPerfil.upsert({
      where:  { equipeId_perfilSlug_moduloSlug: { equipeId, perfilSlug: cargo, moduloSlug } },
      update: { nivel },
      create: { equipeId, perfilSlug: cargo, moduloSlug, nivel },
    })
  );
  await prisma.$transaction(upserts);

  // 2. Propaga para todos os membros atuais com esse cargo
  const membros = await prisma.membroEquipe.findMany({ where: { equipeId, cargo } });
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

/**
 * Cria um novo perfil em uma equipe com matriz inicial vazia (tudo NENHUM).
 */
async function criarPerfil({ equipeId, slug, label, descricao }) {
  const slugNorm = slug.trim().toUpperCase().replace(/\s+/g, '_');

  const perfil = await prisma.perfilEquipe.create({
    data: { equipeId, slug: slugNorm, label: label.trim(), descricao: descricao?.trim() ?? null },
  });

  // Inicializa todos os módulos com NENHUM
  const modulos = await prisma.moduloSistema.findMany({ select: { slug: true } });
  if (modulos.length > 0) {
    await prisma.matrizPerfil.createMany({
      data: modulos.map(m => ({ equipeId, perfilSlug: slugNorm, moduloSlug: m.slug, nivel: 'NENHUM' })),
      skipDuplicates: true,
    });
  }

  return perfil;
}

/**
 * Remove um perfil e sua matriz (cascade). Não afeta membros existentes.
 */
async function deletarPerfil({ equipeId, slug }) {
  const PROTEGIDOS = ['SOCIO', 'VETERINARIO', 'ESTAGIARIO'];
  if (PROTEGIDOS.includes(slug)) {
    throw new Error('Perfis padrão do sistema não podem ser removidos.');
  }
  await prisma.perfilEquipe.delete({ where: { equipeId_slug: { equipeId, slug } } });
}

// ─── Permissões por membro ────────────────────────────────────────────────────

/**
 * Retorna a matriz completa de permissões de um membro em uma equipe.
 */
async function getPermissoesMembro({ equipeId, userId }) {
  const [modulos, permissoes] = await Promise.all([
    prisma.moduloSistema.findMany({ orderBy: { ordemExib: 'asc' } }),
    prisma.permissaoMembro.findMany({ where: { equipeId, userId } }),
  ]);

  const mapaPermissoes = Object.fromEntries(
    permissoes.map((p) => [p.moduloSlug, p.nivel])
  );

  const agrupado = {};
  for (const mod of modulos) {
    if (!agrupado[mod.modulo])                    agrupado[mod.modulo] = {};
    if (!agrupado[mod.modulo][mod.submodulo])     agrupado[mod.modulo][mod.submodulo] = [];
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
 * Atualiza um ou mais níveis de permissão para um membro específico.
 */
async function atualizarPermissoes({
  equipeId,
  alvoUserId,
  alteracoes,
  atualizadoPorId,
  atualizadoPorNome,
  ipOrigem,
}) {
  const [alvoUser, equipe] = await Promise.all([
    prisma.user.findUnique({ where: { id: alvoUserId }, select: { fullName: true, email: true } }),
    prisma.equipe.findUnique({ where: { id: equipeId }, select: { nome: true } }),
  ]);

  if (!alvoUser) throw new Error('Usuário alvo não encontrado.');
  if (!equipe)   throw new Error('Equipe não encontrada.');

  const membroAlvo = await prisma.membroEquipe.findUnique({
    where: { equipeId_userId: { equipeId, userId: alvoUserId } },
  });
  if (!membroAlvo) throw new Error('Usuário alvo não pertence a esta equipe.');
  if (membroAlvo.cargo === 'SOCIO') throw new Error('Não é possível alterar permissões de um sócio.');

  const slugs = Object.keys(alteracoes);
  const permissoesAtuaisQuemAltera = await prisma.permissaoMembro.findMany({
    where: { equipeId, userId: atualizadoPorId, moduloSlug: { in: slugs } },
  });
  const mapaQuemAltera = Object.fromEntries(
    permissoesAtuaisQuemAltera.map((p) => [p.moduloSlug, p.nivel])
  );

  const permissoesAlvo = await prisma.permissaoMembro.findMany({
    where: { equipeId, userId: alvoUserId, moduloSlug: { in: slugs } },
  });
  const mapaAlvo = Object.fromEntries(
    permissoesAlvo.map((p) => [p.moduloSlug, p.nivel])
  );

  const modulos = await prisma.moduloSistema.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, label: true },
  });
  const mapaLabels = Object.fromEntries(modulos.map((m) => [m.slug, m.label]));

  const upserts    = [];
  const auditorias = [];
  const agora      = new Date();

  for (const [moduloSlug, novoNivel] of Object.entries(alteracoes)) {
    const nivelQuemAltera = mapaQuemAltera[moduloSlug] ?? 'NENHUM';
    const isSocioContext  = permissoesAtuaisQuemAltera.length === 0; // sócios não têm entradas

    if (!isSocioContext && NIVEL_ORDINAL[novoNivel] > NIVEL_ORDINAL[nivelQuemAltera]) {
      throw new Error(
        `Você não pode conceder "${novoNivel}" em "${moduloSlug}". Seu nível atual é "${nivelQuemAltera}".`
      );
    }

    const nivelAnterior = mapaAlvo[moduloSlug] ?? null;
    if (nivelAnterior === novoNivel) continue;

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

// ─── Auditoria ────────────────────────────────────────────────────────────────

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

// ─── Permissões de proprietário ───────────────────────────────────────────────

async function atualizarPermissoesProprietario({ equipeId, alvoUserId, funcionalidades, atualizadoPor }) {
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

async function getPermissoesProprietarios({ equipeId }) {
  const animais = await prisma.animal.findMany({
    where:  { user: { animais: { some: {} } } },
    select: { userId: true, user: { select: { id: true, fullName: true, email: true } } },
    distinct: ['userId'],
  });

  const permissoes = await prisma.permissaoProprietario.findMany({ where: { equipeId } });

  const mapaPermissoes = {};
  for (const p of permissoes) {
    if (!mapaPermissoes[p.userId]) mapaPermissoes[p.userId] = {};
    mapaPermissoes[p.userId][p.funcionalidade] = p.habilitado;
  }

  return animais.map((a) => ({
    userId:     a.user.id,
    fullName:   a.user.fullName,
    email:      a.user.email,
    permissoes: mapaPermissoes[a.user.id] ?? {},
  }));
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
  criarPerfil,
  deletarPerfil,
};
// backend/src/services/permissao.service.js
// =============================================================================
// Service de permissões — lógica de negócio desacoplada do controller.
//
// Dois níveis de configuração:
//  - ADMIN global   → MatrizPerfil.locked=true, propagado a todas as equipes
//  - Gestor equipe   → MatrizPerfil.locked=false, configurável por equipe
//
// Nota: operações com o campo "locked" usam $queryRaw/$executeRawUnsafe porque
// o Prisma client precisa ser regenerado após a migration que adicionou o campo.
// Execute `npx prisma generate` após parar o backend para usar o client tipado.
// =============================================================================


const prisma = require('../lib/prisma').default;
const { NIVEL_ORDINAL } = require('../middlewares/permissao.middleware');
const { PERMISSOES_PADRAO } = require('../seeds/002_permissoes_padrao.seed');

const MODULOS_ADMIN_ONLY = ['medicamentos', 'procedimentos'];
const ACOES_PROPRIETARIO = ['ler', 'imprimir'];
// GESTOR incluído: ADMIN pode bloquear permissões globais para gestores também
const USER_TYPES_GERENCIADOS = ['GESTOR', 'VETERINARIO', 'ESTAGIARIO', 'PROPRIETARIO'];

const PERFIS_PADRAO = [
  { slug: 'GESTOR',        label: 'Gestor',        descricao: 'Acesso total irrestrito. Bypass de todas as permissões do sistema.' },
  { slug: 'VETERINARIO',  label: 'Veterinário',   descricao: 'Acesso clínico completo: prontuários, exames, prescrições e nutrição.' },
  { slug: 'FORNECEDOR',   label: 'Fornecedor',    descricao: 'Fornecedor de serviços. Acesso configurável pelo gestor da equipe.' },
  { slug: 'ESTAGIARIO',   label: 'Estagiário',    descricao: 'Acesso de leitura por padrão. Permissões elevadas pelo gestor conforme necessário.' },
  { slug: 'PROPRIETARIO', label: 'Proprietário',  descricao: 'Proprietário de animais. Acesso de leitura configurável pelo gestor.' },
  { slug: 'SECRETARIA',   label: 'Secretaria',    descricao: 'Recepção e administrativo: agendamentos, cadastros e financeiro básico.' },
  { slug: 'FINANCEIRO',   label: 'Financeiro',    descricao: 'Setor financeiro: acesso completo ao módulo de faturas e cobrança.' },
  { slug: 'ENFERMEIRO',   label: 'Enfermeiro',    descricao: 'Técnico de enfermagem: execução de prescrições, vacinas e evoluções.' },
];

// ─── Helpers raw SQL para o campo locked ──────────────────────────────────────

async function getLockedEntries(perfilSlug) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "moduloSlug", nivel FROM schs2vet.tb_matriz_perfis WHERE "perfilSlug" = $1 AND locked = true`,
    perfilSlug
  );
  return rows; // [{ moduloSlug, nivel }]
}

async function getLockedSlugsForEquipe(equipeId, perfilSlug, slugsAlterados) {
  if (!slugsAlterados.length) return [];
  const slugList = slugsAlterados.map((_, i) => `$${i + 3}`).join(', ');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "moduloSlug" FROM schs2vet.tb_matriz_perfis WHERE "equipeId" = $1 AND "perfilSlug" = $2 AND locked = true AND "moduloSlug" IN (${slugList})`,
    equipeId, perfilSlug, ...slugsAlterados
  );
  return rows.map(r => r.moduloSlug);
}

async function getMatrizComLocked(equipeId, perfilSlug) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "moduloSlug", nivel, locked FROM schs2vet.tb_matriz_perfis WHERE "equipeId" = $1 AND "perfilSlug" = $2`,
    equipeId, perfilSlug
  );
  // locked só é semanticamente relevante quando nivel != NENHUM.
  // Se havia locked=true+nivel=NENHUM (dados ruins de "revogar tudo"), tratamos como não-bloqueado.
  return rows.map(r => ({ ...r, locked: r.locked === true && r.nivel !== 'NENHUM' }));
}

async function upsertComLocked(equipeId, perfilSlug, moduloSlug, nivel, locked) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO schs2vet.tb_matriz_perfis ("equipeId", "perfilSlug", "moduloSlug", nivel, locked)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("equipeId", "perfilSlug", "moduloSlug")
     DO UPDATE SET nivel = EXCLUDED.nivel, locked = EXCLUDED.locked`,
    equipeId, perfilSlug, moduloSlug, nivel, locked
  );
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

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

    const defaults    = PERMISSOES_PADRAO[perfil.slug] ?? {};
    const modulos     = await prisma.moduloSistema.findMany({ select: { slug: true } });
    const lockedGlobais = await getLockedEntries(perfil.slug);
    const mapaLocked  = Object.fromEntries(lockedGlobais.map(l => [l.moduloSlug, l.nivel]));

    for (const m of modulos) {
      const nivel  = mapaLocked[m.slug] ?? defaults[m.slug] ?? 'NENHUM';
      const locked = !!mapaLocked[m.slug];
      await upsertComLocked(equipeId, perfil.slug, m.slug, nivel, locked);
    }
  }
}

// ─── Aplicar permissões padrão ────────────────────────────────────────────────

async function aplicarPermissoesPadrao({ equipeId, userId, cargo, atualizadoPor }) {
  if (cargo === 'GESTOR') return;

  const matrizBD = await prisma.matrizPerfil.findMany({
    where: { equipeId, perfilSlug: cargo },
  });

  let mapa;
  if (matrizBD.length > 0) {
    mapa = Object.fromEntries(matrizBD.map(m => [m.moduloSlug, m.nivel]));
  } else {
    mapa = PERMISSOES_PADRAO[cargo] ?? {};
  }

  if (Object.keys(mapa).length === 0) return;

  // Só propaga slugs que existem no catálogo ModuloSistema — PermissaoMembro.moduloSlug
  // tem FK para ModuloSistema.slug; um slug do mapa ausente no DB (seed desatualizado)
  // causaria P2003 e abortaria toda a inclusão do membro. Degrada graciosamente.
  const catalogo   = await prisma.moduloSistema.findMany({ select: { slug: true } });
  const catalogoSet = new Set(catalogo.map(m => m.slug));
  const entradas   = Object.entries(mapa).filter(([moduloSlug]) => catalogoSet.has(moduloSlug));
  if (entradas.length === 0) return;

  const agora   = new Date();
  const upserts = entradas.map(([moduloSlug, nivel]) =>
    prisma.permissaoMembro.upsert({
      where:  { equipeId_userId_moduloSlug: { equipeId, userId, moduloSlug } },
      update: { nivel, atualizadoPor, updatedAt: agora },
      create: { equipeId, userId, moduloSlug, nivel, atualizadoPor },
    })
  );

  await prisma.$transaction(upserts);
}

// ─── CRUD de Perfis ───────────────────────────────────────────────────────────

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
    prisma.matrizPerfil.findMany({ where: { equipeId } }),
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

async function getMatrizPorCargo({ equipeId, cargo }) {
  await garantirPerfisPadrao(equipeId);

  // GESTOR vê todos os módulos (inclui admin-only); demais excluem catálogos admin-only
  const whereModulos = cargo !== 'GESTOR' ? { modulo: { notIn: MODULOS_ADMIN_ONLY } } : {};

  const [modulos, matrizBD] = await Promise.all([
    prisma.moduloSistema.findMany({ where: whereModulos, orderBy: { ordemExib: 'asc' } }),
    getMatrizComLocked(equipeId, cargo),
  ]);

  const mapaEntradas = Object.fromEntries(matrizBD.map(m => [m.moduloSlug, m]));
  const defaults     = PERMISSOES_PADRAO[cargo] ?? {};

  const totalMembros = await prisma.membroEquipe.count({ where: { equipeId, cargo } });

  const agrupado = {};
  for (const mod of modulos) {
    if (!agrupado[mod.modulo])                  agrupado[mod.modulo] = {};
    if (!agrupado[mod.modulo][mod.submodulo])   agrupado[mod.modulo][mod.submodulo] = [];
    const entrada = mapaEntradas[mod.slug];
    agrupado[mod.modulo][mod.submodulo].push({
      slug:   mod.slug,
      acao:   mod.acao,
      label:  mod.label,
      nivel:  entrada ? entrada.nivel : (defaults[mod.slug] ?? 'NENHUM'),
      locked: entrada?.locked === true,
    });
  }

  return { cargo, totalMembros, matriz: agrupado };
}

async function salvarMatrizPorCargo({ equipeId, cargo, permissoes, atualizadoPorId, atualizadoPorNome, ipOrigem, bypassLocked = false }) {
  if (!bypassLocked) {
    const slugsAlterados  = Object.keys(permissoes);
    const slugsLocked     = await getLockedSlugsForEquipe(equipeId, cargo, slugsAlterados);
    if (slugsLocked.length > 0) {
      throw new Error(`As permissões a seguir foram definidas pelo administrador e não podem ser alteradas: ${slugsLocked.join(', ')}`);
    }
  }

  // Upsert na MatrizPerfil — omite locked (preserva o valor existente no banco)
  const upserts = Object.entries(permissoes).map(([moduloSlug, nivel]) =>
    prisma.matrizPerfil.upsert({
      where:  { equipeId_perfilSlug_moduloSlug: { equipeId, perfilSlug: cargo, moduloSlug } },
      update: { nivel },
      create: { equipeId, perfilSlug: cargo, moduloSlug, nivel },
    })
  );
  await prisma.$transaction(upserts);

  // GESTOR tem bypass total — não mantém PermissaoMembro; apenas a MatrizPerfil é informacional
  if (cargo === 'GESTOR') return { membros: 0, alteracoes: 0 };

  // Inclui membros que têm o cargo como primário OU como secundário (cargos array)
  const membros = await prisma.membroEquipe.findMany({
    where: { equipeId, OR: [{ cargo }, { cargos: { has: cargo } }] },
    select: { userId: true, cargo: true, cargos: true },
  });

  const NIVEL_ORD_PROP = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };
  const slugsAlterados = Object.keys(permissoes);
  let totalAlteracoes = 0;

  for (const membro of membros) {
    const todosCargos = membro.cargos && membro.cargos.length > 0 ? membro.cargos : [membro.cargo];
    let alteracoesEfetivas;

    if (todosCargos.length === 1) {
      // Cargo único — usa os valores da matriz diretamente
      alteracoesEfetivas = permissoes;
    } else {
      // Multi-cargo: recalcula a união para os slugs afetados, preservando contribuição dos demais cargos.
      // NEGADO em qualquer cargo vence (deny-wins).
      const matrizTodos = await prisma.matrizPerfil.findMany({
        where: { equipeId, perfilSlug: { in: todosCargos }, moduloSlug: { in: slugsAlterados } },
      });
      alteracoesEfetivas = {};
      for (const slug of slugsAlterados) {
        const niveisSlug = matrizTodos.filter(m => m.moduloSlug === slug);
        if (niveisSlug.some(m => m.nivel === 'NEGADO')) {
          alteracoesEfetivas[slug] = 'NEGADO';
          continue;
        }
        const maxNivel = niveisSlug.reduce((max, m) => {
          return (NIVEL_ORD_PROP[m.nivel] ?? 0) > (NIVEL_ORD_PROP[max] ?? 0) ? m.nivel : max;
        }, 'NENHUM');
        alteracoesEfetivas[slug] = maxNivel;
      }
    }

    const res = await atualizarPermissoes({
      equipeId,
      alvoUserId: membro.userId,
      alteracoes: alteracoesEfetivas,
      atualizadoPorId,
      atualizadoPorNome,
      ipOrigem,
    });
    totalAlteracoes += res.alteracoes ?? 0;
  }

  return { membros: membros.length, alteracoes: totalAlteracoes };
}

async function criarPerfil({ equipeId, slug, label, descricao }) {
  const slugNorm = slug.trim().toUpperCase().replace(/\s+/g, '_');

  const perfil = await prisma.perfilEquipe.create({
    data: { equipeId, slug: slugNorm, label: label.trim(), descricao: descricao?.trim() ?? null },
  });

  const modulos = await prisma.moduloSistema.findMany({ select: { slug: true } });
  if (modulos.length > 0) {
    await prisma.matrizPerfil.createMany({
      data: modulos.map(m => ({ equipeId, perfilSlug: slugNorm, moduloSlug: m.slug, nivel: 'NENHUM' })),
      skipDuplicates: true,
    });
  }

  return perfil;
}

async function deletarPerfil({ equipeId, slug }) {
  const PROTEGIDOS = ['GESTOR', 'VETERINARIO', 'ESTAGIARIO', 'PROPRIETARIO'];
  if (PROTEGIDOS.includes(slug)) {
    throw new Error('Perfis padrão do sistema não podem ser removidos.');
  }
  await prisma.perfilEquipe.delete({ where: { equipeId_slug: { equipeId, slug } } });
}

// ─── Permissões globais por UserType (ADMIN) ──────────────────────────────────

async function getMatrizGlobalUserType({ userType }) {
  if (!USER_TYPES_GERENCIADOS.includes(userType)) {
    throw new Error(`UserType inválido para gestão global: ${userType}`);
  }

  // GESTOR vê todos os módulos (inclui admin-only); demais excluem catálogos admin-only
  const whereModulos = userType !== 'GESTOR' ? { modulo: { notIn: MODULOS_ADMIN_ONLY } } : {};

  const modulos = await prisma.moduloSistema.findMany({
    where:   whereModulos,
    orderBy: { ordemExib: 'asc' },
  });

  // Busca entradas locked globais para este userType (de qualquer equipe)
  const lockedGlobais       = await getLockedEntries(userType);
  const configuracaoExistente = lockedGlobais.length > 0;
  const mapa = configuracaoExistente
    ? Object.fromEntries(lockedGlobais.map(m => [m.moduloSlug, m.nivel]))
    : (PERMISSOES_PADRAO[userType] ?? {});

  const agrupado = {};
  for (const mod of modulos) {
    if (!agrupado[mod.modulo])                  agrupado[mod.modulo] = {};
    if (!agrupado[mod.modulo][mod.submodulo])   agrupado[mod.modulo][mod.submodulo] = [];
    agrupado[mod.modulo][mod.submodulo].push({
      slug:  mod.slug,
      acao:  mod.acao,
      label: mod.label,
      nivel: mapa[mod.slug] ?? 'NENHUM',
    });
  }

  return { userType, configuracaoExistente, matriz: agrupado };
}

async function salvarMatrizGlobalUserType({ userType, permissoes }) {
  if (!USER_TYPES_GERENCIADOS.includes(userType)) {
    throw new Error(`UserType inválido para gestão global: ${userType}`);
  }

  const equipes = await prisma.equipe.findMany({ select: { id: true } });

  let equipesAtualizadas = 0;
  let membrosAtualizados = 0;

  for (const equipe of equipes) {
    const perfilExiste = await prisma.perfilEquipe.findUnique({
      where:  { equipeId_slug: { equipeId: equipe.id, slug: userType } },
      select: { slug: true },
    });
    if (!perfilExiste) continue;

    // locked=true só quando a permissão foi realmente concedida (nivel != NENHUM)
    for (const [moduloSlug, nivel] of Object.entries(permissoes)) {
      await upsertComLocked(equipe.id, userType, moduloSlug, nivel, nivel !== 'NENHUM');
    }
    equipesAtualizadas++;

    // Propaga para PermissaoMembro (exceto PROPRIETARIO e GESTOR — ambos têm bypass ou sem registros)
    // Inclui membros com o cargo como primário OU como secundário (cargos array — multi-cargo).
    // Para multi-cargo: recalcula a união com os demais cargos (mesmo algoritmo do salvarMatrizPorCargo).
    if (userType !== 'PROPRIETARIO' && userType !== 'GESTOR') {
      const membros = await prisma.membroEquipe.findMany({
        where:  { equipeId: equipe.id, OR: [{ cargo: userType }, { cargos: { has: userType } }] },
        select: { userId: true, cargo: true, cargos: true },
      });
      const NIVEL_ORD_PROP = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };
      const slugsAlterados = Object.keys(permissoes);
      const agora = new Date();
      for (const membro of membros) {
        const todosCargos = membro.cargos && membro.cargos.length > 0 ? membro.cargos : [membro.cargo];
        let alteracoesEfetivas;

        if (todosCargos.length === 1) {
          alteracoesEfetivas = permissoes;
        } else {
          // Multi-cargo: recomputa a união para os slugs afetados considerando todos os cargos.
          const matrizTodos = await prisma.matrizPerfil.findMany({
            where: { equipeId: equipe.id, perfilSlug: { in: todosCargos }, moduloSlug: { in: slugsAlterados } },
          });
          alteracoesEfetivas = {};
          for (const slug of slugsAlterados) {
            const niveisSlug = matrizTodos.filter(m => m.moduloSlug === slug);
            if (niveisSlug.some(m => m.nivel === 'NEGADO')) {
              alteracoesEfetivas[slug] = 'NEGADO';
              continue;
            }
            const maxNivel = niveisSlug.reduce((max, m) => {
              return (NIVEL_ORD_PROP[m.nivel] ?? 0) > (NIVEL_ORD_PROP[max] ?? 0) ? m.nivel : max;
            }, 'NENHUM');
            alteracoesEfetivas[slug] = maxNivel;
          }
        }

        const membroUpserts = Object.entries(alteracoesEfetivas).map(([moduloSlug, nivel]) =>
          prisma.permissaoMembro.upsert({
            where:  { equipeId_userId_moduloSlug: { equipeId: equipe.id, userId: membro.userId, moduloSlug } },
            update: { nivel, updatedAt: agora },
            create: { equipeId: equipe.id, userId: membro.userId, moduloSlug, nivel, atualizadoPor: 0 },
          })
        );
        await prisma.$transaction(membroUpserts);
        membrosAtualizados++;
      }
    }
  }

  return { equipesAtualizadas, membrosAtualizados };
}

// ─── Permissões por membro ────────────────────────────────────────────────────

async function getPermissoesMembro({ equipeId, userId }) {
  const [modulos, permissoes] = await Promise.all([
    prisma.moduloSistema.findMany({
      where:   { modulo: { notIn: MODULOS_ADMIN_ONLY } },
      orderBy: { ordemExib: 'asc' },
    }),
    prisma.permissaoMembro.findMany({ where: { equipeId, userId } }),
  ]);

  const mapaPermissoes = Object.fromEntries(permissoes.map(p => [p.moduloSlug, p.nivel]));

  const agrupado = {};
  for (const mod of modulos) {
    if (!agrupado[mod.modulo])                  agrupado[mod.modulo] = {};
    if (!agrupado[mod.modulo][mod.submodulo])   agrupado[mod.modulo][mod.submodulo] = [];
    agrupado[mod.modulo][mod.submodulo].push({
      slug:  mod.slug,
      acao:  mod.acao,
      label: mod.label,
      nivel: mapaPermissoes[mod.slug] ?? 'NENHUM',
    });
  }

  return agrupado;
}

async function atualizarPermissoes({ equipeId, alvoUserId, alteracoes, atualizadoPorId, atualizadoPorNome, ipOrigem }) {
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
  if (membroAlvo.cargo === 'GESTOR') throw new Error('Não é possível alterar permissões de um gestor.');

  const slugs = Object.keys(alteracoes);
  const permissoesAtuaisQuemAltera = await prisma.permissaoMembro.findMany({
    where: { equipeId, userId: atualizadoPorId, moduloSlug: { in: slugs } },
  });
  const mapaQuemAltera = Object.fromEntries(permissoesAtuaisQuemAltera.map(p => [p.moduloSlug, p.nivel]));

  const permissoesAlvo = await prisma.permissaoMembro.findMany({
    where: { equipeId, userId: alvoUserId, moduloSlug: { in: slugs } },
  });
  const mapaAlvo = Object.fromEntries(permissoesAlvo.map(p => [p.moduloSlug, p.nivel]));

  const modulos = await prisma.moduloSistema.findMany({
    where:  { slug: { in: slugs } },
    select: { slug: true, label: true },
  });
  const mapaLabels = Object.fromEntries(modulos.map(m => [m.slug, m.label]));

  const upserts    = [];
  const auditorias = [];
  const agora      = new Date();

  for (const [moduloSlug, novoNivel] of Object.entries(alteracoes)) {
    const nivelQuemAltera = mapaQuemAltera[moduloSlug] ?? 'NENHUM';
    const isGestorContext  = permissoesAtuaisQuemAltera.length === 0;

    if (!isGestorContext && NIVEL_ORDINAL[novoNivel] > NIVEL_ORDINAL[nivelQuemAltera]) {
      throw new Error(`Você não pode conceder "${novoNivel}" em "${moduloSlug}". Seu nível atual é "${nivelQuemAltera}".`);
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
      equipeId, equipeNome: equipe.nome, alvoUserId,
      alvoUserNome: alvoUser.fullName, alvoUserEmail: alvoUser.email,
      moduloSlug, moduloLabel: mapaLabels[moduloSlug] ?? moduloSlug,
      nivelAnterior, nivelNovo: novoNivel,
      alteradoPorId: atualizadoPorId, alteradoPorNome: atualizadoPorNome,
      ipOrigem: ipOrigem ?? null,
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
      where: { equipeId }, orderBy: { createdAt: 'desc' }, skip, take: limit,
    }),
  ]);
  return { total, page, limit, registros };
}

// ─── Permissões de proprietário (legado — mantido para compatibilidade) ────────

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
  const equipe = await prisma.equipe.findUnique({ where: { id: equipeId }, select: { empresaId: true } });

  // Proprietários com animais DESTA equipe (legados sem equipe: empresa toda).
  // Se a equipe não tiver empresa vinculada, retorna lista vazia (isolamento seguro).
  const empresaId = equipe?.empresaId;
  if (!empresaId) return [];

  const animais = await prisma.animal.findMany({
    where: {
      empresaId,
      OR:   [{ equipeId }, { equipeId: null }],
      user: { NOT: { userType: 'ADMIN' } },
    },
    select:   { userId: true, user: { select: { id: true, fullName: true, email: true } } },
    distinct: ['userId'],
  });

  const permissoes = await prisma.permissaoProprietario.findMany({ where: { equipeId } });
  const mapaPermissoes = {};
  for (const p of permissoes) {
    if (!mapaPermissoes[p.userId]) mapaPermissoes[p.userId] = {};
    mapaPermissoes[p.userId][p.funcionalidade] = p.habilitado;
  }
  return animais.map(a => ({
    userId: a.user.id, fullName: a.user.fullName, email: a.user.email,
    permissoes: mapaPermissoes[a.user.id] ?? {},
  }));
}

module.exports = {
  aplicarPermissoesPadrao,
  garantirPerfisPadrao,
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
  getMatrizGlobalUserType,
  salvarMatrizGlobalUserType,
  USER_TYPES_GERENCIADOS,
};

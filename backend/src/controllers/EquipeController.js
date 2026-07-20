// backend/src/controllers/EquipeController.js
'use strict';

const bcrypt           = require('bcryptjs');
const emailService     = require('../services/emailService');
const PermissaoService = require('../services/PermissaoService');
const { PERMISSOES_PADRAO } = require('../seeds/002_permissoes_padrao.seed');
const { getEquipeIdsDoProprietario } = require('../middlewares/permissao.middleware');
const { storage }      = require('../storage');
const { TIPOS_FECHAMENTO_VALIDOS } = require('../lib/faturaUtils');

const prisma = require('../lib/prisma').default;

// ─── Helper: encontra a empresa do usuário (owner OU gestor convidado) ─────────
// empresaIdPreferida (req.empresaId, vindo do seletor de empresa no frontend):
// usada se o usuário for dono OU gestor dela; caso contrário cai no fallback.
async function getEmpresaDoGestor(userId, empresaIdPreferida = null) {
  if (empresaIdPreferida) {
    const preferida = await prisma.empresa.findFirst({
      where: {
        id: Number(empresaIdPreferida),
        OR: [
          { ownerId: userId },
          { equipes: { some: { membros: { some: { userId, cargo: 'GESTOR' } } } } },
        ],
      },
    });
    if (preferida) return preferida;
  }

  // 1. Usuário é dono (ownerId)
  let empresa = await prisma.empresa.findFirst({ where: { ownerId: userId } });
  if (empresa) return empresa;

  // 2. Usuário é gestor convidado (cargo: 'GESTOR' em alguma equipe)
  const assoc = await prisma.membroEquipe.findFirst({
    where:   { userId, cargo: 'GESTOR' },
    include: { equipe: { select: { empresaId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (assoc?.equipe?.empresaId) {
    return prisma.empresa.findUnique({ where: { id: assoc.equipe.empresaId } });
  }
  return null;
}

// ─── Helper: garante empresa + equipe padrão do vet ──────────────────────────
// equipeIdPreferida (req.equipeId — equipe ativa do gestor CPF): usada se pertencer à empresa.
async function garantirEquipePadrao(vetUserId, empresaIdPreferida = null, equipeIdPreferida = null) {
  let empresa = await getEmpresaDoGestor(vetUserId, empresaIdPreferida);
  if (!empresa) {
    const vetUser = await prisma.user.findUnique({ where: { id: vetUserId }, select: { fullName: true } });
    empresa = await prisma.empresa.create({
      data: { nome: `Clínica de ${vetUser?.fullName ?? 'Veterinário'}`, ownerId: vetUserId },
    });
  }

  let equipe = null;
  if (equipeIdPreferida) {
    equipe = await prisma.equipe.findFirst({
      where: { id: Number(equipeIdPreferida), empresaId: empresa.id },
    });
  }
  // orderBy createdAt asc: mesma equipe "primeira" que listarMembros escolhe — evita
  // inclusão e listagem divergirem quando não há equipe ativa no contexto.
  if (!equipe) equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id }, orderBy: { createdAt: 'asc' } });
  if (!equipe) {
    equipe = await prisma.equipe.create({
      data: { nome: 'Equipe Principal', empresaId: empresa.id },
    });
  }

  return { empresa, equipe };
}

// ─── Helper: equipe ativa dentro da empresa ───────────────────────────────────
// Prefere req.equipeId (seletor do gestor CPF) se a equipe pertencer à empresa;
// caso contrário cai na primeira equipe da empresa.
async function getEquipeAtiva(empresaId, equipeIdPreferida = null) {
  if (equipeIdPreferida) {
    const equipe = await prisma.equipe.findFirst({
      where: { id: Number(equipeIdPreferida), empresaId },
    });
    if (equipe) return equipe;
  }
  return prisma.equipe.findFirst({ where: { empresaId } });
}

// ─── Helper: resolve o escopo (empresaId + equipeId) da EmpresaConfiguracao ───
// Empresa com CNPJ → configuração única por empresa (equipeId null).
// Empresa pessoal (CNPJ null) → configuração única por equipe ativa.
// Retorna null se o usuário não for dono nem gestor de nenhuma empresa/equipe (mesmo
// critério de getEmpresaDoGestor/getEquipeAtiva — caller trata como 404).
async function resolverEscopoConfiguracao(req) {
  const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
  if (!empresa) return null;
  if (empresa.cnpj) return { empresaId: empresa.id, equipeId: null };
  const equipe = await getEquipeAtiva(empresa.id, req.equipeId);
  if (!equipe) return null;
  return { empresaId: empresa.id, equipeId: equipe.id };
}

// Espécies atendidas: coluna TEXT com CSV de IDs de Especie. Converte de/para array de números.
function parseEspeciesAtendidas(csv) {
  if (!csv) return [];
  return String(csv).split(',').map(s => Number(s.trim())).filter(Number.isInteger);
}

// Resolve o escopo da configuração para QUALQUER membro do contexto ativo (não só
// gestor) — usado para leitura do expediente de atendimento pelo Agendamento.
// Baseia-se em req.empresaId/req.equipeId já validados pelo auth.
async function resolverEscopoConfiguracaoMembro(req) {
  if (!req.empresaId) return null;
  const empresa = await prisma.empresa.findUnique({ where: { id: req.empresaId }, select: { id: true, cnpj: true } });
  if (!empresa) return null;
  if (empresa.cnpj) return { empresaId: empresa.id, equipeId: null };
  let equipeId = req.equipeId ?? null;
  if (!equipeId) {
    const eq = await prisma.equipe.findFirst({ where: { empresaId: empresa.id }, orderBy: { id: 'asc' }, select: { id: true } });
    if (!eq) return null;
    equipeId = eq.id;
  }
  return { empresaId: empresa.id, equipeId };
}

// Prisma rejeita `null` num campo de chave única composta em findUnique/upsert.
// Empresa com CNPJ usa equipeId=null → usar findFirst, que traduz `equipeId: null`
// para `IS NULL` corretamente.
async function buscarConfiguracao(escopo) {
  return prisma.empresaConfiguracao.findFirst({
    where: { empresaId: escopo.empresaId, equipeId: escopo.equipeId },
  });
}

// ─── Helper: onboarding de vet convidado ─────────────────────────────────────
// Marca isConvidado=true e copia espécies do dono da equipe para o vet convidado
// (somente se o convidado for VETERINARIO e ainda não tiver espécies cadastradas)
async function aplicarOnboardingConvidado(userId, equipeId) {
  const CARGOS_VET = ['VETERINARIO', 'ADMIN'];
  const usuario = await prisma.user.findUnique({
    where:  { id: userId },
    select: { userType: true },
  });

  // Sempre marca como convidado — SQL raw para não depender do prisma generate
  try {
    await prisma.$executeRawUnsafe(`UPDATE schs2vet.users SET "isConvidado" = true WHERE id = $1`, userId);
  } catch { /* coluna ainda não existe no DB legado — ignora */ }

  // Copia espécies somente para vets sem espécies ainda
  if (!usuario || !CARGOS_VET.includes(usuario.userType)) return;

  const equipe = await prisma.equipe.findUnique({
    where:   { id: equipeId },
    include: { empresa: { select: { ownerId: true } } },
  });
  if (!equipe?.empresa?.ownerId) return;

  const vetPerfilDono = await prisma.vetPerfil.findUnique({
    where:   { userId: equipe.empresa.ownerId },
    include: { especies: { select: { especieId: true } } },
  });
  const especiesDonoIds = vetPerfilDono?.especies.map(e => e.especieId) ?? [];
  if (especiesDonoIds.length === 0) return;

  // Cria VetPerfil do convidado se não existir
  let perfilConvidado = await prisma.vetPerfil.findUnique({ where: { userId } });
  if (!perfilConvidado) {
    perfilConvidado = await prisma.vetPerfil.create({ data: { userId } });
  }

  // Só copia se o convidado ainda não tem espécies próprias
  const especiesConvidado = await prisma.vetEspecie.count({ where: { vetPerfilId: perfilConvidado.id } });
  if (especiesConvidado > 0) return;

  const upserts = especiesDonoIds.map(especieId =>
    prisma.vetEspecie.upsert({
      where:  { vetPerfilId_especieId: { vetPerfilId: perfilConvidado.id, especieId } },
      update: {},
      create: { vetPerfilId: perfilConvidado.id, especieId },
    })
  );
  await prisma.$transaction(upserts);
}

const { USER_TYPES_GERENCIADOS } = PermissaoService;

const NIVEL_ORDER = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };

// Anexa a cada membro os perfis do usuário — exibidos na coluna "Perfis" do
// ControleAcesso. PRIVACIDADE: os perfis são exclusivos de cada empresa — o que
// o usuário é em OUTRA empresa (gestor da própria, estagiário de terceiros etc.)
// não aparece para ninguém fora dela. Por padrão o escopo é a empresa da equipe
// listada ({ empresaId }); apenas o ADMIN da plataforma vê tudo ({ todos: true }).
async function anexarPerfisGlobais(membros, { empresaId = null, todos = false } = {}) {
  const userIds = [...new Set(membros.map(m => m.user.id))];
  if (userIds.length === 0) return membros;
  const [vinculos, donos] = await Promise.all([
    prisma.membroEquipe.findMany({
      where: {
        userId: { in: userIds },
        ...(todos ? {} : { equipe: { empresaId: empresaId ? Number(empresaId) : -1 } }),
      },
      select: { userId: true, cargo: true, cargos: true },
    }),
    prisma.empresa.findMany({
      where: {
        ownerId: { in: userIds },
        ...(todos ? {} : { id: empresaId ? Number(empresaId) : -1 }),
      },
      select: { ownerId: true },
    }),
  ]);
  const perfisPorUser = new Map();
  const add = (userId, cargo) => {
    if (!cargo) return;
    if (!perfisPorUser.has(userId)) perfisPorUser.set(userId, new Set());
    perfisPorUser.get(userId).add(cargo);
  };
  for (const v of vinculos) {
    add(v.userId, v.cargo);
    for (const c of (v.cargos ?? [])) add(v.userId, c);
  }
  for (const d of donos) add(d.ownerId, 'GESTOR');
  return membros.map(m => ({ ...m, perfisGlobais: [...(perfisPorUser.get(m.user.id) ?? [])] }));
}

// ─── Expediente de trabalho do MEMBRO (via SQL raw — colunas novas em tb_membros_equipe) ──
// Valida e normaliza os campos do body. Cada campo: undefined = não altera; ''/[] = limpa.
function parseExpedienteTrabalho(body) {
  let dias; // undefined = não enviado
  if (body.diasTrabalho !== undefined) {
    const arr = Array.isArray(body.diasTrabalho)
      ? body.diasTrabalho
      : String(body.diasTrabalho).split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length === 0) dias = null;
    else {
      const nums = [...new Set(arr.map(Number))].sort((a, b) => a - b);
      if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 6)) return { erro: 'Dias de trabalho inválidos (0=Dom … 6=Sáb).' };
      dias = nums.join(',');
    }
  }
  const parseHora = (v) => {
    if (v === undefined) return undefined;
    const s = String(v).trim();
    if (s === '') return null;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return '__ERRO__';
    return s;
  };
  const hi = parseHora(body.horaInicioTrabalho);
  const hf = parseHora(body.horaFimTrabalho);
  if (hi === '__ERRO__' || hf === '__ERRO__') return { erro: 'Horário de trabalho inválido — use HH:MM.' };
  if (hi && hf && hi >= hf) return { erro: 'A hora de início do trabalho deve ser menor que a de término.' };
  return { diasTrabalho: dias, horaInicioTrabalho: hi, horaFimTrabalho: hf };
}

// Grava só os campos enviados (undefined = não altera).
async function gravarExpedienteTrabalho(membroId, exp) {
  const sets = [], vals = [];
  let i = 1;
  if (exp.diasTrabalho       !== undefined) { sets.push(`"diasTrabalho"=$${i++}`);       vals.push(exp.diasTrabalho); }
  if (exp.horaInicioTrabalho !== undefined) { sets.push(`"horaInicioTrabalho"=$${i++}`); vals.push(exp.horaInicioTrabalho); }
  if (exp.horaFimTrabalho    !== undefined) { sets.push(`"horaFimTrabalho"=$${i++}`);    vals.push(exp.horaFimTrabalho); }
  if (sets.length === 0) return;
  vals.push(Number(membroId));
  await prisma.$executeRawUnsafe(`UPDATE schs2vet.tb_membros_equipe SET ${sets.join(', ')} WHERE id=$${i}`, ...vals);
}

// Anexa diasTrabalho/horaInicioTrabalho/horaFimTrabalho a uma lista de membros já carregados.
// Resolução POR PROFISSIONAL: usa o expediente do vínculo do contexto; se ele estiver
// vazio, herda o expediente que o profissional definiu em QUALQUER vínculo (o mais
// recente). Assim o expediente "definido uma vez" aparece em qualquer equipe/agenda.
async function anexarExpedienteTrabalho(membros) {
  const ids     = membros.map(m => m.id).filter(Boolean);
  const userIds = [...new Set(membros.map(m => m.user?.id).filter(Boolean))];
  if (ids.length === 0) return membros;
  const [rowsMembro, rowsUser] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT id, "diasTrabalho", "horaInicioTrabalho", "horaFimTrabalho"
         FROM schs2vet.tb_membros_equipe WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`,
      ...ids,
    ),
    userIds.length
      ? prisma.$queryRawUnsafe(
          `SELECT DISTINCT ON ("userId") "userId", "diasTrabalho", "horaInicioTrabalho", "horaFimTrabalho"
             FROM schs2vet.tb_membros_equipe
            WHERE "userId" IN (${userIds.map((_, i) => `$${i + 1}`).join(', ')})
              AND ("diasTrabalho" IS NOT NULL OR "horaInicioTrabalho" IS NOT NULL OR "horaFimTrabalho" IS NOT NULL)
            ORDER BY "userId", id DESC`,
          ...userIds,
        )
      : [],
  ]);
  const porMembro = new Map(rowsMembro.map(r => [r.id, r]));
  const porUser   = new Map(rowsUser.map(r => [r.userId, r]));
  return membros.map(m => {
    const e = porMembro.get(m.id) ?? {};
    const u = porUser.get(m.user?.id) ?? {};
    return {
      ...m,
      diasTrabalho:       e.diasTrabalho       ?? u.diasTrabalho       ?? null,
      horaInicioTrabalho: e.horaInicioTrabalho ?? u.horaInicioTrabalho ?? null,
      horaFimTrabalho:    e.horaFimTrabalho    ?? u.horaFimTrabalho    ?? null,
    };
  });
}

const EquipeController = {

  // ── Empresas ────────────────────────────────────────────────────────────────

  criarEmpresa: async (req, res) => {
    try {
      const { nome, cnpj, telefone, endereco } = req.body;
      if (!nome?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });

      const nomeTrim = nome.trim();
      const cnpjNorm = cnpj?.trim() ? cnpj.replace(/\D/g, '') : null;

      // Duplicidade: mesmo gestor (e-mail) + mesmo nome + mesmo CPF/CNPJ → bloqueia.
      // cnpj null = empresa pessoal (CPF do owner, fixo por usuário) — coberto pelo mesmo check.
      const duplicada = await prisma.empresa.findFirst({
        where: { ownerId: req.user.id, nome: { equals: nomeTrim, mode: 'insensitive' }, cnpj: cnpjNorm },
      });
      if (duplicada) {
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma empresa com este nome e CPF/CNPJ para o seu usuário.' });
      }

      const empresa = await prisma.empresa.create({
        data: { nome: nomeTrim, cnpj: cnpjNorm, telefone: telefone || null, endereco: endereco || null, ownerId: req.user.id },
      });
      // Instância de WhatsApp exclusiva da clínica (Evolution API) — best-effort,
      // nunca bloqueia o cadastro; o Conectar da tela de Configurações cobre falhas.
      require('../services/whatsappService').provisionarPorEmpresa(empresa.id).catch(() => {});
      res.status(201).json({ sucesso: true, dados: empresa });
    } catch (err) {
      console.error('Erro ao criar empresa:', err);
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma empresa com este nome e CPF/CNPJ para o seu usuário.' });
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  listarEmpresas: async (req, res) => {
    try {
      const userId = req.user.id;
      // Inclui empresas onde é owner OU onde é gestor convidado (cargo: 'GESTOR')
      const membroGestor = await prisma.membroEquipe.findMany({
        where:   { userId, cargo: 'GESTOR' },
        select:  { equipe: { select: { empresaId: true } } },
      });
      const empresaIdsGestor = membroGestor.map(m => m.equipe.empresaId).filter(Boolean);

      const empresas = await prisma.empresa.findMany({
        where:   { OR: [{ ownerId: userId }, { id: { in: empresaIdsGestor } }] },
        include: { equipes: { include: { _count: { select: { membros: true } } } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ sucesso: true, dados: empresas });
    } catch (err) {
      console.error('Erro ao listar empresas:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // GET /equipes/meus-contextos
  // Opções de contexto ativo do usuário logado — TODOS os vínculos, não só de gestor:
  // empresas onde é dono + equipes onde tem cargo (GESTOR, VETERINARIO, FORNECEDOR...).
  // Permite que um usuário multi-perfil (ex: FORNECEDOR numa equipe que assinou a
  // aplicação e virou GESTOR da própria empresa) alterne entre os perfis no Sidebar.
  // Empresa CNPJ → opção no nível da empresa; empresa pessoal (CPF) → opção por equipe.
  meusContextos: async (req, res) => {
    try {
      const userId = req.user.id;

      const CARGO_LABEL = {
        GESTOR: 'Gestor', VETERINARIO: 'Veterinário', ESTAGIARIO: 'Estagiário',
        FORNECEDOR: 'Fornecedor', SECRETARIA: 'Secretária', FINANCEIRO: 'Financeiro',
        ENFERMEIRO: 'Enfermeiro',
      };
      const labelCargo = c => CARGO_LABEL[c] ?? (c ? c.charAt(0) + c.slice(1).toLowerCase() : '');

      const [empresasOwned, membros] = await Promise.all([
        prisma.empresa.findMany({
          where:   { ownerId: userId },
          select:  { id: true, nome: true, cnpj: true, equipes: { select: { id: true, nome: true }, orderBy: { id: 'asc' } } },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.membroEquipe.findMany({
          where:   { userId },
          select:  { cargo: true, equipe: { select: { id: true, nome: true, empresa: { select: { id: true, nome: true, cnpj: true, ownerId: true } } } } },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

      const opcoes = [];
      const visto  = new Set();
      const add = (o) => {
        const k = `${o.empresaId}:${o.equipeId ?? ''}`;
        if (visto.has(k)) return;
        visto.add(k);
        opcoes.push(o);
      };

      // Empresas próprias: dono = gestor delas
      for (const emp of empresasOwned) {
        if (!emp.cnpj && emp.equipes.length > 0) {
          for (const eq of emp.equipes) add({ empresaId: emp.id, equipeId: eq.id, label: `${eq.nome} · Gestor`, cargo: 'GESTOR' });
        } else {
          add({ empresaId: emp.id, equipeId: null, label: `${emp.nome} · Gestor`, cargo: 'GESTOR' });
        }
      }

      // Vínculos de equipe (gestor convidado e cargos não-gestores)
      for (const m of membros) {
        const emp = m.equipe?.empresa;
        if (!emp) continue;
        if (emp.ownerId === userId) continue; // já coberto acima
        if (m.cargo === 'GESTOR' && emp.cnpj) {
          add({ empresaId: emp.id, equipeId: null, label: `${emp.nome} · Gestor`, cargo: 'GESTOR' });
        } else {
          add({ empresaId: emp.id, equipeId: m.equipe.id, label: `${m.equipe.nome} · ${labelCargo(m.cargo)}`, cargo: m.cargo });
        }
      }

      res.json({ sucesso: true, dados: opcoes });
    } catch (err) {
      console.error('Erro ao listar contextos do usuário:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Configurações (logotipo + dia de fechamento de fatura) ────────────────────
  // Única por empresa (CNPJ) ou por equipe (empresa pessoal) — ver resolverEscopoConfiguracao.
  // Sem checagem de role explícita: getEmpresaDoGestor só resolve empresa para quem é
  // ownerId ou tem cargo GESTOR — não-gestor cai em 404 naturalmente (mesmo padrão de
  // renomearEquipe/listarEmpresas).

  obterConfiguracao: async (req, res) => {
    try {
      const escopo = await resolverEscopoConfiguracao(req);
      if (!escopo) return res.status(404).json({ sucesso: false, mensagem: 'Empresa não encontrada' });

      const config = await buscarConfiguracao(escopo);

      // Mesma resolução de compat que deveFecharHoje (faturaUtils.js): nunca retorna
      // tipoFechamento null pro frontend — sempre o efetivamente aplicado hoje.
      const tipoFechamentoEfetivo = config?.tipoFechamento
        ?? (config?.diaFechamentoFatura != null ? 'DIA_FIXO' : 'ULTIMO_DIA_MES');

      res.json({
        sucesso: true,
        dados: {
          logoUrl:             config?.logoUrl             ?? null,
          tipoFechamento:      tipoFechamentoEfetivo,
          diaFechamentoFatura: config?.diaFechamentoFatura  ?? null,
          whatsapp:            config?.whatsapp             ?? null,
          diasAtendimento:       config?.diasAtendimento       ?? null,
          horaInicioAtendimento: config?.horaInicioAtendimento ?? null,
          horaFimAtendimento:    config?.horaFimAtendimento    ?? null,
          especiesAtendidas:     parseEspeciesAtendidas(config?.especiesAtendidas),
        },
      });
    } catch (err) {
      console.error('Erro ao obter configuração:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // Espécies atendidas pela empresa do contexto ativo — leitura para QUALQUER membro
  // (usado no Cadastro Pessoal do membro convidado para filtrar as especialidades).
  obterEspeciesAtendidas: async (req, res) => {
    try {
      // equipeId explícito (tela de gestão pode gerenciar equipe ≠ contexto ativo):
      // usa o escopo da equipe informada, desde que o usuário tenha acesso a ela.
      let escopo = null;
      const equipeIdParam = req.query.equipeId ? Number(req.query.equipeId) : null;
      if (equipeIdParam) {
        const eq = await prisma.equipe.findUnique({
          where:  { id: equipeIdParam },
          select: { id: true, empresaId: true, empresa: { select: { cnpj: true } } },
        });
        if (eq) {
          const acessoOk = eq.empresaId === req.empresaId
            || !!(await getEmpresaDoGestor(req.user.id, eq.empresaId));
          if (acessoOk) {
            escopo = eq.empresa?.cnpj
              ? { empresaId: eq.empresaId, equipeId: null }
              : { empresaId: eq.empresaId, equipeId: eq.id };
          }
        }
      }
      if (!escopo) escopo = await resolverEscopoConfiguracaoMembro(req);
      // Dono/gestor sem MembroEquipe (sem req.empresaId resolvido) — usa o escopo de gestor
      if (!escopo) escopo = await resolverEscopoConfiguracao(req);
      if (!escopo) return res.json({ sucesso: true, dados: { especiesAtendidas: [] } });
      const config = await buscarConfiguracao(escopo);

      let especies = parseEspeciesAtendidas(config?.especiesAtendidas);
      if (especies.length === 0) {
        // Sem configuração explícita em Configurações: usa as espécies escolhidas
        // na CRIAÇÃO da empresa (perfil do dono — VetEspecie). Evita que o seletor
        // de especialidades mostre TODAS as espécies do catálogo.
        const emp = await prisma.empresa.findUnique({
          where:  { id: escopo.empresaId },
          select: { ownerId: true },
        });
        if (emp?.ownerId) {
          const perfilDono = await prisma.vetPerfil.findUnique({
            where:  { userId: emp.ownerId },
            select: { especies: { select: { especieId: true } } },
          });
          especies = perfilDono?.especies.map(e => e.especieId) ?? [];
        }
      }

      return res.json({ sucesso: true, dados: { especiesAtendidas: especies } });
    } catch (err) {
      console.error('Erro ao obter espécies atendidas:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // Expediente de atendimento do contexto ativo — leitura para QUALQUER membro
  // (usado pelo Agendamento para liberar apenas os horários configurados).
  obterHorarioAtendimento: async (req, res) => {
    try {
      const escopo = await resolverEscopoConfiguracaoMembro(req);
      const vazio = { diasAtendimento: null, horaInicioAtendimento: null, horaFimAtendimento: null };
      if (!escopo) return res.json({ sucesso: true, dados: vazio });
      const config = await buscarConfiguracao(escopo);
      return res.json({
        sucesso: true,
        dados: {
          diasAtendimento:       config?.diasAtendimento       ?? null,
          horaInicioAtendimento: config?.horaInicioAtendimento ?? null,
          horaFimAtendimento:    config?.horaFimAtendimento    ?? null,
        },
      });
    } catch (err) {
      console.error('Erro ao obter horário de atendimento:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // Logotipo + nome da empresa do contexto ativo — leitura por QUALQUER membro
  // (usado pelo Sidebar para exibir a logomarca no lugar do texto padrão).
  obterLogo: async (req, res) => {
    try {
      const escopo = await resolverEscopoConfiguracaoMembro(req);
      const vazio = { logoUrl: null, empresaNome: null };
      if (!escopo) return res.json({ sucesso: true, dados: vazio });
      const [config, empresa] = await Promise.all([
        buscarConfiguracao(escopo),
        prisma.empresa.findUnique({ where: { id: escopo.empresaId }, select: { nome: true } }),
      ]);
      return res.json({
        sucesso: true,
        dados: { logoUrl: config?.logoUrl ?? null, empresaNome: empresa?.nome ?? null },
      });
    } catch (err) {
      console.error('Erro ao obter logo:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  salvarConfiguracao: async (req, res) => {
    try {
      const escopo = await resolverEscopoConfiguracao(req);
      if (!escopo) return res.status(404).json({ sucesso: false, mensagem: 'Empresa não encontrada' });

      const {
        tipoFechamento, diaFechamentoFatura, removerLogo, whatsapp,
        diasAtendimento, horaInicioAtendimento, horaFimAtendimento,
        especiesAtendidas,
      } = req.body;

      // Espécies atendidas — aceita array [1,2] ou CSV "1,2". undefined = não altera;
      // vazio = null (todas as espécies). Persiste como CSV de IDs.
      let especiesFinal;
      if (especiesAtendidas !== undefined) {
        const arr = Array.isArray(especiesAtendidas)
          ? especiesAtendidas
          : String(especiesAtendidas).split(',').map(s => s.trim()).filter(Boolean);
        const nums = [...new Set(arr.map(Number))].filter(Number.isInteger).sort((a, b) => a - b);
        especiesFinal = nums.length ? nums.join(',') : null;
      }

      // WhatsApp da empresa — normaliza para somente dígitos (DDD+número, DDI opcional).
      // undefined = não altera; string vazia = remove o número.
      let whatsappFinal;
      if (whatsapp !== undefined) {
        const digitos = String(whatsapp).replace(/\D/g, '');
        if (digitos === '') {
          whatsappFinal = null;
        } else if (digitos.length < 10 || digitos.length > 15) {
          return res.status(400).json({ sucesso: false, mensagem: 'WhatsApp inválido — informe DDD + número (10 a 15 dígitos).' });
        } else {
          whatsappFinal = digitos;
        }
      }

      // Expediente de atendimento. undefined = não altera; vazio = remove (sem restrição).
      const parseHora = (v) => {
        if (v === undefined) return undefined;
        const s = String(v).trim();
        if (s === '') return null;
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new Error('Horário de atendimento inválido — use HH:MM.');
        return s;
      };
      let diasFinal;
      if (diasAtendimento !== undefined) {
        // Aceita array [1,2,..] ou CSV "1,2,..". Vazio = null (todos os dias).
        const arr = Array.isArray(diasAtendimento)
          ? diasAtendimento
          : String(diasAtendimento).split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length === 0) {
          diasFinal = null;
        } else {
          const nums = [...new Set(arr.map(Number))].sort((a, b) => a - b);
          if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 6)) {
            return res.status(400).json({ sucesso: false, mensagem: 'Dias de atendimento inválidos (0=Dom … 6=Sáb).' });
          }
          diasFinal = nums.join(',');
        }
      }
      let horaInicioFinal, horaFimFinal;
      try {
        horaInicioFinal = parseHora(horaInicioAtendimento);
        horaFimFinal    = parseHora(horaFimAtendimento);
      } catch (e) {
        return res.status(400).json({ sucesso: false, mensagem: e.message });
      }
      if (horaInicioFinal && horaFimFinal && horaInicioFinal >= horaFimFinal) {
        return res.status(400).json({ sucesso: false, mensagem: 'A hora de início deve ser menor que a de término.' });
      }

      let tipoFinal;
      let diaFinal;
      if (tipoFechamento === undefined) {
        tipoFinal = undefined; // não altera
        diaFinal  = undefined;
      } else {
        if (!TIPOS_FECHAMENTO_VALIDOS.includes(tipoFechamento)) {
          return res.status(400).json({ sucesso: false, mensagem: `tipoFechamento deve ser um de: ${TIPOS_FECHAMENTO_VALIDOS.join(', ')}` });
        }
        tipoFinal = tipoFechamento;

        if (tipoFechamento === 'ULTIMO_DIA_MES') {
          diaFinal = null; // ignora qualquer valor enviado
        } else {
          const n = Number(diaFechamentoFatura);
          // Dia fixo limitado a 28 para existir em todos os meses do ano.
          const limite = tipoFechamento === 'DIA_UTIL' ? 10 : 28;
          if (!Number.isInteger(n) || n < 1 || n > limite) {
            return res.status(400).json({
              sucesso: false,
              mensagem: tipoFechamento === 'DIA_UTIL'
                ? 'Para dia útil, informe um número entre 1 e 10.'
                : 'Para dia fixo, informe um número entre 1 e 28.',
            });
          }
          diaFinal = n;
        }
      }

      const existente = await buscarConfiguracao(escopo);

      let logoUrlFinal;
      if (req.file) {
        logoUrlFinal = await storage.upload(req.file, 'empresas');
        if (existente?.logoUrl) await storage.delete(existente.logoUrl);
      } else if (removerLogo === 'true' || removerLogo === true) {
        if (existente?.logoUrl) await storage.delete(existente.logoUrl);
        logoUrlFinal = null;
      }

      // Não usar upsert: Prisma rejeita null em chave única composta (empresa CNPJ = equipeId null).
      const config = existente
        ? await prisma.empresaConfiguracao.update({
            where: { id: existente.id },
            data: {
              ...(tipoFinal     !== undefined && { tipoFechamento: tipoFinal, diaFechamentoFatura: diaFinal }),
              ...(logoUrlFinal  !== undefined && { logoUrl: logoUrlFinal }),
              ...(whatsappFinal !== undefined && { whatsapp: whatsappFinal }),
              ...(diasFinal        !== undefined && { diasAtendimento: diasFinal }),
              ...(horaInicioFinal  !== undefined && { horaInicioAtendimento: horaInicioFinal }),
              ...(horaFimFinal     !== undefined && { horaFimAtendimento: horaFimFinal }),
              ...(especiesFinal    !== undefined && { especiesAtendidas: especiesFinal }),
            },
          })
        : await prisma.empresaConfiguracao.create({
            data: {
              empresaId:           escopo.empresaId,
              equipeId:            escopo.equipeId,
              tipoFechamento:      tipoFinal ?? null,
              diaFechamentoFatura: diaFinal  ?? null,
              logoUrl:             logoUrlFinal ?? null,
              whatsapp:            whatsappFinal ?? null,
              diasAtendimento:       diasFinal       ?? null,
              horaInicioAtendimento: horaInicioFinal ?? null,
              horaFimAtendimento:    horaFimFinal    ?? null,
              especiesAtendidas:     especiesFinal   ?? null,
            },
          });

      res.json({
        sucesso: true,
        dados: {
          logoUrl:             config.logoUrl,
          tipoFechamento:      config.tipoFechamento ?? (config.diaFechamentoFatura != null ? 'DIA_FIXO' : 'ULTIMO_DIA_MES'),
          diaFechamentoFatura: config.diaFechamentoFatura,
          whatsapp:            config.whatsapp,
          diasAtendimento:       config.diasAtendimento,
          horaInicioAtendimento: config.horaInicioAtendimento,
          horaFimAtendimento:    config.horaFimAtendimento,
          especiesAtendidas:     parseEspeciesAtendidas(config.especiesAtendidas),
        },
      });
    } catch (err) {
      console.error('Erro ao salvar configuração:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Equipes ─────────────────────────────────────────────────────────────────

  criarEquipe: async (req, res) => {
    try {
      const { nome, empresaId } = req.body;
      if (!nome?.trim() || !empresaId) {
        return res.status(400).json({ sucesso: false, mensagem: 'nome e empresaId são obrigatórios' });
      }

      // Verifica se o usuário é owner ou gestor da empresa
      const userId    = req.user.id;
      const empresaId_n = Number(empresaId);
      const membro    = await prisma.membroEquipe.findFirst({
        where: { userId, cargo: 'GESTOR', equipe: { empresaId: empresaId_n } },
      });
      const empresa = await prisma.empresa.findFirst({
        where: { id: empresaId_n, OR: [{ ownerId: userId }, { id: membro ? empresaId_n : -1 }] },
      });
      if (!empresa) return res.status(404).json({ sucesso: false, mensagem: 'Empresa não encontrada' });

      // Duplicidade: nome de equipe único dentro da empresa
      const equipeDuplicada = await prisma.equipe.findFirst({
        where: { empresaId: empresaId_n, nome: { equals: nome.trim(), mode: 'insensitive' } },
      });
      if (equipeDuplicada) {
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma equipe com este nome nesta empresa.' });
      }

      const equipe = await prisma.equipe.create({
        data: { nome: nome.trim(), empresaId: empresaId_n },
      });
      res.status(201).json({ sucesso: true, dados: equipe });
    } catch (err) {
      console.error('Erro ao criar equipe:', err);
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma equipe com este nome nesta empresa.' });
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Convites ─────────────────────────────────────────────────────────────────

  listarConvites: async (req, res) => {
    try {
      const selectBase = { id: true, email: true, cargo: true, status: true, createdAt: true, expiresAt: true };

      // ADMIN: todos os convites de todas as equipes
      if ((req.user.role === 'ADMIN' || req.user.userType === 'ADMIN')) {
        const convites = await prisma.conviteEquipe.findMany({
          orderBy: { createdAt: 'desc' },
          select:  { ...selectBase, equipe: { select: { nome: true, empresa: { select: { nome: true } } } } },
        });
        return res.json({ sucesso: true, dados: convites });
      }

      const vetUserId = req.user.id;
      const empresa   = await getEmpresaDoGestor(vetUserId, req.empresaId);
      if (!empresa) return res.json({ sucesso: true, dados: [] });

      const equipe = await getEquipeAtiva(empresa.id, req.equipeId);
      if (!equipe)  return res.json({ sucesso: true, dados: [] });

      const convites = await prisma.conviteEquipe.findMany({
        where:   { equipeId: equipe.id },
        orderBy: { createdAt: 'desc' },
        select:  { ...selectBase, equipe: { select: { nome: true, empresa: { select: { nome: true } } } } },
      });
      res.json({ sucesso: true, dados: convites });
    } catch (err) {
      console.error('Erro ao listar convites:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Renomear equipe (apenas gestores da equipe) ────────────────────────────────

  renomearEquipe: async (req, res) => {
    try {
      const equipeId = Number(req.params.equipeId);
      const { nome } = req.body;

      if (!nome?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'Nome da equipe é obrigatório.' });
      }

      // Verifica que o usuário é gestor da equipe (ADMIN tem acesso irrestrito)
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const membro = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
        });
        if (!membro || membro.cargo !== 'GESTOR') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas gestores podem renomear a equipe.' });
        }
      }

      const equipe = await prisma.equipe.update({
        where: { id: equipeId },
        data:  { nome: nome.trim() },
        select: { id: true, nome: true },
      });

      return res.json({ sucesso: true, dados: equipe });
    } catch (err) {
      console.error('Erro ao renomear equipe:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Admin: todas as empresas com gestores e membros agrupados ─────────────────

  listarTodasEmpresasAdmin: async (req, res) => {
    try {
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        return res.status(403).json({ sucesso: false, mensagem: 'Acesso restrito a administradores.' });
      }

      const empresas = await prisma.empresa.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          equipes: {
            orderBy: { createdAt: 'asc' },
            include: {
              membros: {
                where:   { NOT: { user: { role: 'ADMIN' } } },
                orderBy: { createdAt: 'asc' },
                include: {
                  user: { select: { id: true, fullName: true, email: true, ativo: true } },
                },
              },
            },
          },
        },
      });

      // Ordena membros de cada equipe: GESTOR primeiro, depois alfabético
      const dados = empresas.map(emp => ({
        id:     emp.id,
        nome:   emp.nome,
        cnpj:   emp.cnpj ?? null,
        equipes: emp.equipes.map(eq => ({
          id:   eq.id,
          nome: eq.nome,
          membros: eq.membros.sort((a, b) => {
            if (a.cargo === 'GESTOR' && b.cargo !== 'GESTOR') return -1;
            if (b.cargo === 'GESTOR' && a.cargo !== 'GESTOR') return  1;
            return (a.user.fullName ?? '').localeCompare(b.user.fullName ?? '');
          }),
        })),
      }));

      return res.json({ sucesso: true, dados });
    } catch (err) {
      console.error('Erro ao listar todas as empresas:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Membros ─────────────────────────────────────────────────────────────────

  listarMembros: async (req, res) => {
    try {
      const vetUserId    = req.user.id;
      const equipeIdParam = req.query.equipeId ? Number(req.query.equipeId) : null;

      // ADMIN: acesso irrestrito a qualquer equipe
      if ((req.user.role === 'ADMIN' || req.user.userType === 'ADMIN')) {
        const todasEquipes = await prisma.equipe.findMany({
          include: { empresa: { select: { nome: true } } },
          orderBy: { createdAt: 'asc' },
        });
        const equipe = equipeIdParam
          ? todasEquipes.find(e => e.id === equipeIdParam)
          : todasEquipes[0];

        if (!equipe) {
          return res.json({ sucesso: true, dados: [], equipeId: null, isGestor: true, todasEquipes: [] });
        }

        const membros = await prisma.membroEquipe.findMany({
          where:   { equipeId: equipe.id, NOT: { user: { role: 'ADMIN' } } },
          include: {
            user:   { select: { id: true, fullName: true, email: true, phone: true, ativo: true, userType: true, cep: true, endereco: true, complemento: true, bairro: true, cidade: true, estado: true, fornecedorPerfil: { select: { tipoServico: true } }, vetPerfil: { select: { subespecialidades: { select: { nome: true } } } }, especialidades: { select: { especialidadeId: true, especialidade: { select: { id: true, nome: true } } } } } },
            equipe: { select: { nome: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        return res.json({
          sucesso: true,
          dados:        await anexarExpedienteTrabalho(await anexarPerfisGlobais(membros, { todos: true })), // ADMIN da plataforma vê tudo
          equipeId:     equipe.id,
          isGestor:      true,
          todasEquipes: todasEquipes.map(e => ({ id: e.id, nome: e.nome, empresaNome: e.empresa?.nome ?? '' })),
        });
      }

      // Owner OU gestor convidado (cargo: 'GESTOR') — ambos têm isGestor=true
      const empresa = await getEmpresaDoGestor(vetUserId, req.empresaId);
      const isGestor = !!empresa;

      if (!empresa) return res.json({ sucesso: true, dados: [], equipeId: null, isGestor: false });

      const equipes = await prisma.equipe.findMany({ where: { empresaId: empresa.id }, orderBy: { createdAt: 'asc' } });
      if (equipes.length === 0) return res.json({ sucesso: true, dados: [], equipeId: null, isGestor: false });

      // Prioridade: query param explícito > equipe ativa do seletor (req.equipeId) > primeira
      const equipeAlvoId = equipeIdParam ?? req.equipeId;
      const equipeAlvo = equipeAlvoId ? equipes.find(e => e.id === equipeAlvoId) ?? equipes[0] : equipes[0];

      const membros = await prisma.membroEquipe.findMany({
        where:   { equipeId: equipeAlvo.id, NOT: { user: { role: 'ADMIN' } } },
        include: {
          user:   { select: { id: true, fullName: true, email: true, phone: true, ativo: true, userType: true, cep: true, endereco: true, complemento: true, bairro: true, cidade: true, estado: true, fornecedorPerfil: { select: { tipoServico: true } }, vetPerfil: { select: { subespecialidades: { select: { nome: true } } } }, especialidades: { select: { especialidadeId: true, especialidade: { select: { id: true, nome: true } } } } } },
          equipe: { select: { nome: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({
        sucesso: true,
        // Perfis restritos à PRÓPRIA empresa — o que o membro é em outras empresas não aparece
        dados:        await anexarExpedienteTrabalho(await anexarPerfisGlobais(membros, { empresaId: empresa.id })),
        equipeId:     equipeAlvo.id,
        isGestor,
        empresaId:    empresa.id,
        todasEquipes: equipes.map(e => ({ id: e.id, nome: e.nome, empresaId: empresa.id, empresaNome: empresa.nome ?? '' })),
      });
    } catch (err) {
      console.error('Erro ao listar membros:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },
  listarMembrosPorEquipe: async (req, res) => {
    try {
      const { equipeId } = req.params;
      const equipeIdN = Number(equipeId);
      const isAdminReq = req.user.role === 'ADMIN' || req.user.userType === 'ADMIN';

      const equipe = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });

      // Garante que o solicitante pertence à mesma empresa da equipe (isolamento multi-empresa)
      if (!isAdminReq) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        if (empresa) {
          if (!equipe || equipe.empresaId !== empresa.id) {
            return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a esta equipe.' });
          }
        }
      }

      const membros = await prisma.membroEquipe.findMany({
        where:   { equipeId: equipeIdN, NOT: { user: { role: 'ADMIN' } } },
        include: { user: { select: { id: true, fullName: true, email: true, phone: true, ativo: true, userType: true } } },
        orderBy: { createdAt: 'desc' },
      });
      // Perfis restritos à empresa desta equipe (ADMIN da plataforma vê tudo)
      const dados = await anexarPerfisGlobais(
        membros,
        isAdminReq ? { todos: true } : { empresaId: equipe?.empresaId ?? null },
      );
      res.json({ sucesso: true, dados });
    } catch (err) {
      console.error('Erro ao listar membros por equipe:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Fornecedores disponíveis para inclusão como FORNECEDOR ──────────────────

  getFornecedoresPorEquipe: async (req, res) => {
    try {
      const equipeIdN = Number(req.params.equipeId);

      // Isolamento: verifica que o solicitante pertence à empresa desta equipe
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        if (empresa) {
          const equipe = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });
          if (!equipe || equipe.empresaId !== empresa.id) {
            return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado.' });
          }
        }
      }

      // IDs já membros da equipe (para excluir do resultado)
      const membroIds = await prisma.membroEquipe.findMany({
        where:  { equipeId: equipeIdN },
        select: { userId: true },
      });
      const idsJaMembros = membroIds.map(m => m.userId);

      const fornecedores = await prisma.user.findMany({
        where:   { userType: 'FORNECEDOR', ativo: true, id: { notIn: idsJaMembros } },
        select:  { id: true, fullName: true, email: true, phone: true },
        orderBy: { fullName: 'asc' },
      });

      res.json({ sucesso: true, dados: fornecedores });
    } catch (err) {
      console.error('Erro ao listar fornecedores por equipe:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ─── Designações de Prestador ─────────────────────────────────────────────

  getDesignacoesPrestador: async (req, res) => {
    try {
      const equipeIdN    = Number(req.params.equipeId);
      const prestadorIdN = Number(req.params.userId);

      // Valida acesso: ADMIN ou gestor/dono da empresa desta equipe
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        const equipe  = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });
        if (!empresa || !equipe || equipe.empresaId !== empresa.id)
          return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado.' });
      }

      const equipe = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });

      const [designacoes, animaisDisponiveis] = await Promise.all([
        prisma.designacaoPrestador.findMany({
          where: { equipeId: equipeIdN, prestadorId: prestadorIdN },
          include: {
            animal: { select: { id: true, nome: true, photoUrl: true, especie: { select: { nome: true } } } },
          },
          orderBy: [{ ativo: 'desc' }, { animal: { nome: 'asc' } }],
        }),
        prisma.animal.findMany({
          where: {
            ativo: true,
            OR: [
              { equipeId: equipeIdN },
              ...(equipe?.empresaId ? [{ empresaId: equipe.empresaId }] : []),
            ],
            NOT: {
              designacoes: { some: { prestadorId: prestadorIdN, equipeId: equipeIdN, ativo: true } },
            },
          },
          select: { id: true, nome: true, photoUrl: true, especie: { select: { nome: true } } },
          orderBy: { nome: 'asc' },
        }),
      ]);

      res.json({ sucesso: true, dados: { designacoes, animaisDisponiveis } });
    } catch (err) {
      console.error('Erro ao listar designações:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  addDesignacaoPrestador: async (req, res) => {
    try {
      const equipeIdN    = Number(req.params.equipeId);
      const prestadorIdN = Number(req.params.userId);
      const { animalId, motivo } = req.body;

      if (!animalId) return res.status(400).json({ sucesso: false, mensagem: 'animalId é obrigatório' });

      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        const equipe  = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });
        if (!empresa || !equipe || equipe.empresaId !== empresa.id)
          return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado.' });
      }

      const designacao = await prisma.designacaoPrestador.upsert({
        where: { animalId_prestadorId_equipeId: { animalId: Number(animalId), prestadorId: prestadorIdN, equipeId: equipeIdN } },
        create: {
          animalId:    Number(animalId),
          prestadorId: prestadorIdN,
          equipeId:    equipeIdN,
          motivo:      motivo?.trim() || null,
          criadoPorId: req.user.id,
          ativo:       true,
          dataInicio:  new Date(),
        },
        update: {
          ativo:      true,
          dataFim:    null,
          motivo:     motivo?.trim() || null,
          dataInicio: new Date(),
        },
        include: {
          animal: { select: { id: true, nome: true, photoUrl: true, especie: { select: { nome: true } } } },
        },
      });

      res.status(201).json({ sucesso: true, dados: designacao });
    } catch (err) {
      console.error('Erro ao adicionar designação:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  removeDesignacaoPrestador: async (req, res) => {
    try {
      const equipeIdN    = Number(req.params.equipeId);
      const prestadorIdN = Number(req.params.userId);
      const animalIdN    = Number(req.params.animalId);

      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        const equipe  = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });
        if (!empresa || !equipe || equipe.empresaId !== empresa.id)
          return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado.' });
      }

      await prisma.designacaoPrestador.updateMany({
        where: { animalId: animalIdN, prestadorId: prestadorIdN, equipeId: equipeIdN },
        data:  { ativo: false, dataFim: new Date() },
      });

      res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao remover designação:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  adicionarMembro: async (req, res) => {
    try {
      const vetUserId                  = req.user.id;
      const { fullName, email, phone, cargo, senha } = req.body;

      if (!fullName || !email || !cargo) {
        return res.status(400).json({ sucesso: false, mensagem: 'fullName, email e cargo são obrigatórios' });
      }

      if (cargo === 'GESTOR' && (req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem conceder o cargo de Gestor.' });
      }

      const { equipe } = await garantirEquipePadrao(vetUserId, req.empresaId, req.equipeId);

      let usuario = await prisma.user.findUnique({ where: { email } });
      if (!usuario) {
        const senhaHash = await bcrypt.hash(senha || 'Inicial#001', 10);
        usuario = await prisma.user.create({
          data: {
            fullName, email,
            phone:        phone || null,
            passwordHash: senhaHash,
            role:         'USER',
            userType:     cargo === 'ESTAGIARIO' ? 'ESTAGIARIO' : 'VETERINARIO',
          },
        });
      }

      const jaEMembro = await prisma.membroEquipe.findUnique({
        where: { equipeId_userId: { equipeId: equipe.id, userId: usuario.id } },
      });
      if (jaEMembro) return res.status(409).json({ sucesso: false, mensagem: 'Este usuário já é membro da equipe' });

      const membro = await prisma.membroEquipe.create({
        data:    { equipeId: equipe.id, userId: usuario.id, cargo },
        include: { user: { select: { id: true, fullName: true, email: true, phone: true, ativo: true } } },
      });
      res.status(201).json({ sucesso: true, dados: membro });
    } catch (err) {
      console.error('Erro ao adicionar membro:', err);
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'Membro já cadastrado' });
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  atualizarMembro: async (req, res) => {
    try {
      const { id } = req.params;
      const { cargo, phone, senha, fullName, email, ativo, cep, endereco, complemento, bairro, cidade, estado, especialidadeIds } = req.body;

      const membro = await prisma.membroEquipe.findUnique({
        where:   { id: Number(id) },
        include: { user: true, equipe: { select: { empresaId: true } } },
      });
      if (!membro) return res.status(404).json({ sucesso: false, mensagem: 'Membro não encontrado' });

      // Autorização: ADMIN, ou gestor da empresa da equipe do membro
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        if (!empresa || membro.equipe?.empresaId !== empresa.id) {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas gestores da equipe podem editar membros.' });
        }
        // Gestor não edita outro gestor (inclui troca de senha)
        if (membro.cargo === 'GESTOR') {
          return res.status(403).json({ sucesso: false, mensagem: 'Gestores não podem ser editados por outros gestores.' });
        }
      }

      if (cargo === 'GESTOR' && (req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem conceder o cargo de Gestor.' });
      }

      if (email !== undefined) {
        const emailNorm = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
          return res.status(400).json({ sucesso: false, mensagem: 'E-mail inválido' });
        }
        const existente = await prisma.user.findFirst({ where: { email: emailNorm, id: { not: membro.userId } } });
        if (existente) {
          return res.status(409).json({ sucesso: false, mensagem: 'Este e-mail já está em uso por outro usuário.' });
        }
      }

      if (senha) {
        if (senha.length < 8)            return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 8 caracteres' });
        if (!/[A-Z]/.test(senha))        return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos uma letra maiúscula' });
        if (!/\d/.test(senha))           return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 1 número' });
        if (!/[^A-Za-z0-9]/.test(senha)) return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 1 caractere especial' });
      }

      if (cargo) await prisma.membroEquipe.update({ where: { id: Number(id) }, data: { cargo } });

      // Expediente de trabalho do profissional (dias/horários) — via SQL raw
      const expediente = parseExpedienteTrabalho(req.body);
      if (expediente.erro) return res.status(400).json({ sucesso: false, mensagem: expediente.erro });
      await gravarExpedienteTrabalho(Number(id), expediente);

      const dadosUser = {};
      if (fullName !== undefined && fullName.trim()) dadosUser.fullName = fullName.trim();
      if (email    !== undefined && email.trim())    dadosUser.email    = email.trim().toLowerCase();
      if (phone       !== undefined) dadosUser.phone       = phone?.trim()       || null;
      if (cep         !== undefined) dadosUser.cep         = cep?.trim()         || null;
      if (endereco    !== undefined) dadosUser.endereco    = endereco?.trim()    || null;
      if (complemento !== undefined) dadosUser.complemento = complemento?.trim() || null;
      if (bairro      !== undefined) dadosUser.bairro      = bairro?.trim()      || null;
      if (cidade      !== undefined) dadosUser.cidade      = cidade?.trim()      || null;
      if (estado      !== undefined) dadosUser.estado      = estado?.trim()      || null;
      if (ativo       !== undefined) dadosUser.ativo       = Boolean(ativo);
      if (senha)                     dadosUser.passwordHash = await bcrypt.hash(senha, 10);
      if (Object.keys(dadosUser).length > 0) {
        await prisma.user.update({ where: { id: membro.userId }, data: dadosUser });
      }

      // Sincroniza com o cadastro Fornecedor vinculado (quando o membro é PRESTADOR)
      const dadosFornecedor = {};
      if (fullName    !== undefined && fullName.trim()) dadosFornecedor.nome        = fullName.trim();
      if (email       !== undefined && email.trim())    dadosFornecedor.email       = email.trim().toLowerCase();
      if (phone       !== undefined) dadosFornecedor.telefone    = phone?.trim()       || null;
      if (cep         !== undefined) dadosFornecedor.cep         = cep?.trim()         || null;
      if (endereco    !== undefined) dadosFornecedor.endereco    = endereco?.trim()    || null;
      if (complemento !== undefined) dadosFornecedor.complemento = complemento?.trim() || null;
      if (bairro      !== undefined) dadosFornecedor.bairro      = bairro?.trim()      || null;
      if (cidade      !== undefined) dadosFornecedor.cidade      = cidade?.trim()      || null;
      if (estado      !== undefined) dadosFornecedor.estado      = estado?.trim()      || null;
      if (Object.keys(dadosFornecedor).length > 0) {
        // Lookup primário: por userId (vínculo estabelecido via incluirMembroDireto)
        let fornecedorAlvo = await prisma.fornecedor.findFirst({ where: { userId: membro.userId } });
        // Fallback: por e-mail atual do usuário (registros legados sem userId populado)
        if (!fornecedorAlvo && membro.user?.email) {
          fornecedorAlvo = await prisma.fornecedor.findFirst({ where: { email: membro.user.email } });
        }
        if (fornecedorAlvo) {
          await prisma.fornecedor.update({
            where: { id: fornecedorAlvo.id },
            data:  { ...dadosFornecedor, userId: membro.userId }, // estabelece o link se ainda não estava
          });
        }
      }

      // Especialidades (catálogo por espécie) — sincroniza quando enviadas (delete + insert).
      if (Array.isArray(especialidadeIds)) {
        const ids = [...new Set(especialidadeIds.map(Number))].filter(Number.isInteger);
        const rows = ids.length > 0
          ? await prisma.especialidade.findMany({ where: { id: { in: ids }, ativo: true }, select: { id: true, nome: true } })
          : [];
        await prisma.usuarioEspecialidade.deleteMany({ where: { userId: membro.userId } });
        if (rows.length > 0) {
          await prisma.usuarioEspecialidade.createMany({
            data: rows.map(r => ({ userId: membro.userId, especialidadeId: r.id })),
            skipDuplicates: true,
          });
        }
        // Fornecedor vinculado: mantém o tipoServico legado e os vínculos em sincronia
        const fornecedorEspec = await prisma.fornecedor.findFirst({ where: { userId: membro.userId } });
        if (fornecedorEspec && rows.length > 0) {
          await prisma.fornecedorEspecialidade.deleteMany({ where: { fornecedorId: fornecedorEspec.id } });
          await prisma.fornecedorEspecialidade.createMany({
            data: rows.map(r => ({ fornecedorId: fornecedorEspec.id, especialidadeId: r.id })),
            skipDuplicates: true,
          });
          await prisma.fornecedor.update({
            where: { id: fornecedorEspec.id },
            data:  { tipoServico: rows[0].nome.slice(0, 50) },
          });
        }
      }

      res.json({ sucesso: true, mensagem: 'Membro atualizado' });
    } catch (err) {
      console.error('Erro ao atualizar membro:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  toggleMembro: async (req, res) => {
    try {
      const { id }  = req.params;
      const membro  = await prisma.membroEquipe.findUnique({ where: { id: Number(id) }, include: { user: true } });
      if (!membro) return res.status(404).json({ sucesso: false, mensagem: 'Membro não encontrado' });

      await prisma.user.update({ where: { id: membro.userId }, data: { ativo: !membro.user.ativo } });
      res.json({ sucesso: true, mensagem: membro.user.ativo ? 'Membro inativado' : 'Membro ativado' });
    } catch (err) {
      console.error('Erro ao alternar status do membro:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  removerMembro: async (req, res) => {
    try {
      const { membroId } = req.params;

      // Gestores não podem excluir outros gestores — apenas desativar
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const alvo = await prisma.membroEquipe.findUnique({
          where:  { id: Number(membroId) },
          select: { cargo: true },
        });
        if (alvo?.cargo === 'GESTOR') {
          return res.status(403).json({
            sucesso: false,
            mensagem: 'Gestores não podem ser excluídos por outros gestores. Use a opção de desativar.',
          });
        }
      }

      await prisma.membroEquipe.delete({ where: { id: Number(membroId) } });
      res.json({ sucesso: true, mensagem: 'Membro removido da equipe' });
    } catch (err) {
      console.error('Erro ao remover membro:', err);
      if (err.code === 'P2025') return res.status(404).json({ sucesso: false, mensagem: 'Membro não encontrado' });
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ADMIN: remove o gestor da equipe e desativa a conta
  removerGestorAdmin: async (req, res) => {
    try {
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem usar esta ação.' });
      }

      const equipeId = Number(req.params.equipeId);
      const userId   = Number(req.params.userId);

      const membro = await prisma.membroEquipe.findUnique({
        where:  { equipeId_userId: { equipeId, userId } },
        select: { id: true, cargo: true, user: { select: { fullName: true } } },
      });

      if (!membro) {
        return res.status(404).json({ sucesso: false, mensagem: 'Membro não encontrado nesta equipe.' });
      }
      if (membro.cargo !== 'GESTOR') {
        return res.status(400).json({ sucesso: false, mensagem: 'Esta rota é exclusiva para remoção de gestores.' });
      }

      await prisma.$transaction([
        prisma.membroEquipe.delete({ where: { id: membro.id } }),
        prisma.user.delete({ where: { id: userId } }),
      ]);

      res.json({ sucesso: true, mensagem: `${membro.user.fullName} foi removido e sua conta foi excluída.` });
    } catch (err) {
      console.error('Erro ao remover gestor:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Convites ────────────────────────────────────────────────────────────────

  convidarMembro: async (req, res) => {
    try {
      const vetUserId        = req.user.id;
      const { email, cargo } = req.body;

      if (!email || !cargo) {
        return res.status(400).json({ sucesso: false, mensagem: 'email e cargo são obrigatórios' });
      }

      const { equipe } = await garantirEquipePadrao(vetUserId, req.empresaId, req.equipeId);

      // Bloqueia re-convite: membro já existente
      const usuarioCheck = await prisma.user.findUnique({ where: { email } });
      if (usuarioCheck) {
        const jaMembro = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId: equipe.id, userId: usuarioCheck.id } },
        });
        if (jaMembro) {
          return res.status(409).json({ sucesso: false, mensagem: 'Este e-mail já faz parte da equipe' });
        }
      }

      // Bloqueia re-convite: já existe convite PENDENTE e não expirado
      const conviteAtivo = await prisma.conviteEquipe.findFirst({
        where: { equipeId: equipe.id, email, status: 'PENDENTE', expiresAt: { gt: new Date() } },
      });
      if (conviteAtivo) {
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe um convite pendente para este e-mail. Aguarde expirar ou cancele o anterior.' });
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

      const convite = await prisma.conviteEquipe.create({
        data: { equipeId: equipe.id, email, cargo, expiresAt },
      });

      // Buscar dados do vet para o email + espécies que ele atende
      const vetUser = await prisma.user.findUnique({
        where:  { id: vetUserId },
        select: { fullName: true },
      });
      const vetPerfilDono = await prisma.vetPerfil.findUnique({
        where:   { userId: vetUserId },
        include: {
          especies: {
            include: { especie: { select: { nome: true } } },
          },
        },
      });
      // especiesDono: nomes para o email | especiesDonoComId: IDs para copiar ao VetPerfil
      const especiesDono    = vetPerfilDono?.especies.map(e => e.especie) ?? [];
      const especiesDonoComId = vetPerfilDono?.especies.map(e => e.especieId) ?? [];

      // Criar usuário convidado se ainda não existir
      const SENHA_INICIAL = 'Inicial_001';
      const cargoToUserType = { VETERINARIO: 'VETERINARIO', ESTAGIARIO: 'ESTAGIARIO', ADMIN: 'VETERINARIO', MEMBRO: 'ESTAGIARIO', PROPRIETARIO: 'PROPRIETARIO', SECRETARIA: 'ESTAGIARIO', FINANCEIRO: 'ESTAGIARIO', ENFERMEIRO: 'ESTAGIARIO' };
      const userTypeConvidado = cargoToUserType[cargo] || 'ESTAGIARIO';
      let usuarioCriado = false;
      let usuarioConvidadoId = null;
      const usuarioExistente = await prisma.user.findUnique({ where: { email } });

      if (!usuarioExistente) {
        const senhaHash = await bcrypt.hash(SENHA_INICIAL, 10);
        const novoUsuario = await prisma.user.create({
          data: {
            email,
            fullName:           '',
            passwordHash:       senhaHash,
            role:               'USER',
            userType:           userTypeConvidado,
            mustChangePassword: true,
          },
        });
        usuarioConvidadoId = novoUsuario.id;
        usuarioCriado = true;
      } else {
        usuarioConvidadoId = usuarioExistente.id;
      }

      // Marca isConvidado e copia espécies do vet dono — já na criação do convite
      if (usuarioConvidadoId) {
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE schs2vet.users SET "isConvidado" = true WHERE id = $1`,
            usuarioConvidadoId,
          );
        } catch { /* coluna ainda não existe no DB legado */ }

        // Copia espécies se for vet e tiver espécies disponíveis
        if (userTypeConvidado === 'VETERINARIO' && especiesDonoComId.length > 0) {
          let perfilConvidado = await prisma.vetPerfil.findUnique({ where: { userId: usuarioConvidadoId } });
          if (!perfilConvidado) {
            perfilConvidado = await prisma.vetPerfil.create({ data: { userId: usuarioConvidadoId } });
          }
          const jaTemEspecies = await prisma.vetEspecie.count({ where: { vetPerfilId: perfilConvidado.id } });
          if (jaTemEspecies === 0) {
            await prisma.$transaction(
              especiesDonoComId.map(especieId =>
                prisma.vetEspecie.upsert({
                  where:  { vetPerfilId_especieId: { vetPerfilId: perfilConvidado.id, especieId } },
                  update: {},
                  create: { vetPerfilId: perfilConvidado.id, especieId },
                })
              )
            );
          }
        }
      }

      // Enviar email com link de convite + espécies que a equipe atende
      emailService.enviarConviteEquipe({
        email,
        cargo,
        token:         convite.token,
        vetNome:       vetUser?.fullName || 'Veterinário',
        equipeNome:    equipe.nome,
        usuarioCriado,
        senhaInicial:  usuarioCriado ? SENHA_INICIAL : null,
        especiesNomes: especiesDono.map(e => e.nome).filter(Boolean),
      }).catch(err => console.error('[emailService] Falha ao enviar convite de equipe:', err));

      res.status(201).json({
        sucesso:  true,
        dados:    convite,
        mensagem: 'Convite enviado por e-mail',
      });
    } catch (err) {
      console.error('Erro ao convidar membro:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Inclusão direta (sem fluxo de aceite) ───────────────────────────────────
  incluirMembroDireto: async (req, res) => {
    try {
      const vetUserId        = req.user.id;
      const { email: emailRaw, cargo, fullName, phone, cep, endereco, complemento, bairro, cidade, estado, fornecedorId, tipoServico, especialidadeIds, equipeId: equipeIdBody } = req.body;
      const email = (emailRaw ?? '').trim().toLowerCase();

      if (!email || !cargo) {
        return res.status(400).json({ sucesso: false, mensagem: 'email e cargo são obrigatórios' });
      }
      if (!fullName?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
      }
      if (!phone?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });
      }

      // Cargo FORNECEDOR: amarra a conta de login ao cadastro Fornecedor (tipoServico
      // alimenta o seletor de encaminhamento). Existente → vincula; novo → cria CLIENTE.
      let fornecedorVinculo = null;
      if (cargo === 'FORNECEDOR') {
        if (fornecedorId) {
          fornecedorVinculo = await prisma.fornecedor.findUnique({ where: { id: Number(fornecedorId) } });
          if (!fornecedorVinculo) {
            return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
          }
        } else {
          const { TIPOS_SERVICO_VALIDOS } = require('./FornecedorController');
          const temEspec = Array.isArray(especialidadeIds) && especialidadeIds.length > 0;
          if (!temEspec && (!tipoServico?.trim() || !TIPOS_SERVICO_VALIDOS.includes(tipoServico))) {
            return res.status(400).json({ sucesso: false, mensagem: 'Selecione ao menos uma especialidade para o fornecedor' });
          }
        }
      }

      // Especialidades do catálogo (se enviadas) — fonte única; derivam o tipoServico legado.
      let especResolvidas = null;
      if (Array.isArray(especialidadeIds) && especialidadeIds.length > 0) {
        const ids = [...new Set(especialidadeIds.map(Number))].filter(Number.isInteger);
        const rows = await prisma.especialidade.findMany({
          where: { id: { in: ids }, ativo: true }, select: { id: true, nome: true },
        });
        especResolvidas = { ids: rows.map(r => r.id), tipoServico: rows[0]?.nome?.slice(0, 50) ?? null };
      }

      // Inclui na equipe que a tela está gerenciando (equipeIdBody) — garantirEquipePadrao
      // valida que ela pertence à empresa do gestor; caso contrário cai no contexto ativo.
      // Sem isso, a inclusão podia gravar numa equipe diferente da exibida na lista.
      const { equipe } = await garantirEquipePadrao(vetUserId, req.empresaId, equipeIdBody ?? req.equipeId);

      // Bloqueia se já é membro
      const usuarioCheck = await prisma.user.findUnique({ where: { email } });
      if (usuarioCheck) {
        const jaMembro = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId: equipe.id, userId: usuarioCheck.id } },
        });
        if (jaMembro) {
          return res.status(409).json({ sucesso: false, mensagem: 'Este e-mail já faz parte da equipe' });
        }
      }

      // ── Validações que podem falhar ANTES de qualquer gravação ─────────────
      // (evita usuário/membro órfão quando a requisição é rejeitada no meio)

      // Expediente de trabalho (dias/horários) — valida o formato já aqui
      const expediente = parseExpedienteTrabalho(req.body);
      if (expediente.erro) return res.status(400).json({ sucesso: false, mensagem: expediente.erro });

      // Fornecedor selecionado já vinculado a OUTRA conta não pode ser reutilizado
      if (fornecedorVinculo?.userId && (!usuarioCheck || fornecedorVinculo.userId !== usuarioCheck.id)) {
        return res.status(409).json({ sucesso: false, mensagem: 'Este fornecedor já está vinculado a outro usuário' });
      }

      // Reverso: o usuário (por e-mail) já pode estar vinculado a OUTRO cadastro de
      // fornecedor. Como Fornecedor.userId é @unique, vincular/criar aqui violaria a
      // constraint (Unique constraint on user_id). Bloqueia com mensagem clara.
      if (cargo === 'FORNECEDOR' && usuarioCheck) {
        const fornecedorDoUsuario = await prisma.fornecedor.findUnique({ where: { userId: usuarioCheck.id } });
        if (fornecedorDoUsuario && (!fornecedorVinculo || fornecedorDoUsuario.id !== fornecedorVinculo.id)) {
          return res.status(409).json({ sucesso: false, mensagem: 'Este usuário já está vinculado a outro cadastro de fornecedor.' });
        }
      }

      // Buscar dados do vet dono + espécies
      const vetUser = await prisma.user.findUnique({ where: { id: vetUserId }, select: { fullName: true } });
      const vetPerfilDono = await prisma.vetPerfil.findUnique({
        where:   { userId: vetUserId },
        include: { especies: { include: { especie: { select: { nome: true } } } } },
      });
      const especiesDono      = vetPerfilDono?.especies.map(e => e.especie) ?? [];
      const especiesDonoComId = vetPerfilDono?.especies.map(e => e.especieId) ?? [];

      const SENHA_INICIAL = 'Inicial_001';
      const cargoToUserType = { VETERINARIO: 'VETERINARIO', ESTAGIARIO: 'ESTAGIARIO', GESTOR: 'VETERINARIO', ADMIN: 'VETERINARIO', MEMBRO: 'ESTAGIARIO', PROPRIETARIO: 'PROPRIETARIO', FORNECEDOR: 'FORNECEDOR', SECRETARIA: 'ESTAGIARIO', FINANCEIRO: 'ESTAGIARIO', ENFERMEIRO: 'ESTAGIARIO' };
      const userTypeNovo = cargoToUserType[cargo] || 'ESTAGIARIO';

      let usuarioCriado = false;
      let usuario = await prisma.user.findUnique({ where: { email } });
      // Rastreio p/ compensação em caso de falha no meio do fluxo (evita órfãos)
      var usuarioCriadoId = null;
      var membroCriadoId  = null;
      var equipeIdCriacao = equipe.id;
      var membroUserId    = null;

      if (!usuario) {
        const senhaHash = await bcrypt.hash(SENHA_INICIAL, 10);
        usuario = await prisma.user.create({
          data: {
            email,
            fullName:           fullName.trim(),
            phone:              phone.trim(),
            cep:                cep?.trim()         || null,
            endereco:           endereco?.trim()    || null,
            complemento:        complemento?.trim() || null,
            bairro:             bairro?.trim()      || null,
            cidade:             cidade?.trim()      || null,
            estado:             estado?.trim()      || null,
            passwordHash:       senhaHash,
            role:               'USER',
            userType:           userTypeNovo,
            mustChangePassword: true,
          },
        });
        usuarioCriado = true;
        usuarioCriadoId = usuario.id;
      } else if (!usuario.fullName?.trim() || !usuario.phone?.trim()) {
        // Usuário pré-existente sem cadastro completo: preenche nome/telefone informados
        usuario = await prisma.user.update({
          where: { id: usuario.id },
          data:  {
            fullName: usuario.fullName?.trim() ? usuario.fullName : fullName.trim(),
            phone:    usuario.phone?.trim()    ? usuario.phone    : phone.trim(),
          },
        });
      }

      // Adicionar à equipe diretamente
      const novoMembro = await prisma.membroEquipe.create({
        data: { equipeId: equipe.id, userId: usuario.id, cargo },
      });
      membroCriadoId = novoMembro.id;
      membroUserId   = usuario.id;

      // Expediente de trabalho do profissional (dias/horários) — via SQL raw
      await gravarExpedienteTrabalho(novoMembro.id, expediente);

      // Vincular/criar cadastro Fornecedor
      let fornecedorFinalId = null;
      if (cargo === 'FORNECEDOR') {
        if (fornecedorVinculo) {
          await prisma.fornecedor.update({
            where: { id: fornecedorVinculo.id },
            data: {
              userId:   usuario.id,
              email:    fornecedorVinculo.email    || email,
              telefone: fornecedorVinculo.telefone || phone.trim(),
            },
          });
          fornecedorFinalId = fornecedorVinculo.id;
        } else {
          const novoForn = await prisma.fornecedor.create({
            data: {
              nome:        fullName.trim(),
              email,
              telefone:    phone.trim(),
              tipoServico: especResolvidas?.tipoServico ?? tipoServico?.trim() ?? 'Prestador',
              tipoEntrada: 'CLIENTE',
              empresaId:   req.empresaId ?? null,
              equipeId:    equipe.id,
              userId:      usuario.id,
            },
          });
          fornecedorFinalId = novoForn.id;
        }
      }

      // Especialidades (catálogo por espécie) — grava no usuário e, se fornecedor, no cadastro.
      if (especResolvidas) {
        await prisma.usuarioEspecialidade.deleteMany({ where: { userId: usuario.id } });
        if (especResolvidas.ids.length > 0) {
          await prisma.usuarioEspecialidade.createMany({
            data: especResolvidas.ids.map(especialidadeId => ({ userId: usuario.id, especialidadeId })),
            skipDuplicates: true,
          });
        }
        // Só grava no cadastro de Fornecedor quando ele é NOVO — um fornecedor
        // existente preserva as especialidades definidas no próprio cadastro.
        if (fornecedorFinalId && !fornecedorVinculo && especResolvidas.ids.length > 0) {
          await prisma.fornecedorEspecialidade.createMany({
            data: especResolvidas.ids.map(especialidadeId => ({ fornecedorId: fornecedorFinalId, especialidadeId })),
            skipDuplicates: true,
          });
        }
      }

      // Propagar permissões do MatrizPerfil para o novo membro
      await PermissaoService.aplicarPermissoesPadrao({
        equipeId:      equipe.id,
        userId:        usuario.id,
        cargo,
        atualizadoPor: vetUserId,
      });

      // Marcar isConvidado e copiar espécies
      await aplicarOnboardingConvidado(usuario.id, equipe.id);
      if (userTypeNovo === 'VETERINARIO' && especiesDonoComId.length > 0) {
        let perfilNovo = await prisma.vetPerfil.findUnique({ where: { userId: usuario.id } });
        if (!perfilNovo) {
          perfilNovo = await prisma.vetPerfil.create({ data: { userId: usuario.id } });
        }
        const jaTemEspecies = await prisma.vetEspecie.count({ where: { vetPerfilId: perfilNovo.id } });
        if (jaTemEspecies === 0) {
          await prisma.$transaction(
            especiesDonoComId.map(especieId =>
              prisma.vetEspecie.upsert({
                where:  { vetPerfilId_especieId: { vetPerfilId: perfilNovo.id, especieId } },
                update: {},
                create: { vetPerfilId: perfilNovo.id, especieId },
              })
            )
          );
        }
      }

      // Email de notificação (sem link de aceite)
      emailService.enviarInclusaoEquipe({
        email,
        cargo,
        vetNome:       vetUser?.fullName || 'Veterinário',
        equipeNome:    equipe.nome,
        usuarioCriado,
        senhaInicial:  usuarioCriado ? SENHA_INICIAL : null,
        especiesNomes: especiesDono.map(e => e.nome).filter(Boolean),
      }).catch(err => console.error('[emailService] Falha ao enviar notificação de inclusão:', err));

      res.status(201).json({ sucesso: true, mensagem: 'Membro incluído com sucesso!', dados: { userId: usuario.id, fullName: usuario.fullName } });
    } catch (err) {
      console.error('Erro ao incluir membro:', err);
      // Compensação (melhor esforço): desfaz o que esta requisição criou para não
      // deixar cadastro órfão — que causava "já existe" no retry e depois duplicata.
      try {
        if (membroCriadoId) {
          await prisma.permissaoMembro.deleteMany({ where: { equipeId: equipeIdCriacao, userId: membroUserId } }).catch(() => {});
          await prisma.membroEquipe.delete({ where: { id: membroCriadoId } }).catch(() => {});
        }
        if (usuarioCriadoId) {
          await prisma.usuarioEspecialidade.deleteMany({ where: { userId: usuarioCriadoId } }).catch(() => {});
          await prisma.fornecedor.updateMany({ where: { userId: usuarioCriadoId }, data: { userId: null } }).catch(() => {});
          await prisma.user.delete({ where: { id: usuarioCriadoId } }).catch(() => {});
        }
      } catch { /* melhor esforço — não mascarar o erro original */ }
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  convidarGestorAdmin: async (req, res) => {
    try {
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem usar esta rota.' });
      }

      const { email: emailRaw, fullName, empresaNome, cnpj, cpf, nomeEquipe, especiesIds, equipeId: equipeIdParam, empresaId: empresaIdParam } = req.body;
      const email = (emailRaw ?? '').trim().toLowerCase();

      if (!email) return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório.' });

      const usandoExistente = !!equipeIdParam || !!empresaIdParam;

      const isCnpj = !!cnpj?.trim();
      const isCpf  = !isCnpj && !!cpf?.trim();
      if (!usandoExistente) {
        if (!empresaNome?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório.' });
        if (!isCnpj && !isCpf)   return res.status(400).json({ sucesso: false, mensagem: 'Informe o CNPJ ou CPF.' });
      }

      const cnpjNorm = isCnpj ? cnpj.replace(/\D/g, '') : null;
      const cpfNorm  = isCpf  ? cpf.replace(/\D/g, '')  : null;

      // Cria usuário se não existir
      const SENHA_INICIAL  = 'Inicial_001';
      let usuarioExistente = await prisma.user.findUnique({ where: { email } });
      let usuarioCriado    = false;

      if (!usuarioExistente) {
        const senhaHash = await bcrypt.hash(SENHA_INICIAL, 10);
        usuarioExistente = await prisma.user.create({
          data: {
            email,
            fullName:           (fullName ?? empresaNome)?.trim() || '',
            passwordHash:       senhaHash,
            role:               'USER',
            userType:           'VETERINARIO',
            mustChangePassword: true,
            ...(cpfNorm  ? { cpf:  cpfNorm  } : {}),
            ...(cnpjNorm ? { cnpj: cnpjNorm } : {}),
          },
        });
        usuarioCriado = true;
      }
      const convidadoId = usuarioExistente.id;

      let empresa, equipe;

      if (equipeIdParam) {
        // CPF + equipe existente selecionada diretamente
        equipe = await prisma.equipe.findUnique({ where: { id: Number(equipeIdParam) }, include: { empresa: true } });
        if (!equipe) return res.status(404).json({ sucesso: false, mensagem: 'Equipe não encontrada.' });
        empresa = equipe.empresa;
      } else if (empresaIdParam) {
        // CNPJ + empresa existente selecionada diretamente
        empresa = await prisma.empresa.findUnique({ where: { id: Number(empresaIdParam) } });
        if (!empresa) return res.status(404).json({ sucesso: false, mensagem: 'Empresa não encontrada.' });
        equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id } });
        if (!equipe) {
          equipe = await prisma.equipe.create({ data: { nome: 'Equipe Principal', empresaId: empresa.id } });
        }
      } else if (isCnpj) {
        // CNPJ: reutiliza empresa por CNPJ + nome (mesmo CNPJ com nome diferente cria outra empresa)
        empresa = await prisma.empresa.findFirst({
          where: { cnpj: cnpjNorm, nome: { equals: empresaNome.trim(), mode: 'insensitive' } },
        });
        if (!empresa) {
          empresa = await prisma.empresa.create({
            data: { nome: empresaNome.trim(), cnpj: cnpjNorm, ownerId: convidadoId },
          });
        }
        equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id } });
        if (!equipe) {
          equipe = await prisma.equipe.create({ data: { nome: 'Equipe Principal', empresaId: empresa.id } });
        }
      } else {
        // CPF: empresa pessoal do convidado — reutiliza só se o nome também coincidir
        // (mesmo CPF + e-mail com nome diferente = nova empresa permitida)
        empresa = await prisma.empresa.findFirst({
          where: { ownerId: convidadoId, cnpj: null, nome: { equals: empresaNome.trim(), mode: 'insensitive' } },
        });
        if (!empresa) {
          empresa = await prisma.empresa.create({
            data: { nome: empresaNome.trim(), cnpj: null, ownerId: convidadoId },
          });
        }
        const nomeEquipeFinal = nomeEquipe?.trim() || 'Equipe Principal';
        equipe = await prisma.equipe.findFirst({
          where: { empresaId: empresa.id, nome: { equals: nomeEquipeFinal, mode: 'insensitive' } },
        });
        if (!equipe) {
          equipe = await prisma.equipe.create({ data: { nome: nomeEquipeFinal, empresaId: empresa.id } });
        }
      }

      const jaMembro = await prisma.membroEquipe.findUnique({
        where: { equipeId_userId: { equipeId: equipe.id, userId: convidadoId } },
      });
      if (jaMembro) {
        return res.status(409).json({ sucesso: false, mensagem: 'Este usuário já é membro desta equipe.' });
      }

      // Inclui diretamente como GESTOR — sem convite, acesso imediato
      const membro = await prisma.membroEquipe.create({
        data: { equipeId: equipe.id, userId: convidadoId, cargo: 'GESTOR' },
      });

      // Instância de WhatsApp exclusiva da clínica (Evolution API) — best-effort
      require('../services/whatsappService').provisionarPorEmpresa(empresa.id).catch(() => {});

      try {
        await prisma.$executeRawUnsafe(`UPDATE schs2vet.users SET "isConvidado" = true WHERE id = $1`, convidadoId);
      } catch { /* ignora */ }

      const idsEspecies = Array.isArray(especiesIds) ? especiesIds.map(Number).filter(Boolean) : [];
      if (idsEspecies.length > 0) {
        let vetPerfil = await prisma.vetPerfil.findUnique({ where: { userId: convidadoId } });
        if (!vetPerfil) {
          vetPerfil = await prisma.vetPerfil.create({ data: { userId: convidadoId } });
        }
        await prisma.$transaction(
          idsEspecies.map(especieId =>
            prisma.vetEspecie.upsert({
              where:  { vetPerfilId_especieId: { vetPerfilId: vetPerfil.id, especieId } },
              update: {},
              create: { vetPerfilId: vetPerfil.id, especieId },
            })
          )
        );
      }

      emailService.enviarAcessoGestor({
        email,
        nomeGestor:  (fullName ?? empresaNome)?.trim() || email,
        empresaNome: empresa.nome,
        equipeName:  equipe.nome,
        usuarioCriado,
        senhaInicial: usuarioCriado ? SENHA_INICIAL : null,
      }).catch(err => console.error('[emailService] Falha ao enviar e-mail de acesso gestor:', err));

      return res.status(201).json({ sucesso: true, dados: membro, mensagem: 'Gestor incluído com sucesso' });
    } catch (err) {
      console.error('Erro ao convidar gestor:', err);
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: req.body.cnpj?.trim() ? 'CNPJ já cadastrado para outra empresa.' : 'Conflito de dados ao criar empresa.' });
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  convidarParaEquipe: async (req, res) => {
    try {
      const equipeId = Number(req.params.equipeId);
      const { email: emailRaw, cargo, fullName } = req.body;
      const email = (emailRaw ?? '').trim().toLowerCase();

      if (!email || !cargo) {
        return res.status(400).json({ sucesso: false, mensagem: 'email e cargo são obrigatórios' });
      }

      // Apenas ADMIN (role sistêmica) ou GESTOR da equipe podem usar esta rota
      const isAdmin = (req.user.role === 'ADMIN' || req.user.userType === 'ADMIN');
      if (!isAdmin) {
        const membroSolicitante = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
          select: { cargo: true },
        });
        if (!membroSolicitante || membroSolicitante.cargo !== 'GESTOR') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores ou gestores podem convidar membros.' });
        }
      }

      const equipe = await prisma.equipe.findUnique({
        where: { id: equipeId },
        select: { id: true, nome: true },
      });
      if (!equipe) return res.status(404).json({ sucesso: false, mensagem: 'Equipe não encontrada' });

      // Bloqueia re-convite: membro já existente
      const usuarioCheck = await prisma.user.findUnique({ where: { email } });
      if (usuarioCheck) {
        const jaMembro = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: usuarioCheck.id } },
        });
        if (jaMembro) {
          return res.status(409).json({ sucesso: false, mensagem: 'Este e-mail já faz parte da equipe.' });
        }
      }

      // Bloqueia re-convite: já existe convite PENDENTE não expirado
      const conviteAtivo = await prisma.conviteEquipe.findFirst({
        where: { equipeId, email, status: 'PENDENTE', expiresAt: { gt: new Date() } },
      });
      if (conviteAtivo) {
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe um convite pendente para este e-mail.' });
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const convite   = await prisma.conviteEquipe.create({
        data: { equipeId, email, cargo, expiresAt },
      });

      // Cria usuário se ainda não existir
      const SENHA_INICIAL     = 'Inicial_001';
      const cargoToUserType   = { VETERINARIO: 'VETERINARIO', ESTAGIARIO: 'ESTAGIARIO', PROPRIETARIO: 'PROPRIETARIO', ADMIN: 'VETERINARIO', MEMBRO: 'ESTAGIARIO', FORNECEDOR: 'FORNECEDOR', SECRETARIA: 'ESTAGIARIO', FINANCEIRO: 'ESTAGIARIO', ENFERMEIRO: 'ESTAGIARIO' };
      const userTypeConvidado = cargoToUserType[cargo] ?? 'ESTAGIARIO';
      const usuarioExistente  = await prisma.user.findUnique({ where: { email } });
      let usuarioCriado      = false;
      let usuarioConvidadoId = usuarioExistente?.id ?? null;

      if (!usuarioExistente) {
        const senhaHash   = await bcrypt.hash(SENHA_INICIAL, 10);
        const novoUsuario = await prisma.user.create({
          data: {
            email,
            fullName:           fullName?.trim() || '',
            passwordHash:       senhaHash,
            role:               'USER',
            userType:           userTypeConvidado,
            mustChangePassword: true,
          },
        });
        usuarioConvidadoId = novoUsuario.id;
        usuarioCriado      = true;
      }

      if (usuarioConvidadoId) {
        try {
          await prisma.$executeRawUnsafe(`UPDATE schs2vet.users SET "isConvidado" = true WHERE id = $1`, usuarioConvidadoId);
        } catch { /* ignora se coluna ainda não existir */ }
      }

      // ADMIN convida como Gestor → email diferenciado (cria organização)
      // GESTOR convida membros comuns → email padrão de equipe
      if (isAdmin) {
        emailService.enviarConviteAdmin({
          email,
          token:         convite.token,
          usuarioCriado,
          senhaInicial:  usuarioCriado ? SENHA_INICIAL : null,
        }).catch(err => console.error('[emailService] Falha ao enviar convite admin:', err));
      } else {
        const convidadoPorNome = req.user.fullName || 'Gestor';
        emailService.enviarConviteEquipe({
          email,
          cargo,
          token:         convite.token,
          vetNome:       convidadoPorNome,
          equipeNome:    equipe.nome,
          usuarioCriado,
          senhaInicial:  usuarioCriado ? SENHA_INICIAL : null,
          especiesNomes: [],
        }).catch(err => console.error('[emailService] Falha ao enviar convite:', err));
      }

      return res.status(201).json({
        sucesso:  true,
        dados:    convite,
        mensagem: 'Convite enviado por e-mail',
      });
    } catch (err) {
      console.error('Erro ao convidar para equipe:', err);
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'Convite duplicado.' });
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  verificarConvite: async (req, res) => {
    try {
      const { token } = req.params;
      const convite   = await prisma.conviteEquipe.findUnique({
        where:   { token },
        include: { equipe: { include: { empresa: { select: { nome: true } } } } },
      });

      if (!convite)                       return res.status(404).json({ sucesso: false, mensagem: 'Convite não encontrado' });
      if (convite.status !== 'PENDENTE')  return res.status(410).json({ sucesso: false, mensagem: 'Convite já utilizado ou cancelado' });
      if (new Date() > convite.expiresAt) return res.status(410).json({ sucesso: false, mensagem: 'Convite expirado' });

      res.json({ sucesso: true, dados: { email: convite.email, cargo: convite.cargo, equipe: convite.equipe } });
    } catch (err) {
      console.error('Erro ao verificar convite:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  aceitarConvite: async (req, res) => {
    try {
      const { token } = req.params;
      const userId    = req.user.id;

      const convite = await prisma.conviteEquipe.findUnique({ where: { token } });
      if (!convite)                       return res.status(404).json({ sucesso: false, mensagem: 'Convite não encontrado' });
      if (convite.status !== 'PENDENTE')  return res.status(410).json({ sucesso: false, mensagem: 'Convite já utilizado' });
      if (new Date() > convite.expiresAt) return res.status(410).json({ sucesso: false, mensagem: 'Convite expirado' });

      const jaEMembro = await prisma.membroEquipe.findUnique({
        where: { equipeId_userId: { equipeId: convite.equipeId, userId } },
      });
      if (jaEMembro) return res.status(409).json({ sucesso: false, mensagem: 'Você já é membro desta equipe' });

      await prisma.$transaction([
        prisma.membroEquipe.create({ data: { equipeId: convite.equipeId, userId, cargo: convite.cargo } }),
        prisma.conviteEquipe.update({ where: { token }, data: { status: 'ACEITO' } }),
      ]);

      // Aplica permissões padrão para o cargo
      await PermissaoService.aplicarPermissoesPadrao({
        equipeId:      convite.equipeId,
        userId,
        cargo:         convite.cargo,
        atualizadoPor: 0,
      });

      // Marca como convidado e copia espécies do dono da equipe
      await aplicarOnboardingConvidado(userId, convite.equipeId);

      res.json({ sucesso: true, mensagem: 'Bem-vindo à equipe!' });
    } catch (err) {
      console.error('Erro ao aceitar convite:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // GET /api/equipes/minhas-especies
  // Retorna os nomes das espécies que a equipe/empresa do usuário atende.
  // ADMIN → todas as espécies. VET → do próprio VetPerfil. GESTOR/outros → união dos vets da equipe.
  getMinhasEspecies: async (req, res) => {
    try {
      const userId = Number(req.user.id);

      if ((req.user.role === 'ADMIN' || req.user.userType === 'ADMIN')) {
        const todas = await prisma.especie.findMany({ select: { nome: true } });
        return res.json({ sucesso: true, dados: todas.map(e => e.nome) });
      }

      // Busca o VetPerfil do próprio usuário
      const perfilProprio = await prisma.vetPerfil.findUnique({
        where:   { userId },
        include: { especies: { include: { especie: { select: { nome: true } } } } },
      });

      if (perfilProprio?.especies?.length) {
        const nomes = perfilProprio.especies.map(ve => ve.especie.nome);
        return res.json({ sucesso: true, dados: [...new Set(nomes)] });
      }

      // Para GESTOR ou usuário sem VetPerfil: busca as espécies de todos os vets da equipe
      const membro = await prisma.membroEquipe.findFirst({
        where:   { userId },
        include: { equipe: { select: { id: true, membros: { select: { userId: true } } } } },
      });

      if (!membro?.equipe) {
        return res.json({ sucesso: true, dados: [] });
      }

      const userIds = membro.equipe.membros.map(m => m.userId);
      const perfis  = await prisma.vetPerfil.findMany({
        where:   { userId: { in: userIds } },
        include: { especies: { include: { especie: { select: { nome: true } } } } },
      });

      const nomes = perfis.flatMap(p => p.especies.map(ve => ve.especie.nome));
      return res.json({ sucesso: true, dados: [...new Set(nomes)] });
    } catch (err) {
      console.error('Erro ao buscar espécies da equipe:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar espécies' });
    }
  },

  getMinhaEquipe: async (req, res) => {
    try {
      // Prioriza equipe ativa (gestor CPF) > empresa ativa (gestor CNPJ) > primeira equipe
      const whereBase = { userId: Number(req.user.id) };
      const where = req.equipeId
        ? { ...whereBase, equipeId: req.equipeId }
        : req.empresaId
          ? { ...whereBase, equipe: { empresaId: req.empresaId } }
          : whereBase;

      const includeEquipe = {
        equipe: {
          include: {
            empresa: true,
            membros: {
              include: {
                user: { select: { id: true, fullName: true, email: true, phone: true, ativo: true, userType: true } },
              },
              orderBy: { createdAt: 'asc' },
            },
            convites: {
              where: { status: 'PENDENTE', expiresAt: { gt: new Date() } },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      };

      let membro = await prisma.membroEquipe.findFirst({
        where,
        include: includeEquipe,
        orderBy: { createdAt: 'asc' },
      });

      // Sem MembroEquipe no contexto ativo (ex.: owner sem registro) → primeira equipe geral
      if (!membro?.equipe && (req.equipeId || req.empresaId)) {
        membro = await prisma.membroEquipe.findFirst({
          where: whereBase,
          include: includeEquipe,
          orderBy: { createdAt: 'asc' },
        });
      }

      if (!membro?.equipe) return res.status(404).json({ sucesso: false, mensagem: 'Nenhuma equipe encontrada.' });
      res.json({ sucesso: true, dados: membro.equipe });
    } catch (err) {
      console.error('Erro ao buscar equipe:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  recusarConvite: async (req, res) => {
    try {
      const { token } = req.params;
      const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true } });
      const convite = await prisma.conviteEquipe.findUnique({ where: { token } });

      if (!convite)                      return res.status(404).json({ sucesso: false, mensagem: 'Convite não encontrado' });
      if (convite.status !== 'PENDENTE') return res.status(410).json({ sucesso: false, mensagem: 'Convite já respondido' });
      if (!user || user.email !== convite.email) {
        return res.status(403).json({ sucesso: false, mensagem: 'Convite pertence a outro e-mail.' });
      }

      await prisma.conviteEquipe.update({ where: { token }, data: { status: 'RECUSADO' } });
      res.json({ sucesso: true, mensagem: 'Convite recusado.' });
    } catch (err) {
      console.error('Erro ao recusar convite:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  recusarMeusConvites: async (req, res) => {
    try {
      const email = req.user.email;
      await prisma.conviteEquipe.updateMany({
        where: { email, status: 'PENDENTE' },
        data:  { status: 'RECUSADO' },
      });
      res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao recusar convites:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  autoAceitarConvites: async (req, res) => {
    try {
      const email  = req.user.email;
      // Busca o usuario no banco para garantir o id correto (evita problema de tipo com JWT)
      const dbUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!dbUser) return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });
      const userId = dbUser.id;

      const convitesPendentes = await prisma.conviteEquipe.findMany({
        where: { email, status: 'PENDENTE', expiresAt: { gt: new Date() } },
      });

      let aceitos = 0;
      for (const convite of convitesPendentes) {
        const jaEMembro = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId: convite.equipeId, userId } },
        });
        if (jaEMembro) continue;

        await prisma.$transaction([
          prisma.membroEquipe.create({ data: { equipeId: convite.equipeId, userId, cargo: convite.cargo } }),
          prisma.conviteEquipe.update({ where: { id: convite.id }, data: { status: 'ACEITO' } }),
        ]);

        await PermissaoService.aplicarPermissoesPadrao({
          equipeId:      convite.equipeId,
          userId,
          cargo:         convite.cargo,
          atualizadoPor: 0,
        });

        // Marca como convidado e copia espécies do dono da equipe
        await aplicarOnboardingConvidado(userId, convite.equipeId);
        aceitos++;
      }

      res.json({ sucesso: true, dados: { aceitos } });
    } catch (err) {
      console.error('Erro ao auto-aceitar convites:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  removerConvite: async (req, res) => {
    try {
      const userId    = req.user.id;
      const conviteId = Number(req.params.conviteId);

      const empresa = await getEmpresaDoGestor(userId, req.empresaId);
      if (!empresa) return res.status(403).json({ sucesso: false, mensagem: 'Sem permissão' });

      const equipe = await getEquipeAtiva(empresa.id, req.equipeId);
      if (!equipe) return res.status(403).json({ sucesso: false, mensagem: 'Sem permissão' });

      const convite = await prisma.conviteEquipe.findFirst({ where: { id: conviteId, equipeId: equipe.id } });
      if (!convite) return res.status(404).json({ sucesso: false, mensagem: 'Convite não encontrado' });
      if (convite.status === 'ACEITO') {
        return res.status(400).json({ sucesso: false, mensagem: 'Convite já aceito — remova o membro pela lista de membros' });
      }

      await prisma.conviteEquipe.delete({ where: { id: conviteId } });
      res.json({ sucesso: true, mensagem: 'Convite removido' });
    } catch (err) {
      console.error('Erro ao remover convite:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  cancelarConvite: async (req, res) => {
    try {
      const equipeId  = Number(req.params.equipeId);
      const conviteId = Number(req.params.conviteId);

      const membroSolicitante = await prisma.membroEquipe.findUnique({
        where: { equipeId_userId: { equipeId, userId: req.user.id } },
        select: { cargo: true },
      });
      if (!membroSolicitante || membroSolicitante.cargo !== 'GESTOR') {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas gestores podem cancelar convites.' });
      }

      await prisma.conviteEquipe.updateMany({
        where: { id: conviteId, equipeId, status: 'PENDENTE' },
        data:  { status: 'CANCELADO' },
      });
      res.json({ sucesso: true, mensagem: 'Convite cancelado.' });
    } catch (err) {
      console.error('Erro ao cancelar convite:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // Atribui múltiplos cargos a um membro. As permissões são a união (max nivel) de todos os perfis.
  alterarCargos: async (req, res) => {
    try {
      const equipeId   = Number(req.params.equipeId);
      const alvoUserId = Number(req.params.alvoUserId);
      const { cargos } = req.body;

      if (!Array.isArray(cargos) || cargos.length === 0) {
        return res.status(400).json({ sucesso: false, mensagem: 'cargos deve ser um array não-vazio.' });
      }
      if (cargos.includes('PROPRIETARIO')) {
        return res.status(400).json({ sucesso: false, mensagem: 'O perfil PROPRIETARIO é atribuído automaticamente.' });
      }

      // ADMIN bypass; Gestor pode alterar mas não pode promover a GESTOR
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const membroSolicitante = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
          select: { cargo: true },
        });
        if (!membroSolicitante || membroSolicitante.cargo !== 'GESTOR') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas gestores podem alterar cargos.' });
        }
        if (cargos.includes('GESTOR')) {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem conceder o cargo de Gestor.' });
        }
      }

      // Garante que todos os perfis padrão existam (evita 400 por PerfilEquipe ausente
      // quando o gestor usa Equipe.tsx antes de abrir ControleAcesso).
      await PermissaoService.garantirPerfisPadrao(equipeId);

      // Valida que todos os cargos existem na equipe
      for (const cargo of cargos) {
        const perfilExiste = await prisma.perfilEquipe.findUnique({
          where: { equipeId_slug: { equipeId, slug: cargo } },
        });
        if (!perfilExiste) {
          return res.status(400).json({ sucesso: false, mensagem: `Cargo "${cargo}" não existe nesta equipe.` });
        }
      }

      // Cargo primário: GESTOR tem prioridade, senão o primeiro da lista
      const cargoPrimario = cargos.includes('GESTOR') ? 'GESTOR' : cargos[0];

      // Carrega as matrizes de permissão de todos os cargos e faz a união (nivel máximo).
      // Fallback para PERMISSOES_PADRAO quando MatrizPerfil não está semeada para o cargo
      // nesta equipe — evita que a segunda role contribua zero para a união.
      // NEGADO em qualquer cargo vence (deny-wins) sobre qualquer nível positivo dos demais.
      const NIVEL_ORD = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };
      const matrizes = await prisma.matrizPerfil.findMany({
        where: { equipeId, perfilSlug: { in: cargos } },
      });

      // Agrupa por cargo para detectar cargos sem entradas no banco
      const slugsPorCargo = {};
      for (const m of matrizes) {
        if (!slugsPorCargo[m.perfilSlug]) slugsPorCargo[m.perfilSlug] = {};
        slugsPorCargo[m.perfilSlug][m.moduloSlug] = m.nivel;
      }

      const mapaUniao = {};
      for (const cargo of cargos) {
        // MatrizPerfil da equipe tem prioridade; PERMISSOES_PADRAO como fallback
        const matrizCargo  = slugsPorCargo[cargo] ?? {};
        const defaultCargo = PERMISSOES_PADRAO[cargo] ?? {};
        const efetivo      = { ...defaultCargo, ...matrizCargo };

        for (const [slug, nivel] of Object.entries(efetivo)) {
          if (nivel === 'NEGADO') {
            mapaUniao[slug] = 'NEGADO'; // deny-wins: NEGADO de qualquer cargo bloqueia
            continue;
          }
          const atual = mapaUniao[slug];
          if (atual === 'NEGADO') continue; // já negado por outro cargo
          if (atual === undefined || (NIVEL_ORD[nivel] ?? 0) > (NIVEL_ORD[atual] ?? 0)) {
            mapaUniao[slug] = nivel;
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.membroEquipe.update({
          where: { equipeId_userId: { equipeId, userId: alvoUserId } },
          data:  { cargo: cargoPrimario, cargos },
        });
        await tx.permissaoMembro.deleteMany({ where: { equipeId, userId: alvoUserId } });
        if (Object.keys(mapaUniao).length > 0) {
          await tx.permissaoMembro.createMany({
            data: Object.entries(mapaUniao).map(([slug, nivel]) => ({
              equipeId,
              userId:        alvoUserId,
              moduloSlug:    slug,
              nivel,
              atualizadoPor: req.user.id,
            })),
            skipDuplicates: true,
          });
        }
      });

      res.json({ sucesso: true, mensagem: 'Perfis atualizados com sucesso.', cargos, cargoPrimario });
    } catch (err) {
      console.error('Erro ao alterar cargos:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  alterarCargo: async (req, res) => {
    try {
      const equipeId   = Number(req.params.equipeId);
      const alvoUserId = Number(req.params.alvoUserId);
      const { cargo }  = req.body;

      if (!cargo?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'cargo é obrigatório.' });
      }

      // Valida contra PerfilEquipe da equipe (aceita perfis customizados) + restringe PROPRIETARIO
      const perfilExiste = await prisma.perfilEquipe.findUnique({
        where: { equipeId_slug: { equipeId, slug: cargo } },
      });
      if (!perfilExiste) {
        return res.status(400).json({ sucesso: false, mensagem: `Cargo "${cargo}" não existe nesta equipe.` });
      }
      if (cargo === 'PROPRIETARIO') {
        return res.status(400).json({ sucesso: false, mensagem: 'O perfil PROPRIETARIO é atribuído automaticamente — não pode ser concedido como cargo de equipe.' });
      }

      // ADMIN tem bypass total; GESTOR pode alterar cargos mas não pode promover a GESTOR
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const membroSolicitante = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
          select: { cargo: true },
        });
        if (!membroSolicitante || membroSolicitante.cargo !== 'GESTOR') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas gestores podem alterar cargos.' });
        }
        if (cargo === 'GESTOR') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem conceder o cargo de Gestor.' });
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.membroEquipe.update({
          where: { equipeId_userId: { equipeId, userId: alvoUserId } },
          data:  { cargo },
        });
        await tx.permissaoMembro.deleteMany({ where: { equipeId, userId: alvoUserId } });
        await PermissaoService.aplicarPermissoesPadrao({ equipeId, userId: alvoUserId, cargo, atualizadoPor: req.user.id });
      });

      res.json({ sucesso: true, mensagem: 'Cargo alterado com sucesso.' });
    } catch (err) {
      console.error('Erro ao alterar cargo:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  setup: async (req, res) => {
    try {
      const { empresaNome, equipeName } = req.body;
      if (!empresaNome?.trim() || !equipeName?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'empresaNome e equipeName são obrigatórios.' });
      }

      // Gestor pode ter mais de uma empresa/equipe — bloqueia apenas duplicata exata
      // (mesmo e-mail/owner + mesmo nome de empresa; setup não recebe CNPJ → empresa pessoal)
      const duplicada = await prisma.empresa.findFirst({
        where: { ownerId: req.user.id, nome: { equals: empresaNome.trim(), mode: 'insensitive' } },
      });
      if (duplicada) {
        return res.status(409).json({ sucesso: false, mensagem: 'Você já possui uma empresa com este nome.' });
      }

      const resultado = await prisma.$transaction(async (tx) => {
        const empresa = await tx.empresa.create({
          data: { nome: empresaNome.trim(), ownerId: req.user.id },
        });
        const equipe = await tx.equipe.create({
          data: { nome: equipeName.trim(), empresaId: empresa.id },
        });
        await tx.membroEquipe.create({
          data: { equipeId: equipe.id, userId: req.user.id, cargo: 'GESTOR' },
        });
        return { empresa, equipe };
      });

      res.status(201).json({ sucesso: true, dados: resultado });
    } catch (err) {
      console.error('Erro ao criar setup:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Permissões do usuário logado ─────────────────────────────────────────────
  // Retorna mapa plano { slug: nivel } para o frontend aplicar controle de acesso.
  // Gestor recebe FULL em tudo automaticamente (bypass via flag isGestor).
  // PROPRIETARIO: lê MatrizPerfil do perfil PROPRIETARIO nas equipes vinculadas aos seus animais.
  minhasPermissoes: async (req, res) => {
    try {
      const userId = req.user.id;

      // ── ADMIN: acesso irrestrito — retorna FULL em todos os módulos ───────────
      if ((req.user.role === 'ADMIN' || req.user.userType === 'ADMIN')) {
        const modulos = await prisma.moduloSistema.findMany({ select: { slug: true } });
        const permissoes = Object.fromEntries(modulos.map(m => [m.slug, 'FULL']));
        return res.json({ sucesso: true, dados: { permissoes, isGestor: true, isAdmin: true, temEquipe: true } });
      }

      // ── PROPRIETARIO: lê MatrizPerfil das equipes vinculadas aos seus animais ──
      // Multicargo: se também tiver cargo VETERINARIO/ESTAGIARIO/GESTOR numa equipe,
      // faz merge das permissões (MAX entre cargo de equipe e PROPRIETARIO).
      // NEGADO do cargo de equipe bloqueia; NEGADO de PROPRIETARIO não bloqueia cargo de equipe.
      if (req.user.userType === 'PROPRIETARIO') {
        // Verifica se também tem cargo de equipe (VETERINARIO/ESTAGIARIO/GESTOR)
        let membroEquipe = null;
        if (req.equipeId) {
          membroEquipe = await prisma.membroEquipe.findUnique({
            where:  { equipeId_userId: { equipeId: req.equipeId, userId } },
            select: { equipeId: true, cargo: true, cargos: true },
          });
        }
        if (!membroEquipe && req.empresaId) {
          membroEquipe = await prisma.membroEquipe.findFirst({
            where:   { userId, equipe: { empresaId: req.empresaId } },
            select:  { equipeId: true, cargo: true, cargos: true },
            orderBy: { createdAt: 'desc' },
          });
        }

        // GESTOR bypass — mesmo sendo PROPRIETARIO, tem acesso total
        if (membroEquipe?.cargo === 'GESTOR') {
          const modulos = await prisma.moduloSistema.findMany({ select: { slug: true } });
          const permissoes = Object.fromEntries(modulos.map(m => [m.slug, 'FULL']));
          return res.json({ sucesso: true, dados: { permissoes, isGestor: true, temEquipe: true } });
        }

        const equipeIds = await getEquipeIdsDoProprietario(Number(userId));
        const NIVEL_POSITIVO = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };

        // Permissões de PROPRIETARIO (das equipes vinculadas via animais)
        const mapaMaximoProp = {};
        if (equipeIds.length > 0) {
          const matrizesProp = await prisma.matrizPerfil.findMany({
            where: { equipeId: { in: equipeIds }, perfilSlug: 'PROPRIETARIO' },
          });
          const negadosProp = new Set();
          for (const m of matrizesProp) {
            if (m.nivel === 'NEGADO') { negadosProp.add(m.moduloSlug); mapaMaximoProp[m.moduloSlug] = 'NEGADO'; continue; }
            if (negadosProp.has(m.moduloSlug)) continue;
            const atual = mapaMaximoProp[m.moduloSlug];
            if (atual === undefined || NIVEL_POSITIVO[m.nivel] > NIVEL_POSITIVO[atual]) {
              mapaMaximoProp[m.moduloSlug] = m.nivel;
            }
          }
        }
        mapaMaximoProp['dashboard.geral.ler'] = mapaMaximoProp['dashboard.geral.ler'] ?? 'LEITURA';

        // Sem cargo de equipe: retorna apenas permissões de PROPRIETARIO (comportamento original)
        if (!membroEquipe || !['VETERINARIO', 'ESTAGIARIO'].includes(membroEquipe.cargo)) {
          if (equipeIds.length === 0) {
            return res.json({ sucesso: true, dados: {
              permissoes:    { 'dashboard.geral.ler': 'LEITURA' },
              isGestor:       false,
              temEquipe:     false,
              isProprietario: true,
            }});
          }

          const permissoes = Object.fromEntries(
            Object.entries(mapaMaximoProp).filter(([, v]) => v !== 'NENHUM')
          );
          return res.json({ sucesso: true, dados: {
            permissoes,
            isGestor:       false,
            temEquipe:      equipeIds.length > 0,
            isProprietario: true,
          }});
        }

        // COM cargo de equipe VET/ESTAGIARIO: merge de permissões
        // Lê MatrizPerfil do cargo da equipe (pode ter cargos múltiplos via campo cargos)
        const todosCargos = (membroEquipe.cargos && membroEquipe.cargos.length > 0)
          ? membroEquipe.cargos
          : [membroEquipe.cargo];

        const matrizesCargo = await prisma.matrizPerfil.findMany({
          where:  { equipeId: membroEquipe.equipeId, perfilSlug: { in: todosCargos } },
          select: { moduloSlug: true, nivel: true },
        });

        const mapaCargo = {};
        const negadosCargo = new Set();
        for (const m of matrizesCargo) {
          if (m.nivel === 'NEGADO') { negadosCargo.add(m.moduloSlug); mapaCargo[m.moduloSlug] = 'NEGADO'; continue; }
          if (negadosCargo.has(m.moduloSlug)) continue;
          const atual = mapaCargo[m.moduloSlug];
          if (!atual || (NIVEL_POSITIVO[m.nivel] ?? 0) > (NIVEL_POSITIVO[atual] ?? 0)) {
            mapaCargo[m.moduloSlug] = m.nivel;
          }
        }

        // Merge final: MAX entre cargo de equipe e PROPRIETARIO por módulo.
        // NEGADO do cargo bloqueia; NEGADO de PROPRIETARIO não bloqueia quem tem cargo de equipe.
        const todasSlugs = new Set([...Object.keys(mapaMaximoProp), ...Object.keys(mapaCargo)]);
        const permissoesMerge = {};
        for (const slug of todasSlugs) {
          const nivelCargo = mapaCargo[slug] ?? PERMISSOES_PADRAO[membroEquipe.cargo]?.[slug] ?? 'NENHUM';
          if (nivelCargo === 'NEGADO') continue;

          const nivelPropBruto = mapaMaximoProp[slug] ?? 'NENHUM';
          const nivelProp      = nivelPropBruto === 'NEGADO' ? 'NENHUM' : nivelPropBruto;

          const ordCargo = NIVEL_POSITIVO[nivelCargo] ?? 0;
          const ordProp  = NIVEL_POSITIVO[nivelProp]  ?? 0;
          const nivelMax = ordCargo >= ordProp ? nivelCargo : nivelProp;

          if (nivelMax !== 'NENHUM') permissoesMerge[slug] = nivelMax;
        }
        permissoesMerge['dashboard.geral.ler'] = permissoesMerge['dashboard.geral.ler'] ?? 'LEITURA';

        return res.json({ sucesso: true, dados: {
          permissoes:     permissoesMerge,
          isGestor:       false,
          temEquipe:      true,
          isProprietario: true,
          isMulticargo:   true,
        }});
      }

      // Resolve o vínculo do CONTEXTO ATIVO — cargo e permissões podem diferir entre
      // equipes/empresas (ex.: GESTOR na equipe A, VETERINARIO na equipe B).
      // Prioridade: equipe ativa > equipe dentro da empresa ativa > vínculo mais recente.
      let membro = null;
      if (req.equipeId) {
        membro = await prisma.membroEquipe.findUnique({
          where:  { equipeId_userId: { equipeId: req.equipeId, userId } },
          select: { equipeId: true, cargo: true, cargos: true },
        });
      }
      if (!membro && req.empresaId) {
        membro = await prisma.membroEquipe.findFirst({
          where:   { userId, equipe: { empresaId: req.empresaId } },
          select:  { equipeId: true, cargo: true, cargos: true },
          orderBy: { createdAt: 'desc' },
        });
      }

      // Dono da empresa ativa sem MembroEquipe nela → bypass de gestor
      if (!membro && req.empresaId) {
        const dono = await prisma.empresa.findFirst({
          where:  { id: req.empresaId, ownerId: userId },
          select: { id: true },
        });
        if (dono && req.user.userType !== 'FORNECEDOR') {
          const modulos = await prisma.moduloSistema.findMany({ select: { slug: true } });
          const permissoes = Object.fromEntries(modulos.map(m => [m.slug, 'FULL']));
          return res.json({ sucesso: true, dados: { permissoes, isGestor: true, temEquipe: true } });
        }
      }

      if (!membro) {
        membro = await prisma.membroEquipe.findFirst({
          where:   { userId },
          select:  { equipeId: true, cargo: true, cargos: true },
          orderBy: { createdAt: 'desc' },
        });
      }

      if (!membro) {
        return res.json({ sucesso: true, dados: { permissoes: {}, isGestor: false, temEquipe: false } });
      }

      if (membro.cargo === 'GESTOR') {
        // Gestor tem bypass — retorna FULL em todos os módulos
        const modulos = await prisma.moduloSistema.findMany({ select: { slug: true } });
        const permissoes = Object.fromEntries(modulos.map(m => [m.slug, 'FULL']));
        return res.json({ sucesso: true, dados: { permissoes, isGestor: true, temEquipe: true } });
      }

      // FORNECEDOR: permissões individuais por membro (PermissaoMembro),
      // pois o gestor configura acesso granular por animal via ControleAcesso → Fornecedor.
      // Todos os demais cargos: MatrizPerfil é a fonte canônica — reflete exatamente o que
      // o gestor configurou na aba "Matriz de Perfis" do ControleAcesso, sem depender de
      // propagação para PermissaoMembro (que pode estar desatualizada).
      let permissoesMap = {};

      if (membro.cargo === 'FORNECEDOR') {
        const membroRegistros = await prisma.permissaoMembro.findMany({
          where:  { equipeId: membro.equipeId, userId },
          select: { moduloSlug: true, nivel: true },
        });
        for (const m of membroRegistros) permissoesMap[m.moduloSlug] = m.nivel;
      } else {
        // Para VET, ESTAGIARIO, SECRETARIA, FINANCEIRO, ENFERMEIRO etc.:
        // lê MatrizPerfil diretamente — é o que o gestor edita e a única fonte de verdade.
        // Multi-cargo: faz a união dos níveis (NEGADO vence; entre positivos, toma o máximo).
        const todosCargos = (membro.cargos && membro.cargos.length > 0)
          ? membro.cargos
          : [membro.cargo];

        const matrizRegistros = await prisma.matrizPerfil.findMany({
          where:  { equipeId: membro.equipeId, perfilSlug: { in: todosCargos } },
          select: { moduloSlug: true, nivel: true },
        });

        const NIVEL_ORD_LOCAL = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };
        const negados = new Set();
        for (const m of matrizRegistros) {
          if (m.nivel === 'NEGADO') {
            negados.add(m.moduloSlug);
            permissoesMap[m.moduloSlug] = 'NEGADO';
            continue;
          }
          if (negados.has(m.moduloSlug)) continue;
          const atual = permissoesMap[m.moduloSlug];
          if (!atual || (NIVEL_ORD_LOCAL[m.nivel] ?? 0) > (NIVEL_ORD_LOCAL[atual] ?? 0)) {
            permissoesMap[m.moduloSlug] = m.nivel;
          }
        }
      }

      // Remove NENHUM do mapa para que podeExecutar retorne false para slugs ausentes
      const permissoes = Object.fromEntries(
        Object.entries(permissoesMap).filter(([, v]) => v !== 'NENHUM'),
      );
      return res.json({ sucesso: true, dados: { permissoes, isGestor: false, temEquipe: true } });
    } catch (err) {
      console.error('Erro ao buscar permissões:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Permissões globais por UserType (ADMIN) ──────────────────────────────────

  getMatrizGlobalUserType: async (req, res) => {
    try {
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        return res.status(403).json({ sucesso: false, mensagem: 'Acesso restrito a administradores.' });
      }
      const { userType } = req.params;
      if (!USER_TYPES_GERENCIADOS.includes(userType)) {
        return res.status(400).json({ sucesso: false, mensagem: `UserType inválido: ${userType}` });
      }
      const dados = await PermissaoService.getMatrizGlobalUserType({ userType });
      return res.json({ sucesso: true, dados });
    } catch (err) {
      console.error('Erro ao buscar matriz global:', err);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  salvarMatrizGlobalUserType: async (req, res) => {
    try {
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        return res.status(403).json({ sucesso: false, mensagem: 'Acesso restrito a administradores.' });
      }
      const { userType } = req.params;
      if (!USER_TYPES_GERENCIADOS.includes(userType)) {
        return res.status(400).json({ sucesso: false, mensagem: `UserType inválido: ${userType}` });
      }
      const { permissoes } = req.body;
      if (!permissoes || typeof permissoes !== 'object') {
        return res.status(400).json({ sucesso: false, mensagem: 'permissoes é obrigatório.' });
      }
      const resultado = await PermissaoService.salvarMatrizGlobalUserType({ userType, permissoes });
      return res.json({ sucesso: true, dados: resultado, mensagem: `Permissões globais de ${userType} aplicadas em ${resultado.equipesAtualizadas} equipe(s).` });
    } catch (err) {
      console.error('Erro ao salvar matriz global:', err);
      return res.status(500).json({ sucesso: false, mensagem: err.message ?? 'Erro interno' });
    }
  },

  getEspeciesEquipe: async (req, res) => {
    try {
      const equipeId = Number(req.params.equipeId);
      const membros  = await prisma.membroEquipe.findMany({ where: { equipeId }, select: { userId: true } });
      const userIds  = membros.map(m => m.userId);
      const perfis   = await prisma.vetPerfil.findMany({
        where:   { userId: { in: userIds } },
        include: { especies: { include: { especie: { select: { id: true, nome: true } } } } },
      });
      const map = new Map();
      perfis.forEach(vp => vp.especies.forEach(ve => map.set(ve.especie.id, ve.especie)));
      return res.json({ sucesso: true, dados: Array.from(map.values()) });
    } catch (err) {
      console.error('Erro ao buscar espécies da equipe:', err);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  getEspeciesEmpresa: async (req, res) => {
    try {
      const empresaId = Number(req.params.empresaId);
      const equipes   = await prisma.equipe.findMany({ where: { empresaId }, select: { id: true } });
      const equipeIds = equipes.map(e => e.id);
      const membros   = await prisma.membroEquipe.findMany({ where: { equipeId: { in: equipeIds } }, select: { userId: true } });
      const userIds   = [...new Set(membros.map(m => m.userId))];
      const perfis    = await prisma.vetPerfil.findMany({
        where:   { userId: { in: userIds } },
        include: { especies: { include: { especie: { select: { id: true, nome: true } } } } },
      });
      const map = new Map();
      perfis.forEach(vp => vp.especies.forEach(ve => map.set(ve.especie.id, ve.especie)));
      return res.json({ sucesso: true, dados: Array.from(map.values()) });
    } catch (err) {
      console.error('Erro ao buscar espécies da empresa:', err);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

module.exports = EquipeController;
// Reuso do escopo de configuração (empresa CNPJ ou equipe de empresa pessoal)
// por outros controllers — ex.: WhatsappController (Evolution API).
module.exports.resolverEscopoConfiguracao = resolverEscopoConfiguracao;

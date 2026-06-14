// backend/src/controllers/EquipeController.js
'use strict';

const bcrypt           = require('bcryptjs');
const emailService     = require('../services/emailService');
const PermissaoService = require('../services/PermissaoService');
const { getEquipeIdsDoProprietario } = require('../middlewares/permissao.middleware');

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
      if (req.user.role === 'ADMIN') {
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
      if (req.user.role !== 'ADMIN') {
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
      if (req.user.role !== 'ADMIN') {
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
      if (req.user.role === 'ADMIN') {
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
            user:   { select: { id: true, fullName: true, email: true, phone: true, ativo: true, userType: true, cep: true, endereco: true, complemento: true, bairro: true, cidade: true, estado: true } },
            equipe: { select: { nome: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        return res.json({
          sucesso: true,
          dados:        membros,
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
          user:   { select: { id: true, fullName: true, email: true, phone: true, ativo: true, userType: true, cep: true, endereco: true, complemento: true, bairro: true, cidade: true, estado: true } },
          equipe: { select: { nome: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({
        sucesso: true,
        dados:        membros,
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

      // Garante que o solicitante pertence à mesma empresa da equipe (isolamento multi-empresa)
      if (req.user.role !== 'ADMIN') {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        if (empresa) {
          const equipe = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });
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
      res.json({ sucesso: true, dados: membros });
    } catch (err) {
      console.error('Erro ao listar membros por equipe:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Fornecedores disponíveis para inclusão como PRESTADOR ──────────────────

  getFornecedoresPorEquipe: async (req, res) => {
    try {
      const equipeIdN = Number(req.params.equipeId);

      // Isolamento: verifica que o solicitante pertence à empresa desta equipe
      if (req.user.role !== 'ADMIN') {
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

  adicionarMembro: async (req, res) => {
    try {
      const vetUserId                  = req.user.id;
      const { fullName, email, phone, cargo, senha } = req.body;

      if (!fullName || !email || !cargo) {
        return res.status(400).json({ sucesso: false, mensagem: 'fullName, email e cargo são obrigatórios' });
      }

      if (cargo === 'GESTOR' && req.user.role !== 'ADMIN') {
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
      const { cargo, phone, senha, fullName, ativo, cep, endereco, complemento, bairro, cidade, estado } = req.body;

      const membro = await prisma.membroEquipe.findUnique({
        where:   { id: Number(id) },
        include: { user: true, equipe: { select: { empresaId: true } } },
      });
      if (!membro) return res.status(404).json({ sucesso: false, mensagem: 'Membro não encontrado' });

      // Autorização: ADMIN, ou gestor da empresa da equipe do membro
      if (req.user.role !== 'ADMIN') {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        if (!empresa || membro.equipe?.empresaId !== empresa.id) {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas gestores da equipe podem editar membros.' });
        }
        // Gestor não edita outro gestor (inclui troca de senha)
        if (membro.cargo === 'GESTOR') {
          return res.status(403).json({ sucesso: false, mensagem: 'Gestores não podem ser editados por outros gestores.' });
        }
      }

      if (cargo === 'GESTOR' && req.user.role !== 'ADMIN') {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem conceder o cargo de Gestor.' });
      }

      if (senha) {
        if (senha.length < 8)            return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 8 caracteres' });
        if (!/[A-Z]/.test(senha))        return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos uma letra maiúscula' });
        if (!/\d/.test(senha))           return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 1 número' });
        if (!/[^A-Za-z0-9]/.test(senha)) return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 1 caractere especial' });
      }

      if (cargo) await prisma.membroEquipe.update({ where: { id: Number(id) }, data: { cargo } });

      const dadosUser = {};
      if (fullName !== undefined && fullName.trim()) dadosUser.fullName = fullName.trim();
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
      if (req.user.role !== 'ADMIN') {
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
      if (req.user.role !== 'ADMIN') {
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
      const cargoToUserType = { VETERINARIO: 'VETERINARIO', ESTAGIARIO: 'ESTAGIARIO', ADMIN: 'VETERINARIO', MEMBRO: 'ESTAGIARIO', PROPRIETARIO: 'PROPRIETARIO' };
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
      const { email: emailRaw, cargo, fullName, phone, cep, endereco, complemento, bairro, cidade, estado, fornecedorId, tipoServico, equipeId: equipeIdBody } = req.body;
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

      // Cargo PRESTADOR: amarra a conta de login ao cadastro Fornecedor (tipoServico
      // alimenta o seletor de encaminhamento). Existente → vincula; novo → cria CLIENTE.
      let fornecedorVinculo = null;
      if (cargo === 'PRESTADOR') {
        if (fornecedorId) {
          fornecedorVinculo = await prisma.fornecedor.findUnique({ where: { id: Number(fornecedorId) } });
          if (!fornecedorVinculo) {
            return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
          }
        } else {
          const { TIPOS_SERVICO_VALIDOS } = require('./FornecedorController');
          if (!tipoServico?.trim() || !TIPOS_SERVICO_VALIDOS.includes(tipoServico)) {
            return res.status(400).json({ sucesso: false, mensagem: 'Tipo de serviço é obrigatório para fornecedor' });
          }
        }
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

      // Buscar dados do vet dono + espécies
      const vetUser = await prisma.user.findUnique({ where: { id: vetUserId }, select: { fullName: true } });
      const vetPerfilDono = await prisma.vetPerfil.findUnique({
        where:   { userId: vetUserId },
        include: { especies: { include: { especie: { select: { nome: true } } } } },
      });
      const especiesDono      = vetPerfilDono?.especies.map(e => e.especie) ?? [];
      const especiesDonoComId = vetPerfilDono?.especies.map(e => e.especieId) ?? [];

      const SENHA_INICIAL = 'Inicial_001';
      const cargoToUserType = { VETERINARIO: 'VETERINARIO', ESTAGIARIO: 'ESTAGIARIO', GESTOR: 'VETERINARIO', ADMIN: 'VETERINARIO', MEMBRO: 'ESTAGIARIO', PROPRIETARIO: 'PROPRIETARIO', PRESTADOR: 'FORNECEDOR' };
      const userTypeNovo = cargoToUserType[cargo] || 'ESTAGIARIO';

      let usuarioCriado = false;
      let usuario = await prisma.user.findUnique({ where: { email } });

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

      // Fornecedor já vinculado a OUTRA conta não pode ser reutilizado
      if (fornecedorVinculo?.userId && fornecedorVinculo.userId !== usuario.id) {
        return res.status(409).json({ sucesso: false, mensagem: 'Este fornecedor já está vinculado a outro usuário' });
      }

      // Adicionar à equipe diretamente
      await prisma.membroEquipe.create({
        data: { equipeId: equipe.id, userId: usuario.id, cargo },
      });

      // Vincular/criar cadastro Fornecedor do prestador
      if (cargo === 'PRESTADOR') {
        if (fornecedorVinculo) {
          await prisma.fornecedor.update({
            where: { id: fornecedorVinculo.id },
            data: {
              userId:   usuario.id,
              email:    fornecedorVinculo.email    || email,
              telefone: fornecedorVinculo.telefone || phone.trim(),
            },
          });
        } else {
          await prisma.fornecedor.create({
            data: {
              nome:        fullName.trim(),
              email,
              telefone:    phone.trim(),
              tipoServico: tipoServico.trim(),
              tipoEntrada: 'CLIENTE',
              empresaId:   req.empresaId ?? null,
              userId:      usuario.id,
            },
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

      res.status(201).json({ sucesso: true, mensagem: 'Membro incluído com sucesso!' });
    } catch (err) {
      console.error('Erro ao incluir membro:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  convidarGestorAdmin: async (req, res) => {
    try {
      if (req.user.role !== 'ADMIN') {
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

      const conviteAtivo = await prisma.conviteEquipe.findFirst({
        where: { equipeId: equipe.id, email, status: 'PENDENTE', expiresAt: { gt: new Date() } },
      });
      if (conviteAtivo) {
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe um convite pendente para este e-mail.' });
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const convite   = await prisma.conviteEquipe.create({
        data: { equipeId: equipe.id, email, cargo: 'GESTOR', expiresAt },
      });

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

      emailService.enviarConviteAdmin({
        email,
        token:        convite.token,
        usuarioCriado,
        senhaInicial: usuarioCriado ? SENHA_INICIAL : null,
      }).catch(err => console.error('[emailService] Falha ao enviar convite gestor:', err));

      return res.status(201).json({ sucesso: true, dados: convite, mensagem: 'Convite de gestor enviado por e-mail' });
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
      const isAdmin = req.user.role === 'ADMIN';
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
      const cargoToUserType   = { VETERINARIO: 'VETERINARIO', ESTAGIARIO: 'ESTAGIARIO', PROPRIETARIO: 'PROPRIETARIO', ADMIN: 'VETERINARIO', MEMBRO: 'ESTAGIARIO', PRESTADOR: 'FORNECEDOR' };
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

      if (req.user.role === 'ADMIN') {
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
      if (req.user.role !== 'ADMIN') {
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

      // Carrega as matrizes de permissão de todos os cargos e faz a união (nivel máximo)
      const NIVEL_ORD = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };
      const matrizes = await prisma.matrizPerfil.findMany({
        where: { equipeId, perfilSlug: { in: cargos } },
      });
      const mapaUniao = {};
      for (const m of matrizes) {
        const atual = mapaUniao[m.moduloSlug];
        if (atual === undefined || NIVEL_ORD[m.nivel] > NIVEL_ORD[atual]) {
          mapaUniao[m.moduloSlug] = m.nivel;
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
              userId:     alvoUserId,
              moduloSlug: slug,
              nivel,
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
      if (req.user.role !== 'ADMIN') {
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
      if (req.user.role === 'ADMIN') {
        const modulos = await prisma.moduloSistema.findMany({ select: { slug: true } });
        const permissoes = Object.fromEntries(modulos.map(m => [m.slug, 'FULL']));
        return res.json({ sucesso: true, dados: { permissoes, isGestor: true, isAdmin: true, temEquipe: true } });
      }

      // ── PROPRIETARIO: lê MatrizPerfil das equipes vinculadas aos seus animais ──
      // Segregação por equipe: usa Animal.equipeId (equipe responsável); animais
      // legados sem equipeId caem no escopo de todas as equipes da empresa.
      if (req.user.userType === 'PROPRIETARIO') {
        const equipeIds = await getEquipeIdsDoProprietario(Number(userId));

        if (equipeIds.length === 0) {
          return res.json({ sucesso: true, dados: {
            permissoes:    { 'dashboard.geral.ler': 'LEITURA' },
            isGestor:       false,
            temEquipe:     false,
            isProprietario: true,
          }});
        }

        const matrizes = await prisma.matrizPerfil.findMany({
          where: { equipeId: { in: equipeIds }, perfilSlug: 'PROPRIETARIO' },
        });

        // União das permissões — NEGADO vence sobre qualquer nível positivo (deny-wins).
        // Entre valores positivos, toma o máximo entre as equipes.
        const NIVEL_POSITIVO = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };
        const negados  = new Set(); // slugs com NEGADO em ao menos uma equipe
        const mapaMaximo = {};
        for (const m of matrizes) {
          if (m.nivel === 'NEGADO') {
            negados.add(m.moduloSlug);
            mapaMaximo[m.moduloSlug] = 'NEGADO';
            continue;
          }
          if (negados.has(m.moduloSlug)) continue; // NEGADO já ganhou para este slug
          const atual = mapaMaximo[m.moduloSlug];
          if (atual === undefined || NIVEL_POSITIVO[m.nivel] > NIVEL_POSITIVO[atual]) {
            mapaMaximo[m.moduloSlug] = m.nivel;
          }
        }
        mapaMaximo['dashboard.geral.ler'] = mapaMaximo['dashboard.geral.ler'] ?? 'LEITURA';

        const permissoes = Object.fromEntries(
          Object.entries(mapaMaximo).filter(([, v]) => v !== 'NENHUM')
        );

        return res.json({ sucesso: true, dados: {
          permissoes,
          isGestor:       false,
          temEquipe:     equipeIds.length > 0,
          isProprietario: true,
        }});
      }

      // Resolve o vínculo do CONTEXTO ATIVO — cargo e permissões podem diferir entre
      // equipes/empresas (ex.: GESTOR na equipe A, VETERINARIO na equipe B).
      // Prioridade: equipe ativa > equipe dentro da empresa ativa > vínculo mais recente.
      let membro = null;
      if (req.equipeId) {
        membro = await prisma.membroEquipe.findUnique({
          where:  { equipeId_userId: { equipeId: req.equipeId, userId } },
          select: { equipeId: true, cargo: true },
        });
      }
      if (!membro && req.empresaId) {
        membro = await prisma.membroEquipe.findFirst({
          where:   { userId, equipe: { empresaId: req.empresaId } },
          select:  { equipeId: true, cargo: true },
          orderBy: { createdAt: 'desc' },
        });
      }

      // Dono da empresa ativa sem MembroEquipe nela → bypass de gestor
      if (!membro && req.empresaId) {
        const dono = await prisma.empresa.findFirst({
          where:  { id: req.empresaId, ownerId: userId },
          select: { id: true },
        });
        if (dono) {
          const modulos = await prisma.moduloSistema.findMany({ select: { slug: true } });
          const permissoes = Object.fromEntries(modulos.map(m => [m.slug, 'FULL']));
          return res.json({ sucesso: true, dados: { permissoes, isGestor: true, temEquipe: true } });
        }
      }

      if (!membro) {
        membro = await prisma.membroEquipe.findFirst({
          where:   { userId },
          select:  { equipeId: true, cargo: true },
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

      const registros = await prisma.permissaoMembro.findMany({
        where:  { equipeId: membro.equipeId, userId },
        select: { moduloSlug: true, nivel: true },
      });

      const permissoes = Object.fromEntries(registros.map(r => [r.moduloSlug, r.nivel]));
      return res.json({ sucesso: true, dados: { permissoes, isGestor: false, temEquipe: true } });
    } catch (err) {
      console.error('Erro ao buscar permissões:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Permissões globais por UserType (ADMIN) ──────────────────────────────────

  getMatrizGlobalUserType: async (req, res) => {
    try {
      if (req.user.role !== 'ADMIN') {
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
      if (req.user.role !== 'ADMIN') {
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

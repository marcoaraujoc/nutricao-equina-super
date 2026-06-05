// backend/src/controllers/EquipeController.js
'use strict';

const bcrypt           = require('bcryptjs');
const emailService     = require('../services/emailService');
const PermissaoService = require('../services/PermissaoService');

const prisma = require('../lib/prisma').default;

// ─── Helper: encontra a empresa do usuário (owner OU sócio convidado) ─────────
async function getEmpresaDoSocio(userId) {
  // 1. Usuário é dono (ownerId)
  let empresa = await prisma.empresa.findFirst({ where: { ownerId: userId } });
  if (empresa) return empresa;

  // 2. Usuário é sócio convidado (cargo: 'SOCIO' em alguma equipe)
  const assoc = await prisma.membroEquipe.findFirst({
    where:   { userId, cargo: 'SOCIO' },
    include: { equipe: { select: { empresaId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (assoc?.equipe?.empresaId) {
    return prisma.empresa.findUnique({ where: { id: assoc.equipe.empresaId } });
  }
  return null;
}

// ─── Helper: garante empresa + equipe padrão do vet ──────────────────────────
async function garantirEquipePadrao(vetUserId) {
  let empresa = await getEmpresaDoSocio(vetUserId);
  if (!empresa) {
    const vetUser = await prisma.user.findUnique({ where: { id: vetUserId }, select: { fullName: true } });
    empresa = await prisma.empresa.create({
      data: { nome: `Clínica de ${vetUser?.fullName ?? 'Veterinário'}`, ownerId: vetUserId },
    });
  }

  let equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id } });
  if (!equipe) {
    equipe = await prisma.equipe.create({
      data: { nome: 'Equipe Principal', empresaId: empresa.id },
    });
  }

  return { empresa, equipe };
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

      const empresa = await prisma.empresa.create({
        data: { nome: nome.trim(), cnpj: cnpj || null, telefone: telefone || null, endereco: endereco || null, ownerId: req.user.id },
      });
      res.status(201).json({ sucesso: true, dados: empresa });
    } catch (err) {
      console.error('Erro ao criar empresa:', err);
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'CNPJ já cadastrado' });
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  listarEmpresas: async (req, res) => {
    try {
      const userId = req.user.id;
      // Inclui empresas onde é owner OU onde é sócio convidado (cargo: 'SOCIO')
      const membroSocio = await prisma.membroEquipe.findMany({
        where:   { userId, cargo: 'SOCIO' },
        select:  { equipe: { select: { empresaId: true } } },
      });
      const empresaIdsSocio = membroSocio.map(m => m.equipe.empresaId).filter(Boolean);

      const empresas = await prisma.empresa.findMany({
        where:   { OR: [{ ownerId: userId }, { id: { in: empresaIdsSocio } }] },
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

      // Verifica se o usuário é owner ou sócio da empresa
      const userId    = req.user.id;
      const empresaId_n = Number(empresaId);
      const membro    = await prisma.membroEquipe.findFirst({
        where: { userId, cargo: 'SOCIO', equipe: { empresaId: empresaId_n } },
      });
      const empresa = await prisma.empresa.findFirst({
        where: { id: empresaId_n, OR: [{ ownerId: userId }, { id: membro ? empresaId_n : -1 }] },
      });
      if (!empresa) return res.status(404).json({ sucesso: false, mensagem: 'Empresa não encontrada' });

      const equipe = await prisma.equipe.create({
        data: { nome: nome.trim(), empresaId: Number(empresaId) },
      });
      res.status(201).json({ sucesso: true, dados: equipe });
    } catch (err) {
      console.error('Erro ao criar equipe:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Convites ─────────────────────────────────────────────────────────────────

  listarConvites: async (req, res) => {
    try {
      const vetUserId = req.user.id;
      const empresa   = await getEmpresaDoSocio(vetUserId);
      if (!empresa) return res.json({ sucesso: true, dados: [] });

      const equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id } });
      if (!equipe)  return res.json({ sucesso: true, dados: [] });

      const convites = await prisma.conviteEquipe.findMany({
        where:   { equipeId: equipe.id },
        orderBy: { createdAt: 'desc' },
        select:  { id: true, email: true, cargo: true, status: true, createdAt: true, expiresAt: true },
      });
      res.json({ sucesso: true, dados: convites });
    } catch (err) {
      console.error('Erro ao listar convites:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Renomear equipe (apenas sócios da equipe) ────────────────────────────────

  renomearEquipe: async (req, res) => {
    try {
      const equipeId = Number(req.params.equipeId);
      const { nome } = req.body;

      if (!nome?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'Nome da equipe é obrigatório.' });
      }

      // Verifica que o usuário é sócio da equipe (ADMIN tem acesso irrestrito)
      if (req.user.role !== 'ADMIN') {
        const membro = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
        });
        if (!membro || membro.cargo !== 'SOCIO') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas sócios podem renomear a equipe.' });
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

  // ── Admin: todas as empresas com sócios e membros agrupados ─────────────────

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
                orderBy: { createdAt: 'asc' },
                include: {
                  user: { select: { id: true, fullName: true, email: true, ativo: true } },
                },
              },
            },
          },
        },
      });

      // Ordena membros de cada equipe: SOCIO primeiro, depois alfabético
      const dados = empresas.map(emp => ({
        id:     emp.id,
        nome:   emp.nome,
        equipes: emp.equipes.map(eq => ({
          id:   eq.id,
          nome: eq.nome,
          membros: eq.membros.sort((a, b) => {
            if (a.cargo === 'SOCIO' && b.cargo !== 'SOCIO') return -1;
            if (b.cargo === 'SOCIO' && a.cargo !== 'SOCIO') return  1;
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
          return res.json({ sucesso: true, dados: [], equipeId: null, isSocio: true, todasEquipes: [] });
        }

        const membros = await prisma.membroEquipe.findMany({
          where:   { equipeId: equipe.id },
          include: {
            user:   { select: { id: true, fullName: true, email: true, phone: true, ativo: true, userType: true } },
            equipe: { select: { nome: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        return res.json({
          sucesso: true,
          dados:        membros,
          equipeId:     equipe.id,
          isSocio:      true,
          todasEquipes: todasEquipes.map(e => ({ id: e.id, nome: e.nome, empresaNome: e.empresa?.nome ?? '' })),
        });
      }

      // Owner OU sócio convidado (cargo: 'SOCIO') — ambos têm isSocio=true
      const empresa = await getEmpresaDoSocio(vetUserId);
      const isSocio = !!empresa;

      if (!empresa) return res.json({ sucesso: true, dados: [], equipeId: null, isSocio: false });

      const equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id } });
      if (!equipe) return res.json({ sucesso: true, dados: [], equipeId: null, isSocio: false });

      const membros = await prisma.membroEquipe.findMany({
        where:   { equipeId: equipe.id },
        include: {
          user:   { select: { id: true, fullName: true, email: true, phone: true, ativo: true, userType: true } },
          equipe: { select: { nome: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ sucesso: true, dados: membros, equipeId: equipe.id, isSocio });
    } catch (err) {
      console.error('Erro ao listar membros:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },
  listarMembrosPorEquipe: async (req, res) => {
    try {
      const { equipeId } = req.params;
      const membros = await prisma.membroEquipe.findMany({
        where:   { equipeId: Number(equipeId) },
        include: { user: { select: { id: true, fullName: true, email: true, phone: true, ativo: true, userType: true } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ sucesso: true, dados: membros });
    } catch (err) {
      console.error('Erro ao listar membros por equipe:', err);
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

      if (cargo === 'SOCIO' && req.user.role !== 'ADMIN') {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem conceder o cargo de Sócio.' });
      }

      const { equipe } = await garantirEquipePadrao(vetUserId);

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
      const { id }                      = req.params;
      const { cargo, phone, senha, fullName } = req.body;

      const membro = await prisma.membroEquipe.findUnique({ where: { id: Number(id) }, include: { user: true } });
      if (!membro) return res.status(404).json({ sucesso: false, mensagem: 'Membro não encontrado' });

      if (cargo === 'SOCIO' && req.user.role !== 'ADMIN') {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem conceder o cargo de Sócio.' });
      }

      if (cargo) await prisma.membroEquipe.update({ where: { id: Number(id) }, data: { cargo } });

      const dadosUser = {};
      if (fullName !== undefined && fullName.trim()) dadosUser.fullName = fullName.trim();
      if (phone    !== undefined) dadosUser.phone        = phone;
      if (senha)                  dadosUser.passwordHash = await bcrypt.hash(senha, 10);
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

      // Sócios não podem excluir outros sócios — apenas desativar
      if (req.user.role !== 'ADMIN') {
        const alvo = await prisma.membroEquipe.findUnique({
          where:  { id: Number(membroId) },
          select: { cargo: true },
        });
        if (alvo?.cargo === 'SOCIO') {
          return res.status(403).json({
            sucesso: false,
            mensagem: 'Sócios não podem ser excluídos por outros sócios. Use a opção de desativar.',
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

  // ADMIN: remove o sócio da equipe e desativa a conta
  removerSocioAdmin: async (req, res) => {
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
      if (membro.cargo !== 'SOCIO') {
        return res.status(400).json({ sucesso: false, mensagem: 'Esta rota é exclusiva para remoção de sócios.' });
      }

      await prisma.$transaction([
        prisma.membroEquipe.delete({ where: { id: membro.id } }),
        prisma.user.delete({ where: { id: userId } }),
      ]);

      res.json({ sucesso: true, mensagem: `${membro.user.fullName} foi removido e sua conta foi excluída.` });
    } catch (err) {
      console.error('Erro ao remover sócio:', err);
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

      const { equipe } = await garantirEquipePadrao(vetUserId);

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
      const cargoToUserType = { VETERINARIO: 'VETERINARIO', ESTAGIARIO: 'ESTAGIARIO', ADMIN: 'VETERINARIO', MEMBRO: 'ESTAGIARIO' };
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

  convidarSocioAdmin: async (req, res) => {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem usar esta rota.' });
      }

      const { email: emailRaw, fullName, empresaNome, cnpj } = req.body;
      const email = (emailRaw ?? '').trim().toLowerCase();

      if (!email)               return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório.' });
      if (!empresaNome?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome da empresa é obrigatório.' });
      if (!cnpj?.trim())        return res.status(400).json({ sucesso: false, mensagem: 'CNPJ é obrigatório.' });

      const cnpjNorm = cnpj.replace(/\D/g, '');

      // Cria usuário se não existir
      const SENHA_INICIAL  = 'Inicial_001';
      let usuarioExistente = await prisma.user.findUnique({ where: { email } });
      let usuarioCriado    = false;

      if (!usuarioExistente) {
        const senhaHash = await bcrypt.hash(SENHA_INICIAL, 10);
        usuarioExistente = await prisma.user.create({
          data: {
            email,
            fullName:           fullName?.trim() || '',
            passwordHash:       senhaHash,
            role:               'USER',
            userType:           'VETERINARIO',
            mustChangePassword: true,
          },
        });
        usuarioCriado = true;
      }
      const convidadoId = usuarioExistente.id;

      // Reutiliza empresa pelo CNPJ (múltiplos sócios) ou cria nova
      let empresa = await prisma.empresa.findUnique({ where: { cnpj: cnpjNorm } });
      if (!empresa) {
        empresa = await prisma.empresa.create({
          data: { nome: empresaNome.trim(), cnpj: cnpjNorm, ownerId: convidadoId },
        });
      }

      // Usa ou cria equipe principal da empresa
      let equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id } });
      if (!equipe) {
        equipe = await prisma.equipe.create({
          data: { nome: 'Equipe Principal', empresaId: empresa.id },
        });
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
        data: { equipeId: equipe.id, email, cargo: 'SOCIO', expiresAt },
      });

      try {
        await prisma.$executeRawUnsafe(`UPDATE schs2vet.users SET "isConvidado" = true WHERE id = $1`, convidadoId);
      } catch { /* ignora */ }

      emailService.enviarConviteAdmin({
        email,
        token:        convite.token,
        usuarioCriado,
        senhaInicial: usuarioCriado ? SENHA_INICIAL : null,
      }).catch(err => console.error('[emailService] Falha ao enviar convite sócio:', err));

      return res.status(201).json({ sucesso: true, dados: convite, mensagem: 'Convite de sócio enviado por e-mail' });
    } catch (err) {
      console.error('Erro ao convidar sócio:', err);
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'CNPJ já cadastrado para outra empresa.' });
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

      // Apenas ADMIN (role sistêmica) ou SÓCIO da equipe podem usar esta rota
      const isAdmin = req.user.role === 'ADMIN';
      if (!isAdmin) {
        const membroSolicitante = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
          select: { cargo: true },
        });
        if (!membroSolicitante || membroSolicitante.cargo !== 'SOCIO') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores ou sócios podem convidar membros.' });
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
      const cargoToUserType   = { VETERINARIO: 'VETERINARIO', ESTAGIARIO: 'ESTAGIARIO' };
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

      // ADMIN convida como Sócio → email diferenciado (cria organização)
      // SÓCIO convida membros comuns → email padrão de equipe
      if (isAdmin) {
        emailService.enviarConviteAdmin({
          email,
          token:         convite.token,
          usuarioCriado,
          senhaInicial:  usuarioCriado ? SENHA_INICIAL : null,
        }).catch(err => console.error('[emailService] Falha ao enviar convite admin:', err));
      } else {
        const convidadoPorNome = req.user.fullName || 'Sócio';
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

  getMinhaEquipe: async (req, res) => {
    try {
      const membro = await prisma.membroEquipe.findFirst({
        where: { userId: Number(req.user.id) },
        include: {
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
        },
        orderBy: { createdAt: 'asc' },
      });

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

      const empresa = await getEmpresaDoSocio(userId);
      if (!empresa) return res.status(403).json({ sucesso: false, mensagem: 'Sem permissão' });

      const equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id } });
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
      if (!membroSolicitante || membroSolicitante.cargo !== 'SOCIO') {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas sócios podem cancelar convites.' });
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

      // ADMIN bypass; Sócio pode alterar mas não pode promover a SÓCIO
      if (req.user.role !== 'ADMIN') {
        const membroSolicitante = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
          select: { cargo: true },
        });
        if (!membroSolicitante || membroSolicitante.cargo !== 'SOCIO') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas sócios podem alterar cargos.' });
        }
        if (cargos.includes('SOCIO')) {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem conceder o cargo de Sócio.' });
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

      // Cargo primário: SOCIO tem prioridade, senão o primeiro da lista
      const cargoPrimario = cargos.includes('SOCIO') ? 'SOCIO' : cargos[0];

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

      // ADMIN tem bypass total; SÓCIO pode alterar cargos mas não pode promover a SÓCIO
      if (req.user.role !== 'ADMIN') {
        const membroSolicitante = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
          select: { cargo: true },
        });
        if (!membroSolicitante || membroSolicitante.cargo !== 'SOCIO') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas sócios podem alterar cargos.' });
        }
        if (cargo === 'SOCIO') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem conceder o cargo de Sócio.' });
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

      const empresaExistente = await getEmpresaDoSocio(req.user.id);
      if (empresaExistente) {
        return res.status(409).json({ sucesso: false, mensagem: 'Você já pertence a uma empresa cadastrada.' });
      }

      const resultado = await prisma.$transaction(async (tx) => {
        const empresa = await tx.empresa.create({
          data: { nome: empresaNome.trim(), ownerId: req.user.id },
        });
        const equipe = await tx.equipe.create({
          data: { nome: equipeName.trim(), empresaId: empresa.id },
        });
        await tx.membroEquipe.create({
          data: { equipeId: equipe.id, userId: req.user.id, cargo: 'SOCIO' },
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
  // Sócio recebe FULL em tudo automaticamente (bypass via flag isSocio).
  // PROPRIETARIO: lê MatrizPerfil do perfil PROPRIETARIO nas equipes vinculadas aos seus animais.
  minhasPermissoes: async (req, res) => {
    try {
      const userId = req.user.id;

      // ── PROPRIETARIO: lê MatrizPerfil das equipes vinculadas aos seus animais ──
      if (req.user.userType === 'PROPRIETARIO') {
        const animaisDoOwner = await prisma.animal.findMany({
          where:    { userId: Number(userId), empresaId: { not: null } },
          select:   { empresaId: true },
          distinct: ['empresaId'],
        });

        const empresaIds = animaisDoOwner.map(a => a.empresaId).filter(Boolean);

        if (empresaIds.length === 0) {
          return res.json({ sucesso: true, dados: {
            permissoes:    { 'dashboard.geral.ler': 'LEITURA' },
            isSocio:       false,
            temEquipe:     false,
            isProprietario: true,
          }});
        }

        const equipes = await prisma.equipe.findMany({
          where:  { empresaId: { in: empresaIds } },
          select: { id: true },
        });
        const equipeIds = equipes.map(e => e.id);

        const matrizes = await prisma.matrizPerfil.findMany({
          where: { equipeId: { in: equipeIds }, perfilSlug: 'PROPRIETARIO' },
        });

        // União das permissões — toma o nível máximo entre as equipes
        const mapaMaximo = {};
        for (const m of matrizes) {
          const atual = mapaMaximo[m.moduloSlug];
          if (atual === undefined || NIVEL_ORDER[m.nivel] > NIVEL_ORDER[atual]) {
            mapaMaximo[m.moduloSlug] = m.nivel;
          }
        }
        mapaMaximo['dashboard.geral.ler'] = mapaMaximo['dashboard.geral.ler'] ?? 'LEITURA';

        const permissoes = Object.fromEntries(
          Object.entries(mapaMaximo).filter(([, v]) => v !== 'NENHUM')
        );

        return res.json({ sucesso: true, dados: {
          permissoes,
          isSocio:       false,
          temEquipe:     equipeIds.length > 0,
          isProprietario: true,
        }});
      }

      const membro = await prisma.membroEquipe.findFirst({
        where:   { userId },
        select:  { equipeId: true, cargo: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!membro) {
        return res.json({ sucesso: true, dados: { permissoes: {}, isSocio: false, temEquipe: false } });
      }

      if (membro.cargo === 'SOCIO') {
        // Sócio tem bypass — retorna FULL em todos os módulos
        const modulos = await prisma.moduloSistema.findMany({ select: { slug: true } });
        const permissoes = Object.fromEntries(modulos.map(m => [m.slug, 'FULL']));
        return res.json({ sucesso: true, dados: { permissoes, isSocio: true, temEquipe: true } });
      }

      const registros = await prisma.permissaoMembro.findMany({
        where:  { equipeId: membro.equipeId, userId },
        select: { moduloSlug: true, nivel: true },
      });

      const permissoes = Object.fromEntries(registros.map(r => [r.moduloSlug, r.nivel]));
      return res.json({ sucesso: true, dados: { permissoes, isSocio: false, temEquipe: true } });
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

};

module.exports = EquipeController;

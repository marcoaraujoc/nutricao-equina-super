// backend/src/controllers/EquipeController.js
'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt           = require('bcryptjs');
const emailService     = require('../services/emailService');

const prisma = new PrismaClient();

// ─── Helper: garante empresa + equipe padrão do vet ──────────────────────────
async function garantirEquipePadrao(vetUserId) {
  let empresa = await prisma.empresa.findFirst({ where: { ownerId: vetUserId } });
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
      const empresas = await prisma.empresa.findMany({
        where:   { ownerId: req.user.id },
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

      const empresa = await prisma.empresa.findFirst({ where: { id: Number(empresaId), ownerId: req.user.id } });
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

  // ── Membros ─────────────────────────────────────────────────────────────────

  listarMembros: async (req, res) => {
    try {
      const vetUserId = req.user.id;
      const empresa   = await prisma.empresa.findFirst({ where: { ownerId: vetUserId } });
      if (!empresa) return res.json({ sucesso: true, dados: [] });

      const equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id } });
      if (!equipe)  return res.json({ sucesso: true, dados: [] });

      const membros = await prisma.membroEquipe.findMany({
        where:   { equipeId: equipe.id },
        include: {
          user:   { select: { id: true, fullName: true, email: true, phone: true, ativo: true, userType: true } },
          equipe: { select: { nome: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ sucesso: true, dados: membros });
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
      const { id }              = req.params;
      const { cargo, phone, senha } = req.body;

      const membro = await prisma.membroEquipe.findUnique({ where: { id: Number(id) }, include: { user: true } });
      if (!membro) return res.status(404).json({ sucesso: false, mensagem: 'Membro não encontrado' });

      if (cargo) await prisma.membroEquipe.update({ where: { id: Number(id) }, data: { cargo } });

      const dadosUser = {};
      if (phone !== undefined) dadosUser.phone = phone;
      if (senha)               dadosUser.passwordHash = await bcrypt.hash(senha, 10);
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
      await prisma.membroEquipe.delete({ where: { id: Number(membroId) } });
      res.json({ sucesso: true, mensagem: 'Membro removido da equipe' });
    } catch (err) {
      console.error('Erro ao remover membro:', err);
      if (err.code === 'P2025') return res.status(404).json({ sucesso: false, mensagem: 'Membro não encontrado' });
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

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

      const convite = await prisma.conviteEquipe.create({
        data: { equipeId: equipe.id, email, cargo, expiresAt },
      });

      // Buscar dados do vet para o email
      const vetUser = await prisma.user.findUnique({
        where:  { id: vetUserId },
        select: { fullName: true },
      });

      // Enviar email com link de convite
      emailService.enviarConviteEquipe({
        email,
        cargo,
        token:      convite.token,
        vetNome:    vetUser?.fullName || 'Veterinário',
        equipeNome: equipe.nome,
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

      res.json({ sucesso: true, mensagem: 'Bem-vindo à equipe!' });
    } catch (err) {
      console.error('Erro ao aceitar convite:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

module.exports = EquipeController;
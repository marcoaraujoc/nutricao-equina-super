// backend/src/controllers/VeterinarioController.js
'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const VeterinarioController = {

  // ── GET /api/veterinarios ─────────────────────────────────────────────────
  listar: async (req, res) => {
    try {
      const { especieId } = req.query;

      const where = {};

      if (especieId) {
        where.especies = {
          some: { especieId: Number(especieId) },
        };
      }

      const perfis = await prisma.vetPerfil.findMany({
        where,
        include: {
          user: {
            select: { id: true, fullName: true, email: true, phone: true },
          },
          especies: {
            include: { especie: { select: { id: true, nome: true } } },
          },
        },
        orderBy: { user: { fullName: 'asc' } },
      });

      const dados = perfis.map(p => ({
        vetUserId: p.userId,
        crmv:      p.crmv,
        bio:       p.bio,
        nome:      p.user.fullName,
        email:     p.user.email,
        telefone:  p.user.phone,
        especies:  p.especies.map(ve => ({ id: ve.especie.id, nome: ve.especie.nome })),
      }));

      res.json({ sucesso: true, dados });
    } catch (error) {
      console.error('Erro ao listar veterinários:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── GET /api/veterinarios/proprietarios ───────────────────────────────────
  // Lista proprietários ativos — acessível para veterinários
  listarProprietarios: async (req, res) => {
    try {
      const proprietarios = await prisma.user.findMany({
        where:   { userType: 'PROPRIETARIO', ativo: true },
        select:  { id: true, fullName: true, email: true, phone: true },
        orderBy: { fullName: 'asc' },
      });
      res.json({ sucesso: true, dados: proprietarios });
    } catch (error) {
      console.error('Erro ao listar proprietários:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── GET /api/veterinarios/perfil ──────────────────────────────────────────
  obterPerfil: async (req, res) => {
    try {
      const userId = req.user.id;

      let perfil = await prisma.vetPerfil.findUnique({
        where: { userId },
        include: {
          especies: {
            include: { especie: { select: { id: true, nome: true } } },
          },
        },
      });

      if (!perfil) {
        perfil = await prisma.vetPerfil.create({
          data: { userId },
          include: {
            especies: {
              include: { especie: { select: { id: true, nome: true } } },
            },
          },
        });
      }

      res.json({
        sucesso: true,
        dados: {
          ...perfil,
          especies: perfil.especies.map(ve => ({ id: ve.especie.id, nome: ve.especie.nome })),
        },
      });
    } catch (error) {
      console.error('Erro ao obter perfil vet:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── PUT /api/veterinarios/perfil ──────────────────────────────────────────
  atualizarPerfil: async (req, res) => {
    try {
      const userId = req.user.id;
      const { crmv, bio, especieIds } = req.body;

      let perfil = await prisma.vetPerfil.findUnique({ where: { userId } });
      if (!perfil) {
        perfil = await prisma.vetPerfil.create({ data: { userId } });
      }

      await prisma.vetPerfil.update({
        where: { id: perfil.id },
        data: { crmv: crmv ?? perfil.crmv, bio: bio ?? perfil.bio },
      });

      if (Array.isArray(especieIds)) {
        await prisma.vetEspecie.deleteMany({ where: { vetPerfilId: perfil.id } });
        if (especieIds.length > 0) {
          await prisma.vetEspecie.createMany({
            data: especieIds.map(eid => ({ vetPerfilId: perfil.id, especieId: Number(eid) })),
            skipDuplicates: true,
          });
        }
      }

      res.json({ sucesso: true, mensagem: 'Perfil atualizado com sucesso' });
    } catch (error) {
      console.error('Erro ao atualizar perfil vet:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── POST /api/veterinarios/solicitacoes ───────────────────────────────────
  solicitarVinculo: async (req, res) => {
    try {
      const { animalId, vetUserId, mensagem } = req.body;

      if (!animalId || !vetUserId) {
        return res.status(400).json({ sucesso: false, mensagem: 'animalId e vetUserId são obrigatórios' });
      }

      const animal = await prisma.animal.findFirst({
        where: { id: Number(animalId), userId: req.user.id },
      });
      if (!animal) {
        return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      }

      const existente = await prisma.vetAnimalSolicitacao.findUnique({
        where: { animalId_vetUserId: { animalId: Number(animalId), vetUserId: Number(vetUserId) } },
      });
      if (existente && existente.status === 'PENDENTE') {
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma solicitação pendente para este veterinário' });
      }
      if (existente && existente.status === 'ACEITO') {
        return res.status(409).json({ sucesso: false, mensagem: 'Este veterinário já é responsável por este animal' });
      }

      const solicitacao = await prisma.vetAnimalSolicitacao.upsert({
        where: { animalId_vetUserId: { animalId: Number(animalId), vetUserId: Number(vetUserId) } },
        create: {
          animalId:  Number(animalId),
          vetUserId: Number(vetUserId),
          status:    'PENDENTE',
          mensagem:  mensagem || null,
        },
        update: {
          status:   'PENDENTE',
          mensagem: mensagem || null,
        },
      });

      // Notifica o veterinário por e-mail (não-bloqueante)
      try {
        const vet = await prisma.user.findUnique({
          where:  { id: Number(vetUserId) },
          select: { email: true, fullName: true },
        });

        if (vet?.email && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
          const nodemailer = require('nodemailer');
          const transporter = nodemailer.createTransport({
            host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
            port:   Number(process.env.EMAIL_PORT) || 587,
            secure: false,
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
          });

          await transporter.sendMail({
            from:    `S2Vet <${process.env.EMAIL_USER}>`,
            to:      vet.email,
            subject: `[S2Vet] Nova solicitação de vínculo — ${animal.nome}`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
                <h2 style="color:#059669;margin-bottom:8px">Nova solicitação de vínculo</h2>
                <p style="color:#374151">Olá, <strong>${vet.fullName}</strong>!</p>
                <p style="color:#374151">O proprietário <strong>${req.user.fullName}</strong> solicita que você seja o veterinário responsável pelo animal:</p>
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0">
                  <p style="margin:0;font-size:18px;font-weight:bold;color:#065f46">${animal.nome}</p>
                  ${mensagem ? `<p style="margin:8px 0 0;color:#374151;font-size:14px">"${mensagem}"</p>` : ''}
                </div>
                <p style="color:#374151">Acesse o S2Vet para aceitar ou recusar a solicitação.</p>
                <a href="${process.env.APP_URL || 'http://localhost:5173'}/clinica"
                   style="display:inline-block;background:#059669;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:8px">
                  Acessar S2Vet
                </a>
                <p style="color:#9ca3af;font-size:12px;margin-top:24px">S2Vet — Sistema Hospitalar Veterinário</p>
              </div>
            `,
          });
        }
      } catch (emailErr) {
        console.warn('VeterinarioController: falha ao enviar e-mail de solicitação:', emailErr.message);
      }

      res.status(201).json({
        sucesso: true,
        dados:   solicitacao,
        mensagem: 'Solicitação enviada. Aguardando aceite do veterinário.',
      });
    } catch (error) {
      console.error('Erro ao solicitar vínculo:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── GET /api/veterinarios/solicitacoes ────────────────────────────────────
  listarSolicitacoes: async (req, res) => {
    try {
      const { status } = req.query;
      const vetUserId  = req.user.id;

      const where = { vetUserId };
      if (status) where.status = status;

      const solicitacoes = await prisma.vetAnimalSolicitacao.findMany({
        where,
        include: {
          animal: {
            select: {
              id: true, nome: true, photoUrl: true, peso: true,
              sexo: true, categoriaAnimal: true, tipoExercicio: true,
              dataNascimento: true, idadeAnos: true,
              especie: { select: { nome: true } },
              raca:    { select: { nome: true } },
              user:    { select: { fullName: true, email: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ sucesso: true, dados: solicitacoes });
    } catch (error) {
      console.error('Erro ao listar solicitações:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── PATCH /api/veterinarios/solicitacoes/:id ──────────────────────────────
  responderSolicitacao: async (req, res) => {
    try {
      const { id }     = req.params;
      const { status } = req.body;
      const vetUserId  = req.user.id;

      if (!['ACEITO', 'RECUSADO'].includes(status)) {
        return res.status(400).json({ sucesso: false, mensagem: 'Status inválido. Use ACEITO ou RECUSADO' });
      }

      const solicitacao = await prisma.vetAnimalSolicitacao.findFirst({
        where: { id: Number(id), vetUserId },
      });
      if (!solicitacao) {
        return res.status(404).json({ sucesso: false, mensagem: 'Solicitação não encontrada' });
      }
      if (solicitacao.status !== 'PENDENTE') {
        return res.status(409).json({ sucesso: false, mensagem: 'Solicitação já foi respondida' });
      }

      const atualizada = await prisma.vetAnimalSolicitacao.update({
        where: { id: Number(id) },
        data:  { status },
      });

      res.json({
        sucesso: true,
        dados:   atualizada,
        mensagem: status === 'ACEITO' ? 'Animal aceito com sucesso!' : 'Solicitação recusada.',
      });
    } catch (error) {
      console.error('Erro ao responder solicitação:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── GET /api/veterinarios/meus-animais ────────────────────────────────────
  meusAnimais: async (req, res) => {
    try {
      const vetUserId = req.user.id;

      const solicitacoes = await prisma.vetAnimalSolicitacao.findMany({
        where:   { vetUserId, status: 'ACEITO' },
        include: {
          animal: {
            include: {
              especie: { select: { id: true, nome: true } },
              raca:    { select: { id: true, nome: true } },
              user:    { select: { id: true, fullName: true, email: true } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      res.json({
        sucesso: true,
        dados:   solicitacoes.map(s => s.animal),
      });
    } catch (error) {
      console.error('Erro ao listar animais do vet:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

module.exports = VeterinarioController;
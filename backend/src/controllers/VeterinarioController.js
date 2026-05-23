// backend/src/controllers/VeterinarioController.js
'use strict';

const { PrismaClient } = require('@prisma/client');
const crypto           = require('crypto');
const emailService     = require('../services/emailService');

const prisma = new PrismaClient();

// ─── Helpers internos ─────────────────────────────────────────────────────────

const gerarToken     = () => crypto.randomBytes(32).toString('hex');
const gerarExpiracao = (dias = 7) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d;
};

// ─── Controller ───────────────────────────────────────────────────────────────

const VeterinarioController = {

  // ── GET /api/veterinarios ─────────────────────────────────────────────────
  listar: async (req, res) => {
    try {
      const { especieId } = req.query;

      const where = {};
      if (especieId) {
        where.especies = { some: { especieId: Number(especieId) } };
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
      console.error('[VeterinarioController.listar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── GET /api/veterinarios/proprietarios ───────────────────────────────────
  listarProprietarios: async (req, res) => {
    try {
      const proprietarios = await prisma.user.findMany({
        where:   { userType: 'PROPRIETARIO', ativo: true },
        select:  { id: true, fullName: true, email: true, phone: true },
        orderBy: { fullName: 'asc' },
      });
      res.json({ sucesso: true, dados: proprietarios });
    } catch (error) {
      console.error('[VeterinarioController.listarProprietarios]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── GET /api/veterinarios/perfil ──────────────────────────────────────────
  obterPerfil: async (req, res) => {
    try {
      const userId = req.user.id;

      let perfil = await prisma.vetPerfil.findUnique({
        where:   { userId },
        include: {
          especies: {
            include: { especie: { select: { id: true, nome: true } } },
          },
        },
      });

      if (!perfil) {
        perfil = await prisma.vetPerfil.create({
          data:    { userId },
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
      console.error('[VeterinarioController.obterPerfil]', error);
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
        data:  { crmv: crmv ?? perfil.crmv, bio: bio ?? perfil.bio },
      });

      if (Array.isArray(especieIds)) {
        await prisma.vetEspecie.deleteMany({ where: { vetPerfilId: perfil.id } });
        if (especieIds.length > 0) {
          await prisma.vetEspecie.createMany({
            data:           especieIds.map(eid => ({ vetPerfilId: perfil.id, especieId: Number(eid) })),
            skipDuplicates: true,
          });
        }
      }

      res.json({ sucesso: true, mensagem: 'Perfil atualizado com sucesso' });
    } catch (error) {
      console.error('[VeterinarioController.atualizarPerfil]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── POST /api/veterinarios/solicitacoes ───────────────────────────────────
  // Proprietário solicita vínculo com vet — gera token e envia email
  solicitarVinculo: async (req, res) => {
    try {
      const { animalId, vetUserId, mensagem } = req.body;

      if (!animalId || !vetUserId) {
        return res.status(400).json({ sucesso: false, mensagem: 'animalId e vetUserId são obrigatórios' });
      }

      const animal = await prisma.animal.findFirst({
        where:  { id: Number(animalId), userId: req.user.id },
        select: { id: true, nome: true, user: { select: { fullName: true } } },
      });
      if (!animal) {
        return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      }

      const existente = await prisma.vetAnimalSolicitacao.findUnique({
        where: { animalId_vetUserId: { animalId: Number(animalId), vetUserId: Number(vetUserId) } },
      });
      if (existente?.status === 'PENDENTE') {
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma solicitação pendente para este veterinário' });
      }
      if (existente?.status === 'ACEITO') {
        return res.status(409).json({ sucesso: false, mensagem: 'Este veterinário já é responsável por este animal' });
      }

      const vet = await prisma.user.findUnique({
        where:  { id: Number(vetUserId) },
        select: { id: true, fullName: true, email: true },
      });
      if (!vet) {
        return res.status(404).json({ sucesso: false, mensagem: 'Veterinário não encontrado' });
      }

      const token     = gerarToken();
      const expiresAt = gerarExpiracao(7);

      const solicitacao = await prisma.vetAnimalSolicitacao.upsert({
        where:  { animalId_vetUserId: { animalId: Number(animalId), vetUserId: Number(vetUserId) } },
        create: {
          animalId:      Number(animalId),
          vetUserId:     Number(vetUserId),
          status:        'PENDENTE',
          mensagem:      mensagem || null,
          approvalToken: token,
          expiresAt,
          solicitanteId: req.user.id,
        },
        update: {
          status:        'PENDENTE',
          mensagem:      mensagem || null,
          approvalToken: token,
          expiresAt,
          solicitanteId: req.user.id,
        },
      });

      // Email em background — não bloqueia a resposta
      emailService.enviarSolicitacaoVinculo({
        vetEmail:         vet.email,
        vetNome:          vet.fullName,
        animalNome:       animal.nome,
        proprietarioNome: animal.user?.fullName || req.user.fullName || 'Proprietário',
        token,
      }).catch(err => console.warn('[emailService] Falha ao enviar email de solicitação:', err.message));

      res.status(201).json({
        sucesso:  true,
        dados:    solicitacao,
        mensagem: 'Solicitação enviada. O veterinário receberá um e-mail para aceitar.',
      });
    } catch (error) {
      console.error('[VeterinarioController.solicitarVinculo]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── GET /api/veterinarios/solicitacoes ────────────────────────────────────
  listarSolicitacoes: async (req, res) => {
    try {
      const { status, animalId } = req.query;
      const vetUserId            = req.user.id;

      const where = { vetUserId };
      if (status)   where.status   = status;
      if (animalId) where.animalId = Number(animalId);

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
      console.error('[VeterinarioController.listarSolicitacoes]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── GET /api/veterinarios/solicitacoes/pendentes ──────────────────────────
  // Retorna solicitações PENDENTES do vet autenticado — usado para badge no Sidebar
  listarPendentes: async (req, res) => {
    try {
      const vetUserId = Number(req.user.id);

      const pendentes = await prisma.vetAnimalSolicitacao.findMany({
        where:   { vetUserId, status: 'PENDENTE' },
        include: {
          animal: {
            select: {
              id:       true,
              nome:     true,
              photoUrl: true,
              especie:  { select: { nome: true } },
              user:     { select: { fullName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ sucesso: true, dados: pendentes });
    } catch (error) {
      console.error('[VeterinarioController.listarPendentes]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── GET /api/veterinarios/solicitacoes/responder-email ────────────────────
  // ROTA PÚBLICA — o token JWT não é exigido; o approvalToken é a prova de identidade
  // Vet clica no link do email → aceita ou recusa diretamente
  responderViaEmail: async (req, res) => {
  const { token, acao } = req.query;

  if (!token || !['aceitar', 'recusar'].includes(acao)) {
    return res.status(400).json({
      sucesso:  false,
      mensagem: 'Token e ação (aceitar|recusar) são obrigatórios',
    });
  }

  try {
    const solicitacao = await prisma.vetAnimalSolicitacao.findUnique({
      where:   { approvalToken: token },
      include: {
        animal: {
          select: {
            id:   true,
            nome: true,
            user: { select: { fullName: true, email: true } },
          },
        },
        veterinario: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!solicitacao) {
      return res.status(404).json({
        sucesso:  false,
        mensagem: 'Token inválido ou solicitação não encontrada',
      });
    }

    // ── Validação de identidade ──────────────────────────────────────────
    // Se o JWT estiver presente, verifica que o usuário logado é o vet desta solicitação.
    // Permite que vets não logados ainda usem o link normalmente.
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt     = require('jsonwebtoken');
        const SECRET  = process.env.JWT_SECRET;
        const payload = jwt.verify(authHeader.split(' ')[1], SECRET);

        if (Number(payload.id) !== Number(solicitacao.vetUserId)) {
          return res.status(403).json({
            sucesso:  false,
            mensagem: 'Este link de aprovação pertence a outro veterinário. Faça login com a conta correta.',
            codigo:   'VET_INCORRETO',
          });
        }
      } catch {
        // Token JWT inválido ou expirado — ignora e prossegue com token-only
      }
    }
    // ────────────────────────────────────────────────────────────────────

    if (solicitacao.status !== 'PENDENTE') {
      return res.status(409).json({
        sucesso:  false,
        mensagem: `Esta solicitação já foi ${solicitacao.status.toLowerCase()}`,
        dados:    { status: solicitacao.status },
      });
    }

    if (solicitacao.expiresAt && new Date() > solicitacao.expiresAt) {
      return res.status(410).json({
        sucesso:  false,
        mensagem: 'Este link expirou. Solicite ao proprietário que reatribua o veterinário pelo sistema.',
      });
    }

    const novoStatus = acao === 'aceitar' ? 'ACEITO' : 'RECUSADO';
    const aceito     = novoStatus === 'ACEITO';

    await prisma.vetAnimalSolicitacao.update({
      where: { id: solicitacao.id },
      data:  { status: novoStatus, approvalToken: null, expiresAt: null },
    });

    const prop = solicitacao.animal?.user;
    if (prop?.email) {
      emailService.enviarConfirmacaoVinculo({
        proprietarioEmail: prop.email,
        proprietarioNome:  prop.fullName,
        animalNome:        solicitacao.animal.nome,
        vetNome:           solicitacao.veterinario.fullName,
        aceito,
      }).catch(err => console.error('[emailService] Falha ao notificar proprietário:', err));
    }

    res.json({
      sucesso:  true,
      mensagem: aceito
        ? `Vínculo com ${solicitacao.animal.nome} aceito com sucesso!`
        : 'Solicitação recusada.',
      dados: {
        status:    novoStatus,
        animalId:  solicitacao.animalId,
        animalNome: solicitacao.animal.nome,
        aceito,
      },
    });
  } catch (error) {
    console.error('[VeterinarioController.responderViaEmail]', error);
    res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
  }
},

  // ── PATCH /api/veterinarios/solicitacoes/:id ──────────────────────────────
  // Resposta via plataforma (vet logado) — também invalida o token se existir
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
        // Invalida token ao responder pela plataforma (evita uso posterior do link de email)
        data:  { status, approvalToken: null, expiresAt: null },
      });

      res.json({
        sucesso:  true,
        dados:    atualizada,
        mensagem: status === 'ACEITO' ? 'Animal aceito com sucesso!' : 'Solicitação recusada.',
      });
    } catch (error) {
      console.error('[VeterinarioController.responderSolicitacao]', error);
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
      console.error('[VeterinarioController.meusAnimais]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

module.exports = VeterinarioController;
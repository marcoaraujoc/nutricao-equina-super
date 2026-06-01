// backend/src/controllers/VeterinarioController.js
'use strict';

const { PrismaClient } = require('@prisma/client');
const crypto           = require('crypto');
const emailService     = require('../services/emailService');
const { getEmpresaIdDoVet } = require('../lib/vetUtils');

const prisma = new PrismaClient();

// ─── Helpers internos ─────────────────────────────────────────────────────────

const gerarToken     = () => crypto.randomBytes(32).toString('hex');
const gerarExpiracao = (dias = 7) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d;
};

/**
 * Retorna true se o vet PODE receber solicitações (VINCULO/DESVINCULO/TROCA_VET).
 * Regra: só recebe quem é DONO de uma empresa (Empresa.ownerId) OU é vet autônomo
 * (sem nenhum MembroEquipe). Vets convidados (têm MembroEquipe mas não são donos) → false.
 */
async function podeReceberSolicitacoes(vetId) {
  const id = Number(vetId);

  // Dono de uma empresa → sempre pode
  const empresa = await prisma.empresa.findFirst({ where: { ownerId: id } });
  if (empresa) return true;

  // Membro de uma equipe mas sem empresa própria → convidado → não pode
  const membro = await prisma.membroEquipe.findFirst({ where: { userId: id } });
  if (membro) return false;

  // Vet autônomo (sem equipe e sem empresa ainda) → pode
  return true;
}

// ─── Controller ───────────────────────────────────────────────────────────────

const VeterinarioController = {

  // ── GET /api/veterinarios ─────────────────────────────────────────────────
  listar: async (req, res) => {
    try {
      const { especieId } = req.query;

      // Apenas vets sem vínculo de equipe (standalone) ou que sejam sócios da equipe.
      // Vets convidados (membros com cargo != SOCIO) não aparecem para proprietários.
      const where = {
        user: {
          OR: [
            { membrosEquipe: { none: {} } },
            { membrosEquipe: { some: { cargo: 'SOCIO' } } },
          ],
        },
      };
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

      // Apenas o dono da empresa recebe solicitações
      if (!(await podeReceberSolicitacoes(vetUserId))) {
        return res.json({ sucesso: true, dados: [] });
      }

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

      // Apenas o dono da empresa recebe solicitações
      if (!(await podeReceberSolicitacoes(vetUserId))) {
        return res.json({ sucesso: true, dados: [] });
      }

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
        veterinario:     { select: { id: true, fullName: true, email: true } },
        novoVeterinario: { select: { id: true, fullName: true, email: true } },
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

    // TROCA_VET recusado: restaura VINCULO ACEITO (vet antigo mantém acesso)
    const isTrocaRecusada = !aceito && solicitacao.tipo === 'TROCA_VET';

    await prisma.vetAnimalSolicitacao.update({
      where: { id: solicitacao.id },
      data: isTrocaRecusada
        ? { tipo: 'VINCULO', status: 'ACEITO', novoVetUserId: null, approvalToken: null, expiresAt: null, mensagem: null }
        : { status: novoStatus, approvalToken: null, expiresAt: null },
    });

    if (!aceito && !isTrocaRecusada) {
      await prisma.animal.update({
        where: { id: solicitacao.animalId },
        data:  { veterinarioNome: null, veterinarioClinica: null },
      });
    }

    // VINCULO aceito: associa o animal à empresa do vet (multi-tenant)
    if (aceito && solicitacao.tipo === 'VINCULO') {
      const empId = await getEmpresaIdDoVet(solicitacao.vetUserId);
      if (empId) {
        await prisma.animal.update({
          where: { id: solicitacao.animalId },
          data:  { empresaId: empId },
        });
      }
    }

    // TROCA_VET aceita via email: criar VINCULO PENDENTE para o novo vet e notificá-lo
    if (aceito && solicitacao.tipo === 'TROCA_VET' && solicitacao.novoVetUserId) {
      const novoToken  = gerarToken();
      const expiresAt  = gerarExpiracao(7);

      await prisma.vetAnimalSolicitacao.upsert({
        where:  { animalId_vetUserId: { animalId: solicitacao.animalId, vetUserId: solicitacao.novoVetUserId } },
        create: {
          animalId:      solicitacao.animalId,
          vetUserId:     solicitacao.novoVetUserId,
          tipo:          'VINCULO',
          status:        'PENDENTE',
          approvalToken: novoToken,
          expiresAt,
          solicitanteId: solicitacao.solicitanteId,
        },
        update: {
          tipo:          'VINCULO',
          status:        'PENDENTE',
          approvalToken: novoToken,
          expiresAt,
          solicitanteId: solicitacao.solicitanteId,
          mensagem:      null,
        },
      });

      if (solicitacao.novoVeterinario?.email) {
        emailService.enviarSolicitacaoVinculo({
          vetEmail:         solicitacao.novoVeterinario.email,
          vetNome:          solicitacao.novoVeterinario.fullName,
          animalNome:       solicitacao.animal.nome,
          proprietarioNome: solicitacao.animal.user?.fullName || 'Proprietário',
          token:            novoToken,
        }).catch(err => console.error('[emailService] Falha ao notificar novo vet (TROCA_VET via email):', err?.message));
      }
    }

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
        include: {
          animal:          { select: { id: true, nome: true, user: { select: { fullName: true, email: true } } } },
          novoVeterinario: { select: { id: true, fullName: true, email: true } },
        },
      });
      if (!solicitacao) {
        return res.status(404).json({ sucesso: false, mensagem: 'Solicitação não encontrada' });
      }
      if (solicitacao.status !== 'PENDENTE') {
        return res.status(409).json({ sucesso: false, mensagem: 'Solicitação já foi respondida' });
      }

      // TROCA_VET recusado: restaura VINCULO ACEITO (vet antigo mantém acesso)
      const isTrocaRecusada = status === 'RECUSADO' && solicitacao.tipo === 'TROCA_VET';

      const atualizada = await prisma.vetAnimalSolicitacao.update({
        where: { id: Number(id) },
        data: isTrocaRecusada
          ? { tipo: 'VINCULO', status: 'ACEITO', novoVetUserId: null, approvalToken: null, expiresAt: null, mensagem: null }
          : { status, approvalToken: null, expiresAt: null },
      });

      if (status === 'RECUSADO' && !isTrocaRecusada) {
        await prisma.animal.update({
          where: { id: solicitacao.animalId },
          data:  { veterinarioNome: null, veterinarioClinica: null },
        });
      }

      // VINCULO aceito: associa o animal à empresa do vet (multi-tenant)
      if (status === 'ACEITO' && solicitacao.tipo === 'VINCULO') {
        const empId = await getEmpresaIdDoVet(vetUserId);
        if (empId) {
          await prisma.animal.update({
            where: { id: solicitacao.animalId },
            data:  { empresaId: empId },
          });
        }
      }

      // Notifica proprietário por email em qualquer recusa
      if (status === 'RECUSADO' && solicitacao.animal.user?.email) {
        const vetNomeLogado = req.user?.fullName || 'Veterinário';
        emailService.enviarConfirmacaoVinculo({
          proprietarioEmail: solicitacao.animal.user.email,
          proprietarioNome:  solicitacao.animal.user.fullName || 'Proprietário',
          animalNome:        solicitacao.animal.nome,
          vetNome:           vetNomeLogado,
          aceito:            false,
        }).catch(err => console.error('[emailService] Falha ao notificar proprietário sobre recusa:', err?.message));
      }

      // TROCA_VET aceita: criar VINCULO PENDENTE para o novo vet e notificá-lo
      if (status === 'ACEITO' && solicitacao.tipo === 'TROCA_VET' && solicitacao.novoVetUserId) {
        const token     = gerarToken();
        const expiresAt = gerarExpiracao(7);

        await prisma.vetAnimalSolicitacao.upsert({
          where:  { animalId_vetUserId: { animalId: solicitacao.animalId, vetUserId: solicitacao.novoVetUserId } },
          create: {
            animalId:      solicitacao.animalId,
            vetUserId:     solicitacao.novoVetUserId,
            tipo:          'VINCULO',
            status:        'PENDENTE',
            approvalToken: token,
            expiresAt,
            solicitanteId: solicitacao.solicitanteId,
          },
          update: {
            tipo:          'VINCULO',
            status:        'PENDENTE',
            approvalToken: token,
            expiresAt,
            solicitanteId: solicitacao.solicitanteId,
            mensagem:      null,
          },
        });

        if (solicitacao.novoVeterinario?.email) {
          emailService.enviarSolicitacaoVinculo({
            vetEmail:         solicitacao.novoVeterinario.email,
            vetNome:          solicitacao.novoVeterinario.fullName,
            animalNome:       solicitacao.animal.nome,
            proprietarioNome: solicitacao.animal.user?.fullName || 'Proprietário',
            token,
          }).catch(err => console.error('[emailService] Falha ao notificar novo vet (TROCA_VET):', err?.message));
        }
      }

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

  // ── POST /api/veterinarios/solicitar-vinculo ─────────────────────────────
  // Vet solicita acesso a um animal: proprietário recebe o convite por email.
  solicitarVinculoVet: async (req, res) => {
    try {
      const vetId      = Number(req.user.id);
      const { animalId } = req.body;

      if (!animalId) {
        return res.status(400).json({ sucesso: false, mensagem: 'animalId é obrigatório' });
      }

      // Apenas o dono da empresa pode solicitar vínculo com proprietários
      if (!(await podeReceberSolicitacoes(vetId))) {
        return res.status(403).json({
          sucesso:  false,
          mensagem: 'Apenas o veterinário responsável pela equipe pode solicitar vínculos com proprietários.',
        });
      }

      const animal = await prisma.animal.findUnique({
        where:  { id: Number(animalId) },
        select: {
          id:   true,
          nome: true,
          user: { select: { id: true, fullName: true, email: true } },
          solicitacoes: {
            where: {
              vetUserId: vetId,
              status:    { in: ['ACEITO', 'PENDENTE'] },
            },
            select: { status: true },
          },
        },
      });

      if (!animal) {
        return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      }

      const jaVinculado = animal.solicitacoes.some(s => s.status === 'ACEITO');
      if (jaVinculado) {
        return res.status(409).json({ sucesso: false, mensagem: 'Você já é responsável por este animal' });
      }
      const jaPendente = animal.solicitacoes.some(s => s.status === 'PENDENTE');
      if (jaPendente) {
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma solicitação pendente para este animal' });
      }

      const vet = await prisma.user.findUnique({
        where:  { id: vetId },
        select: { fullName: true },
      });

      const token     = gerarToken();
      const expiresAt = gerarExpiracao(7);

      await prisma.vetAnimalSolicitacao.upsert({
        where:  { animalId_vetUserId: { animalId: Number(animalId), vetUserId: vetId } },
        create: {
          animalId:      Number(animalId),
          vetUserId:     vetId,
          tipo:          'VINCULO',
          status:        'PENDENTE',
          approvalToken: token,
          expiresAt,
          solicitanteId: vetId,
        },
        update: {
          tipo:          'VINCULO',
          status:        'PENDENTE',
          approvalToken: token,
          expiresAt,
          solicitanteId: vetId,
          mensagem:      null,
        },
      });

      if (animal.user?.email) {
        emailService.enviarSolicitacaoVinculoProprietario({
          proprietarioEmail: animal.user.email,
          proprietarioNome:  animal.user.fullName || 'Proprietário',
          animalNome:        animal.nome,
          vetNome:           vet?.fullName || 'Veterinário',
          token,
        })
          .then(() => console.log(`[emailService] Email ao proprietário enviado → ${animal.user.email}`))
          .catch(err => console.error('[emailService] Falha ao enviar para proprietário:', err?.message ?? err));
      } else {
        console.warn('[emailService] Proprietário sem email — notificação não enviada');
      }

      res.status(201).json({
        sucesso:  true,
        mensagem: 'Solicitação enviada ao proprietário. Aguarde a aprovação.',
      });
    } catch (error) {
      console.error('[VeterinarioController.solicitarVinculoVet]', error);
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
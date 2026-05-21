// backend/src/controllers/AnimalController.js
'use strict';

const { PrismaClient } = require('@prisma/client');
const crypto           = require('crypto');
const emailService     = require('../services/emailService');

const prisma = new PrismaClient();

const ANIMAL_INCLUDE = {
  especie: true,
  raca:    true,
  user:    { select: { id: true, fullName: true, email: true, phone: true } },
  solicitacoes: {
    where:  { status: { in: ['ACEITO', 'PENDENTE'] } },
    select: {
      id:          true,
      status:      true,
      vetUserId:   true,
      veterinario: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  },
};

const gerarToken     = () => crypto.randomBytes(32).toString('hex');
const gerarExpiracao = (dias = 7) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d;
};

const obterUserType = async (userId) => {
  const u = await prisma.user.findUnique({
    where:  { id: Number(userId) },
    select: { userType: true, role: true },
  });
  return { userType: u?.userType ?? 'PROPRIETARIO', role: u?.role ?? 'USER' };
};

// Cria ou atualiza solicitação PENDENTE + dispara email ao destinatário correto
// Quando solicitanteId === novoVetId → vet solicitou → email ao proprietário
// Quando solicitanteId !== novoVetId → proprietário solicitou → email ao vet
const criarSolicitacaoPendente = async ({
  animalId, novoVetId, animalNome, solicitanteId, proprietarioNome, proprietarioEmail,
}) => {
  const novoVetIdNum = novoVetId ? Number(novoVetId) : null;
  if (!novoVetIdNum || isNaN(novoVetIdNum)) throw new Error(`novoVetId inválido: ${novoVetId}`);

  // Buscar e notificar vet anterior ACEITO
  const solAnterior = await prisma.vetAnimalSolicitacao.findFirst({
    where:   { animalId: Number(animalId), status: 'ACEITO', vetUserId: { not: novoVetIdNum } },
    include: { veterinario: { select: { fullName: true, email: true } } },
  });

  // Cancelar solicitações ativas de outros vets
  await prisma.vetAnimalSolicitacao.updateMany({
    where: {
      animalId:  Number(animalId),
      status:    { in: ['ACEITO', 'PENDENTE'] },
      vetUserId: { not: novoVetIdNum },
    },
    data: { status: 'CANCELADO' },
  });

  // Notificar vet anterior (sem informar quem assumiu)
  if (solAnterior?.veterinario?.email) {
    emailService.enviarNotificacaoTrocaVet({
      vetEmail:         solAnterior.veterinario.email,
      vetNome:          solAnterior.veterinario.fullName,
      animalNome,
      proprietarioNome: proprietarioNome || 'Proprietário',
    }).catch(err => console.error('[emailService] Falha ao notificar vet anterior:', err));
  }

  const vet = await prisma.user.findUnique({
    where:  { id: novoVetIdNum },
    select: { id: true, fullName: true, email: true },
  });
  if (!vet) throw new Error(`Veterinário id=${novoVetIdNum} não encontrado`);

  const token     = gerarToken();
  const expiresAt = gerarExpiracao(7);

  await prisma.vetAnimalSolicitacao.upsert({
    where:  { animalId_vetUserId: { animalId: Number(animalId), vetUserId: novoVetIdNum } },
    create: {
      animalId:      Number(animalId),
      vetUserId:     novoVetIdNum,
      status:        'PENDENTE',
      approvalToken: token,
      expiresAt,
      solicitanteId: solicitanteId ? Number(solicitanteId) : null,
    },
    update: {
      status:        'PENDENTE',
      approvalToken: token,
      expiresAt,
      solicitanteId: solicitanteId ? Number(solicitanteId) : null,
    },
  });

  const solicitanteEOVet = solicitanteId && Number(solicitanteId) === novoVetIdNum;

  if (solicitanteEOVet) {
    // Vet solicitou → email ao proprietário pedindo autorização
    if (proprietarioEmail) {
      try {
        await emailService.enviarSolicitacaoVinculoProprietario({
          proprietarioEmail,
          proprietarioNome: proprietarioNome || 'Proprietário',
          animalNome,
          vetNome:          vet.fullName,
          token,
        });
        console.log(`[emailService] Email ao proprietário enviado → ${proprietarioEmail}`);
      } catch (err) {
        console.error('[emailService] FALHA ao enviar para proprietário:', err?.message ?? err);
      }
    } else {
      console.warn('[emailService] Proprietário sem email — notificação não enviada');
    }
  } else {
    // Proprietário solicitou → email ao vet pedindo aprovação (fluxo original)
    try {
      await emailService.enviarSolicitacaoVinculo({
        vetEmail:         vet.email,
        vetNome:          vet.fullName,
        animalNome,
        proprietarioNome: proprietarioNome || 'Proprietário',
        token,
      });
      console.log(`[emailService] Email ao vet enviado → ${vet.email}`);
    } catch (err) {
      console.error('[emailService] FALHA ao enviar para vet:', err?.message ?? err);
    }
  }

  return vet;
};

class AnimalController {

  // ── GET /api/animais/buscar-por-nome?nome=X ──────────────────────────────
  // DEVE ser registrado ANTES de /:id nas rotas

  async buscarPorNome(req, res) {
      const { nome } = req.query;
      if (!nome?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'Nome obrigatório' });
      }

      try {
        const vetLogadoId = Number(req.user.id);

        const animais = await prisma.animal.findMany({
          where:   { nome: { contains: nome.trim(), mode: 'insensitive' } },
          include: {
            user: { select: { id: true, fullName: true, email: true, phone: true } },
            solicitacoes: {
              where:  { status: { in: ['ACEITO', 'PENDENTE'] } },
              select: { status: true, vetUserId: true },
            },
          },
          take: 10,
        });

        if (animais.length === 0) {
          return res.json({ sucesso: true, dados: null });
        }

        const animal = animais.find(
          a => a.nome.toLowerCase() === nome.trim().toLowerCase()
        ) ?? animais[0];

        const solAtiva = animal.solicitacoes.find(
          s => s.status === 'ACEITO' || s.status === 'PENDENTE'
        );
        const temVet   = !!solAtiva;
        const vetDoAnimalId = solAtiva?.vetUserId ?? null;

        // ── Checa se o vet do animal é da mesma equipe ──────────────────────
        let vetDaMinhaEquipe = false;

        if (temVet && vetDoAnimalId && vetDoAnimalId !== vetLogadoId) {
          // Busca equipes onde o vet logado é membro
          const minhasEquipes = await prisma.equipeMembro.findMany({
            where:  { userId: vetLogadoId },
            select: { equipeId: true },
          });
          const minhasEquipeIds = minhasEquipes.map(e => e.equipeId);

          if (minhasEquipeIds.length > 0) {
            // Verifica se o vet do animal também está em alguma dessas equipes
            const vetDoAnimalNaEquipe = await prisma.equipeMembro.findFirst({
              where: {
                userId:   vetDoAnimalId,
                equipeId: { in: minhasEquipeIds },
              },
            });
            vetDaMinhaEquipe = !!vetDoAnimalNaEquipe;
          }
        }

        // Se o próprio vet logado tem o animal → também é "minha equipe"
        if (vetDoAnimalId === vetLogadoId) {
          vetDaMinhaEquipe = true;
        }

        res.json({
          sucesso: true,
          dados: {
            id:              animal.id,
            nome:            animal.nome,
            temVet,
            vetDaMinhaEquipe,
            proprietario:    animal.user,
          },
        });
      } catch (error) {
        console.error('[AnimalController.buscarPorNome]', error);
        res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
      }
    }

  // ── POST /api/animais/proprietario/aprovar ───────────────────────────────
  // Rota pública — proprietário aprova ou recusa vínculo pelo link do email

  async proprietarioAprovar(req, res) {
    const { token, acao } = req.body;

    if (!token || !acao) {
      return res.status(400).json({ sucesso: false, mensagem: 'Token e ação são obrigatórios' });
    }
    if (!['aceitar', 'recusar'].includes(acao)) {
      return res.status(400).json({ sucesso: false, mensagem: 'Ação inválida' });
    }

    try {
      const solicitacao = await prisma.vetAnimalSolicitacao.findFirst({
        where: { approvalToken: token, status: 'PENDENTE' },
        include: {
          animal:      { select: { nome: true, userId: true } },
          veterinario: { select: { fullName: true, email: true } },
        },
      });

      if (!solicitacao) {
        return res.status(404).json({
          sucesso:  false,
          mensagem: 'Token inválido ou solicitação não encontrada',
        });
      }

      if (solicitacao.expiresAt && new Date() > solicitacao.expiresAt) {
        return res.status(410).json({
          sucesso:  false,
          mensagem: 'Este link expirou. Solicite um novo vínculo.',
        });
      }

      const novoStatus = acao === 'aceitar' ? 'ACEITO' : 'RECUSADO';

      await prisma.vetAnimalSolicitacao.update({
        where: { id: solicitacao.id },
        data:  { status: novoStatus, approvalToken: null },
      });

      // Busca nome do proprietário para o email de confirmação ao vet
      const proprietario = await prisma.user.findUnique({
        where:  { id: solicitacao.animal.userId },
        select: { fullName: true },
      });

      try {
        await emailService.enviarConfirmacaoVinculo({
          proprietarioEmail: solicitacao.veterinario.email,
          proprietarioNome:  solicitacao.veterinario.fullName,
          animalNome:        solicitacao.animal.nome,
          vetNome:           proprietario?.fullName || 'Proprietário',
          aceito:            acao === 'aceitar',
        });
      } catch (err) {
        console.error('[emailService] Falha ao notificar vet sobre decisão:', err?.message);
      }

      res.json({
        sucesso:  true,
        aceito:   acao === 'aceitar',
        mensagem: acao === 'aceitar'
          ? `Vínculo com Dr(a). ${solicitacao.veterinario.fullName} autorizado com sucesso!`
          : 'Vínculo recusado. O veterinário foi notificado.',
      });
    } catch (error) {
      console.error('[AnimalController.proprietarioAprovar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }

  // ── GET /api/animais ─────────────────────────────────────────────────────

  async listar(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado' });

      const { userType, role } = await obterUserType(userId);
      const isAdmin = role === 'ADMIN';

      const where = isAdmin
        ? {}
        : userType === 'VETERINARIO'
          ? { solicitacoes: { some: { vetUserId: Number(userId), status: { in: ['ACEITO', 'PENDENTE'] } } } }
          : { userId: Number(userId) };

      const animais = await prisma.animal.findMany({
        where,
        include:  ANIMAL_INCLUDE,
        orderBy:  { dataCadastro: 'desc' },
      });

      res.json({ sucesso: true, dados: animais });
    } catch (error) {
      console.error('[AnimalController.listar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar animais' });
    }
  }

  // ── GET /api/animais/:id ─────────────────────────────────────────────────

  async obterPorId(req, res) {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ sucesso: false, mensagem: 'ID inválido' });
    }
    try {
      const animal = await prisma.animal.findUnique({
        where:   { id },
        include: ANIMAL_INCLUDE,
      });
      if (!animal) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      res.json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('[AnimalController.obterPorId]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar animal' });
    }
  }

  // ── POST /api/animais ────────────────────────────────────────────────────

  async criar(req, res) {
    const {
      nome, especieId, racaId, peso, dataNascimento, idadeAnos, sexo,
      categoriaAnimal, tipoExercicio, veterinarioNome, veterinarioClinica,
      proprietarioId, veterinarioUserId, local,
    } = req.body;

    if (!nome?.trim())                    return res.status(400).json({ sucesso: false, mensagem: 'Nome do animal é obrigatório' });
    if (!especieId)                       return res.status(400).json({ sucesso: false, mensagem: 'Espécie é obrigatória' });
    if (!racaId || isNaN(Number(racaId))) return res.status(400).json({ sucesso: false, mensagem: 'Raça é obrigatória' });
    if (!dataNascimento && !idadeAnos)    return res.status(400).json({ sucesso: false, mensagem: 'Informe a data de nascimento ou a idade' });

    try {
      const { userType } = await obterUserType(req.user.id);
      const isVet = userType === 'VETERINARIO';

      // Busca nome completo do vet no banco (não está no JWT)
      const vetLogado = await prisma.user.findUnique({
        where:  { id: Number(req.user.id) },
        select: { fullName: true },
      });
      const vetNomeCompleto = vetLogado?.fullName || 'Veterinário';

      // ── Vet vinculando animal já existente sem vet ──────────────────────
      if (isVet && req.body.animalExistenteId) {
        const existenteId = Number(req.body.animalExistenteId);
        const animalExistente = await prisma.animal.findUnique({
          where:  { id: existenteId },
          select: {
            id:   true,
            nome: true,
            user: { select: { fullName: true, email: true } },
            solicitacoes: {
              where:  { status: { in: ['ACEITO', 'PENDENTE'] } },
              select: { status: true },
            },
          },
        });

        if (!animalExistente) {
          return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
        }

        const jaTemVet = animalExistente.solicitacoes.some(
          s => s.status === 'ACEITO' || s.status === 'PENDENTE'
        );
        if (jaTemVet) {
          return res.status(409).json({
            sucesso:  false,
            mensagem: `${animalExistente.nome} já está sob cuidados de outro veterinário.`,
          });
        }

        // Solicitação PENDENTE + email ao proprietário
        await criarSolicitacaoPendente({
          animalId:          animalExistente.id,
          novoVetId:         req.user.id,
          animalNome:        animalExistente.nome,
          solicitanteId:     req.user.id,
          proprietarioNome:  animalExistente.user?.fullName,
          proprietarioEmail: animalExistente.user?.email,
        });

        return res.status(201).json({
          sucesso:  true,
          dados:    { id: animalExistente.id },
          mensagem: 'Solicitação enviada ao proprietário. O vínculo será efetivado após o aceite.',
        });
      }

      // ── Criação de novo animal ──────────────────────────────────────────

      const especie  = await prisma.especie.findUnique({ where: { id: Number(especieId) } });
      const isEquino = especie && (
        especie.nome.toLowerCase().includes('equino') ||
        especie.nome.toLowerCase().includes('cavalo')
      );
      if (isEquino && (!categoriaAnimal || !tipoExercicio)) {
        return res.status(400).json({
          sucesso:  false,
          mensagem: 'Categoria e tipo de exercício são obrigatórios para equinos',
        });
      }

      let targetUserId              = req.user.id;
      let proprietarioNomeParaEmail = 'Proprietário';
      let proprietarioEmailParaEmail = null;
      let isNewProprietario = false;

            if (proprietarioId) {
              targetUserId = Number(proprietarioId);
              const prop = await prisma.user.findUnique({
                where:  { id: Number(proprietarioId) },
                select: { fullName: true, email: true },
              });
              proprietarioNomeParaEmail  = prop?.fullName || 'Proprietário';
              proprietarioEmailParaEmail = prop?.email    || null;

            } else if (req.body.proprietario) {
              const propData = typeof req.body.proprietario === 'string'
                ? JSON.parse(req.body.proprietario)
                : req.body.proprietario;

              if (propData?.email) {
                let prop = await prisma.user.findUnique({ where: { email: propData.email } });
                if (!prop) {
                  const bcrypt = require('bcryptjs');
                  prop = await prisma.user.create({
                    data: {
                      fullName:           propData.fullName || 'Proprietário',
                      email:              propData.email,
                      phone:              propData.phone || null,
                      passwordHash:       await bcrypt.hash('Inicial#001', 10),
                      role:               'USER',
                      userType:           'PROPRIETARIO',
                      mustChangePassword: true,
                    },
                  });
                  isNewProprietario = true;
                }
                targetUserId               = prop.id;
                proprietarioNomeParaEmail  = prop.fullName;
                proprietarioEmailParaEmail = prop.email;
              }
            } else {
              const prop = await prisma.user.findUnique({
                where:  { id: Number(targetUserId) },
                select: { fullName: true, email: true },
              });
              proprietarioNomeParaEmail  = prop?.fullName || 'Proprietário';
              proprietarioEmailParaEmail = prop?.email    || null;
            }

      const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;

      const animal = await prisma.animal.create({
        data: {
          nome:            nome.trim(),
          peso:            parseFloat(peso) || 0,
          dataNascimento:  dataNascimento ? new Date(dataNascimento) : null,
          idadeAnos:       dataNascimento ? null : (Number(idadeAnos) || null),
          sexo,
          categoriaAnimal: isEquino ? (categoriaAnimal || null) : null,
          tipoExercicio:   isEquino ? (tipoExercicio   || null) : null,
          veterinarioNome:    veterinarioNome    || null,
          veterinarioClinica: veterinarioClinica || null,
          local:           local?.trim() || null,
          photoUrl,
          especieId: Number(especieId),
          racaId:    Number(racaId),
          userId:    Number(targetUserId),
        },
      });

      if (isVet) {
        const criadoParaSiMesmo = Number(targetUserId) === Number(req.user.id);

        if (criadoParaSiMesmo) {
          // Vet criando animal para si mesmo → ACEITO direto
          await prisma.vetAnimalSolicitacao.create({
            data: { animalId: animal.id, vetUserId: Number(req.user.id), status: 'ACEITO' },
          });
        } else {
          // Vet criando para um proprietário → PENDENTE + email ao proprietário
          const tokenVinculo  = gerarToken();
          const expiresAtVinculo = gerarExpiracao(7);

          await prisma.vetAnimalSolicitacao.create({
            data: {
              animalId:      animal.id,
              vetUserId:     Number(req.user.id),
              status:        'PENDENTE',
              approvalToken: tokenVinculo,
              expiresAt:     expiresAtVinculo,
              solicitanteId: Number(req.user.id),
            },
          });

          if (proprietarioEmailParaEmail) {
            try {
              await emailService.enviarSolicitacaoVinculoProprietario({
                proprietarioEmail: proprietarioEmailParaEmail,
                proprietarioNome:  proprietarioNomeParaEmail,
                animalNome:        animal.nome,
                vetNome:           vetNomeCompleto,
                token:             tokenVinculo,
                isNewUser:         isNewProprietario,        // ← NOVO
                senhaInicial:      isNewProprietario ? 'Inicial#001' : undefined,  // ← NOVO
              });
              console.log(`[emailService] Email ao proprietário enviado → ${proprietarioEmailParaEmail}`);
            } catch (err) {
              console.error('[emailService] FALHA ao enviar para proprietário:', err?.message ?? err);
            }
          } else {
            console.warn('[emailService] Proprietário sem email — notificação não enviada');
          }
        }
      }

      // Proprietário indicou um vet → solicitação PENDENTE + email ao vet
      const vetIdParaSolicitar = veterinarioUserId ? Number(veterinarioUserId) : null;
      if (!isVet && vetIdParaSolicitar && !isNaN(vetIdParaSolicitar)) {
        await criarSolicitacaoPendente({
          animalId:          animal.id,
          novoVetId:         vetIdParaSolicitar,
          animalNome:        animal.nome,
          solicitanteId:     req.user.id,
          proprietarioNome:  proprietarioNomeParaEmail,
          proprietarioEmail: proprietarioEmailParaEmail,
        });
      }

      res.status(201).json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('[AnimalController.criar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao criar animal' });
    }
  }

  // ── PUT /api/animais/:id ─────────────────────────────────────────────────

  async atualizar(req, res) {
    const animalId = Number(req.params.id);
    const {
      nome, especieId, racaId, peso, dataNascimento, idadeAnos, sexo,
      categoriaAnimal, tipoExercicio, veterinarioNome, veterinarioClinica,
      veterinarioUserId, local,
    } = req.body;

    if (!nome?.trim())                    return res.status(400).json({ sucesso: false, mensagem: 'Nome do animal é obrigatório' });
    if (!especieId)                       return res.status(400).json({ sucesso: false, mensagem: 'Espécie é obrigatória' });
    if (!racaId || isNaN(Number(racaId))) return res.status(400).json({ sucesso: false, mensagem: 'Raça é obrigatória' });
    if (!dataNascimento && !idadeAnos)    return res.status(400).json({ sucesso: false, mensagem: 'Informe a data de nascimento ou a idade' });

    try {
      const especie  = await prisma.especie.findUnique({ where: { id: Number(especieId) } });
      const isEquino = especie && (
        especie.nome.toLowerCase().includes('equino') ||
        especie.nome.toLowerCase().includes('cavalo')
      );
      if (isEquino && (!categoriaAnimal || !tipoExercicio)) {
        return res.status(400).json({
          sucesso:  false,
          mensagem: 'Categoria e tipo de exercício são obrigatórios para equinos',
        });
      }

      const solicitacaoAtual = await prisma.vetAnimalSolicitacao.findFirst({
        where:  { animalId, status: 'ACEITO' },
        select: { vetUserId: true },
      });
      const vetAtualId = solicitacaoAtual?.vetUserId ?? null;
      const novoVetId  = veterinarioUserId ? Number(veterinarioUserId) : null;
      const vetMudou   = novoVetId !== null && !isNaN(novoVetId) && novoVetId !== vetAtualId;

      const animalAtual = await prisma.animal.findUnique({
        where:  { id: animalId },
        select: { user: { select: { fullName: true, email: true } } },
      });
      const photoUrl = req.file ? `/uploads/${req.file.filename}` : undefined;

      const animal = await prisma.animal.update({
        where: { id: animalId },
        data: {
          nome:            nome.trim(),
          peso:            parseFloat(peso) || 0,
          dataNascimento:  dataNascimento ? new Date(dataNascimento) : null,
          idadeAnos:       dataNascimento ? null : (Number(idadeAnos) || null),
          sexo,
          categoriaAnimal: isEquino ? (categoriaAnimal || null) : null,
          tipoExercicio:   isEquino ? (tipoExercicio   || null) : null,
          veterinarioNome:    veterinarioNome    || null,
          veterinarioClinica: veterinarioClinica || null,
          local:           local?.trim() || null,
          especieId: Number(especieId),
          racaId:    Number(racaId),
          ...(photoUrl && { photoUrl }),
        },
      });

      if (vetMudou) {
        await criarSolicitacaoPendente({
          animalId,
          novoVetId,
          animalNome:        animal.nome,
          solicitanteId:     req.user.id,
          proprietarioNome:  animalAtual?.user?.fullName || 'Proprietário',
          proprietarioEmail: animalAtual?.user?.email    || null,
        });
      }

      const animalAtualizado = await prisma.animal.findUnique({
        where:   { id: animalId },
        include: ANIMAL_INCLUDE,
      });
      res.json({ sucesso: true, dados: animalAtualizado });
    } catch (error) {
      console.error('[AnimalController.atualizar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao atualizar animal' });
    }
  }

  // ── DELETE /api/animais/:id ──────────────────────────────────────────────

  async excluir(req, res) {
    const animalId = Number(req.params.id);
    try {
      await prisma.dieta.deleteMany({ where: { animalId } });
      await prisma.vetAnimalSolicitacao.deleteMany({ where: { animalId } });
      await prisma.animal.delete({ where: { id: animalId } });
      res.json({ sucesso: true, mensagem: 'Animal excluído com sucesso' });
    } catch (error) {
      console.error('[AnimalController.excluir]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir animal' });
    }
  }

  // ── POST /api/animais/vincular-vet ───────────────────────────────────────
  // Uso restrito: vínculo direto ACEITO (apenas quando vet cria animal para si mesmo)

  async vincularVet(req, res) {
    const { animalId, vetUserId } = req.body;
    if (!animalId || !vetUserId) {
      return res.status(400).json({ sucesso: false, mensagem: 'animalId e vetUserId são obrigatórios' });
    }
    try {
      await prisma.vetAnimalSolicitacao.upsert({
        where:  { animalId_vetUserId: { animalId: Number(animalId), vetUserId: Number(vetUserId) } },
        create: { animalId: Number(animalId), vetUserId: Number(vetUserId), status: 'ACEITO' },
        update: { status: 'ACEITO', approvalToken: null, expiresAt: null },
      });
      res.json({ sucesso: true, mensagem: 'Vínculo criado com sucesso' });
    } catch (error) {
      console.error('[AnimalController.vincularVet]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }

  // ── DELETE /api/animais/:id/desvincular-vet ─────────────────────────────

  async desvincularVet(req, res) {
    const animalId  = Number(req.params.id);
    const vetUserId = Number(req.user.id);

    try {
      const animal = await prisma.animal.findUnique({
        where:  { id: animalId },
        select: { nome: true, user: { select: { fullName: true, email: true } } },
      });
      if (!animal) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });

      await prisma.vetAnimalSolicitacao.updateMany({
        where: { animalId, vetUserId, status: { in: ['ACEITO', 'PENDENTE'] } },
        data:  { status: 'CANCELADO' },
      });

      if (animal.user?.email) {
        const vet = await prisma.user.findUnique({
          where:  { id: vetUserId },
          select: { fullName: true },
        });
        emailService.enviarConfirmacaoVinculo({
          proprietarioEmail: animal.user.email,
          proprietarioNome:  animal.user.fullName,
          animalNome:        animal.nome,
          vetNome:           vet?.fullName || 'Veterinário',
          aceito:            false,
        }).catch(err => console.error('[emailService] Falha ao notificar proprietário:', err));
      }

      res.json({ sucesso: true, mensagem: 'Desvinculado com sucesso' });
    } catch (error) {
      console.error('[AnimalController.desvincularVet]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }
}

module.exports = new AnimalController();
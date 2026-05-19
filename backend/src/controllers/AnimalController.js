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
const gerarExpiracao = (dias = 7) => { const d = new Date(); d.setDate(d.getDate() + dias); return d; };

const obterUserType = async (userId) => {
  const u = await prisma.user.findUnique({ where: { id: Number(userId) }, select: { userType: true, role: true } });
  return { userType: u?.userType ?? 'PROPRIETARIO', role: u?.role ?? 'USER' };
};

const criarSolicitacaoPendente = async ({ animalId, novoVetId, animalNome, solicitanteId, proprietarioNome }) => {
  const novoVetIdNum = novoVetId ? Number(novoVetId) : null;
  if (!novoVetIdNum || isNaN(novoVetIdNum)) throw new Error(`novoVetId inválido: ${novoVetId}`);

  // Buscar vet anterior ACEITO para notificação (item 7)
  const solAnterior = await prisma.vetAnimalSolicitacao.findFirst({
    where:   { animalId: Number(animalId), status: 'ACEITO', vetUserId: { not: novoVetIdNum } },
    include: { veterinario: { select: { fullName: true, email: true } } },
  });

  // Cancelar solicitações ativas de outros vets
  await prisma.vetAnimalSolicitacao.updateMany({
    where: { animalId: Number(animalId), status: { in: ['ACEITO', 'PENDENTE'] }, vetUserId: { not: novoVetIdNum } },
    data:  { status: 'CANCELADO' },
  });

  // Notificar vet anterior — sem informar quem assumiu (item 7)
  if (solAnterior?.veterinario?.email) {
    emailService.enviarNotificacaoTrocaVet({
      vetEmail:         solAnterior.veterinario.email,
      vetNome:          solAnterior.veterinario.fullName,
      animalNome,
      proprietarioNome: proprietarioNome || 'Proprietário',
    }).catch(err => console.error('[emailService] Falha ao notificar vet anterior:', err));
  }

  const vet = await prisma.user.findUnique({ where: { id: novoVetIdNum }, select: { id: true, fullName: true, email: true } });
  if (!vet) throw new Error(`Veterinário id=${novoVetIdNum} não encontrado`);

  const token = gerarToken(); const expiresAt = gerarExpiracao(7);

  await prisma.vetAnimalSolicitacao.upsert({
    where:  { animalId_vetUserId: { animalId: Number(animalId), vetUserId: novoVetIdNum } },
    create: { animalId: Number(animalId), vetUserId: novoVetIdNum, status: 'PENDENTE', approvalToken: token, expiresAt, solicitanteId: solicitanteId ? Number(solicitanteId) : null },
    update: { status: 'PENDENTE', approvalToken: token, expiresAt, solicitanteId: solicitanteId ? Number(solicitanteId) : null },
  });

  emailService.enviarSolicitacaoVinculo({
    vetEmail: vet.email, vetNome: vet.fullName, animalNome,
    proprietarioNome: proprietarioNome || 'Proprietário', token,
  }).catch(err => console.error('[emailService] Falha ao enviar email:', err));

  return vet;
};

class AnimalController {

  async listar(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado' });

      const { userType, role } = await obterUserType(userId);
      const isAdmin = role === 'ADMIN';

      const where = isAdmin ? {}
        : userType === 'VETERINARIO' ? { solicitacoes: { some: { vetUserId: Number(userId), status: 'ACEITO' } } }
        : { userId: Number(userId) };

      const animais = await prisma.animal.findMany({ where, include: ANIMAL_INCLUDE, orderBy: { dataCadastro: 'desc' } });
      res.json({ sucesso: true, dados: animais });
    } catch (error) {
      console.error('[AnimalController.listar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar animais' });
    }
  }

  async obterPorId(req, res) {
    try {
      const animal = await prisma.animal.findUnique({ where: { id: Number(req.params.id) }, include: ANIMAL_INCLUDE });
      if (!animal) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      res.json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('[AnimalController.obterPorId]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar animal' });
    }
  }

  async criar(req, res) {
    const { nome, especieId, racaId, peso, dataNascimento, idadeAnos, sexo,
      categoriaAnimal, tipoExercicio, veterinarioNome, veterinarioClinica,
      proprietarioId, veterinarioUserId } = req.body;

    if (!nome?.trim())                    return res.status(400).json({ sucesso: false, mensagem: 'Nome do animal é obrigatório' });
    if (!especieId)                       return res.status(400).json({ sucesso: false, mensagem: 'Espécie é obrigatória' });
    if (!racaId || isNaN(Number(racaId))) return res.status(400).json({ sucesso: false, mensagem: 'Raça é obrigatória' });
    if (!dataNascimento && !idadeAnos)    return res.status(400).json({ sucesso: false, mensagem: 'Informe a data de nascimento ou a idade' });

    try {
      const { userType } = await obterUserType(req.user.id);
      const isVet = userType === 'VETERINARIO';

      const especie  = await prisma.especie.findUnique({ where: { id: Number(especieId) } });
      const isEquino = especie && (especie.nome.toLowerCase().includes('equino') || especie.nome.toLowerCase().includes('cavalo'));
      if (isEquino && (!categoriaAnimal || !tipoExercicio))
        return res.status(400).json({ sucesso: false, mensagem: 'Categoria e tipo de exercício são obrigatórios para equinos' });

      let targetUserId = req.user.id;
      let proprietarioNomeParaEmail = 'Proprietário';

      if (proprietarioId) {
        targetUserId = Number(proprietarioId);
      } else if (req.body.proprietario) {
        const propData = typeof req.body.proprietario === 'string' ? JSON.parse(req.body.proprietario) : req.body.proprietario;
        if (propData?.email) {
          let prop = await prisma.user.findUnique({ where: { email: propData.email } });
          if (!prop) {
            const bcrypt = require('bcryptjs');
            prop = await prisma.user.create({ data: { fullName: propData.fullName || 'Proprietário', email: propData.email, phone: propData.phone || null, passwordHash: await bcrypt.hash('Inicial#001', 10), role: 'USER', userType: 'PROPRIETARIO' } });
          }
          targetUserId = prop.id;
          proprietarioNomeParaEmail = prop.fullName;
        }
      } else {
        const prop = await prisma.user.findUnique({ where: { id: Number(targetUserId) }, select: { fullName: true } });
        proprietarioNomeParaEmail = prop?.fullName || 'Proprietário';
      }

      const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;

      const animal = await prisma.animal.create({
        data: {
          nome: nome.trim(), peso: parseFloat(peso) || 0,
          dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
          idadeAnos: dataNascimento ? null : (Number(idadeAnos) || null),
          sexo,
          categoriaAnimal: isEquino ? (categoriaAnimal || null) : null,
          tipoExercicio:   isEquino ? (tipoExercicio   || null) : null,
          veterinarioNome:    veterinarioNome    || null,
          veterinarioClinica: veterinarioClinica || null,
          photoUrl, especieId: Number(especieId), racaId: Number(racaId), userId: Number(targetUserId),
        },
      });

      if (isVet) {
        await prisma.vetAnimalSolicitacao.create({ data: { animalId: animal.id, vetUserId: Number(req.user.id), status: 'ACEITO' } });
      }

      const vetIdParaSolicitar = veterinarioUserId ? Number(veterinarioUserId) : null;
      if (!isVet && vetIdParaSolicitar && !isNaN(vetIdParaSolicitar)) {
        await criarSolicitacaoPendente({ animalId: animal.id, novoVetId: vetIdParaSolicitar, animalNome: animal.nome, solicitanteId: req.user.id, proprietarioNome: proprietarioNomeParaEmail });
      }

      res.status(201).json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('[AnimalController.criar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao criar animal' });
    }
  }

  async atualizar(req, res) {
    const animalId = Number(req.params.id);
    const { nome, especieId, racaId, peso, dataNascimento, idadeAnos, sexo,
      categoriaAnimal, tipoExercicio, veterinarioNome, veterinarioClinica, veterinarioUserId } = req.body;

    if (!nome?.trim())                    return res.status(400).json({ sucesso: false, mensagem: 'Nome do animal é obrigatório' });
    if (!especieId)                       return res.status(400).json({ sucesso: false, mensagem: 'Espécie é obrigatória' });
    if (!racaId || isNaN(Number(racaId))) return res.status(400).json({ sucesso: false, mensagem: 'Raça é obrigatória' });
    if (!dataNascimento && !idadeAnos)    return res.status(400).json({ sucesso: false, mensagem: 'Informe a data de nascimento ou a idade' });

    try {
      const especie  = await prisma.especie.findUnique({ where: { id: Number(especieId) } });
      const isEquino = especie && (especie.nome.toLowerCase().includes('equino') || especie.nome.toLowerCase().includes('cavalo'));
      if (isEquino && (!categoriaAnimal || !tipoExercicio))
        return res.status(400).json({ sucesso: false, mensagem: 'Categoria e tipo de exercício são obrigatórios para equinos' });

      const solicitacaoAtual = await prisma.vetAnimalSolicitacao.findFirst({ where: { animalId, status: 'ACEITO' }, select: { vetUserId: true } });
      const vetAtualId = solicitacaoAtual?.vetUserId ?? null;
      const novoVetId  = veterinarioUserId ? Number(veterinarioUserId) : null;
      const vetMudou   = novoVetId !== null && !isNaN(novoVetId) && novoVetId !== vetAtualId;

      const animalAtual = await prisma.animal.findUnique({ where: { id: animalId }, select: { user: { select: { fullName: true } } } });
      const photoUrl    = req.file ? `/uploads/${req.file.filename}` : undefined;

      const animal = await prisma.animal.update({
        where: { id: animalId },
        data: {
          nome: nome.trim(), peso: parseFloat(peso) || 0,
          dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
          idadeAnos: dataNascimento ? null : (Number(idadeAnos) || null),
          sexo,
          categoriaAnimal: isEquino ? (categoriaAnimal || null) : null,
          tipoExercicio:   isEquino ? (tipoExercicio   || null) : null,
          veterinarioNome:    veterinarioNome    || null,
          veterinarioClinica: veterinarioClinica || null,
          especieId: Number(especieId), racaId: Number(racaId),
          ...(photoUrl && { photoUrl }),
        },
      });

      if (vetMudou) {
        await criarSolicitacaoPendente({
          animalId, novoVetId, animalNome: animal.nome,
          solicitanteId: req.user.id,
          proprietarioNome: animalAtual?.user?.fullName || 'Proprietário',
        });
      }

      const animalAtualizado = await prisma.animal.findUnique({ where: { id: animalId }, include: ANIMAL_INCLUDE });
      res.json({ sucesso: true, dados: animalAtualizado });
    } catch (error) {
      console.error('[AnimalController.atualizar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao atualizar animal' });
    }
  }

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

  async vincularVet(req, res) {
    const { animalId, vetUserId } = req.body;
    if (!animalId || !vetUserId)
      return res.status(400).json({ sucesso: false, mensagem: 'animalId e vetUserId são obrigatórios' });
    try {
      await prisma.vetAnimalSolicitacao.upsert({
        where:  { animalId_vetUserId: { animalId: Number(animalId), vetUserId: Number(vetUserId) } },
        create: { animalId: Number(animalId), vetUserId: Number(vetUserId), status: 'ACEITO' },
        update: { status: 'ACEITO', approvalToken: null, expiresAt: null },
      });
      res.json({ sucesso: true, mensagem: 'Vínculo vet-animal criado com sucesso' });
    } catch (error) {
      console.error('[AnimalController.vincularVet]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }

  // ── DELETE /api/animais/:id/desvincular-vet ─────────────────────────────
  // Item 6: vet se remove da responsabilidade do animal
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

      // Notificar proprietário
      if (animal.user?.email) {
        const vet = await prisma.user.findUnique({ where: { id: vetUserId }, select: { fullName: true } });
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
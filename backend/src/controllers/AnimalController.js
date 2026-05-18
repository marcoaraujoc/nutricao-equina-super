// backend/src/controllers/AnimalController.js
'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── Include padrão ───────────────────────────────────────────────────────────
const ANIMAL_INCLUDE = {
  especie: true,
  raca:    true,
  user:    { select: { fullName: true, email: true } },
  solicitacoes: {
    where:  { status: 'ACEITO' },
    select: {
      vetUserId:   true,
      veterinario: { select: { fullName: true, email: true } },
    },
    take: 1,
  },
};

class AnimalController {

  // ── GET /api/animais ────────────────────────────────────────────────────────
  async listar(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ sucesso: false, mensagem: 'Usuário não autenticado' });
      }

      // Busca userType do banco — não vem no JWT
      const perfil   = await prisma.user.findUnique({
        where:  { id: Number(userId) },
        select: { userType: true, role: true },
      });
      const userType = perfil?.userType ?? 'PROPRIETARIO';
      const isAdmin  = perfil?.role === 'ADMIN';

      const where = isAdmin
        ? {}
        : userType === 'VETERINARIO'
          ? { solicitacoes: { some: { vetUserId: Number(userId), status: 'ACEITO' } } }
          : { userId: Number(userId) };

      const animais = await prisma.animal.findMany({
        where,
        include: ANIMAL_INCLUDE,
        orderBy: { dataCadastro: 'desc' },
      });

      res.json({ sucesso: true, dados: animais });
    } catch (error) {
      console.error('Erro ao listar animais:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar animais' });
    }
  }

  // ── GET /api/animais/:id ────────────────────────────────────────────────────
  async obterPorId(req, res) {
    const { id } = req.params;
    try {
      const animal = await prisma.animal.findUnique({
        where:   { id: Number(id) },
        include: ANIMAL_INCLUDE,
      });

      if (!animal) {
        return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      }

      res.json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('Erro ao buscar animal:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar animal' });
    }
  }

  // ── POST /api/animais ───────────────────────────────────────────────────────
  async criar(req, res) {
    const {
      nome, especieId, racaId, peso,
      dataNascimento, idadeAnos, sexo,
      categoriaAnimal, tipoExercicio,
      veterinarioNome, veterinarioClinica,
      // proprietarioId: enviado pelo vet quando cadastra animal para um proprietário
      proprietarioId,
    } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Nome do animal é obrigatório' });
    }
    if (!especieId) {
      return res.status(400).json({ sucesso: false, mensagem: 'Espécie é obrigatória' });
    }
    if (!racaId || isNaN(Number(racaId))) {
      return res.status(400).json({ sucesso: false, mensagem: 'Raça é obrigatória' });
    }
    if (!dataNascimento && !idadeAnos) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Informe a data de nascimento ou a idade do animal',
      });
    }

    try {
      const especie  = await prisma.especie.findUnique({ where: { id: Number(especieId) } });
      const isEquino = especie && (
        especie.nome.toLowerCase().includes('equino') ||
        especie.nome.toLowerCase().includes('cavalo')
      );

      if (isEquino && (!categoriaAnimal || !tipoExercicio)) {
        return res.status(400).json({
          sucesso: false,
          mensagem: 'Categoria e tipo de exercício são obrigatórios para equinos',
        });
      }

      let photoUrl = null;
      if (req.file) photoUrl = `/uploads/${req.file.filename}`;

      // Se o vet está cadastrando para um proprietário, usa o userId do proprietário
      // Caso contrário, usa o userId do usuário logado
      let targetUserId = req.user?.id;

        // Vet cadastrando animal para um proprietário
        if (proprietarioId) {
          targetUserId = Number(proprietarioId);
        } else if (req.body.proprietario) {
          // Dados do proprietário enviados pelo vet — cria ou busca o usuário
          const { fullName, email, phone } = req.body.proprietario;
          if (email) {
            let propUser = await prisma.user.findUnique({ where: { email } });
            if (!propUser) {
              const bcrypt = require('bcryptjs');
              const hash   = await bcrypt.hash('Inicial#001', 10);
              propUser = await prisma.user.create({
                data: { fullName, email, phone: phone || null, passwordHash: hash, role: 'USER', userType: 'PROPRIETARIO' },
              });
            }
            targetUserId = propUser.id;
          }
        }

      const animal = await prisma.animal.create({
        data: {
          nome:               nome.trim(),
          peso:               parseFloat(peso) || 0,
          dataNascimento:     dataNascimento ? new Date(dataNascimento) : null,
          idadeAnos:          dataNascimento ? null : (Number(idadeAnos) || null),
          sexo,
          categoriaAnimal:    isEquino ? (categoriaAnimal || null) : null,
          tipoExercicio:      isEquino ? (tipoExercicio   || null) : null,
          veterinarioNome:    veterinarioNome    || null,
          veterinarioClinica: veterinarioClinica || null,
          photoUrl,
          especieId: Number(especieId),
          racaId:    Number(racaId),
          userId:    targetUserId,
        },
      });

      res.status(201).json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('Erro ao criar animal:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao criar animal' });
    }
  }

  // ── PUT /api/animais/:id ────────────────────────────────────────────────────
  async atualizar(req, res) {
    const { id } = req.params;
    const {
      nome, especieId, racaId, peso,
      dataNascimento, idadeAnos, sexo,
      categoriaAnimal, tipoExercicio,
      veterinarioNome, veterinarioClinica,
    } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Nome do animal é obrigatório' });
    }
    if (!especieId) {
      return res.status(400).json({ sucesso: false, mensagem: 'Espécie é obrigatória' });
    }
    if (!racaId || isNaN(Number(racaId))) {
      return res.status(400).json({ sucesso: false, mensagem: 'Raça é obrigatória' });
    }
    if (!dataNascimento && !idadeAnos) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Informe a data de nascimento ou a idade do animal',
      });
    }

    try {
      const especie  = await prisma.especie.findUnique({ where: { id: Number(especieId) } });
      const isEquino = especie && (
        especie.nome.toLowerCase().includes('equino') ||
        especie.nome.toLowerCase().includes('cavalo')
      );

      if (isEquino && (!categoriaAnimal || !tipoExercicio)) {
        return res.status(400).json({
          sucesso: false,
          mensagem: 'Categoria e tipo de exercício são obrigatórios para equinos',
        });
      }

      let photoUrl = undefined;
      if (req.file) photoUrl = `/uploads/${req.file.filename}`;

      const animal = await prisma.animal.update({
        where: { id: Number(id) },
        data: {
          nome:               nome.trim(),
          peso:               parseFloat(peso) || 0,
          dataNascimento:     dataNascimento ? new Date(dataNascimento) : null,
          idadeAnos:          dataNascimento ? null : (Number(idadeAnos) || null),
          sexo,
          categoriaAnimal:    isEquino ? (categoriaAnimal || null) : null,
          tipoExercicio:      isEquino ? (tipoExercicio   || null) : null,
          veterinarioNome:    veterinarioNome    || null,
          veterinarioClinica: veterinarioClinica || null,
          especieId: Number(especieId),
          racaId:    Number(racaId),
          ...(photoUrl && { photoUrl }),
        },
      });

      res.json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('Erro ao atualizar animal:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao atualizar animal' });
    }
  }

  // ── DELETE /api/animais/:id ─────────────────────────────────────────────────
  async excluir(req, res) {
    const { id } = req.params;
    try {
      await prisma.dieta.deleteMany({ where: { animalId: Number(id) } });
      await prisma.vetAnimalSolicitacao.deleteMany({ where: { animalId: Number(id) } });
      await prisma.animal.delete({ where: { id: Number(id) } });
      res.json({ sucesso: true, mensagem: 'Animal excluído com sucesso' });
    } catch (error) {
      console.error('Erro ao excluir animal:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir animal' });
    }
  }

  // ── POST /api/animais/vincular-vet ──────────────────────────────────────────
  // Vet cria vínculo direto com animal — status ACEITO automaticamente
  // Usado quando o próprio vet cadastra o animal para o proprietário
  async vincularVet(req, res) {
    const { animalId, vetUserId } = req.body;
    if (!animalId || !vetUserId) {
      return res.status(400).json({ sucesso: false, mensagem: 'animalId e vetUserId são obrigatórios' });
    }
    try {
      await prisma.vetAnimalSolicitacao.upsert({
        where:  { animalId_vetUserId: { animalId: Number(animalId), vetUserId: Number(vetUserId) } },
        create: { animalId: Number(animalId), vetUserId: Number(vetUserId), status: 'ACEITO' },
        update: { status: 'ACEITO' },
      });
      res.json({ sucesso: true, mensagem: 'Vínculo vet-animal criado com sucesso' });
    } catch (error) {
      console.error('Erro ao vincular vet:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }
}

module.exports = new AnimalController();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class AnimalController {
  async listar(req, res) {
    const { userId, email } = req.query;
    try {
      let where = {};

      if (email) {
        const usuario = await prisma.user.findUnique({
          where: { email: String(email) }
        });
        if (usuario) where = { userId: usuario.id };
      } else if (userId) {
        where = { userId: Number(userId) };
      }

      const animais = await prisma.animal.findMany({
        where,
        include: { 
          especie: true, 
          raca: true, 
          exercises: true,
          user: { select: { fullName: true, email: true } }
        }
      });

      res.json(animais);
    } catch (error) {
      console.error('Erro no listar animais:', error);
      res.status(500).json({ error: 'Erro ao listar animais', details: error.message });
    }
  }

  async obterPorId(req, res) {
    const { id } = req.params;
    try {
      const animal = await prisma.animal.findUnique({
        where: { id: Number(id) },
        include: { 
          especie: true, 
          raca: true, 
          exercises: true,
          user: { select: { fullName: true, email: true } }
        }
      });
      if (!animal) return res.status(404).json({ error: 'Animal não encontrado' });
      res.json(animal);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar animal' });
    }
  }

  async criar(req, res) {
    const { nome, especieId, racaId, peso, dataNascimento, sexo, userId, exercises = '[]' } = req.body;

    let parsedExercises = [];
    try {
      parsedExercises = JSON.parse(exercises);
    } catch (e) {
      parsedExercises = [];
    }

    if (!racaId || isNaN(Number(racaId))) return res.status(400).json({ error: 'Raça é obrigatória' });
    if (!userId) return res.status(400).json({ error: 'Usuário não identificado' });
    if (!especieId) return res.status(400).json({ error: 'Espécie é obrigatória' });

    try {
      let photoUrl = null;
      if (req.file) {
        photoUrl = `/uploads/${req.file.filename}`;
      }

      const animal = await prisma.animal.create({
        data: {
          nome,
          peso: parseFloat(peso) || 0,
          dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
          sexo,
          photoUrl,
          especieId: Number(especieId),
          racaId: Number(racaId),
          userId: Number(userId)
        }
      });

      if (parsedExercises.length > 0) {
        await prisma.animalExercise.createMany({
          data: parsedExercises.map(ex => ({
            animalId: animal.id,
            tipo: ex.tipo,
            periodicidade: ex.periodicidade
          }))
        });
      }

      res.status(201).json(animal);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar animal', details: error.message });
    }
  }

  async atualizar(req, res) {
    const { id } = req.params;
    const { nome, especieId, racaId, peso, dataNascimento, sexo, exercises = '[]' } = req.body;

    let parsedExercises = [];
    try {
      parsedExercises = JSON.parse(exercises);
    } catch (e) {
      parsedExercises = [];
    }

    try {
      let photoUrl = undefined;
      if (req.file) {
        photoUrl = `/uploads/${req.file.filename}`;
      }

      const animal = await prisma.animal.update({
        where: { id: Number(id) },
        data: {
          nome,
          peso: parseFloat(peso) || 0,
          dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
          sexo,
          especieId: Number(especieId),
          racaId: racaId ? Number(racaId) : null,
          ...(photoUrl && { photoUrl })
        }
      });

      if (parsedExercises.length > 0) {
        await prisma.animalExercise.deleteMany({ where: { animalId: Number(id) } });
        await prisma.animalExercise.createMany({
          data: parsedExercises.map(ex => ({
            animalId: Number(id),
            tipo: ex.tipo,
            periodicidade: ex.periodicidade
          }))
        });
      }

      res.json(animal);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar animal', details: error.message });
    }
  }

  async excluir(req, res) {
    const { id } = req.params;
    try {
      // Apaga todos os registros relacionados antes de excluir o animal
      await prisma.animalExercise.deleteMany({ where: { animalId: Number(id) } });
      await prisma.dieta.deleteMany({ where: { animalId: Number(id) } });           // ← ADICIONADO
      // Se existirem outras tabelas relacionadas (exames, etc.), adicione aqui

      await prisma.animal.delete({ where: { id: Number(id) } });

      console.log(`✅ Animal ID ${id} excluído com sucesso`);
      res.json({ message: 'Animal excluído com sucesso' });
    } catch (error) {
      console.error('Erro ao excluir animal:', error);
      res.status(500).json({ 
        error: 'Erro ao excluir animal', 
        details: error.message 
      });
    }
  }
}

module.exports = new AnimalController();
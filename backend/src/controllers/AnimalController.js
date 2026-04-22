const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class AnimalController {
  async listar(req, res) {
    try {
      const animais = await prisma.animal.findMany({
        include: {
          especie: true,
          raca: true,
          exercises: true
        },
        orderBy: { dataCadastro: 'desc' }
      });
      res.json(animais);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao listar animais' });
    }
  }

  async criar(req, res) {
    const { 
      nome, 
      especieId, 
      racaId, 
      peso, 
      dataNascimento, 
      sexo, 
      exercises = [], 
      userId   // ignorado por enquanto (campo ainda não existe no schema)
    } = req.body;

    try {
      // Cria o animal principal
      const animal = await prisma.animal.create({
        data: {
          nome,
          peso: parseFloat(peso) || 0,
          dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
          sexo,
          especieId: Number(especieId),           // obrigatório
          racaId: racaId ? Number(racaId) : null // opcional
        }
      });

      // Cria os exercícios (tabela separada AnimalExercise)
      if (exercises && exercises.length > 0) {
        await prisma.animalExercise.createMany({
          data: exercises.map(ex => ({
            animalId: animal.id,
            tipo: ex.tipo,
            periodicidade: ex.periodicidade
          }))
        });
      }

      res.status(201).json(animal);
    } catch (error) {
      console.error(error);
      res.status(500).json({ 
        error: 'Erro ao criar animal',
        details: error.message 
      });
    }
  }
}

module.exports = new AnimalController();
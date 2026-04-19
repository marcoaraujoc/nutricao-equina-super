const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const listar = async (req, res) => {
  try {
    const animais = await prisma.animal.findMany({
      orderBy: { dataCadastro: 'desc' },
      include: {
        especie: true,
        raca: true,
        exercises: true
      }
    });
    res.json(animais);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao listar animais' });
  }
};

const criar = async (req, res) => {
  try {
    const { nome, especieId, racaId, peso, dataNascimento, sexo, exercises = [] } = req.body;

    const animal = await prisma.animal.create({
      data: {
        nome,
        especieId: parseInt(especieId),
        racaId: racaId ? parseInt(racaId) : null,
        peso: parseFloat(peso),
        dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
        sexo,
      }
    });

    // Cria os exercícios relacionados (se enviados)
    if (exercises && exercises.length > 0) {
      for (const ex of exercises) {
        await prisma.animalExercise.create({
          data: {
            animalId: animal.id,
            tipo: ex.tipo,
            periodicidade: ex.periodicidade
          }
        });
      }
    }

    res.status(201).json(animal);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar animal' });
  }
};

module.exports = { listar, criar };
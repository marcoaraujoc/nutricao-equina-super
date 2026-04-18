const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class AnimalController {
  async listar(req, res) {
    const animais = await prisma.animal.findMany({
      orderBy: { dataCadastro: 'desc' }
    });
    res.json(animais);
  }

  async criar(req, res) {
    const { nome, raca, peso, idade, sexo, tipoExercicio } = req.body;

    try {
      const animal = await prisma.animal.create({
        data: {
          nome,
          raca,
          peso: parseFloat(peso) || 0,
          dataNascimento: idade ? new Date(Date.now() - idade * 365 * 24 * 60 * 60 * 1000) : null,
          sexo,
          tipoExercicio
        }
      });
      res.status(201).json(animal);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar animal' });
    }
  }
}

module.exports = new AnimalController();

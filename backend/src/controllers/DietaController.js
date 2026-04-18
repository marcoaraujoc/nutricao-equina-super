const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class DietaController {
  async listarPorAnimal(req, res) {
    const { animalId } = req.params;
    const dietas = await prisma.dieta.findMany({ 
      where: { animalId: parseInt(animalId) },
      include: { produto: true }
    });
    res.json(dietas);
  }
  async criar(req, res) {
    const dieta = await prisma.dieta.create({ data: req.body });
    res.status(201).json(dieta);
  }
}
module.exports = new DietaController();

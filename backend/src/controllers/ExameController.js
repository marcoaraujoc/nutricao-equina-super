const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class ExameController {
  async listarPorAnimal(req, res) {
    const { animalId } = req.params;
    const exames = await prisma.exameNutricional.findMany({ 
      where: { animalId: parseInt(animalId) },
      include: { nutriente: true }
    });
    res.json(exames);
  }
  async criar(req, res) {
    const exame = await prisma.exameNutricional.create({ data: req.body });
    res.status(201).json(exame);
  }
}
module.exports = new ExameController();

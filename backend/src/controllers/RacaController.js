const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getAll = async (req, res) => {
  try {
    const racas = await prisma.raca.findMany({ orderBy: { nome: 'asc' } });
    res.json(racas);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar raças' });
  }
};

module.exports = { getAll };
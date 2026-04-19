const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getAll = async (req, res) => {
  try {
    const especies = await prisma.especie.findMany({ orderBy: { nome: 'asc' } });
    res.json(especies);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar espécies' });
  }
};

module.exports = { getAll };
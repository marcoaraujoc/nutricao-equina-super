const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class ProdutoController {
  async listar(req, res) { 
    const produtos = await prisma.produto.findMany(); 
    res.json(produtos); 
  }
  async criar(req, res) {
    const produto = await prisma.produto.create({ data: req.body });
    res.status(201).json(produto);
  }
}
module.exports = new ProdutoController();

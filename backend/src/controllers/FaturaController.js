// backend/src/controllers/FaturaController.js

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const recalcularTotal = async (faturaId) => {
  const itens = await prisma.faturaItem.findMany({ where: { faturaId } });
  const total = itens.reduce((acc, i) => acc + i.valor * i.quantidade, 0);
  await prisma.fatura.update({ where: { id: faturaId }, data: { total } });
  return total;
};

const FaturaController = {

  obterFaturaAberta: async (req, res) => {
    const { animalId } = req.params;

    try {
      let fatura = await prisma.fatura.findFirst({
        where: { animalId: Number(animalId), status: 'ABERTA' },
        include: {
          itens: {
            include: { veterinario: { select: { fullName: true } } },
            orderBy: { criadoEm: 'asc' },
          },
        },
      });

      if (!fatura) {
        fatura = await prisma.fatura.create({
          data: { animalId: Number(animalId), status: 'ABERTA' },
          include: {
            itens: { include: { veterinario: { select: { fullName: true } } } },
          },
        });
      }

      res.json({ sucesso: true, dados: fatura });
    } catch (error) {
      console.error('Erro ao obter fatura:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  adicionarItem: async (req, res) => {
    const { faturaId } = req.params;
    const { tipo, descricao, valor, quantidade = 1 } = req.body;
    const veterinarioId = req.user.id;

    if (!tipo || !descricao || valor === undefined || valor === null) {
      return res.status(400).json({ sucesso: false, mensagem: 'tipo, descricao e valor são obrigatórios' });
    }

    try {
      const item = await prisma.faturaItem.create({
        data: {
          faturaId: Number(faturaId),
          tipo,
          descricao,
          valor: Number(valor),
          quantidade: Number(quantidade),
          veterinarioId,
        },
        include: { veterinario: { select: { fullName: true } } },
      });

      const total = await recalcularTotal(Number(faturaId));

      res.status(201).json({ sucesso: true, dados: item, totalFatura: total });
    } catch (error) {
      console.error('Erro ao adicionar item à fatura:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  removerItem: async (req, res) => {
    const { itemId } = req.params;

    try {
      const item = await prisma.faturaItem.findUnique({ where: { id: Number(itemId) } });
      if (!item) return res.status(404).json({ sucesso: false, mensagem: 'Item não encontrado' });

      await prisma.faturaItem.delete({ where: { id: Number(itemId) } });
      const total = await recalcularTotal(item.faturaId);

      res.json({ sucesso: true, mensagem: 'Item removido', totalFatura: total });
    } catch (error) {
      console.error('Erro ao remover item da fatura:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  fecharFatura: async (req, res) => {
    const { faturaId } = req.params;

    try {
      const fatura = await prisma.fatura.update({
        where: { id: Number(faturaId) },
        data: { status: 'FECHADA' },
        include: {
          itens: { include: { veterinario: { select: { fullName: true } } } },
        },
      });

      res.json({ sucesso: true, dados: fatura });
    } catch (error) {
      console.error('Erro ao fechar fatura:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

module.exports = FaturaController;
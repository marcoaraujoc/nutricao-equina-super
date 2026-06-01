// backend/src/controllers/FaturaController.js

const prisma = require('../lib/prisma').default;

const ITEM_INCLUDE = {
  veterinario: { select: { id: true, fullName: true } },
  animal:      { select: { id: true, nome: true, especie: { select: { nome: true } }, raca: { select: { nome: true } }, photoUrl: true } },
};

const FATURA_INCLUDE = {
  itens: {
    where:   { },
    include: ITEM_INCLUDE,
    orderBy: [{ animalId: 'asc' }, { criadoEm: 'asc' }],
  },
  proprietario: { select: { id: true, fullName: true, email: true, phone: true } },
};

async function recalcularTotal(faturaId) {
  const itens = await prisma.faturaItem.findMany({ where: { faturaId } });
  const total = itens.reduce((acc, i) => acc + i.valor * i.quantidade, 0);
  await prisma.fatura.update({ where: { id: faturaId }, data: { total } });
  return total;
}

function mesReferenciaAtual() {
  return new Date().toISOString().slice(0, 7); // "2026-06"
}

const FaturaController = {

  // GET /proprietarios
  // Lista todos os proprietários cujos animais estão vinculados ao vet logado,
  // com resumo da fatura em aberto de cada um.
  listarProprietarios: async (req, res) => {
    const vetId = req.user.id;
    try {
      // Busca animais do vet (aceitos via solicitação)
      const solicitacoes = await prisma.vetAnimalSolicitacao.findMany({
        where:   { vetUserId: vetId, tipo: 'VINCULO', status: 'ACEITO' },
        include: { animal: { select: { id: true, userId: true } } },
      });

      const proprietarioIds = [...new Set(solicitacoes.map(s => s.animal.userId))];
      if (proprietarioIds.length === 0) return res.json({ dados: [] });

      const proprietarios = await prisma.user.findMany({
        where: { id: { in: proprietarioIds } },
        select: {
          id: true, fullName: true, email: true, phone: true,
          animais: {
            where: { ativo: true },
            select: {
              id: true, nome: true,
              especie: { select: { nome: true } },
              raca:    { select: { nome: true } },
              photoUrl: true,
            },
          },
          faturas: {
            where: { status: 'ABERTA' },
            orderBy: { criadoEm: 'desc' },
            take: 1,
            select: { id: true, total: true, status: true, mesReferencia: true, criadoEm: true },
          },
        },
        orderBy: { fullName: 'asc' },
      });

      // Para proprietários sem fatura aberta, verificar se há PAGA recente
      const ids_sem_aberta = proprietarios
        .filter(p => p.faturas.length === 0)
        .map(p => p.id);

      const fatuasPagas = ids_sem_aberta.length > 0
        ? await prisma.fatura.findMany({
            where: { proprietarioId: { in: ids_sem_aberta }, status: 'PAGA' },
            orderBy: { criadoEm: 'desc' },
            select: { id: true, total: true, status: true, mesReferencia: true, proprietarioId: true },
          })
        : [];

      const ultimaFaturaPagaPorProp = fatuasPagas.reduce((acc, f) => {
        if (!acc[f.proprietarioId]) acc[f.proprietarioId] = f;
        return acc;
      }, {});

      const dados = proprietarios.map(p => ({
        ...p,
        faturaAtiva: p.faturas[0] ?? ultimaFaturaPagaPorProp[p.id] ?? null,
        faturas: undefined,
      }));

      res.json({ dados });
    } catch (err) {
      console.error('Erro ao listar proprietários:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // GET /proprietario/:proprietarioId
  // Retorna (ou cria) a fatura ABERTA do mês atual para o proprietário.
  obterFaturaProprietario: async (req, res) => {
    const { proprietarioId } = req.params;
    const mesRef = mesReferenciaAtual();

    try {
      let fatura = await prisma.fatura.findFirst({
        where:   { proprietarioId: Number(proprietarioId), status: 'ABERTA' },
        include: FATURA_INCLUDE,
        orderBy: { criadoEm: 'desc' },
      });

      if (!fatura) {
        fatura = await prisma.fatura.create({
          data:    { proprietarioId: Number(proprietarioId), mesReferencia: mesRef, total: 0, status: 'ABERTA' },
          include: FATURA_INCLUDE,
        });
      }

      res.json({ dados: fatura });
    } catch (err) {
      console.error('Erro ao obter fatura do proprietário:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // POST /:faturaId/itens
  adicionarItem: async (req, res) => {
    const { faturaId }  = req.params;
    const { tipo, descricao, valor, quantidade = 1, animalId } = req.body;
    const veterinarioId = req.user.id;

    if (!tipo || !descricao || valor === undefined || valor === null) {
      return res.status(400).json({ error: 'tipo, descricao e valor são obrigatórios' });
    }

    try {
      const item = await prisma.faturaItem.create({
        data: {
          faturaId:     Number(faturaId),
          animalId:     animalId ? Number(animalId) : null,
          tipo,
          descricao,
          valor:        Number(valor),
          quantidade:   Number(quantidade),
          veterinarioId,
        },
        include: ITEM_INCLUDE,
      });

      const total = await recalcularTotal(Number(faturaId));
      res.status(201).json({ dados: item, totalFatura: total });
    } catch (err) {
      console.error('Erro ao adicionar item:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // PUT /itens/:itemId
  atualizarItem: async (req, res) => {
    const { itemId } = req.params;
    const { tipo, descricao, valor, quantidade } = req.body;

    try {
      const item = await prisma.faturaItem.findUnique({ where: { id: Number(itemId) } });
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });

      const updated = await prisma.faturaItem.update({
        where: { id: Number(itemId) },
        data: {
          ...(tipo       !== undefined && { tipo }),
          ...(descricao  !== undefined && { descricao }),
          ...(valor      !== undefined && { valor: Number(valor) }),
          ...(quantidade !== undefined && { quantidade: Number(quantidade) }),
        },
        include: ITEM_INCLUDE,
      });

      const total = await recalcularTotal(item.faturaId);
      res.json({ dados: updated, totalFatura: total });
    } catch (err) {
      console.error('Erro ao atualizar item:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // DELETE /itens/:itemId
  removerItem: async (req, res) => {
    const { itemId } = req.params;

    try {
      const item = await prisma.faturaItem.findUnique({ where: { id: Number(itemId) } });
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });

      await prisma.faturaItem.delete({ where: { id: Number(itemId) } });
      const total = await recalcularTotal(item.faturaId);

      res.json({ mensagem: 'Item removido', totalFatura: total });
    } catch (err) {
      console.error('Erro ao remover item:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // PATCH /:faturaId/status
  atualizarStatus: async (req, res) => {
    const { faturaId } = req.params;
    const { status }   = req.body;

    const VALIDOS = ['ABERTA', 'PAGA', 'CANCELADA'];
    if (!VALIDOS.includes(status)) {
      return res.status(400).json({ error: `Status inválido. Use: ${VALIDOS.join(', ')}` });
    }

    try {
      const fatura = await prisma.fatura.update({
        where:   { id: Number(faturaId) },
        data:    { status },
        include: FATURA_INCLUDE,
      });
      res.json({ dados: fatura });
    } catch (err) {
      console.error('Erro ao atualizar status:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // Legado — mantido para compatibilidade
  obterFaturaAberta: async (req, res) => {
    const { animalId } = req.params;
    try {
      let fatura = await prisma.fatura.findFirst({
        where:   { animalId: Number(animalId), status: 'ABERTA' },
        include: { itens: { include: { veterinario: { select: { fullName: true } } }, orderBy: { criadoEm: 'asc' } } },
      });
      if (!fatura) {
        fatura = await prisma.fatura.create({
          data:    { animalId: Number(animalId), status: 'ABERTA' },
          include: { itens: { include: { veterinario: { select: { fullName: true } } } } },
        });
      }
      res.json({ sucesso: true, dados: fatura });
    } catch (err) {
      console.error(err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },
};

module.exports = FaturaController;
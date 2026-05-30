// backend/src/controllers/ProdutoController.js
'use strict';

const prisma = require('../lib/prisma').default;

const PRODUTO_INCLUDE = {
  vias: { select: { id: true, via: true }, orderBy: { via: 'asc' } },
};

// ─── Controllers ─────────────────────────────────────────────────────────────

const listar = async (req, res) => {
  try {
    const { busca, ativo, controlado } = req.query;

    const where = {};

    if (ativo !== undefined)
      where.ativo = ativo === 'true';

    if (controlado === 'true')
      where.controlado = true;

    if (busca) {
      where.OR = [
        { nome:              { contains: busca, mode: 'insensitive' } },
        { formaFarmaceutica: { contains: busca, mode: 'insensitive' } },
        { vias: { some: { via: { contains: busca, mode: 'insensitive' } } } },
      ];
    }

    const produtos = await prisma.produto.findMany({
      where,
      include: PRODUTO_INCLUDE,
      orderBy: { nome: 'asc' },
    });

    const [total, totalControlados] = await Promise.all([
      prisma.produto.count({ where: { ativo: true } }),
      prisma.produto.count({ where: { ativo: true, controlado: true } }),
    ]);

    // Comparação campo vs campo não é suportada diretamente no Prisma,
    // então calculamos em memória sobre a lista já trazida (scope: ativo=true)
    const totalAbaixoMinimo = produtos.filter(
      (p) => p.ativo && p.estoqueAtual <= p.estoqueMinimo,
    ).length;

    return res.json({
      data: produtos,
      meta: { total, totalControlados, totalAbaixoMinimo },
    });
  } catch (err) {
    console.error('ProdutoController.listar:', err);
    return res.status(500).json({ error: 'Erro ao listar produtos.' });
  }
};

const obterPorId = async (req, res) => {
  try {
    const produto = await prisma.produto.findUnique({
      where:   { id: Number(req.params.id) },
      include: PRODUTO_INCLUDE,
    });

    if (!produto)
      return res.status(404).json({ error: 'Produto não encontrado.' });

    return res.json({ data: produto });
  } catch (err) {
    console.error('ProdutoController.obterPorId:', err);
    return res.status(500).json({ error: 'Erro ao buscar produto.' });
  }
};

const criar = async (req, res) => {
  try {
    const {
      nome,
      formaFarmaceutica,
      unidade,
      apresentacao,
      controlado = false,
      estoqueMinimo = 0,
      estoqueAtual = 0,
      vias = [],
    } = req.body;

    if (!nome || !formaFarmaceutica || !unidade || !apresentacao)
      return res.status(400).json({ error: 'Campos obrigatórios: nome, formaFarmaceutica, unidade, apresentacao.' });

    if (!Array.isArray(vias) || vias.length === 0)
      return res.status(400).json({ error: 'Informe ao menos uma via de administração.' });

    if (Number(estoqueMinimo) < 0 || Number(estoqueAtual) < 0)
      return res.status(400).json({ error: 'Estoque não pode ser negativo.' });

    const existe = await prisma.produto.findFirst({
      where: {
        nome:              { equals: nome.trim(),              mode: 'insensitive' },
        formaFarmaceutica: { equals: formaFarmaceutica.trim(), mode: 'insensitive' },
        apresentacao:      { equals: apresentacao.trim(),      mode: 'insensitive' },
      },
    });

    if (existe)
      return res.status(409).json({ error: 'Já existe um produto com mesmo nome, forma farmacêutica e apresentação.' });

    const produto = await prisma.produto.create({
      data: {
        nome:              nome.trim(),
        formaFarmaceutica: formaFarmaceutica.trim(),
        unidade:           unidade.trim(),
        apresentacao:      apresentacao.trim(),
        controlado:        Boolean(controlado),
        estoqueMinimo:     Number(estoqueMinimo),
        estoqueAtual:      Number(estoqueAtual),
        vias: { create: vias.map((v) => ({ via: String(v) })) },
      },
      include: PRODUTO_INCLUDE,
    });

    return res.status(201).json({ data: produto });
  } catch (err) {
    if (err.code === 'P2002')
      return res.status(409).json({ error: 'Já existe um produto com mesmo nome, forma farmacêutica e apresentação.' });
    console.error('ProdutoController.criar:', err);
    return res.status(500).json({ error: 'Erro ao criar produto.' });
  }
};

const atualizar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      nome,
      formaFarmaceutica,
      unidade,
      apresentacao,
      controlado,
      estoqueMinimo,
      ativo,
      vias,
    } = req.body;

    const existe = await prisma.produto.findUnique({ where: { id } });
    if (!existe)
      return res.status(404).json({ error: 'Produto não encontrado.' });

    if (estoqueMinimo !== undefined && Number(estoqueMinimo) < 0)
      return res.status(400).json({ error: 'Estoque mínimo não pode ser negativo.' });

    // Verificar duplicidade excluindo o próprio registro
    if (nome !== undefined || formaFarmaceutica !== undefined || apresentacao !== undefined) {
      const nomeFinal         = (nome              ?? existe.nome).trim();
      const formaFinal        = (formaFarmaceutica ?? existe.formaFarmaceutica).trim();
      const apresentacaoFinal = (apresentacao      ?? existe.apresentacao).trim();

      const duplicado = await prisma.produto.findFirst({
        where: {
          id:                { not: id },
          nome:              { equals: nomeFinal,         mode: 'insensitive' },
          formaFarmaceutica: { equals: formaFinal,        mode: 'insensitive' },
          apresentacao:      { equals: apresentacaoFinal, mode: 'insensitive' },
        },
      });

      if (duplicado)
        return res.status(409).json({ error: 'Já existe um produto com mesmo nome, forma farmacêutica e apresentação.' });
    }

    const data = {};
    if (nome              !== undefined) data.nome              = nome.trim();
    if (formaFarmaceutica !== undefined) data.formaFarmaceutica = formaFarmaceutica.trim();
    if (unidade           !== undefined) data.unidade           = unidade.trim();
    if (apresentacao      !== undefined) data.apresentacao      = apresentacao.trim();
    if (controlado        !== undefined) data.controlado        = Boolean(controlado);
    if (estoqueMinimo     !== undefined) data.estoqueMinimo     = Number(estoqueMinimo);
    if (ativo             !== undefined) data.ativo             = Boolean(ativo);

    const produto = await prisma.$transaction(async (tx) => {
      if (Array.isArray(vias)) {
        await tx.produtoViaAdministracao.deleteMany({ where: { produtoId: id } });
        data.vias = { create: vias.map((v) => ({ via: String(v) })) };
      }

      return tx.produto.update({
        where:   { id },
        data,
        include: PRODUTO_INCLUDE,
      });
    });

    return res.json({ data: produto });
  } catch (err) {
    if (err.code === 'P2002')
      return res.status(409).json({ error: 'Já existe um produto com mesmo nome, forma farmacêutica e apresentação.' });
    console.error('ProdutoController.atualizar:', err);
    return res.status(500).json({ error: 'Erro ao atualizar produto.' });
  }
};

const excluir = async (req, res) => {
  try {
    const id = Number(req.params.id);

    const existe = await prisma.produto.findUnique({ where: { id } });
    if (!existe)
      return res.status(404).json({ error: 'Produto não encontrado.' });

    await prisma.produto.update({ where: { id }, data: { ativo: false } });

    return res.json({ data: { message: 'Produto inativado com sucesso.' } });
  } catch (err) {
    console.error('ProdutoController.excluir:', err);
    return res.status(500).json({ error: 'Erro ao excluir produto.' });
  }
};

// Ajuste manual de estoque + registro de MovimentoEstoque
const ajustarEstoque = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { tipo, quantidade, motivo } = req.body;

    if (!tipo || !['ENTRADA', 'SAIDA', 'AJUSTE'].includes(tipo))
      return res.status(400).json({ error: 'tipo deve ser ENTRADA, SAIDA ou AJUSTE.' });

    const qty = Number(quantidade);
    if (!qty || qty <= 0)
      return res.status(400).json({ error: 'quantidade deve ser maior que zero.' });

    const existe = await prisma.produto.findUnique({ where: { id } });
    if (!existe)
      return res.status(404).json({ error: 'Produto não encontrado.' });

    const delta      = tipo === 'SAIDA' ? -qty : qty;
    const novoEstoque = existe.estoqueAtual + delta;

    if (novoEstoque < 0)
      return res.status(400).json({ error: 'Estoque resultante seria negativo.' });

    const produto = await prisma.$transaction(async (tx) => {
      await tx.movimentoEstoque.create({
        data: { produtoId: id, tipo, quantidade: qty, motivo: motivo ?? null },
      });

      return tx.produto.update({
        where:   { id },
        data:    { estoqueAtual: novoEstoque },
        include: PRODUTO_INCLUDE,
      });
    });

    return res.json({ data: produto });
  } catch (err) {
    console.error('ProdutoController.ajustarEstoque:', err);
    return res.status(500).json({ error: 'Erro ao ajustar estoque.' });
  }
};

const listarMovimentos = async (req, res) => {
  try {
    const id = Number(req.params.id);

    const movimentos = await prisma.movimentoEstoque.findMany({
      where:   { produtoId: id },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });

    return res.json({ data: movimentos });
  } catch (err) {
    console.error('ProdutoController.listarMovimentos:', err);
    return res.status(500).json({ error: 'Erro ao listar movimentos.' });
  }
};

module.exports = { listar, obterPorId, criar, atualizar, excluir, ajustarEstoque, listarMovimentos };
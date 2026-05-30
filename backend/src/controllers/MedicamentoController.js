// backend/src/controllers/MedicamentoController.js
'use strict';

const prisma = require('../lib/prisma').default;

const INCLUDE = {
  vias: { select: { id: true, via: true }, orderBy: { via: 'asc' } },
};

// ─── Listar ──────────────────────────────────────────────────────────────────

const listar = async (req, res) => {
  try {
    const { busca, ativo, controlado } = req.query;
    const where = {};

    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (controlado === 'true') where.controlado = true;

    if (busca) {
      where.OR = [
        { nome:              { contains: busca, mode: 'insensitive' } },
        { formaFarmaceutica: { contains: busca, mode: 'insensitive' } },
        { vias: { some: { via: { contains: busca, mode: 'insensitive' } } } },
      ];
    }

    const [medicamentos, total, totalControlados] = await Promise.all([
      prisma.medicamento.findMany({ where, include: INCLUDE, orderBy: { nome: 'asc' } }),
      prisma.medicamento.count({ where: { ativo: true } }),
      prisma.medicamento.count({ where: { ativo: true, controlado: true } }),
    ]);

    return res.json({ dados: medicamentos, meta: { total, totalControlados } });
  } catch (err) {
    console.error('MedicamentoController.listar:', err);
    return res.status(500).json({ error: 'Erro ao listar medicamentos.' });
  }
};

// ─── Obter por ID ─────────────────────────────────────────────────────────────

const obterPorId = async (req, res) => {
  try {
    const med = await prisma.medicamento.findUnique({
      where: { id: Number(req.params.id) },
      include: INCLUDE,
    });
    if (!med) return res.status(404).json({ error: 'Medicamento não encontrado.' });
    return res.json({ dados: med });
  } catch (err) {
    console.error('MedicamentoController.obterPorId:', err);
    return res.status(500).json({ error: 'Erro ao buscar medicamento.' });
  }
};

// ─── Criar ───────────────────────────────────────────────────────────────────

const criar = async (req, res) => {
  try {
    const { nome, formaFarmaceutica, unidade, apresentacao, controlado = false, ativo = true, vias = [] } = req.body;

    if (!nome || !formaFarmaceutica || !unidade || !apresentacao)
      return res.status(400).json({ error: 'Campos obrigatórios: nome, formaFarmaceutica, unidade, apresentacao.' });

    if (!Array.isArray(vias) || vias.length === 0)
      return res.status(400).json({ error: 'Informe ao menos uma via de administração.' });

    const existe = await prisma.medicamento.findFirst({
      where: {
        nome:              { equals: nome.trim(),              mode: 'insensitive' },
        formaFarmaceutica: { equals: formaFarmaceutica.trim(), mode: 'insensitive' },
        apresentacao:      { equals: apresentacao.trim(),      mode: 'insensitive' },
      },
    });
    if (existe)
      return res.status(409).json({ error: 'Já existe um medicamento com mesmo nome, forma farmacêutica e apresentação.' });

    const med = await prisma.medicamento.create({
      data: {
        nome:              nome.trim(),
        formaFarmaceutica: formaFarmaceutica.trim(),
        unidade:           unidade.trim(),
        apresentacao:      apresentacao.trim(),
        controlado:        Boolean(controlado),
        ativo:             Boolean(ativo),
        vias: { create: vias.map((v) => ({ via: String(v) })) },
      },
      include: INCLUDE,
    });

    return res.status(201).json({ data: med });
  } catch (err) {
    if (err.code === 'P2002')
      return res.status(409).json({ error: 'Já existe um medicamento com mesmo nome, forma farmacêutica e apresentação.' });
    console.error('MedicamentoController.criar:', err);
    return res.status(500).json({ error: 'Erro ao criar medicamento.' });
  }
};

// ─── Atualizar ────────────────────────────────────────────────────────────────

const atualizar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nome, formaFarmaceutica, unidade, apresentacao, controlado, ativo, vias } = req.body;

    const existe = await prisma.medicamento.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Medicamento não encontrado.' });

    if (nome !== undefined || formaFarmaceutica !== undefined || apresentacao !== undefined) {
      const n = (nome              ?? existe.nome).trim();
      const f = (formaFarmaceutica ?? existe.formaFarmaceutica).trim();
      const a = (apresentacao      ?? existe.apresentacao).trim();

      const dup = await prisma.medicamento.findFirst({
        where: {
          id:                { not: id },
          nome:              { equals: n, mode: 'insensitive' },
          formaFarmaceutica: { equals: f, mode: 'insensitive' },
          apresentacao:      { equals: a, mode: 'insensitive' },
        },
      });
      if (dup) return res.status(409).json({ error: 'Já existe um medicamento com esse nome/forma/apresentação.' });
    }

    const data = {};
    if (nome              !== undefined) data.nome              = nome.trim();
    if (formaFarmaceutica !== undefined) data.formaFarmaceutica = formaFarmaceutica.trim();
    if (unidade           !== undefined) data.unidade           = unidade.trim();
    if (apresentacao      !== undefined) data.apresentacao      = apresentacao.trim();
    if (controlado        !== undefined) data.controlado        = Boolean(controlado);
    if (ativo             !== undefined) data.ativo             = Boolean(ativo);

    const med = await prisma.$transaction(async (tx) => {
      if (Array.isArray(vias)) {
        await tx.medicamentoVia.deleteMany({ where: { medicamentoId: id } });
        data.vias = { create: vias.map((v) => ({ via: String(v) })) };
      }
      return tx.medicamento.update({ where: { id }, data, include: INCLUDE });
    });

    return res.json({ dados: med });
  } catch (err) {
    if (err.code === 'P2002')
      return res.status(409).json({ error: 'Já existe um medicamento com esse nome/forma/apresentação.' });
    console.error('MedicamentoController.atualizar:', err);
    return res.status(500).json({ error: 'Erro ao atualizar medicamento.' });
  }
};

// ─── Excluir (soft delete) ────────────────────────────────────────────────────

const excluir = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existe = await prisma.medicamento.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Medicamento não encontrado.' });

    await prisma.medicamento.update({ where: { id }, data: { ativo: false } });
    return res.json({ data: { message: 'Medicamento inativado com sucesso.' } });
  } catch (err) {
    console.error('MedicamentoController.excluir:', err);
    return res.status(500).json({ error: 'Erro ao excluir medicamento.' });
  }
};

module.exports = { listar, obterPorId, criar, atualizar, excluir };
'use strict';

const prisma = require('../lib/prisma').default;
const { registrarAuditoria } = require('../lib/auditoria');

// ─── Listar ───────────────────────────────────────────────────────────────────

const listar = async (req, res) => {
  try {
    const { busca, ativo, categoria } = req.query;
    const where = {};

    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (categoria) where.categoria = { equals: categoria, mode: 'insensitive' };

    if (busca) {
      where.OR = [
        { nome:          { contains: busca, mode: 'insensitive' } },
        { nomeAbreviado: { contains: busca, mode: 'insensitive' } },
        { categoria:     { contains: busca, mode: 'insensitive' } },
        { codigo:        { contains: busca, mode: 'insensitive' } },
      ];
    }

    const [procedimentos, total] = await Promise.all([
      prisma.procedimentoVeterinario.findMany({
        where,
        orderBy: [{ categoria: 'asc' }, { nome: 'asc' }],
      }),
      prisma.procedimentoVeterinario.count({ where: { ativo: true } }),
    ]);

    return res.json({ dados: procedimentos, meta: { total } });
  } catch (err) {
    console.error('ProcedimentoController.listar:', err);
    return res.status(500).json({ error: 'Erro ao listar procedimentos.' });
  }
};

// ─── Obter por ID ─────────────────────────────────────────────────────────────

const obterPorId = async (req, res) => {
  try {
    const p = await prisma.procedimentoVeterinario.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!p) return res.status(404).json({ error: 'Procedimento não encontrado.' });
    return res.json({ dados: p });
  } catch (err) {
    console.error('ProcedimentoController.obterPorId:', err);
    return res.status(500).json({ error: 'Erro ao buscar procedimento.' });
  }
};

// ─── Criar ────────────────────────────────────────────────────────────────────

const criar = async (req, res) => {
  try {
    const {
      codigo, nome, nomeAbreviado, descricao, categoria,
      subcategoria, especialidade, tipoProcedimento, duracao,
      requerAnestesia = false, requerInternacao = false,
      risco, valorCusto, valorVenda, ativo = true,
    } = req.body;

    if (!nome?.trim())      return res.status(400).json({ error: 'nome é obrigatório.' });
    if (!categoria?.trim()) return res.status(400).json({ error: 'categoria é obrigatória.' });

    const p = await prisma.procedimentoVeterinario.create({
      data: {
        codigo:          codigo?.trim() || null,
        nome:            nome.trim(),
        nomeAbreviado:   nomeAbreviado?.trim() || null,
        descricao:       descricao?.trim() || null,
        categoria:       categoria.trim(),
        subcategoria:    subcategoria?.trim() || null,
        especialidade:   especialidade?.trim() || null,
        tipoProcedimento: tipoProcedimento?.trim() || null,
        duracao:         duracao ? Number(duracao) : null,
        requerAnestesia: Boolean(requerAnestesia),
        requerInternacao: Boolean(requerInternacao),
        risco:           risco?.trim() || null,
        valorCusto:      valorCusto !== undefined ? Number(valorCusto) : null,
        valorVenda:      valorVenda !== undefined ? Number(valorVenda) : null,
        ativo:           Boolean(ativo),
      },
    });

    return res.status(201).json({ dados: p });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Código já cadastrado.' });
    console.error('ProcedimentoController.criar:', err);
    return res.status(500).json({ error: 'Erro ao criar procedimento.' });
  }
};

// ─── Atualizar ────────────────────────────────────────────────────────────────

const atualizar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existe = await prisma.procedimentoVeterinario.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Procedimento não encontrado.' });

    const {
      codigo, nome, nomeAbreviado, descricao, categoria,
      subcategoria, especialidade, tipoProcedimento, duracao,
      requerAnestesia, requerInternacao, risco, valorCusto, valorVenda, ativo,
    } = req.body;

    const data = {};
    if (codigo          !== undefined) data.codigo          = codigo?.trim() || null;
    if (nome            !== undefined) data.nome            = nome.trim();
    if (nomeAbreviado   !== undefined) data.nomeAbreviado   = nomeAbreviado?.trim() || null;
    if (descricao       !== undefined) data.descricao       = descricao?.trim() || null;
    if (categoria       !== undefined) data.categoria       = categoria.trim();
    if (subcategoria    !== undefined) data.subcategoria    = subcategoria?.trim() || null;
    if (especialidade   !== undefined) data.especialidade   = especialidade?.trim() || null;
    if (tipoProcedimento !== undefined) data.tipoProcedimento = tipoProcedimento?.trim() || null;
    if (duracao         !== undefined) data.duracao         = duracao ? Number(duracao) : null;
    if (requerAnestesia !== undefined) data.requerAnestesia = Boolean(requerAnestesia);
    if (requerInternacao !== undefined) data.requerInternacao = Boolean(requerInternacao);
    if (risco           !== undefined) data.risco           = risco?.trim() || null;
    if (valorCusto      !== undefined) data.valorCusto      = valorCusto !== null ? Number(valorCusto) : null;
    if (valorVenda      !== undefined) data.valorVenda      = valorVenda !== null ? Number(valorVenda) : null;
    if (ativo           !== undefined) data.ativo           = Boolean(ativo);

    const p = await prisma.procedimentoVeterinario.update({ where: { id }, data });
    return res.json({ dados: p });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Código já cadastrado.' });
    console.error('ProcedimentoController.atualizar:', err);
    return res.status(500).json({ error: 'Erro ao atualizar procedimento.' });
  }
};

// ─── Excluir (soft delete) ────────────────────────────────────────────────────

const excluir = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { motivo } = req.body ?? {};
    if (!motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
    }

    const existe = await prisma.procedimentoVeterinario.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Procedimento não encontrado.' });
    await prisma.procedimentoVeterinario.update({ where: { id }, data: { ativo: false } });

    await registrarAuditoria(null, req, {
      categoria:  'EXCLUSAO',
      entidade:   'PROCEDIMENTO',
      entidadeId: id,
      motivo,
      detalhes:   existe.nome ?? null,
    });

    return res.json({ dados: { message: 'Procedimento inativado.' } });
  } catch (err) {
    console.error('ProcedimentoController.excluir:', err);
    return res.status(500).json({ error: 'Erro ao excluir procedimento.' });
  }
};

module.exports = { listar, obterPorId, criar, atualizar, excluir };
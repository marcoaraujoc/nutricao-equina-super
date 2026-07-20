// backend/src/controllers/ProcedimentoCadastroController.js
// Cadastro > Procedimentos — visão por especialidade com preços/combos POR EMPRESA.
//   - Especialidades do seletor: vet vê SÓ as suas (UsuarioEspecialidade);
//     GESTOR da empresa ativa e ADMIN veem todas as do catálogo.
//   - Inclusão de procedimento no catálogo: exclusiva do ADMIN (rota do catálogo).
//   - Empresa (GESTOR): define valor por procedimento (ProcedimentoValorEmpresa)
//     e cria combos com valor próprio (ProcedimentoCombo/Item).
'use strict';

const prisma = require('../lib/prisma').default;
const { registrarAuditoria } = require('../lib/auditoria');

// Gestor do contexto ativo: dono da empresa OU membro com cargo GESTOR nela.
async function isGestorDaEmpresa(userId, empresaId) {
  if (!empresaId) return false;
  const emp = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { ownerId: true } });
  if (emp?.ownerId === userId) return true;
  const membro = await prisma.membroEquipe.findFirst({
    where:  { userId, cargo: 'GESTOR', equipe: { empresaId } },
    select: { id: true },
  });
  return Boolean(membro);
}

// GET /api/procedimentos/especialidades-minhas
// Nomes de especialidade para o seletor da tela. { dados: [nome], gestor: bool }
const especialidadesMinhas = async (req, res) => {
  try {
    const isAdmin = req.user.userType === 'ADMIN';
    const gestor  = isAdmin || await isGestorDaEmpresa(req.user.id, req.empresaId);

    let nomes;
    if (gestor) {
      const rows = await prisma.especialidade.findMany({
        where: { ativo: true }, select: { nome: true }, orderBy: { nome: 'asc' },
      });
      nomes = rows.map(r => r.nome);
    } else {
      const rows = await prisma.usuarioEspecialidade.findMany({
        where:   { userId: req.user.id, especialidade: { ativo: true } },
        select:  { especialidade: { select: { nome: true } } },
      });
      nomes = rows.map(r => r.especialidade.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }

    return res.json({ dados: [...new Set(nomes)], gestor });
  } catch (err) {
    console.error('ProcedimentoCadastroController.especialidadesMinhas:', err);
    return res.status(500).json({ error: 'Erro ao listar especialidades.' });
  }
};

// GET /api/procedimentos/cadastro/lista?especialidade=NOME&busca=
// Procedimentos ativos da especialidade + valor da empresa ativa (quando houver).
const listarComValores = async (req, res) => {
  try {
    const { especialidade, busca } = req.query;
    const where = { ativo: true };
    if (especialidade) where.especialidade = { equals: String(especialidade), mode: 'insensitive' };
    if (busca) {
      where.OR = [
        { nome:          { contains: String(busca), mode: 'insensitive' } },
        { nomeAbreviado: { contains: String(busca), mode: 'insensitive' } },
        { categoria:     { contains: String(busca), mode: 'insensitive' } },
      ];
    }

    const procedimentos = await prisma.procedimentoVeterinario.findMany({
      where,
      orderBy: [{ categoria: 'asc' }, { nome: 'asc' }],
      select: {
        id: true, nome: true, nomeAbreviado: true, categoria: true, subcategoria: true,
        especialidade: true, tipoProcedimento: true, duracao: true, valorVenda: true, descricao: true,
      },
    });

    let valores = new Map();
    if (req.empresaId && procedimentos.length > 0) {
      const rows = await prisma.procedimentoValorEmpresa.findMany({
        where:  { empresaId: req.empresaId, procedimentoId: { in: procedimentos.map(p => p.id) } },
        select: { procedimentoId: true, valor: true },
      });
      valores = new Map(rows.map(r => [r.procedimentoId, r.valor]));
    }

    return res.json({
      dados: procedimentos.map(p => ({ ...p, valorEmpresa: valores.get(p.id) ?? null })),
    });
  } catch (err) {
    console.error('ProcedimentoCadastroController.listarComValores:', err);
    return res.status(500).json({ error: 'Erro ao listar procedimentos.' });
  }
};

// PUT /api/procedimentos/cadastro/valor/:procedimentoId  { valor }  — GESTOR
// valor numérico > 0 grava/atualiza; null/''/0 remove o valor da empresa.
const definirValor = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Contexto de empresa não resolvido.' });
    if (!(await isGestorDaEmpresa(req.user.id, req.empresaId))) {
      return res.status(403).json({ error: 'Somente o gestor da empresa define valores de procedimento.' });
    }

    const procedimentoId = Number(req.params.procedimentoId);
    const proc = await prisma.procedimentoVeterinario.findUnique({ where: { id: procedimentoId }, select: { id: true } });
    if (!proc) return res.status(404).json({ error: 'Procedimento não encontrado.' });

    const { valor } = req.body;
    if (valor === null || valor === undefined || valor === '' || Number(valor) === 0) {
      await prisma.procedimentoValorEmpresa.deleteMany({ where: { empresaId: req.empresaId, procedimentoId } });
      return res.json({ dados: { procedimentoId, valorEmpresa: null } });
    }

    const v = Number(valor);
    if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'Valor inválido.' });

    const row = await prisma.procedimentoValorEmpresa.upsert({
      where:  { empresaId_procedimentoId: { empresaId: req.empresaId, procedimentoId } },
      create: { empresaId: req.empresaId, procedimentoId, valor: v },
      update: { valor: v },
    });
    return res.json({ dados: { procedimentoId, valorEmpresa: row.valor } });
  } catch (err) {
    console.error('ProcedimentoCadastroController.definirValor:', err);
    return res.status(500).json({ error: 'Erro ao definir valor do procedimento.' });
  }
};

const COMBO_INCLUDE = {
  itens: {
    include: {
      procedimento: { select: { id: true, nome: true, categoria: true, especialidade: true, valorVenda: true } },
    },
  },
};

// GET /api/procedimentos/cadastro/combos — combos ativos da empresa ativa
const listarCombos = async (req, res) => {
  try {
    if (!req.empresaId) return res.json({ dados: [] });
    const combos = await prisma.procedimentoCombo.findMany({
      where:   { empresaId: req.empresaId, ativo: true },
      include: COMBO_INCLUDE,
      orderBy: { nome: 'asc' },
    });
    return res.json({ dados: combos });
  } catch (err) {
    console.error('ProcedimentoCadastroController.listarCombos:', err);
    return res.status(500).json({ error: 'Erro ao listar combos.' });
  }
};

function validarComboBody(body) {
  const nome  = body?.nome?.trim();
  const valor = Number(body?.valor);
  const ids   = Array.isArray(body?.procedimentoIds)
    ? [...new Set(body.procedimentoIds.map(Number).filter(Number.isInteger))]
    : [];
  if (!nome)                          return { erro: 'Nome do combo é obrigatório.' };
  if (!Number.isFinite(valor) || valor <= 0) return { erro: 'Informe o valor do combo (maior que zero).' };
  if (ids.length < 2)                 return { erro: 'Um combo precisa de pelo menos 2 procedimentos.' };
  return { nome, valor, ids, descricao: body?.descricao?.trim() || null };
}

// POST /api/procedimentos/cadastro/combos — GESTOR
const criarCombo = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Contexto de empresa não resolvido.' });
    if (!(await isGestorDaEmpresa(req.user.id, req.empresaId))) {
      return res.status(403).json({ error: 'Somente o gestor da empresa cria combos de procedimentos.' });
    }

    const v = validarComboBody(req.body);
    if (v.erro) return res.status(400).json({ error: v.erro });

    const existentes = await prisma.procedimentoVeterinario.count({ where: { id: { in: v.ids }, ativo: true } });
    if (existentes !== v.ids.length) return res.status(400).json({ error: 'Procedimento inválido no combo.' });

    const combo = await prisma.procedimentoCombo.create({
      data: {
        empresaId: req.empresaId,
        nome:      v.nome,
        descricao: v.descricao,
        valor:     v.valor,
        itens:     { create: v.ids.map(id => ({ procedimentoId: id })) },
      },
      include: COMBO_INCLUDE,
    });
    return res.status(201).json({ dados: combo });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Já existe um combo com esse nome.' });
    console.error('ProcedimentoCadastroController.criarCombo:', err);
    return res.status(500).json({ error: 'Erro ao criar combo.' });
  }
};

// PUT /api/procedimentos/cadastro/combos/:id — GESTOR
const atualizarCombo = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(await isGestorDaEmpresa(req.user.id, req.empresaId))) {
      return res.status(403).json({ error: 'Somente o gestor da empresa altera combos.' });
    }
    const combo = await prisma.procedimentoCombo.findFirst({ where: { id, empresaId: req.empresaId, ativo: true } });
    if (!combo) return res.status(404).json({ error: 'Combo não encontrado.' });

    const v = validarComboBody(req.body);
    if (v.erro) return res.status(400).json({ error: v.erro });

    const existentes = await prisma.procedimentoVeterinario.count({ where: { id: { in: v.ids }, ativo: true } });
    if (existentes !== v.ids.length) return res.status(400).json({ error: 'Procedimento inválido no combo.' });

    const atualizado = await prisma.$transaction(async (tx) => {
      await tx.procedimentoComboItem.deleteMany({ where: { comboId: id } });
      return tx.procedimentoCombo.update({
        where: { id },
        data: {
          nome:      v.nome,
          descricao: v.descricao,
          valor:     v.valor,
          itens:     { create: v.ids.map(pid => ({ procedimentoId: pid })) },
        },
        include: COMBO_INCLUDE,
      });
    });
    return res.json({ dados: atualizado });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Já existe um combo com esse nome.' });
    console.error('ProcedimentoCadastroController.atualizarCombo:', err);
    return res.status(500).json({ error: 'Erro ao atualizar combo.' });
  }
};

// DELETE /api/procedimentos/cadastro/combos/:id — GESTOR; motivo obrigatório (auditoria)
const excluirCombo = async (req, res) => {
  try {
    const id     = Number(req.params.id);
    const motivo = req.body?.motivo?.trim();
    if (!motivo) return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
    if (!(await isGestorDaEmpresa(req.user.id, req.empresaId))) {
      return res.status(403).json({ error: 'Somente o gestor da empresa exclui combos.' });
    }
    const combo = await prisma.procedimentoCombo.findFirst({ where: { id, empresaId: req.empresaId, ativo: true } });
    if (!combo) return res.status(404).json({ error: 'Combo não encontrado.' });

    await prisma.$transaction(async (tx) => {
      await tx.procedimentoCombo.update({ where: { id }, data: { ativo: false } });
      await registrarAuditoria(tx, req, {
        categoria:  'EXCLUSAO',
        entidade:   'PROCEDIMENTO_COMBO',
        entidadeId: id,
        motivo,
        detalhes:   `Combo "${combo.nome}" excluído (soft delete)`,
      });
    });
    return res.json({ dados: { message: 'Combo excluído.' } });
  } catch (err) {
    console.error('ProcedimentoCadastroController.excluirCombo:', err);
    return res.status(500).json({ error: 'Erro ao excluir combo.' });
  }
};

module.exports = {
  especialidadesMinhas,
  listarComValores,
  definirValor,
  listarCombos,
  criarCombo,
  atualizarCombo,
  excluirCombo,
};

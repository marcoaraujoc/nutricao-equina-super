// VacinaAdminController.js — catálogo de vacinas + lotes por empresa (ADMIN only)
const prisma = require('../lib/prisma').default;

// ── Catálogo de vacinas ───────────────────────────────────────────────────────

async function listarVacinas(req, res) {
  try {
    const { busca, ativo } = req.query;
    const where = {};
    if (busca) where.nome = { contains: busca, mode: 'insensitive' };
    if (ativo !== undefined) where.ativo = ativo === 'true';

    const vacinas = await prisma.vacina.findMany({
      where,
      include: {
        lotes: {
          where: { ativo: true },
          orderBy: { validade: 'asc' },
        },
        _count: { select: { aplicacoes: true } },
      },
      orderBy: { nome: 'asc' },
    });
    res.json({ dados: vacinas });
  } catch (err) {
    console.error('listarVacinas:', err);
    res.status(500).json({ error: 'Erro ao listar vacinas' });
  }
}

async function criarVacina(req, res) {
  try {
    const { nome, fabricante, via } = req.body;
    if (!nome?.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });

    const vacina = await prisma.vacina.create({
      data: { nome: nome.trim(), fabricante: fabricante?.trim() || null, via: via?.trim() || 'Subcutânea (SC)' },
    });
    res.status(201).json({ dados: vacina });
  } catch (err) {
    console.error('criarVacina:', err);
    res.status(500).json({ error: 'Erro ao criar vacina' });
  }
}

async function atualizarVacina(req, res) {
  try {
    const { id } = req.params;
    const { nome, fabricante, via } = req.body;
    if (!nome?.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });

    const vacina = await prisma.vacina.update({
      where: { id: Number(id) },
      data: { nome: nome.trim(), fabricante: fabricante?.trim() || null, via: via?.trim() || 'Subcutânea (SC)' },
    });
    res.json({ dados: vacina });
  } catch (err) {
    console.error('atualizarVacina:', err);
    res.status(500).json({ error: 'Erro ao atualizar vacina' });
  }
}

async function toggleVacina(req, res) {
  try {
    const { id } = req.params;
    const vacina = await prisma.vacina.findUnique({ where: { id: Number(id) } });
    if (!vacina) return res.status(404).json({ error: 'Vacina não encontrada' });

    const updated = await prisma.vacina.update({
      where: { id: Number(id) },
      data: { ativo: !vacina.ativo },
    });
    res.json({ dados: updated });
  } catch (err) {
    console.error('toggleVacina:', err);
    res.status(500).json({ error: 'Erro ao alterar status' });
  }
}

// ── Lotes por vacina/empresa ──────────────────────────────────────────────────

async function listarLotes(req, res) {
  try {
    const { vacinaId } = req.params;
    const { empresaId, soAtivos } = req.query;

    const where = { vacinaId: Number(vacinaId) };
    if (empresaId) where.empresaId = Number(empresaId);
    if (soAtivos === 'true') where.ativo = true;

    const lotes = await prisma.loteVacina.findMany({
      where,
      include: { empresa: { select: { id: true, nome: true } } },
      orderBy: { validade: 'asc' },
    });
    res.json({ dados: lotes });
  } catch (err) {
    console.error('listarLotes:', err);
    res.status(500).json({ error: 'Erro ao listar lotes' });
  }
}

async function criarLote(req, res) {
  try {
    const { vacinaId } = req.params;
    const { empresaId, lote, validade, qtdTotal } = req.body;

    if (!lote?.trim()) return res.status(400).json({ error: 'Número do lote é obrigatório' });
    if (!validade) return res.status(400).json({ error: 'Validade é obrigatória' });
    if (!qtdTotal || Number(qtdTotal) < 1) return res.status(400).json({ error: 'Quantidade deve ser maior que zero' });

    const vacina = await prisma.vacina.findUnique({ where: { id: Number(vacinaId) } });
    if (!vacina) return res.status(404).json({ error: 'Vacina não encontrada' });

    const novoLote = await prisma.loteVacina.create({
      data: {
        vacinaId: Number(vacinaId),
        empresaId: empresaId ? Number(empresaId) : null,
        lote: lote.trim(),
        validade: new Date(validade),
        qtdTotal: Number(qtdTotal),
        qtdDisponivel: Number(qtdTotal),
      },
      include: { empresa: { select: { id: true, nome: true } } },
    });
    res.status(201).json({ dados: novoLote });
  } catch (err) {
    console.error('criarLote:', err);
    res.status(500).json({ error: 'Erro ao criar lote' });
  }
}

async function atualizarLote(req, res) {
  try {
    const { id } = req.params;
    const { lote, validade, qtdTotal, qtdDisponivel } = req.body;

    const data = {};
    if (lote !== undefined) data.lote = lote.trim();
    if (validade !== undefined) data.validade = new Date(validade);
    if (qtdTotal !== undefined) data.qtdTotal = Number(qtdTotal);
    if (qtdDisponivel !== undefined) data.qtdDisponivel = Number(qtdDisponivel);

    const updated = await prisma.loteVacina.update({ where: { id: Number(id) }, data });
    res.json({ dados: updated });
  } catch (err) {
    console.error('atualizarLote:', err);
    res.status(500).json({ error: 'Erro ao atualizar lote' });
  }
}

async function inativarLote(req, res) {
  try {
    const { id } = req.params;
    const updated = await prisma.loteVacina.update({
      where: { id: Number(id) },
      data: { ativo: false },
    });
    res.json({ dados: updated });
  } catch (err) {
    console.error('inativarLote:', err);
    res.status(500).json({ error: 'Erro ao inativar lote' });
  }
}

module.exports = {
  listarVacinas,
  criarVacina,
  atualizarVacina,
  toggleVacina,
  listarLotes,
  criarLote,
  atualizarLote,
  inativarLote,
};

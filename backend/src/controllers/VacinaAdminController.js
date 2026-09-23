// VacinaAdminController.js — catálogo de vacinas + lotes por empresa (ADMIN only)
const prisma = require('../lib/prisma').default;
const { registrarAuditoria } = require('../lib/auditoria');

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

// Justificativa obrigatória para INATIVAR + auditoria — mesma regra dos demais
// cadastros. Esta vacina é do CATÁLOGO GLOBAL: inativá-la a retira de TODAS as
// clínicas de uma vez, e até aqui isso acontecia sem motivo e sem deixar rastro.
// Ativar segue direto, sem modal.
async function toggleVacina(req, res) {
  try {
    const { id } = req.params;
    const { motivo } = req.body ?? {};
    const vacina = await prisma.vacina.findUnique({ where: { id: Number(id) } });
    if (!vacina) return res.status(404).json({ error: 'Vacina não encontrada' });

    const vaiInativar = vacina.ativo;
    if (vaiInativar && !motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da inativação' });
    }

    const updated = await prisma.vacina.update({
      where: { id: Number(id) },
      data: { ativo: !vacina.ativo },
    });

    await registrarAuditoria(null, req, {
      categoria:  vaiInativar ? 'INATIVACAO' : 'ATIVACAO',
      entidade:   'VACINA_CATALOGO',
      entidadeId: updated.id,
      motivo:     vaiInativar ? motivo.trim() : null,
      detalhes:   `${req.user?.fullName ?? req.user?.email} ${vaiInativar ? 'inativou' : 'ativou'} a vacina ${vacina.nome} no catálogo do sistema`,
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

// Inativar lote também é inativação: motivo obrigatório + auditoria. Este lote sai
// da fila de aplicação (FEFO) da empresa a que pertence, então a pergunta "por que
// este lote saiu?" — vencimento, recolhimento, perda — precisa estar respondida na
// trilha, não só na memória de quem clicou.
async function inativarLote(req, res) {
  try {
    const { id } = req.params;
    const { motivo } = req.body ?? {};
    if (!motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da inativação' });
    }

    const existe = await prisma.loteVacina.findUnique({
      where:   { id: Number(id) },
      include: { vacina: { select: { nome: true } } },
    });
    if (!existe) return res.status(404).json({ error: 'Lote não encontrado' });

    const updated = await prisma.loteVacina.update({
      where: { id: Number(id) },
      data: { ativo: false },
    });

    await registrarAuditoria(null, req, {
      categoria:  'INATIVACAO',
      entidade:   'ESTOQUE_VACINA',
      entidadeId: updated.id,
      motivo:     motivo.trim(),
      detalhes:   `${req.user?.fullName ?? req.user?.email} inativou o lote ${existe.lote ?? ''} de ${existe.vacina?.nome ?? 'vacina'}`.replace('  ', ' '),
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

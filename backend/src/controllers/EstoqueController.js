// backend/src/controllers/EstoqueController.js
'use strict';

const prisma = require('../lib/prisma').default;

// Calcula preço por unidade base (R$/g ou R$/mL) a partir do preço total e
// da quantidade em sua unidade de medida. Retorna null quando não é possível
// calcular (unidade desconhecida ou quantidade zero).
const FATOR_BASE_ESTOQUE = {
  'g': 1, 'mg': 0.001, 'kg': 1000, 'mcg': 0.000001,
  'ml': 1, 'l': 1000,
};
function calcPrecoUnitarioBase(valorRepassado, qtd, unidade) {
  if (!qtd || qtd <= 0 || !valorRepassado || valorRepassado <= 0) return null;
  const fator = FATOR_BASE_ESTOQUE[(unidade ?? '').trim().toLowerCase()];
  if (fator == null) return null; // unidade incompatível (ex: 'un', 'balde') — não calcula
  const qtdBase = qtd * fator;
  return qtdBase > 0 ? valorRepassado / qtdBase : null;
}

const INCLUDE = {
  medicamento: {
    include: { vias: { select: { id: true, via: true }, orderBy: { via: 'asc' } } },
  },
  fornecedor: { select: { id: true, nome: true, tipoServico: true } },
};

// Normaliza lote para comparação (case-insensitive, vazio=null)
function normLote(lote) {
  const t = (lote ?? '').trim();
  return t === '' ? null : t.toLowerCase();
}
// Normaliza validade para comparação (apenas YYYY-MM-DD)
function normValidade(v) {
  if (!v) return null;
  try { return new Date(v).toISOString().split('T')[0]; } catch { return null; }
}

// ADMIN pode passar ?empresaId= para ver qualquer empresa; demais sempre usam req.empresaId
function getEmpresaScope(req) {
  if (req.user?.userType === 'ADMIN') {
    return req.query?.empresaId ? Number(req.query.empresaId) : (req.empresaId ?? null);
  }
  return req.empresaId ?? null;
}

// Retorna true se o item pertence à empresa do usuário (ADMIN bypassa)
function pertenceAEmpresa(item, req) {
  if (req.user?.userType === 'ADMIN') return true;
  return req.empresaId != null && item.empresaId === req.empresaId;
}

// ─── Listar estoque da clínica ────────────────────────────────────────────────

const listar = async (req, res) => {
  try {
    const { busca, ativo, limit } = req.query;
    const empresaId = getEmpresaScope(req);

    // Não-ADMIN sem empresa ativa não vê nada
    if (!empresaId && req.user?.userType !== 'ADMIN') {
      return res.json({ dados: [], meta: { total: 0, totalControlados: 0, totalAbaixoMinimo: 0, totalAbaixoAlarmante: 0 } });
    }

    const where = {};
    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (empresaId)           where.empresaId = empresaId;

    if (busca) {
      where.medicamento = {
        OR: [
          { nome:              { contains: busca, mode: 'insensitive' } },
          { formaFarmaceutica: { contains: busca, mode: 'insensitive' } },
          { vias: { some: { via: { contains: busca, mode: 'insensitive' } } } },
        ],
      };
    }

    const rawItens = await prisma.estoqueClinica.findMany({
      where,
      include: {
        ...INCLUDE,
        _count: { select: { movimentos: { where: { tipo: 'SAIDA' } } } },
      },
      orderBy: { medicamento: { nome: 'asc' } },
      ...(limit ? { take: parseInt(limit, 10) } : {}),
    });

    const itens = rawItens.map(({ _count, ...i }) => ({ ...i, emUso: (_count?.movimentos ?? 0) > 0 }));

    const [total, totalControlados] = await Promise.all([
      prisma.estoqueClinica.count({ where: { ativo: true, ...(empresaId ? { empresaId } : {}) } }),
      prisma.estoqueClinica.count({ where: { ativo: true, ...(empresaId ? { empresaId } : {}), medicamento: { controlado: true } } }),
    ]);

    const totalAbaixoMinimo    = itens.filter((i) => i.ativo && i.qtdEstoque <= i.estoqueMinimo).length;
    const totalAbaixoAlarmante = itens.filter((i) => i.ativo && i.qtdEstoque <= i.estoqueAlarmante && i.qtdEstoque > i.estoqueMinimo).length;

    return res.json({
      dados: itens,
      meta: { total, totalControlados, totalAbaixoMinimo, totalAbaixoAlarmante },
    });
  } catch (err) {
    console.error('EstoqueController.listar:', err);
    return res.status(500).json({ error: 'Erro ao listar estoque.' });
  }
};

// ─── Obter por ID ─────────────────────────────────────────────────────────────

const obterPorId = async (req, res) => {
  try {
    const item = await prisma.estoqueClinica.findUnique({
      where:   { id: Number(req.params.id) },
      include: INCLUDE,
    });
    if (!item) return res.status(404).json({ error: 'Item de estoque não encontrado.' });
    if (!pertenceAEmpresa(item, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });
    return res.json({ dados: item });
  } catch (err) {
    console.error('EstoqueController.obterPorId:', err);
    return res.status(500).json({ error: 'Erro ao buscar item.' });
  }
};

// ─── Criar entrada de estoque ─────────────────────────────────────────────────

const criar = async (req, res) => {
  try {
    const {
      medicamentoId,
      empresaId,
      valor            = 0,
      valorRepassado   = 0,
      lote,
      validade,
      qtdEstoque       = 0,
      estoqueMinimo    = 0,
      estoqueAlarmante = 0,
      fornecedorId,
      notaFiscal,
    } = req.body;

    if (!medicamentoId)
      return res.status(400).json({ error: 'medicamentoId é obrigatório.' });

    if (Number(qtdEstoque) < 0 || Number(estoqueMinimo) < 0 || Number(estoqueAlarmante) < 0)
      return res.status(400).json({ error: 'Quantidades não podem ser negativas.' });

    const med = await prisma.medicamento.findUnique({ where: { id: Number(medicamentoId) } });
    if (!med) return res.status(404).json({ error: 'Medicamento não encontrado no catálogo.' });

    const eId           = empresaId ? Number(empresaId) : (req.empresaId ?? null);
    const loteNorm      = normLote(lote);
    const validadeStr   = normValidade(validade);
    const precoNovo     = calcPrecoUnitarioBase(Number(valorRepassado), Number(qtdEstoque), med.unidade);
    const nfMotivo      = notaFiscal?.trim() ? `NF: ${notaFiscal.trim()}` : null;

    // ── Busca candidatos para consolidação (mesmo medicamento, empresa, ativo) ─
    const candidatos = await prisma.estoqueClinica.findMany({
      where: { medicamentoId: Number(medicamentoId), empresaId: eId, ativo: true },
      include: INCLUDE,
    });

    // Verifica se existe entrada idêntica (lote+validade+preço)
    const existente = candidatos.find(c => {
      if (normLote(c.lote) !== loteNorm) return false;
      if (normValidade(c.validade) !== validadeStr) return false;
      const cPreco = c.precoUnitarioBase != null ? Number(c.precoUnitarioBase) : null;
      if (precoNovo === null && cPreco === null) return true;
      if (precoNovo === null || cPreco === null) return false;
      const maxP = Math.max(precoNovo, cPreco);
      return maxP === 0 || Math.abs(precoNovo - cPreco) / maxP < 0.01; // 1% de tolerância
    });

    if (existente) {
      // ── CONSOLIDAR: soma quantidade + cria movimento com NF ──────────────
      const updated = await prisma.$transaction(async (tx) => {
        await tx.movimentoEstoque.create({
          data: {
            estoqueId: existente.id,
            tipo: 'ENTRADA',
            quantidade: Number(qtdEstoque),
            motivo: nfMotivo ?? 'Entrada adicional',
          },
        });
        return tx.estoqueClinica.update({
          where: { id: existente.id },
          data: { qtdEstoque: { increment: Number(qtdEstoque) } },
          include: { ...INCLUDE, _count: { select: { movimentos: { where: { tipo: 'SAIDA' } } } } },
        });
      });
      const { _count, ...rest } = updated;
      return res.status(200).json({
        dados: { ...rest, emUso: (_count?.movimentos ?? 0) > 0 },
        consolidado: true,
        mensagem: nfMotivo ? `Quantidade somada ao estoque existente (${nfMotivo}).` : 'Quantidade somada ao estoque existente.',
      });
    }

    // ── NOVA ENTRADA ──────────────────────────────────────────────────────────
    const item = await prisma.$transaction(async (tx) => {
      const entry = await tx.estoqueClinica.create({
        data: {
          medicamentoId:    Number(medicamentoId),
          empresaId:        eId,
          valor:            Number(valor),
          valorRepassado:   Number(valorRepassado),
          precoUnitarioBase: precoNovo,
          lote:             loteNorm ?? null,
          validade:         validade ? new Date(validade) : null,
          qtdEstoque:       Number(qtdEstoque),
          estoqueMinimo:    Number(estoqueMinimo),
          estoqueAlarmante: Number(estoqueAlarmante),
          fornecedorId:     fornecedorId ? Number(fornecedorId) : null,
          notaFiscal:       notaFiscal?.trim() ?? null,
        },
        include: INCLUDE,
      });

      if (Number(qtdEstoque) > 0) {
        await tx.movimentoEstoque.create({
          data: { estoqueId: entry.id, tipo: 'ENTRADA', quantidade: Number(qtdEstoque), motivo: nfMotivo ?? 'Entrada inicial' },
        });
      }

      return entry;
    });

    return res.status(201).json({ dados: { ...item, emUso: false }, consolidado: false });
  } catch (err) {
    console.error('EstoqueController.criar:', err);
    return res.status(500).json({ error: 'Erro ao criar item de estoque.' });
  }
};

// ─── Atualizar ────────────────────────────────────────────────────────────────

const atualizar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { valor, valorRepassado, lote, validade, estoqueMinimo, estoqueAlarmante, ativo, fornecedorId, notaFiscal } = req.body;

    const existe = await prisma.estoqueClinica.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Item de estoque não encontrado.' });
    if (!pertenceAEmpresa(existe, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });

    if (estoqueMinimo    !== undefined && Number(estoqueMinimo)    < 0) return res.status(400).json({ error: 'Estoque mínimo não pode ser negativo.' });
    if (estoqueAlarmante !== undefined && Number(estoqueAlarmante) < 0) return res.status(400).json({ error: 'Estoque alarmante não pode ser negativo.' });

    const data = {};
    if (valor            !== undefined) data.valor            = Number(valor);
    if (valorRepassado   !== undefined) data.valorRepassado   = Number(valorRepassado);
    if (lote             !== undefined) data.lote             = lote?.trim() ?? null;
    if (validade         !== undefined) data.validade         = validade ? new Date(validade) : null;
    if (estoqueMinimo    !== undefined) data.estoqueMinimo    = Number(estoqueMinimo);
    if (estoqueAlarmante !== undefined) data.estoqueAlarmante = Number(estoqueAlarmante);
    if (ativo            !== undefined) data.ativo            = Boolean(ativo);
    if (fornecedorId     !== undefined) data.fornecedorId     = fornecedorId ? Number(fornecedorId) : null;
    if (notaFiscal       !== undefined) data.notaFiscal       = notaFiscal?.trim() ?? null;

    // Recalcula precoUnitarioBase sempre que o valorRepassado for alterado manualmente
    if (valorRepassado !== undefined) {
      const med = await prisma.medicamento.findUnique({ where: { id: existe.medicamentoId }, select: { unidade: true } });
      const novoPreco = calcPrecoUnitarioBase(Number(valorRepassado), existe.qtdEstoque, med?.unidade);
      if (novoPreco !== null) data.precoUnitarioBase = novoPreco;
    }

    const item = await prisma.estoqueClinica.update({ where: { id }, data, include: INCLUDE });
    return res.json({ dados: item });
  } catch (err) {
    console.error('EstoqueController.atualizar:', err);
    return res.status(500).json({ error: 'Erro ao atualizar item.' });
  }
};

// ─── Excluir (soft delete) ────────────────────────────────────────────────────

const excluir = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existe = await prisma.estoqueClinica.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Item não encontrado.' });
    if (!pertenceAEmpresa(existe, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });
    await prisma.estoqueClinica.update({ where: { id }, data: { ativo: false } });
    return res.json({ dados: { message: 'Item inativado com sucesso.' } });
  } catch (err) {
    console.error('EstoqueController.excluir:', err);
    return res.status(500).json({ error: 'Erro ao excluir item.' });
  }
};

// ─── Ajustar estoque (entrada/saída/ajuste) ───────────────────────────────────

const ajustarEstoque = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { tipo, quantidade, motivo } = req.body;

    if (!tipo || !['ENTRADA', 'SAIDA', 'AJUSTE'].includes(tipo))
      return res.status(400).json({ error: 'tipo deve ser ENTRADA, SAIDA ou AJUSTE.' });

    const qty = Number(quantidade);
    if (!qty || qty <= 0) return res.status(400).json({ error: 'quantidade deve ser maior que zero.' });

    const existe = await prisma.estoqueClinica.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Item não encontrado.' });
    if (!pertenceAEmpresa(existe, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });

    const delta      = tipo === 'SAIDA' ? -qty : qty;
    const novaQtd    = existe.qtdEstoque + delta;
    if (novaQtd < 0) return res.status(400).json({ error: 'Estoque resultante seria negativo.' });

    const item = await prisma.$transaction(async (tx) => {
      await tx.movimentoEstoque.create({
        data: { estoqueId: id, tipo, quantidade: qty, motivo: motivo ?? null },
      });
      return tx.estoqueClinica.update({ where: { id }, data: { qtdEstoque: novaQtd }, include: INCLUDE });
    });

    return res.json({ dados: item });
  } catch (err) {
    console.error('EstoqueController.ajustarEstoque:', err);
    return res.status(500).json({ error: 'Erro ao ajustar estoque.' });
  }
};

// ─── Listar movimentações ─────────────────────────────────────────────────────

const listarMovimentos = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await prisma.estoqueClinica.findUnique({ where: { id }, select: { id: true, empresaId: true } });
    if (!item) return res.status(404).json({ error: 'Item de estoque não encontrado.' });
    if (!pertenceAEmpresa(item, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });

    const movimentos = await prisma.movimentoEstoque.findMany({
      where:   { estoqueId: id },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
    return res.json({ dados: movimentos });
  } catch (err) {
    console.error('EstoqueController.listarMovimentos:', err);
    return res.status(500).json({ error: 'Erro ao listar movimentos.' });
  }
};

module.exports = { listar, obterPorId, criar, atualizar, excluir, ajustarEstoque, listarMovimentos };
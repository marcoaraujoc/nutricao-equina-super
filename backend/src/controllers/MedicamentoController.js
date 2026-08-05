// backend/src/controllers/MedicamentoController.js
'use strict';

const prisma = require('../lib/prisma').default;
const { registrarAuditoria } = require('../lib/auditoria');

const INCLUDE = {
  vias: { select: { id: true, via: true }, orderBy: { via: 'asc' } },
};

const INCLUDE_VACINA = {
  vias:    { select: { id: true, via: true }, orderBy: { via: 'asc' } },
  especies: {
    select: {
      id:      true,
      especie: { select: { id: true, nome: true } },
    },
  },
};

// ─── Helper: verifica duplicata com os 5 campos da chave única ────────────────
// nome + fabricante + formaFarmaceutica + apresentacao + set de vias
// excludeId: ignora o próprio registro ao verificar (usado no update)

async function verificarDuplicata(nome, fabricante, formaFarmaceutica, apresentacao, vias, excludeId = null) {
  const fab = (fabricante ?? '').trim().toLowerCase();
  const viasNorm = [...vias].map(v => String(v).trim().toLowerCase()).sort().join('|');

  const candidatos = await prisma.medicamento.findMany({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      nome:              { equals: nome.trim(),              mode: 'insensitive' },
      formaFarmaceutica: { equals: formaFarmaceutica.trim(), mode: 'insensitive' },
      apresentacao:      { equals: apresentacao.trim(),      mode: 'insensitive' },
    },
    include: { vias: { select: { via: true } } },
  });

  return candidatos.some(c => {
    const cFab  = (c.fabricante ?? '').trim().toLowerCase();
    const cVias = c.vias.map(v => v.via.trim().toLowerCase()).sort().join('|');
    return cFab === fab && cVias === viasNorm;
  });
}

// ─── Helper: retorna vias atuais de um medicamento ───────────────────────────

async function getViasExistentes(medicamentoId) {
  const rows = await prisma.medicamentoVia.findMany({
    where:  { medicamentoId },
    select: { via: true },
  });
  return rows.map(r => r.via);
}

// Catálogo VISÍVEL para a empresa ativa: o global (empresaId null, mantido pelo ADMIN)
// + o que a própria empresa cadastrou à mão (lib/catalogoManual.js grava `empresaId`).
//
// Sem este recorte, `listar`/`listarVacinas`/`obterPorId` devolviam TAMBÉM os itens
// privados das outras clínicas — nome comercial, fabricante e apresentação do que cada
// concorrente usa. `paraAtendimento` já filtrava assim; as listagens é que não.
// ADMIN da plataforma continua vendo tudo (é ele quem mantém o catálogo global).
function escopoCatalogo(req) {
  if (req.user?.userType === 'ADMIN') return {};
  const empresaId = req.empresaId ? Number(req.empresaId) : null;
  return { OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId }] : [])] };
}

// ─── Listar ──────────────────────────────────────────────────────────────────

const listar = async (req, res) => {
  try {
    const { busca, ativo, controlado, especieNome, excluirVacinas, especieDaEmpresa } = req.query;
    const take = Math.min(Number(req.query.limit)  || 5000, 5000);
    const skip = Math.max(Number(req.query.offset) || 0,    0);
    const where = {};

    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (controlado === 'true') where.controlado = true;

    if (excluirVacinas === 'true') {
      where.NOT = { classificacao: { contains: 'vacin', mode: 'insensitive' } };
    }

    if (busca) {
      where.OR = [
        { nome:              { contains: busca, mode: 'insensitive' } },
        { formaFarmaceutica: { contains: busca, mode: 'insensitive' } },
        { vias: { some: { via: { contains: busca, mode: 'insensitive' } } } },
      ];
    }

    if (especieNome) {
      const ids = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT me."medicamentoId"
         FROM schs2vet.tb_medicamento_especies me
         JOIN schs2vet.tb_especies e ON e.id = me."especieId"
         WHERE lower(e.nome) = lower($1)`,
        especieNome
      );
      where.id = { in: ids.map((r) => r.medicamentoId) };
    }

    // Resolve espécies a partir dos animais ativos da empresa/equipe do contexto
    if (especieDaEmpresa === 'true' && !especieNome) {
      const empresaId = req.empresaId ?? null;
      const equipeId  = req.equipeId  ?? null;
      if (empresaId || equipeId) {
        const animalWhere = { ativo: true };
        if (equipeId)  animalWhere.equipeId  = equipeId;
        else           animalWhere.empresaId = empresaId;

        const animaisEspecies = await prisma.animal.findMany({
          where:    animalWhere,
          select:   { especieId: true },
          distinct: ['especieId'],
        });
        const especieIds = animaisEspecies.map((a) => a.especieId);

        if (especieIds.length > 0) {
          // Filtra medicamentos vinculados a pelo menos uma dessas espécies
          where.especies = { some: { especieId: { in: especieIds } } };
        }
        // Se não há animais ainda, não filtra por espécie (exibe o catálogo completo)
      }
    }

    // O escopo entra como AND para não colidir com o `where.OR` da busca por nome.
    const escopo = escopoCatalogo(req);
    where.AND = [...(where.AND ?? []), ...(escopo.OR ? [escopo] : [])];

    const [medicamentos, total, totalControlados, totalFiltrado] = await Promise.all([
      prisma.medicamento.findMany({ where, include: INCLUDE_VACINA, orderBy: { nome: 'asc' }, take, skip }),
      prisma.medicamento.count({ where: { ativo: true, ...escopo } }),
      prisma.medicamento.count({ where: { ativo: true, controlado: true, ...escopo } }),
      prisma.medicamento.count({ where }),
    ]);

    return res.json({
      dados: medicamentos,
      meta: {
        total,
        totalControlados,
        totalFiltrado,
        offset: skip,
        limit: take,
        hasMore: skip + medicamentos.length < totalFiltrado,
      },
    });
  } catch (err) {
    console.error('MedicamentoController.listar:', err);
    return res.status(500).json({ error: 'Erro ao listar medicamentos.' });
  }
};

// ─── Listar Vacinas (classificacao contém 'vacin') ────────────────────────────

const listarVacinas = async (req, res) => {
  try {
    const { busca, ativo } = req.query;
    const where = {
      classificacao: { contains: 'vacin', mode: 'insensitive' },
    };

    if (ativo !== undefined) where.ativo = ativo === 'true';

    if (busca) {
      where.AND = [
        { classificacao: { contains: 'vacin', mode: 'insensitive' } },
        {
          OR: [
            { nome:       { contains: busca, mode: 'insensitive' } },
            { fabricante: { contains: busca, mode: 'insensitive' } },
          ],
        },
      ];
      delete where.classificacao;
    }

    const escopo = escopoCatalogo(req);
    where.AND = [...(where.AND ?? []), ...(escopo.OR ? [escopo] : [])];

    const vacinas = await prisma.medicamento.findMany({
      where,
      include: INCLUDE_VACINA,
      orderBy: { nome: 'asc' },
    });

    return res.json({ dados: vacinas });
  } catch (err) {
    console.error('MedicamentoController.listarVacinas:', err);
    return res.status(500).json({ error: 'Erro ao listar vacinas.' });
  }
};

// ─── Listar Espécies ──────────────────────────────────────────────────────────

const listarEspecies = async (_req, res) => {
  try {
    const especies = await prisma.especie.findMany({
      select:  { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
    return res.json({ dados: especies });
  } catch (err) {
    console.error('MedicamentoController.listarEspecies:', err);
    return res.status(500).json({ error: 'Erro ao listar espécies.' });
  }
};

// ─── Obter por ID ─────────────────────────────────────────────────────────────

const obterPorId = async (req, res) => {
  try {
    const med = await prisma.medicamento.findFirst({
      where: { id: Number(req.params.id), ...escopoCatalogo(req) },
      include: INCLUDE_VACINA,
    });
    // Item privado de outra clínica responde 404 — não confirma que existe.
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
    const {
      nome, formaFarmaceutica, unidade, apresentacao,
      controlado = false, ativo = true, vias = [],
      classificacao, fabricante, especieIds = [],
    } = req.body;

    if (!nome || !formaFarmaceutica || !unidade || !apresentacao)
      return res.status(400).json({ error: 'Campos obrigatórios: nome, formaFarmaceutica, unidade, apresentacao.' });

    if (!Array.isArray(vias) || vias.length === 0)
      return res.status(400).json({ error: 'Informe ao menos uma via de administração.' });

    const isDup = await verificarDuplicata(nome, fabricante, formaFarmaceutica, apresentacao, vias);
    if (isDup)
      return res.status(409).json({ error: 'Já existe um medicamento com o mesmo nome, fabricante, forma farmacêutica, apresentação e via.' });

    const createData = {
      nome:              nome.trim(),
      formaFarmaceutica: formaFarmaceutica.trim(),
      unidade:           unidade.trim(),
      apresentacao:      apresentacao.trim(),
      controlado:        Boolean(controlado),
      ativo:             Boolean(ativo),
      vias:              { create: vias.map((v) => ({ via: String(v) })) },
    };
    if (classificacao) createData.classificacao = classificacao.trim();
    if (fabricante)    createData.fabricante    = fabricante.trim();
    if (Array.isArray(especieIds) && especieIds.length > 0) {
      createData.especies = { create: especieIds.map((id) => ({ especieId: Number(id) })) };
    }

    const med = await prisma.medicamento.create({ data: createData, include: INCLUDE });

    return res.status(201).json({ data: med });
  } catch (err) {
    console.error('MedicamentoController.criar:', err);
    return res.status(500).json({ error: 'Erro ao criar medicamento.' });
  }
};

// ─── Atualizar ────────────────────────────────────────────────────────────────

const atualizar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nome, formaFarmaceutica, unidade, apresentacao, controlado, ativo, vias, classificacao, fabricante, especieIds } = req.body;

    const existe = await prisma.medicamento.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Medicamento não encontrado.' });

    // Resolve os valores efetivos (enviado no body ou mantém o atual)
    const nomeEfetivo = nome              ?? existe.nome;
    const fabEfetivo  = fabricante        !== undefined ? fabricante : existe.fabricante;
    const formaEfetiva = formaFarmaceutica ?? existe.formaFarmaceutica;
    const apresEfetiva = apresentacao     ?? existe.apresentacao;
    const viasEfetivas = Array.isArray(vias) ? vias : await getViasExistentes(id);

    const isDup = await verificarDuplicata(
      nomeEfetivo, fabEfetivo, formaEfetiva, apresEfetiva, viasEfetivas,
      id  // exclui o próprio registro da checagem
    );
    if (isDup)
      return res.status(409).json({ error: 'Já existe um medicamento com o mesmo nome, fabricante, forma farmacêutica, apresentação e via.' });

    const data = {};
    if (nome              !== undefined) data.nome              = nome.trim();
    if (formaFarmaceutica !== undefined) data.formaFarmaceutica = formaFarmaceutica.trim();
    if (unidade           !== undefined) data.unidade           = unidade.trim();
    if (apresentacao      !== undefined) data.apresentacao      = apresentacao.trim();
    if (controlado        !== undefined) data.controlado        = Boolean(controlado);
    if (ativo             !== undefined) data.ativo             = Boolean(ativo);
    if (fabricante        !== undefined) data.fabricante        = fabricante?.trim() || null;
    if (classificacao     !== undefined) data.classificacao     = classificacao?.trim() || null;

    const med = await prisma.$transaction(async (tx) => {
      if (Array.isArray(vias)) {
        await tx.medicamentoVia.deleteMany({ where: { medicamentoId: id } });
        data.vias = { create: vias.map((v) => ({ via: String(v) })) };
      }

      if (Array.isArray(especieIds)) {
        await tx.medicamentoEspecie.deleteMany({ where: { medicamentoId: id } });
      }

      const updated = await tx.medicamento.update({ where: { id }, data, include: INCLUDE });

      if (Array.isArray(especieIds) && especieIds.length > 0) {
        await tx.medicamentoEspecie.createMany({
          data: especieIds.map((eid) => ({ medicamentoId: id, especieId: Number(eid) })),
        });
      }

      if (Array.isArray(especieIds)) {
        return tx.medicamento.findUnique({ where: { id }, include: INCLUDE_VACINA });
      }

      return updated;
    });

    return res.json({ dados: med });
  } catch (err) {
    console.error('MedicamentoController.atualizar:', err);
    return res.status(500).json({ error: 'Erro ao atualizar medicamento.' });
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

    const existe = await prisma.medicamento.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Medicamento não encontrado.' });

    await prisma.medicamento.update({ where: { id }, data: { ativo: false } });

    await registrarAuditoria(null, req, {
      categoria:  'EXCLUSAO',
      entidade:   'MEDICAMENTO',
      entidadeId: id,
      motivo,
      detalhes:   existe.nome ?? null,
    });

    return res.json({ data: { message: 'Medicamento inativado com sucesso.' } });
  } catch (err) {
    console.error('MedicamentoController.excluir:', err);
    return res.status(500).json({ error: 'Erro ao excluir medicamento.' });
  }
};

// ─── Para Atendimento ─────────────────────────────────────────────────────────
// Retorna todos os medicamentos do catálogo para a espécie do animal,
// com flag emEstoque indicando se há entrada no estoque da empresa.
// tipo=medicamento: exclui vacinas (classificacao contém 'vacin')
// tipo=vacina:      filtra apenas vacinas
// O backend de prescrição e vacina já ignora silenciosamente itens sem entrada
// de estoque (criarReservas / consumirReservas / verificarEstoqueParaDia fazem
// continue quando !estoque), portanto nenhuma mudança de fluxo é necessária.

const paraAtendimento = async (req, res) => {
  try {
    const { animalId, tipo = 'medicamento', busca } = req.query;
    const empresaId = req.empresaId ?? null;

    if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório.' });

    const animal = await prisma.animal.findUnique({
      where:  { id: Number(animalId) },
      select: { especieId: true },
    });
    if (!animal) return res.status(404).json({ error: 'Animal não encontrado.' });

    const where = { ativo: true };

    if (animal.especieId) {
      where.especies = { some: { especieId: animal.especieId } };
    }

    const isVacina = tipo === 'vacina';

    if (isVacina) {
      where.classificacao = { contains: 'vacin', mode: 'insensitive' };
    } else {
      where.NOT = { classificacao: { contains: 'vacin', mode: 'insensitive' } };
    }

    if (busca?.trim()) {
      where.OR = [
        { nome:              { contains: busca.trim(), mode: 'insensitive' } },
        { formaFarmaceutica: { contains: busca.trim(), mode: 'insensitive' } },
      ];
    }

    // Catálogo global (empresaId null) + medicamentos próprios da empresa ativa
    where.AND = [{ OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId }] : [])] }];

    // FAIL-CLOSED: estoque e lote pertencem SEMPRE a uma empresa (não existe estoque
    // global). Sem contexto o spread virava `{}` e mostrava o saldo das outras clínicas
    // ao lado do medicamento — `?? -1` não casa com nenhuma empresa.
    const escopoFisico = { empresaId: empresaId ? Number(empresaId) : -1 };
    const estoqueWhere = { ativo: true, ...escopoFisico };
    const loteWhere    = { ativo: true, qtdDisponivel: { gt: 0 }, ...escopoFisico };

    const medicamentos = await prisma.medicamento.findMany({
      where,
      include: {
        vias: { select: { id: true, via: true }, orderBy: { via: 'asc' } },
        ...(isVacina
          ? { lotes: { where: loteWhere, select: { id: true, valorUnitario: true, valorUnitarioRepassado: true, dosesPorFrasco: true }, orderBy: { validade: 'asc' }, take: 1 } }
          : { estoques: { where: estoqueWhere, select: { id: true, qtdEstoque: true, precoUnitarioBase: true } } }
        ),
      },
      orderBy: { nome: 'asc' },
    });

    const dados = medicamentos.map(m => {
      if (isVacina) {
        // Preço por dose do lote FEFO disponível (para pré-preencher o orçamento);
        // null quando não há estoque — a vacina ainda aparece (preço editável).
        const lote = (m.lotes ?? [])[0];
        const valorPorDose = lote
          ? Number(lote.valorUnitarioRepassado ?? lote.valorUnitario ?? 0) / (Number(lote.dosesPorFrasco) || 1)
          : null;
        return {
          id: m.id, nome: m.nome, formaFarmaceutica: m.formaFarmaceutica,
          unidade: m.unidade, vias: m.vias,
          emEstoque: (m.lotes ?? []).length > 0,
          valorPorDose,
        };
      }
      const estoques = m.estoques ?? [];
      const qtdTotal = estoques.reduce((s, e) => s + (e.qtdEstoque ?? 0), 0);
      // Preço base do estoque (R$/g ou R$/mL) para pré-preencher o orçamento
      const precoUnitarioBase = estoques.find(e => e.precoUnitarioBase != null)?.precoUnitarioBase ?? null;
      return {
        id: m.id, nome: m.nome, formaFarmaceutica: m.formaFarmaceutica,
        unidade: m.unidade, vias: m.vias,
        emEstoque:   estoques.length > 0,
        qtdEstoque:  estoques.length > 0 ? qtdTotal : null,
        precoUnitarioBase,
      };
    });

    return res.json({ dados });
  } catch (err) {
    console.error('MedicamentoController.paraAtendimento:', err);
    return res.status(500).json({ error: 'Erro ao buscar medicamentos para atendimento.' });
  }
};

module.exports = { listar, listarVacinas, listarEspecies, obterPorId, criar, atualizar, excluir, paraAtendimento };

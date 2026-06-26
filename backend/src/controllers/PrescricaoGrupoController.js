// backend/src/controllers/PrescricaoGrupoController.js
'use strict';

const prisma = require('../lib/prisma').default;
const { formatAtendimentoNum, getOrCreateFatura, adicionarFaturaItem } = require('../lib/faturaUtils');

// ─── Include padrão ───────────────────────────────────────────────────────────

const GRUPO_INCLUDE = {
  veterinario: { select: { id: true, fullName: true, userType: true } },
  evolucao: { select: { id: true, numero: true, tipoAtendimento: true } },
  itens: {
    where:   { ativo: true },
    include: {
      veterinario:    { select: { id: true, fullName: true } },
      medicamentoCat: { select: { id: true, nome: true, formaFarmaceutica: true, unidade: true, controlado: true } },
    },
    orderBy: { id: 'asc' },
  },
};

// ─── Helper: numero formatado ─────────────────────────────────────────────────

const formatNumero = (n) => String(n).padStart(3, '0');

// ─── Helper: próximo número de prescrição para um animal ─────────────────────

const proximoNumero = async (tx, animalId) => {
  const ultimo = await tx.prescricaoGrupo.findFirst({
    where:   { animalId },
    orderBy: { numero: 'desc' },
    select:  { numero: true },
  });
  return (ultimo?.numero ?? 0) + 1;
};

// ─── Helpers: cálculo, reserva e baixa de estoque ────────────────────────────

const DOSES_POR_DIA = {
  '1xDia':        1,    '12em12h':  2,    '8em8h':        3,
  '6em6h':        4,    '4em4h':    6,    '1em1h':        24,
  'continuo':     1,    'seNecessario': 1, 'SOS':         1,
  '1x2dias':      1/2,  '1x3dias':  1/3,  '1xSemana':    1/7,
  '1x21dias':     1/21, '1x30dias': 1/30, '1x90dias':    1/90,
};

// ─── Conversão de unidades ────────────────────────────────────────────────────
// Estratégia: converter TUDO para a unidade base (g para massa, mL para volume),
// fazer a conta na base e converter de volta para a unidade do estoque.
// Kg → g (×1000) | mg → g (×0.001) | L → mL (×1000)
// Se as unidades são incompatíveis (ex: g vs mL) ou desconhecidas, usa o valor bruto.

const FATOR_PARA_BASE = {
  // Massa → gramas
  'g': 1, 'mg': 0.001, 'kg': 1000, 'mcg': 0.000001, 'µg': 0.000001,
  // Volume → mL
  'ml': 1, 'l': 1000,
};

const GRUPO_UNIDADE = {
  'g': 'm', 'mg': 'm', 'kg': 'm', 'mcg': 'm', 'µg': 'm',
  'ml': 'v', 'l': 'v',
};

// qty (em `unidade`) → unidade base (g ou mL)
function paraBase(qty, unidade) {
  const f = FATOR_PARA_BASE[(unidade ?? '').trim().toLowerCase()];
  return f != null ? qty * f : qty;
}

// qty (em unidade base) → unidade original
function deBase(qtyBase, unidade) {
  const f = FATOR_PARA_BASE[(unidade ?? '').trim().toLowerCase()];
  return f != null ? qtyBase / f : qtyBase;
}

function mesmoGrupo(u1, u2) {
  const g1 = GRUPO_UNIDADE[(u1 ?? '').trim().toLowerCase()];
  const g2 = GRUPO_UNIDADE[(u2 ?? '').trim().toLowerCase()];
  return g1 != null && g1 === g2;
}

// ─── Quantidade total do curso ────────────────────────────────────────────────

function calcularQuantidadeTotal(item) {
  const qtdPorDose = parseFloat(item.dosagem) || 1;
  const dias       = Math.max(Number(item.duracaoDias) || 1, 1);
  if (item.frequencia === 'agora') return qtdPorDose;
  const dosesPorDia = DOSES_POR_DIA[item.frequencia] ?? 1;
  return qtdPorDose * dosesPorDia * dias;
}

// ─── Quantidade de 1 dia (sem multiplicar por duracaoDias) ───────────────────

function calcularQuantidadeDiaria(item) {
  const qtdPorDose = parseFloat(item.dosagem) || 1;
  if (item.frequencia === 'agora') return qtdPorDose;
  const dosesPorDia = DOSES_POR_DIA[item.frequencia] ?? 1;
  return qtdPorDose * dosesPorDia;
}

function qtdDiariaEstoque(item, unidadeEstoque) {
  const qtdBruta = calcularQuantidadeDiaria(item);
  if (!mesmoGrupo(item.unidade, unidadeEstoque)) return qtdBruta;
  return deBase(paraBase(qtdBruta, item.unidade), unidadeEstoque);
}

// Converte a quantidade prescrita (item.unidade) para a unidade do estoque via base.
// Ex: 500g → kg: paraBase(500,'g')=500g → deBase(500,'kg')=0.5 kg
function qtdNaUnidadeEstoque(item, unidadeEstoque) {
  const qtdBruta = calcularQuantidadeTotal(item);
  if (!mesmoGrupo(item.unidade, unidadeEstoque)) return qtdBruta; // incompatível, retorna bruto
  return deBase(paraBase(qtdBruta, item.unidade), unidadeEstoque);
}

// Cria reservas de estoque em unidade do estoque (não altera qtdEstoque)
async function criarReservas(tx, grupoId, animalId, itens, empresaId) {
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    const estoque = await tx.estoqueClinica.findFirst({
      where:   { medicamentoId: item.medicamentoCatId, ...(empresaId != null ? { empresaId } : {}), ativo: true },
      include: { medicamento: { select: { unidade: true } } },
    });
    if (!estoque) continue;
    const quantidade = qtdNaUnidadeEstoque(item, estoque.medicamento?.unidade);
    await tx.reservaEstoque.upsert({
      where:  { prescricaoGrupoId_estoqueId: { prescricaoGrupoId: grupoId, estoqueId: estoque.id } },
      update: { quantidade },
      create: { prescricaoGrupoId: grupoId, estoqueId: estoque.id, animalId, quantidade },
    });
  }
}

// Consome reservas e dá baixa no estoque (ao executar).
// Estratégia: converte tudo para a menor unidade (g ou mL), subtrai, converte de volta.
// Retorna { precos: Map<catId, R$/unidadeEstoque>, unidades: Map<catId, unidadeEstoque> }
async function consumirReservas(tx, grupoId, itens, empresaId) {
  const precos   = new Map();
  const unidades = new Map();
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    const estoque = await tx.estoqueClinica.findFirst({
      where:   { medicamentoId: item.medicamentoCatId, ...(empresaId != null ? { empresaId } : {}), ativo: true },
      include: { medicamento: { select: { unidade: true } } },
    });
    if (!estoque) continue;
    const unidadeEstoque = estoque.medicamento?.unidade ?? item.unidade;
    const qtdTotal       = calcularQuantidadeTotal(item);

    let novaQtd;
    if (mesmoGrupo(item.unidade, unidadeEstoque)) {
      // Converte TUDO para a menor unidade base (g ou mL), faz a conta, volta para unidade do estoque
      const estoqueBase  = paraBase(estoque.qtdEstoque, unidadeEstoque);
      const prescritaBase = paraBase(qtdTotal, item.unidade);
      novaQtd = deBase(Math.max(estoqueBase - prescritaBase, 0), unidadeEstoque);
    } else {
      // Unidades incompatíveis — subtrai diretamente
      novaQtd = Math.max(estoque.qtdEstoque - qtdTotal, 0);
    }

    const deduzido = estoque.qtdEstoque - novaQtd;
    const desc     = item.dosagem
      ? `${item.dosagem}${item.unidade ? ' ' + item.unidade : ''} × ${item.frequencia} × ${item.duracaoDias}d`
      : item.frequencia;
    await tx.estoqueClinica.update({ where: { id: estoque.id }, data: { qtdEstoque: novaQtd } });
    await tx.movimentoEstoque.create({
      data: { estoqueId: estoque.id, tipo: 'SAIDA', quantidade: deduzido, motivo: `Prescrição executada: ${desc}` },
    });
    await tx.reservaEstoque.deleteMany({ where: { prescricaoGrupoId: grupoId, estoqueId: estoque.id } });
    // Preço proporcional ao cliente por unidade base (R$/g ou R$/mL).
    // Usa precoUnitarioBase (campo fixo gravado na entrada do estoque) quando disponível;
    // cai no cálculo dinâmico apenas para itens legados sem o campo.
    const precoVenda = estoque.valorRepassado > 0 ? estoque.valorRepassado : (estoque.valor ?? 0);
    let precoPorUnidade;
    if (estoque.precoUnitarioBase != null && estoque.precoUnitarioBase > 0) {
      precoPorUnidade = estoque.precoUnitarioBase; // R$/g ou R$/mL
    } else {
      const qtdEstoqueBase = paraBase(estoque.qtdEstoque, unidadeEstoque);
      precoPorUnidade = qtdEstoqueBase > 0 ? precoVenda / qtdEstoqueBase : 0;
    }
    precos.set(item.medicamentoCatId, precoPorUnidade);
    unidades.set(item.medicamentoCatId, unidadeEstoque);
  }
  return { precos, unidades };
}

// Libera reservas sem dar baixa (ao cancelar)
async function liberarReservas(tx, grupoId) {
  await tx.reservaEstoque.deleteMany({ where: { prescricaoGrupoId: grupoId } });
}

// Debita 1 dia de tratamento do estoque e cria MovimentoEstoque.
// Retorna { precos, unidades } por medicamentoCatId (para lançar na fatura).
async function debitarEstoqueDia(tx, itens, empresaId) {
  const precos   = new Map();
  const unidades = new Map();
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    const estoque = await tx.estoqueClinica.findFirst({
      where:   { medicamentoId: item.medicamentoCatId, ...(empresaId != null ? { empresaId } : {}), ativo: true },
      include: { medicamento: { select: { unidade: true } } },
    });
    if (!estoque) continue;
    const unidadeEstoque = estoque.medicamento?.unidade ?? item.unidade;
    const qtdDia         = calcularQuantidadeDiaria(item);

    let novaQtd;
    if (mesmoGrupo(item.unidade, unidadeEstoque)) {
      const estoqueBase   = paraBase(estoque.qtdEstoque, unidadeEstoque);
      const prescritaBase = paraBase(qtdDia, item.unidade);
      novaQtd = deBase(Math.max(estoqueBase - prescritaBase, 0), unidadeEstoque);
    } else {
      novaQtd = Math.max(estoque.qtdEstoque - qtdDia, 0);
    }

    const deduzido = estoque.qtdEstoque - novaQtd;
    const desc = item.dosagem
      ? `${item.dosagem}${item.unidade ? ' ' + item.unidade : ''} × ${item.frequencia} (1 dia)`
      : `${item.frequencia} (1 dia)`;
    await tx.estoqueClinica.update({ where: { id: estoque.id }, data: { qtdEstoque: novaQtd } });
    await tx.movimentoEstoque.create({
      data: { estoqueId: estoque.id, tipo: 'SAIDA', quantidade: deduzido, motivo: `Prescrição executada: ${desc}` },
    });
    // Valor da dose = qtdDebitBase × precoUnitarioBase (R$/g ou R$/mL).
    // precoUnitarioBase é gravado na entrada do estoque e permanece fixo;
    // itens legados (sem o campo) caem no cálculo dinâmico, que tem o bug
    // de aumentar o preço conforme o estoque diminui.
    const precoVenda   = estoque.valorRepassado > 0 ? estoque.valorRepassado : (estoque.valor ?? 0);
    const qtdDebitBase = paraBase(deduzido, unidadeEstoque);
    let valorDaDose;
    if (estoque.precoUnitarioBase != null && estoque.precoUnitarioBase > 0) {
      valorDaDose = qtdDebitBase * estoque.precoUnitarioBase;
    } else {
      const qtdEstoqueBase = paraBase(estoque.qtdEstoque, unidadeEstoque);
      valorDaDose = qtdEstoqueBase > 0 ? (qtdDebitBase * precoVenda) / qtdEstoqueBase : 0;
    }
    precos.set(item.medicamentoCatId, valorDaDose);
    unidades.set(item.medicamentoCatId, unidadeEstoque);
  }
  return { precos, unidades };
}

// Verifica estoque para 1 dia de tratamento — retorna lista de alertas.
async function verificarEstoqueParaDia(itens, empresaId) {
  const alertas = [];
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    const estoque = await prisma.estoqueClinica.findFirst({
      where:   { medicamentoId: item.medicamentoCatId, ...(empresaId != null ? { empresaId } : {}), ativo: true },
      include: { medicamento: { select: { nome: true, unidade: true } } },
    });
    if (!estoque) continue; // medicamento não cadastrado no estoque da clínica — ignorar silenciosamente
    const unidadeEstoque = estoque.medicamento?.unidade ?? item.unidade;
    const disponBase     = paraBase(estoque.qtdEstoque ?? 0, unidadeEstoque);
    const necessarioBase = paraBase(calcularQuantidadeDiaria(item), item.unidade);
    const comparavel     = mesmoGrupo(item.unidade, unidadeEstoque);
    const insuficiente   = comparavel ? disponBase < necessarioBase : estoque.qtdEstoque < calcularQuantidadeDiaria(item);
    if (insuficiente) {
      alertas.push({
        tipo:          'INSUFICIENTE',
        medicamento:   item.medicamento,
        unidade:       unidadeEstoque,
        qtdNecessaria: qtdDiariaEstoque(item, unidadeEstoque),
        qtdDisponivel: estoque.qtdEstoque ?? 0,
      });
    }
  }
  return alertas;
}

// Verifica estoque real antes de executar — retorna lista de alertas.
// Compara em unidade base para evitar mismatch kg vs g.
async function verificarEstoqueParaExecucao(itens, empresaId) {
  const alertas = [];
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    const estoque = await prisma.estoqueClinica.findFirst({
      where:   { medicamentoId: item.medicamentoCatId, ...(empresaId != null ? { empresaId } : {}), ativo: true },
      include: { medicamento: { select: { nome: true, unidade: true } } },
    });
    if (!estoque) continue; // medicamento não cadastrado no estoque da clínica — ignorar silenciosamente
    const unidadeEstoque  = estoque.medicamento?.unidade ?? item.unidade;
    const disponBase      = paraBase(estoque.qtdEstoque ?? 0, unidadeEstoque);
    const necessarioBase  = paraBase(calcularQuantidadeTotal(item), item.unidade);
    const comparavel      = mesmoGrupo(item.unidade, unidadeEstoque);
    const insuficiente    = comparavel ? disponBase < necessarioBase : estoque.qtdEstoque < calcularQuantidadeTotal(item);
    if (insuficiente) {
      alertas.push({
        tipo:          'INSUFICIENTE',
        medicamento:   item.medicamento,
        unidade:       unidadeEstoque,
        qtdNecessaria: qtdNaUnidadeEstoque(item, unidadeEstoque),
        qtdDisponivel: estoque.qtdEstoque ?? 0,
      });
    }
  }
  return alertas;
}

// Verifica disponibilidade antes de reservar — retorna lista de alertas.
// Compara em unidade base (g/mL) para suportar kg vs g, L vs mL, etc.
// tipo 'INSUFICIENTE': disponível < necessário
// tipo 'ZERADO':       ficará zerado após esta reserva
async function verificarDisponibilidade(itens, grupoId, empresaId) {
  const alertas = [];
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    const estoque = await prisma.estoqueClinica.findFirst({
      where: { medicamentoId: item.medicamentoCatId, ...(empresaId != null ? { empresaId } : {}), ativo: true },
      include: {
        medicamento: { select: { nome: true, unidade: true } },
        reservas: {
          where: { prescricaoGrupoId: { not: grupoId } },
          include: { animal: { select: { nome: true } }, prescricaoGrupo: { select: { numero: true } } },
        },
      },
    });
    if (!estoque) continue;
    const unidadeEstoque = estoque.medicamento?.unidade ?? item.unidade;
    const qtdReservada   = estoque.reservas.reduce((s, r) => s + r.quantidade, 0); // em unidadeEstoque
    const disponivel     = estoque.qtdEstoque - qtdReservada;                      // em unidadeEstoque

    // Compara em unidade base
    const dispBase  = paraBase(disponivel, unidadeEstoque);
    const necBase   = paraBase(calcularQuantidadeTotal(item), item.unidade);
    const comparavel = mesmoGrupo(item.unidade, unidadeEstoque);
    const necessario = qtdNaUnidadeEstoque(item, unidadeEstoque); // em unidadeEstoque para exibição

    const reservasInfo = estoque.reservas.map(r => ({
      animalNome:       r.animal.nome,
      prescricaoNumero: String(r.prescricaoGrupo.numero).padStart(3, '0'),
      quantidade:       r.quantidade,
    }));

    const dispInsuf  = comparavel ? dispBase < necBase        : disponivel < calcularQuantidadeTotal(item);
    const dispZerado = comparavel ? Math.abs(dispBase - necBase) < 0.001 : Math.abs(disponivel - calcularQuantidadeTotal(item)) < 0.001;

    if (dispInsuf) {
      alertas.push({
        tipo:          'INSUFICIENTE',
        medicamento:   item.medicamento,
        unidade:       unidadeEstoque,
        qtdNecessaria: necessario,
        qtdDisponivel: Math.max(disponivel, 0),
        qtdEstoque:    estoque.qtdEstoque,
        qtdReservada,
        reservas:      reservasInfo,
      });
    } else if (necessario > 0 && dispZerado) {
      alertas.push({
        tipo:          'ZERADO',
        medicamento:   item.medicamento,
        unidade:       unidadeEstoque,
        qtdNecessaria: necessario,
        qtdDisponivel: disponivel,
        qtdEstoque:    estoque.qtdEstoque,
        qtdReservada,
        reservas:      reservasInfo,
      });
    }
  }
  return alertas;
}

// ─── Listar grupos por animal ─────────────────────────────────────────────────

const listarPorAnimal = async (req, res) => {
  try {
    const { animalId } = req.params;
    const { page = 1, limit = 20, status } = req.query;

    const where = { animalId: Number(animalId) };
    if (status) where.status = status;

    const [grupos, total] = await Promise.all([
      prisma.prescricaoGrupo.findMany({
        where,
        include: GRUPO_INCLUDE,
        orderBy: { numero: 'desc' },
        skip:    (Number(page) - 1) * Number(limit),
        take:    Number(limit),
      }),
      prisma.prescricaoGrupo.count({ where }),
    ]);

    const salvos = await prisma.prescricaoGrupo.count({ where: { animalId: Number(animalId), status: 'SALVO' } });

    return res.json({
      dados:   grupos.map((g) => ({ ...g, numeroFormatado: formatNumero(g.numero) })),
      total,
      salvos,
    });
  } catch (err) {
    console.error('PrescricaoGrupoController.listarPorAnimal:', err);
    return res.status(500).json({ error: 'Erro ao listar prescrições.' });
  }
};

// ─── Obter grupo por ID ───────────────────────────────────────────────────────

const obterPorId = async (req, res) => {
  try {
    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: Number(req.params.id) },
      include: GRUPO_INCLUDE,
    });
    if (!grupo) return res.status(404).json({ error: 'Prescrição não encontrada.' });
    return res.json({ dados: { ...grupo, numeroFormatado: formatNumero(grupo.numero) } });
  } catch (err) {
    console.error('PrescricaoGrupoController.obterPorId:', err);
    return res.status(500).json({ error: 'Erro ao buscar prescrição.' });
  }
};

// ─── Criar grupo com itens ────────────────────────────────────────────────────

const criar = async (req, res) => {
  try {
    const { animalId, empresaId, evolucaoId, itens = [] } = req.body;
    const veterinarioId = req.user.id;

    if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório.' });
    if (!evolucaoId) return res.status(400).json({ error: 'evolucaoId é obrigatório.', code: 'EVOLUCAO_REQUIRED' });
    if (!Array.isArray(itens) || itens.length === 0)
      return res.status(400).json({ error: 'Inclua ao menos um item na prescrição.' });

    // Valida que a evolução existe e pertence ao animal
    const evolucao = await prisma.evolucaoClinica.findFirst({
      where:  { id: Number(evolucaoId), animalId: Number(animalId), ativo: true },
      select: { id: true },
    });
    if (!evolucao) return res.status(400).json({ error: 'Evolução não encontrada para este animal.', code: 'EVOLUCAO_NOT_FOUND' });

    const grupo = await prisma.$transaction(async (tx) => {
      const numero = await proximoNumero(tx, Number(animalId));

      const grp = await tx.prescricaoGrupo.create({
        data: {
          numero,
          animalId:     Number(animalId),
          veterinarioId,
          evolucaoId:   Number(evolucaoId),
          empresaId:    empresaId ? Number(empresaId) : (req.empresaId ?? null),
          status:       'SALVO',
        },
      });

      for (const item of itens) {
        await tx.prescricao.create({
          data: {
            animalId:           Number(animalId),
            veterinarioId,
            grupoId:            grp.id,
            medicamentoCatId:   item.medicamentoCatId ? Number(item.medicamentoCatId) : null,
            tipo:               item.tipo             ?? 'MEDICAMENTO',
            medicamento:        String(item.medicamento ?? ''),
            dosagem:            item.dosagem           ?? null,
            unidade:            item.unidade           ?? null,
            via:                item.via               ?? 'Oral',
            frequencia:         item.frequencia        ?? '',
            duracaoDias:        Number(item.duracaoDias ?? 1),
            horaInicio:         item.horaInicio        ?? null,
            observacao:         item.observacao        ?? null,
            dataInicio:         item.dataInicio ? new Date(item.dataInicio) : new Date(),
            status:             'RASCUNHO',
            medicamentoCliente: item.medicamentoCliente === true,
          },
        });
      }

      return tx.prescricaoGrupo.findUnique({ where: { id: grp.id }, include: GRUPO_INCLUDE });
    });

    return res.status(201).json({ dados: { ...grupo, numeroFormatado: formatNumero(grupo.numero) } });
  } catch (err) {
    console.error('PrescricaoGrupoController.criar:', err);
    return res.status(500).json({ error: 'Erro ao criar prescrição.' });
  }
};

// ─── Adicionar item ao grupo ──────────────────────────────────────────────────

const adicionarItem = async (req, res) => {
  try {
    const grupoId      = Number(req.params.id);
    const veterinarioId = req.user.id;

    const grupo = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId } });
    if (!grupo)               return res.status(404).json({ error: 'Prescrição não encontrada.' });
    if (grupo.status !== 'SALVO') return res.status(400).json({ error: 'Só é possível adicionar itens em prescrições com status SALVO.' });

    const { tipo, medicamento, medicamentoCatId, dosagem, unidade, via, frequencia, duracaoDias, horaInicio, observacao, dataInicio, medicamentoCliente } = req.body;

    if (!medicamento) return res.status(400).json({ error: 'Campo medicamento é obrigatório.' });

    const item = await prisma.prescricao.create({
      data: {
        animalId:          grupo.animalId,
        veterinarioId,
        grupoId,
        medicamentoCatId:  medicamentoCatId ? Number(medicamentoCatId) : null,
        tipo:              tipo              ?? 'MEDICAMENTO',
        medicamento:       String(medicamento),
        dosagem:           dosagem           ?? null,
        unidade:           unidade           ?? null,
        via:               via               ?? 'Oral',
        frequencia:        frequencia        ?? '',
        duracaoDias:       Number(duracaoDias ?? 1),
        horaInicio:        horaInicio        ?? null,
        observacao:        observacao        ?? null,
        dataInicio:        dataInicio ? new Date(dataInicio) : new Date(),
        status:            'RASCUNHO',
        medicamentoCliente: medicamentoCliente === true,
      },
      include: {
        veterinario:    { select: { id: true, fullName: true } },
        medicamentoCat: { select: { id: true, nome: true } },
      },
    });

    // Atualiza veterinarioId do grupo para quem adicionou
    await prisma.prescricaoGrupo.update({ where: { id: grupoId }, data: { veterinarioId } });

    return res.status(201).json({ dados: item });
  } catch (err) {
    console.error('PrescricaoGrupoController.adicionarItem:', err);
    return res.status(500).json({ error: 'Erro ao adicionar item.' });
  }
};

// ─── Atualizar item ───────────────────────────────────────────────────────────

const atualizarItem = async (req, res) => {
  try {
    const itemId       = Number(req.params.itemId);
    const veterinarioId = req.user.id;

    const item = await prisma.prescricao.findUnique({ where: { id: itemId }, include: { grupo: true } });
    if (!item)                           return res.status(404).json({ error: 'Item não encontrado.' });
    if (item.grupo?.status !== 'SALVO')  return res.status(400).json({ error: 'Prescrição finalizada não pode ser editada.' });

    const { tipo, medicamento, medicamentoCatId, dosagem, unidade, via, frequencia, duracaoDias, horaInicio, observacao, dataInicio, medicamentoCliente } = req.body;

    const data = {};
    if (tipo               !== undefined) data.tipo              = tipo;
    if (medicamento        !== undefined) data.medicamento       = String(medicamento);
    if (medicamentoCatId   !== undefined) data.medicamentoCatId  = medicamentoCatId ? Number(medicamentoCatId) : null;
    if (dosagem            !== undefined) data.dosagem           = dosagem;
    if (unidade            !== undefined) data.unidade           = unidade;
    if (via                !== undefined) data.via               = via;
    if (frequencia         !== undefined) data.frequencia        = frequencia;
    if (duracaoDias        !== undefined) data.duracaoDias       = Number(duracaoDias);
    if (horaInicio         !== undefined) data.horaInicio        = horaInicio;
    if (observacao         !== undefined) data.observacao        = observacao;
    if (dataInicio         !== undefined) data.dataInicio        = new Date(dataInicio);
    if (medicamentoCliente !== undefined) data.medicamentoCliente = medicamentoCliente === true;
    data.veterinarioId = veterinarioId;

    const updated = await prisma.prescricao.update({
      where: { id: itemId },
      data,
      include: {
        veterinario:    { select: { id: true, fullName: true } },
        medicamentoCat: { select: { id: true, nome: true } },
      },
    });

    // Responsável passa a ser quem editou
    await prisma.prescricaoGrupo.update({ where: { id: item.grupoId }, data: { veterinarioId } });

    return res.json({ dados: updated });
  } catch (err) {
    console.error('PrescricaoGrupoController.atualizarItem:', err);
    return res.status(500).json({ error: 'Erro ao atualizar item.' });
  }
};

// ─── Remover item (soft delete) ───────────────────────────────────────────────

const removerItem = async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);

    const item = await prisma.prescricao.findUnique({ where: { id: itemId }, include: { grupo: true } });
    if (!item)                           return res.status(404).json({ error: 'Item não encontrado.' });
    if (item.grupo?.status !== 'SALVO')  return res.status(400).json({ error: 'Prescrição finalizada não pode ser excluída.' });

    await prisma.prescricao.update({ where: { id: itemId }, data: { ativo: false } });

    // Responsável passa a ser quem removeu
    await prisma.prescricaoGrupo.update({ where: { id: item.grupoId }, data: { veterinarioId: req.user.id } });

    return res.json({ dados: { message: 'Item removido.' } });
  } catch (err) {
    console.error('PrescricaoGrupoController.removerItem:', err);
    return res.status(500).json({ error: 'Erro ao remover item.' });
  }
};

// ─── Finalizar grupo ──────────────────────────────────────────────────────────
// SALVO → FINALIZADO.

const finalizar = async (req, res) => {
  try {
    const grupoId       = Number(req.params.id);
    const veterinarioId = req.user.id;

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: { itens: { where: { ativo: true } } },
    });

    if (!grupo)                   return res.status(404).json({ error: 'Prescrição não encontrada.' });
    if (grupo.status !== 'SALVO') return res.status(400).json({ error: 'Só é possível finalizar prescrições com status SALVO.' });

    if (req.user.userType === 'FORNECEDOR' && grupo.veterinarioId !== veterinarioId) {
      return res.status(403).json({ error: 'Você só pode finalizar prescrições criadas por você.' });
    }
    if (grupo.itens.length === 0) return res.status(400).json({ error: 'A prescrição não possui itens ativos.' });

    const agora = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.prescricao.updateMany({
        where: { grupoId, ativo: true },
        data:  { status: 'ATIVA', veterinarioId },
      });

      await tx.prescricaoGrupo.update({
        where: { id: grupoId },
        data:  {
          status:          'FINALIZADO',
          veterinarioId,
          finalizadoPorId: veterinarioId,
          finalizadoEm:    agora,
        },
      });
    });

    const grupoAtualizado = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
    return res.json({ dados: { ...grupoAtualizado, numeroFormatado: formatNumero(grupoAtualizado.numero) } });
  } catch (err) {
    console.error('PrescricaoGrupoController.finalizar:', err);
    return res.status(500).json({ error: 'Erro ao finalizar prescrição.' });
  }
};

// ─── Cancelar grupo ───────────────────────────────────────────────────────────
// Libera reservas de estoque sem dar baixa.

const cancelar = async (req, res) => {
  try {
    const grupoId = Number(req.params.id);
    const userId  = req.user.id;
    const motivo  = req.body?.motivo?.trim() ?? null;

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: { itens: { where: { ativo: true } } },
    });
    if (!grupo) return res.status(404).json({ error: 'Prescrição não encontrada.' });

    // Regra: FORNECEDOR só pode cancelar prescrição que ele próprio criou
    if (req.user.userType === 'FORNECEDOR' && grupo.veterinarioId !== userId) {
      return res.status(403).json({ error: 'Você só pode cancelar prescrições criadas por você.' });
    }

    if (grupo.status === 'EXECUTADO') {
      return res.status(400).json({ error: 'Prescrição executada integralmente não pode ser cancelada.', code: 'EXECUTADO' });
    }

    if (!['SALVO', 'FINALIZADO', 'CANCELADO_PARCIALMENTE'].includes(grupo.status)) {
      return res.status(400).json({ error: 'Status não permite cancelamento.' });
    }

    await prisma.$transaction(async (tx) => {
      await liberarReservas(tx, grupoId);
      await tx.prescricao.updateMany({ where: { grupoId, ativo: true }, data: { status: 'CANCELADA' } });
      await tx.prescricaoGrupo.update({
        where: { id: grupoId },
        data:  { status: 'CANCELADO', motivoCancelamento: motivo },
      });
    });

    return res.json({ dados: { message: 'Prescrição cancelada. Estoque reservado liberado.' } });
  } catch (err) {
    console.error('PrescricaoGrupoController.cancelar:', err);
    return res.status(500).json({ error: 'Erro ao cancelar prescrição.' });
  }
};

// ─── Executar grupo (por dia) ─────────────────────────────────────────────────
// Debita a dose do dia do estoque e lança na fatura.
// Se isUltimoDia = true → transita para EXECUTADO; senão mantém FINALIZADO.

const executar = async (req, res) => {
  try {
    const grupoId       = Number(req.params.id);
    const veterinarioId = req.user.id;
    // isUltimoDia: enviado pelo frontend; default true para compatibilidade retroativa
    const isUltimoDia   = req.body?.isUltimoDia !== false;

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: {
        itens:   { where: { ativo: true }, include: { medicamentoCat: true } },
        evolucao: { select: { id: true, numero: true, tipoAtendimento: true } },
      },
    });
    if (!grupo)                        return res.status(404).json({ error: 'Prescrição não encontrada.' });
    if (grupo.status !== 'FINALIZADO') return res.status(400).json({ error: 'Apenas prescrições FINALIZADAS podem ser executadas.' });

    const empresaIdEfetivo = grupo.empresaId ?? req.empresaId ?? null;

    // Verifica estoque para a dose do dia (não para o tratamento completo)
    const alertasEstoque = await verificarEstoqueParaDia(grupo.itens, empresaIdEfetivo);
    if (alertasEstoque.length > 0) {
      return res.status(409).json({ erro: 'ESTOQUE_INSUFICIENTE', alertas: alertasEstoque });
    }

    const animal = await prisma.animal.findUnique({ where: { id: grupo.animalId }, select: { userId: true } });
    const proprietarioId = animal?.userId ?? null;

    const atendNum = grupo.evolucao
      ? formatAtendimentoNum(grupo.evolucao.tipoAtendimento, grupo.evolucao.numero)
      : null;
    const agora = new Date();

    await prisma.$transaction(async (tx) => {
      // Debita dose do dia e retorna preços/unidades por medicamento
      const { precos, unidades } = await debitarEstoqueDia(tx, grupo.itens, empresaIdEfetivo);

      // Lança na fatura ABERTA do proprietário (quantidade do dia)
      const fatura = await getOrCreateFatura(tx, proprietarioId);

      for (const item of grupo.itens) {
        // MEDICAMENTO sem estoque debitado: não lança na fatura
        if (item.tipo === 'MEDICAMENTO' && item.medicamentoCatId && !precos.has(item.medicamentoCatId)) continue;

        // precos já contém o valor proporcional da dose (regra de 3)
        const valorDaDose = item.medicamentoCatId ? (precos.get(item.medicamentoCatId) ?? 0) : 0;
        const dose = item.dosagem
          ? `${item.dosagem}${item.unidade ?? ''} × ${item.frequencia}`
          : item.frequencia;
        const descBase = item.tipo === 'MEDICAMENTO'
          ? `${item.medicamento} — ${dose}`
          : item.medicamento;
        const descricao = atendNum ? `[${atendNum}] ${descBase}` : descBase;

        await adicionarFaturaItem(tx, {
          faturaId:     fatura.id,
          animalId:     grupo.animalId,
          tipo:         item.tipo === 'MEDICAMENTO' ? 'MEDICAMENTO' : 'PROCEDIMENTO',
          descricao,
          valor:        valorDaDose,  // valor total da dose (regra de 3)
          quantidade:   1,
          veterinarioId,
        });
      }

      // Só transita para EXECUTADO no último dia do tratamento
      if (isUltimoDia) {
        await tx.prescricaoGrupo.update({
          where: { id: grupoId },
          data:  {
            status:         'EXECUTADO',
            executadoPorId: veterinarioId,
            executadoEm:    agora,
          },
        });
      }
    });

    const grupoAtualizado = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
    return res.json({ dados: { ...grupoAtualizado, numeroFormatado: formatNumero(grupoAtualizado.numero) } });
  } catch (err) {
    console.error('PrescricaoGrupoController.executar:', err);
    return res.status(500).json({ error: 'Erro ao executar prescrição.' });
  }
};

// ─── Listar para execução ─────────────────────────────────────────────────────
// Retorna grupos FINALIZADO cujo janela de tratamento inclui hoje.
// Filtro de data usa dataInicio + duracaoDias dos itens (não updatedAt).

const listarParaExecucao = async (req, res) => {
  try {
    const { busca, empresaId, animalId } = req.query;

    const whereGrupo = { status: 'FINALIZADO' };
    if (empresaId) whereGrupo.empresaId = Number(empresaId);
    if (animalId)  whereGrupo.animalId  = Number(animalId);

    const grupos = await prisma.prescricaoGrupo.findMany({
      where:   whereGrupo,
      include: {
        veterinario:  { select: { id: true, fullName: true } },
        finalizadoPor:{ select: { id: true, fullName: true } },
        executadoPor: { select: { id: true, fullName: true } },
        animal: {
          select: {
            id: true, nome: true, photoUrl: true, peso: true,
            // baia: true, ← reabilitar após npx prisma generate com servidor parado
            especie: { select: { nome: true } },
            raca:    { select: { nome: true } },
          },
        },
        itens: {
          where:   { ativo: true },
          include: { medicamentoCat: { select: { id: true, nome: true } } },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: [{ animalId: 'asc' }, { numero: 'asc' }],
    });

    // Data de hoje em UTC (YYYY-MM-DD) — evita deslocamento de fuso ao comparar com dataInicio
    const hojeStr = new Date().toISOString().split('T')[0];
    const hoje    = new Date(hojeStr + 'T00:00:00Z'); // meia-noite UTC

    // Mantém apenas grupos onde pelo menos um item cobre hoje
    const dentroJanela = grupos.filter(g =>
      g.itens.some(item => {
        const inicioStr = new Date(item.dataInicio).toISOString().split('T')[0];
        const inicio    = new Date(inicioStr + 'T00:00:00Z');
        const fim       = new Date(inicio);
        fim.setUTCDate(fim.getUTCDate() + Math.max(Number(item.duracaoDias) || 1, 1));
        const fimStr    = fim.toISOString().split('T')[0];
        return inicioStr <= hojeStr && hojeStr < fimStr;
      })
    );

    // Filtro de busca textual (nome animal, baia, nº prescrição, vet)
    let resultado = dentroJanela;
    if (busca?.trim()) {
      const q = busca.toLowerCase();
      resultado = grupos.filter(g =>
        g.animal.nome.toLowerCase().includes(q) ||
        (g.animal.baia ?? '').toLowerCase().includes(q) ||
        String(g.numero).padStart(3, '0').includes(q) ||
        g.veterinario.fullName.toLowerCase().includes(q)
      );
    }

    // Adiciona diaAtual em cada item para exibição frontend (base UTC)
    const comDia = resultado.map(g => ({
      ...g,
      numeroFormatado: formatNumero(g.numero),
      itens: g.itens.map(item => {
        const inicioStr = new Date(item.dataInicio).toISOString().split('T')[0];
        const inicio    = new Date(inicioStr + 'T00:00:00Z');
        const diaAtual  = Math.floor((hoje.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        return { ...item, diaAtual };
      }),
    }));

    return res.json({ dados: comDia, total: comDia.length });
  } catch (err) {
    console.error('PrescricaoGrupoController.listarParaExecucao:', err);
    return res.status(500).json({ error: 'Erro ao listar prescrições para execução.' });
  }
};

module.exports = {
  listarPorAnimal,
  obterPorId,
  criar,
  adicionarItem,
  atualizarItem,
  removerItem,
  finalizar,
  cancelar,
  executar,
  listarParaExecucao,
};
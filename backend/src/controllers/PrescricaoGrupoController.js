// backend/src/controllers/PrescricaoGrupoController.js
'use strict';

const prisma = require('../lib/prisma').default;

// ─── Include padrão ───────────────────────────────────────────────────────────

const GRUPO_INCLUDE = {
  veterinario: { select: { id: true, fullName: true, userType: true } },
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

// ─── Helper: deduzir estoque ao finalizar ─────────────────────────────────────

// Doses por dia de cada código de frequência
const DOSES_POR_DIA = {
  '1xDia':        1,
  '12em12h':      2,
  '8em8h':        3,
  '6em6h':        4,
  '4em4h':        6,
  '1em1h':        24,
  'continuo':     1,
  'seNecessario': 1,
  'SOS':          1,
  '1x2dias':      1 / 2,
  '1x3dias':      1 / 3,
  '1xSemana':     1 / 7,
  '1x21dias':     1 / 21,
  '1x30dias':     1 / 30,
  '1x90dias':     1 / 90,
};

function calcularQuantidadeTotal(item) {
  const qtdPorDose = parseFloat(item.dosagem) || 1;
  const dias       = Math.max(Number(item.duracaoDias) || 1, 1);

  // Dose única: independe de duracaoDias
  if (item.frequencia === 'agora') return Math.ceil(qtdPorDose);

  const dosesPorDia = DOSES_POR_DIA[item.frequencia] ?? 1;
  return Math.ceil(qtdPorDose * dosesPorDia * dias);
}

async function deduzirEstoque(tx, itens, empresaId) {
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId) continue;

    const estoque = await tx.estoqueClinica.findFirst({
      where: {
        medicamentoId: item.medicamentoCatId,
        ...(empresaId ? { empresaId } : { empresaId: null }),
        ativo: true,
      },
    });

    if (!estoque) continue;

    const deduzir = calcularQuantidadeTotal(item);
    const nova    = Math.max(estoque.qtdEstoque - deduzir, 0);

    const descFreq = item.dosagem
      ? `${item.dosagem}${item.unidade ? ' ' + item.unidade : ''} × ${item.frequencia} × ${item.duracaoDias}d = ${deduzir}`
      : `${item.frequencia} × ${item.duracaoDias}d = ${deduzir}`;

    await tx.estoqueClinica.update({ where: { id: estoque.id }, data: { qtdEstoque: nova } });
    await tx.movimentoEstoque.create({
      data: {
        estoqueId:  estoque.id,
        tipo:       'SAIDA',
        quantidade: deduzir,
        motivo:     `Prescrição: ${descFreq}`,
      },
    });
  }
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
    const { animalId, empresaId, itens = [] } = req.body;
    const veterinarioId = req.user.id;

    if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório.' });
    if (!Array.isArray(itens) || itens.length === 0)
      return res.status(400).json({ error: 'Inclua ao menos um item na prescrição.' });

    const grupo = await prisma.$transaction(async (tx) => {
      const numero = await proximoNumero(tx, Number(animalId));

      const grp = await tx.prescricaoGrupo.create({
        data: {
          numero,
          animalId:     Number(animalId),
          veterinarioId,
          empresaId:    empresaId ? Number(empresaId) : null,
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

    const { tipo, medicamento, medicamentoCatId, dosagem, unidade, via, frequencia, duracaoDias, horaInicio, observacao, dataInicio } = req.body;

    if (!medicamento) return res.status(400).json({ error: 'Campo medicamento é obrigatório.' });

    const item = await prisma.prescricao.create({
      data: {
        animalId:         grupo.animalId,
        veterinarioId,
        grupoId,
        medicamentoCatId: medicamentoCatId ? Number(medicamentoCatId) : null,
        tipo:             tipo             ?? 'MEDICAMENTO',
        medicamento:      String(medicamento),
        dosagem:          dosagem          ?? null,
        unidade:          unidade          ?? null,
        via:              via              ?? 'Oral',
        frequencia:       frequencia       ?? '',
        duracaoDias:      Number(duracaoDias ?? 1),
        horaInicio:       horaInicio       ?? null,
        observacao:       observacao       ?? null,
        dataInicio:       dataInicio ? new Date(dataInicio) : new Date(),
        status:           'RASCUNHO',
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

    const { tipo, medicamento, medicamentoCatId, dosagem, unidade, via, frequencia, duracaoDias, horaInicio, observacao, dataInicio } = req.body;

    const data = {};
    if (tipo              !== undefined) data.tipo             = tipo;
    if (medicamento       !== undefined) data.medicamento      = String(medicamento);
    if (medicamentoCatId  !== undefined) data.medicamentoCatId = medicamentoCatId ? Number(medicamentoCatId) : null;
    if (dosagem           !== undefined) data.dosagem          = dosagem;
    if (unidade           !== undefined) data.unidade          = unidade;
    if (via               !== undefined) data.via              = via;
    if (frequencia        !== undefined) data.frequencia       = frequencia;
    if (duracaoDias       !== undefined) data.duracaoDias      = Number(duracaoDias);
    if (horaInicio        !== undefined) data.horaInicio       = horaInicio;
    if (observacao        !== undefined) data.observacao       = observacao;
    if (dataInicio        !== undefined) data.dataInicio       = new Date(dataInicio);
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
// Transita SALVO→FINALIZADO, deduz estoque, cria FaturaItems

const finalizar = async (req, res) => {
  try {
    const grupoId      = Number(req.params.id);
    const veterinarioId = req.user.id;

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: { itens: { where: { ativo: true }, include: { medicamentoCat: true } } },
    });

    if (!grupo)                 return res.status(404).json({ error: 'Prescrição não encontrada.' });
    if (grupo.status !== 'SALVO') return res.status(400).json({ error: 'Só é possível finalizar prescrições com status SALVO.' });
    if (grupo.itens.length === 0) return res.status(400).json({ error: 'A prescrição não possui itens ativos.' });

    await prisma.$transaction(async (tx) => {
      // Atualiza status dos itens para ATIVA
      await tx.prescricao.updateMany({
        where: { grupoId, ativo: true },
        data:  { status: 'ATIVA', veterinarioId },
      });

      // Atualiza status do grupo para FINALIZADO e responsável
      await tx.prescricaoGrupo.update({
        where: { id: grupoId },
        data:  { status: 'FINALIZADO', veterinarioId },
      });

      // Deduz estoque dos medicamentos
      await deduzirEstoque(tx, grupo.itens, grupo.empresaId);

      // Cria FaturaItems na fatura ABERTA do animal
      let fatura = await tx.fatura.findFirst({
        where: { animalId: grupo.animalId, status: 'ABERTA' },
      });
      if (!fatura) {
        fatura = await tx.fatura.create({ data: { animalId: grupo.animalId, status: 'ABERTA', total: 0 } });
      }

      for (const item of grupo.itens) {
        const descricao = item.tipo === 'MEDICAMENTO'
          ? `${item.medicamento}${item.dosagem ? ` ${item.dosagem}${item.unidade ?? ''}` : ''} — ${item.duracaoDias}d`
          : item.medicamento;

        await tx.faturaItem.create({
          data: {
            faturaId:     fatura.id,
            tipo:         item.tipo === 'MEDICAMENTO' ? 'MEDICAMENTO' : 'PROCEDIMENTO',
            descricao,
            valor:        0,
            quantidade:   1,
            veterinarioId,
          },
        });
      }
    });

    const grupoAtualizado = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
    return res.json({ dados: { ...grupoAtualizado, numeroFormatado: formatNumero(grupoAtualizado.numero) } });
  } catch (err) {
    console.error('PrescricaoGrupoController.finalizar:', err);
    return res.status(500).json({ error: 'Erro ao finalizar prescrição.' });
  }
};

// ─── Cancelar grupo ───────────────────────────────────────────────────────────

const cancelar = async (req, res) => {
  try {
    const grupoId = Number(req.params.id);

    const grupo = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId } });
    if (!grupo)                     return res.status(404).json({ error: 'Prescrição não encontrada.' });
    if (grupo.status === 'FINALIZADO') return res.status(400).json({ error: 'Prescrição finalizada não pode ser cancelada.' });

    await prisma.$transaction(async (tx) => {
      await tx.prescricao.updateMany({ where: { grupoId, ativo: true }, data: { status: 'CANCELADA' } });
      await tx.prescricaoGrupo.update({ where: { id: grupoId }, data: { status: 'CANCELADO' } });
    });

    return res.json({ dados: { message: 'Prescrição cancelada.' } });
  } catch (err) {
    console.error('PrescricaoGrupoController.cancelar:', err);
    return res.status(500).json({ error: 'Erro ao cancelar prescrição.' });
  }
};

// ─── Executar grupo ───────────────────────────────────────────────────────────
// Transita FINALIZADO → EXECUTADO; qualquer perfil autenticado pode executar

const executar = async (req, res) => {
  try {
    const grupoId = Number(req.params.id);

    const grupo = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId } });
    if (!grupo)                       return res.status(404).json({ error: 'Prescrição não encontrada.' });
    if (grupo.status !== 'FINALIZADO') return res.status(400).json({ error: 'Apenas prescrições FINALIZADAS podem ser marcadas como executadas.' });

    const grupoAtualizado = await prisma.prescricaoGrupo.update({
      where:   { id: grupoId },
      data:    { status: 'EXECUTADO' },
      include: GRUPO_INCLUDE,
    });

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

    // Hoje à meia-noite local (compara com dataInicio dos itens)
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    // Mantém apenas grupos onde pelo menos um item tem hoje dentro da janela de tratamento
    const dentroJanela = grupos.filter(g =>
      g.itens.some(item => {
        const inicio = new Date(item.dataInicio);
        inicio.setHours(0, 0, 0, 0);
        const fim = new Date(inicio);
        fim.setDate(fim.getDate() + Math.max(Number(item.duracaoDias) || 1, 1));
        return inicio <= hoje && hoje < fim;
      })
    );

    // Filtro de busca textual (nome animal, baia, nº prescrição, vet)
    let resultado = dentroJanela;
    if (busca?.trim()) {
      const q = busca.toLowerCase();
      resultado = dentroJanela.filter(g =>
        g.animal.nome.toLowerCase().includes(q) ||
        (g.animal.baia ?? '').toLowerCase().includes(q) ||
        String(g.numero).padStart(3, '0').includes(q) ||
        g.veterinario.fullName.toLowerCase().includes(q)
      );
    }

    // Adiciona diaAtual em cada item para exibição frontend
    const comDia = resultado.map(g => ({
      ...g,
      numeroFormatado: formatNumero(g.numero),
      itens: g.itens.map(item => {
        const inicio = new Date(item.dataInicio);
        inicio.setHours(0, 0, 0, 0);
        const diaAtual = Math.floor((hoje.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
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
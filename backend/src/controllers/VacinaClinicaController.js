// VacinaClinicaController.js — registro clínico de vacinas por animal
const prisma = require('../lib/prisma').default;

const INCLUDE_VACINA = {
  veterinario: { select: { id: true, fullName: true } },
  vacina: { select: { id: true, nome: true, fabricante: true, via: true } },
  loteVacina: { select: { id: true, lote: true, validade: true, qtdDisponivel: true } },
};

async function listarPorAnimal(req, res) {
  try {
    const { animalId } = req.params;
    const vacinas = await prisma.vacinaClinica.findMany({
      where: { animalId: Number(animalId), ativo: true },
      include: INCLUDE_VACINA,
      orderBy: { dataAplicacao: 'desc' },
    });
    res.json({ dados: vacinas });
  } catch (err) {
    console.error('listarPorAnimal vacinas:', err);
    res.status(500).json({ error: 'Erro ao listar vacinas' });
  }
}

// Catálogo ativo para dropdown clínico
async function listarCatalogoAtivo(req, res) {
  try {
    const vacinas = await prisma.vacina.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, fabricante: true, via: true },
    });
    res.json({ dados: vacinas });
  } catch (err) {
    console.error('listarCatalogoAtivo:', err);
    res.status(500).json({ error: 'Erro ao listar catálogo' });
  }
}

// Lotes disponíveis para uma vacina (com saldo > 0 e dentro da validade)
async function listarLotesDisponiveis(req, res) {
  try {
    const { vacinaId } = req.params;
    const { empresaId } = req.query;
    const hoje = new Date();

    const where = {
      vacinaId: Number(vacinaId),
      ativo: true,
      qtdDisponivel: { gt: 0 },
      validade: { gte: hoje },
    };
    if (empresaId) where.empresaId = Number(empresaId);

    const lotes = await prisma.loteVacina.findMany({
      where,
      orderBy: { validade: 'asc' },
      select: { id: true, lote: true, validade: true, qtdDisponivel: true, empresaId: true },
    });
    res.json({ dados: lotes });
  } catch (err) {
    console.error('listarLotesDisponiveis:', err);
    res.status(500).json({ error: 'Erro ao listar lotes' });
  }
}

async function registrar(req, res) {
  try {
    const veterinarioId = req.user.id;
    const {
      animalId, vacinaId, loteId,
      nome, fabricante, lote: loteNum,
      dose, via, dataAplicacao, dataReforco, observacao,
    } = req.body;

    if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório' });

    let nomeVacina = nome;
    let fabricanteVacina = fabricante;
    let loteNumFinal = loteNum;
    let viaFinal = via;

    if (vacinaId) {
      const vacinaData = await prisma.vacina.findUnique({ where: { id: Number(vacinaId) } });
      if (vacinaData) {
        nomeVacina = vacinaData.nome;
        fabricanteVacina = vacinaData.fabricante ?? fabricante;
        viaFinal = viaFinal ?? vacinaData.via;
      }
    }

    if (!nomeVacina?.trim()) return res.status(400).json({ error: 'Vacina é obrigatória' });

    if (loteId) {
      const loteData = await prisma.loteVacina.findUnique({ where: { id: Number(loteId) } });
      if (!loteData) return res.status(404).json({ error: 'Lote não encontrado' });
      if (loteData.qtdDisponivel <= 0) return res.status(400).json({ error: 'Lote sem saldo disponível' });
      if (loteData.validade && new Date(loteData.validade) < new Date()) {
        return res.status(400).json({ error: `Lote ${loteData.lote} está vencido (validade: ${new Date(loteData.validade).toLocaleDateString('pt-BR')}). Selecione um lote dentro da validade.` });
      }
      loteNumFinal = loteData.lote;

      await prisma.loteVacina.update({
        where: { id: Number(loteId) },
        data: { qtdDisponivel: loteData.qtdDisponivel - 1 },
      });
    }

    const criada = await prisma.vacinaClinica.create({
      data: {
        animalId: Number(animalId),
        veterinarioId,
        vacinaId: vacinaId ? Number(vacinaId) : null,
        loteId: loteId ? Number(loteId) : null,
        nome: nomeVacina.trim(),
        fabricante: fabricanteVacina?.trim() || null,
        lote: loteNumFinal?.trim() || null,
        dose: dose?.trim() || null,
        via: viaFinal?.trim() || null,
        dataAplicacao: dataAplicacao ? new Date(dataAplicacao) : new Date(),
        dataReforco: dataReforco ? new Date(dataReforco) : null,
        observacao: observacao?.trim() || null,
      },
      include: INCLUDE_VACINA,
    });

    res.status(201).json({ dados: criada });
  } catch (err) {
    console.error('registrar vacina:', err);
    res.status(500).json({ error: 'Erro ao registrar vacina' });
  }
}

async function excluir(req, res) {
  try {
    const { id } = req.params;
    const vacina = await prisma.vacinaClinica.findUnique({ where: { id: Number(id) } });
    if (!vacina) return res.status(404).json({ error: 'Registro não encontrado' });
    if (!vacina.ativo) return res.status(400).json({ error: 'Registro já está inativo' });

    // Restaura 1 dose ao lote se havia vínculo
    if (vacina.loteId) {
      const lote = await prisma.loteVacina.findUnique({ where: { id: vacina.loteId } });
      if (lote) {
        await prisma.loteVacina.update({
          where: { id: lote.id },
          data: { qtdDisponivel: lote.qtdDisponivel + 1 },
        });
      }
    }

    await prisma.vacinaClinica.update({
      where: { id: Number(id) },
      data: { ativo: false },
    });

    res.json({ mensagem: 'Registro removido com sucesso' });
  } catch (err) {
    console.error('excluir vacina:', err);
    res.status(500).json({ error: 'Erro ao remover registro' });
  }
}

module.exports = {
  listarPorAnimal,
  listarCatalogoAtivo,
  listarLotesDisponiveis,
  registrar,
  excluir,
};

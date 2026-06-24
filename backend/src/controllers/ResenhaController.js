const prismaLib = require('../lib/prisma');
const prisma = prismaLib.default ?? prismaLib;

async function obterPorAnimal(req, res) {
  const { animalId } = req.params;
  try {
    const resenha = await prisma.resenhaEquino.findFirst({
      where: { animalId: Number(animalId) },
    });
    return res.json({ data: resenha });
  } catch (err) {
    console.error('[ResenhaController.obterPorAnimal]', err);
    return res.status(500).json({ error: 'Erro ao buscar resenha' });
  }
}

async function salvar(req, res) {
  const {
    animalId,
    numeroCBH,
    paisNascimento,
    registroGenealogia,
    pai,
    mae,
    paiDaMae,
    sinaisCabeca,
    sinaisAE,
    sinaisAD,
    sinaisPE,
    sinaisPD,
    sinaisCorpo,
    marcaFogo,
    outroId,
    graficaData,
  } = req.body;

  const criadoPorId = req.user?.id ?? null;

  const data = {
    numeroCBH:          numeroCBH          ?? null,
    paisNascimento:     paisNascimento     ?? 'Brasil',
    registroGenealogia: registroGenealogia ?? null,
    pai:                pai                ?? null,
    mae:                mae                ?? null,
    paiDaMae:           paiDaMae           ?? null,
    sinaisCabeca:       sinaisCabeca       ?? null,
    sinaisAE:           sinaisAE           ?? null,
    sinaisAD:           sinaisAD           ?? null,
    sinaisPE:           sinaisPE           ?? null,
    sinaisPD:           sinaisPD           ?? null,
    sinaisCorpo:        sinaisCorpo        ?? null,
    marcaFogo:          marcaFogo          ?? null,
    outroId:            outroId            ?? null,
    graficaData:        graficaData        ?? undefined,
    criadoPorId,
    updatedAt:          new Date(),
  };

  try {
    let resenha;
    if (animalId) {
      resenha = await prisma.resenhaEquino.upsert({
        where: { animalId: Number(animalId) },
        update: data,
        create: { ...data, animalId: Number(animalId) },
      });
    } else {
      resenha = await prisma.resenhaEquino.create({ data });
    }
    return res.json({ data: resenha });
  } catch (err) {
    console.error('[ResenhaController.salvar]', err);
    return res.status(500).json({ error: 'Erro ao salvar resenha' });
  }
}

module.exports = { obterPorAnimal, salvar };

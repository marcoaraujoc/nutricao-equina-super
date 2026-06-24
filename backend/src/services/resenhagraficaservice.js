/**
 * resenhagraficaservice.js
 *
 * A detecção de "em qual região anatômica cada traço cai" é SEMPRE
 * recalculada aqui no backend — nunca confiamos no array enviado pelo
 * frontend, garantindo consistência entre relatórios e geometria desenhada.
 */

const prismaLib = require('../lib/prisma');
const prisma = prismaLib.default ?? prismaLib;

/**
 * Testa se um ponto [x, y] está dentro de um polígono via ray-casting.
 * Espelha exatamente a mesma lógica usada no frontend (useResenhaCanvas.ts).
 */
function pontoDentroDoPoligono(ponto, poligono) {
  const [x, y] = ponto;
  let dentro = false;

  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];

    const intersecta =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersecta) dentro = !dentro;
  }

  return dentro;
}

/**
 * Dado um traço (array de pontos [x,y]) e as regiões cadastradas para
 * uma vista, retorna quais regiões o traço toca e o percentual aproximado
 * de pontos que cai em cada uma.
 */
function detectarRegioesDoTraco(pontosTraco, regioesDaVista) {
  if (!pontosTraco?.length || !regioesDaVista?.length) return [];

  const contagemPorRegiao = new Map();

  for (const ponto of pontosTraco) {
    for (const regiao of regioesDaVista) {
      if (pontoDentroDoPoligono(ponto, regiao.poligono)) {
        contagemPorRegiao.set(regiao.id, (contagemPorRegiao.get(regiao.id) || 0) + 1);
      }
    }
  }

  const totalPontos = pontosTraco.length;

  return Array.from(contagemPorRegiao.entries()).map(([regiaoId, contagem]) => ({
    regiaoId,
    percentualOverlap: Math.round((contagem / totalPontos) * 10000) / 100,
  }));
}

/**
 * Busca (ou retorna null) o documento de resenha gráfica de um animal
 * para uma vista específica, incluindo as regiões anatômicas disponíveis.
 */
async function buscarOuCriarResenhaPorVista(animalId, vista) {
  const resenha = await prisma.resenhaGrafica.findUnique({
    where: { animalId_vista: { animalId, vista } },
    include: {
      tracosRegiao: {
        include: { regiao: true },
      },
    },
  });

  const regioesDaVista = await prisma.regiaoAnatomicaEquino.findMany({
    where: { vista, ativo: true },
    orderBy: { ordem: 'asc' },
  });

  return {
    resenha: resenha ?? null,
    regioesDisponiveis: regioesDaVista,
  };
}

/**
 * Salva (cria ou substitui) o documento de resenha gráfica de uma vista,
 * recalculando a relação traço → região no servidor antes de persistir.
 */
async function salvarResenhaGrafica({ animalId, vista, vetorTracos, snapshotPng, criadoPorId }) {
  const regioesDaVista = await prisma.regiaoAnatomicaEquino.findMany({
    where: { vista, ativo: true },
  });

  const regioesFormatadas = regioesDaVista.map((r) => ({
    id: r.id,
    poligono: r.poligono,
  }));

  return prisma.$transaction(async (tx) => {
    const resenha = await tx.resenhaGrafica.upsert({
      where: { animalId_vista: { animalId, vista } },
      update: {
        vetorTracos,
        snapshotPng,
        versao: { increment: 1 },
      },
      create: {
        animalId,
        vista,
        vetorTracos,
        snapshotPng,
        criadoPorId,
      },
    });

    await tx.resenhaTracoRegiao.deleteMany({
      where: { resenhaGraficaId: resenha.id },
    });

    const associacoes = [];
    vetorTracos.forEach((traco, tracoIndex) => {
      const regioesDetectadas = detectarRegioesDoTraco(traco.pontos, regioesFormatadas);
      for (const { regiaoId, percentualOverlap } of regioesDetectadas) {
        associacoes.push({
          resenhaGraficaId: resenha.id,
          tracoIndex,
          regiaoId,
          tipoMarcacao: traco.tipo,
          percentualOverlap,
        });
      }
    });

    if (associacoes.length > 0) {
      await tx.resenhaTracoRegiao.createMany({ data: associacoes });
    }

    return resenha;
  });
}

/**
 * Lista, para um animal, quais regiões anatômicas têm algum tipo de
 * marcação registrada — usado em relatórios e laudo consolidado.
 */
async function listarMarcacoesPorAnimal(animalId) {
  const tracos = await prisma.resenhaTracoRegiao.findMany({
    where: {
      resenhaGrafica: { animalId },
    },
    include: {
      regiao: true,
      resenhaGrafica: { select: { vista: true } },
    },
    orderBy: [{ resenhaGrafica: { vista: 'asc' } }, { regiao: { ordem: 'asc' } }],
  });

  return tracos.map((t) => ({
    vista: t.resenhaGrafica.vista,
    regiaoCodigo: t.regiao.codigo,
    regiaoLabel: t.regiao.labelPt,
    tipoMarcacao: t.tipoMarcacao,
    percentualOverlap: t.percentualOverlap,
  }));
}

module.exports = {
  pontoDentroDoPoligono,
  detectarRegioesDoTraco,
  buscarOuCriarResenhaPorVista,
  salvarResenhaGrafica,
  listarMarcacoesPorAnimal,
};

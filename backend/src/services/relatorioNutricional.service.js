// backend/src/services/relatorioNutricional.service.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/**
 * Determina o status nutricional com base no percentual de atendimento.
 */
const resolverStatus = (percentual) => {
  if (percentual === null) return 'SEM REFERÊNCIA';
  if (percentual <= 70)   return 'DEFICIÊNCIA CRÍTICA';
  if (percentual <= 90)   return 'DEFICIÊNCIA';
  if (percentual <= 120)  return 'ADEQUADO';
  if (percentual <= 200)  return 'EXCESSO';
  return 'EXCESSO CRÍTICO';
};

/**
 * Aproxima o peso do animal ao bucket mais próximo da tabela NRC.
 * Buckets disponíveis: 200, 400, 500 kg.
 */
const aproximarPesoNRC = (peso) => {
  const buckets = [200, 400, 500];
  return buckets.reduce((prev, curr) =>
    Math.abs(curr - peso) < Math.abs(prev - peso) ? curr : prev
  );
};

// -------------------------------------------------------------------
// Busca de dados
// -------------------------------------------------------------------

const buscarAnimal = async (animalId) => {
  const animal = await prisma.animal.findUnique({
    where: { id: Number(animalId) },
    include: {
      raca:    { select: { nome: true } },
      especie: { select: { nome: true } },
      user:    { select: { fullName: true, email: true } },
    },
  });
  if (!animal) throw new Error(`Animal ${animalId} não encontrado`);
  return animal;
};

const buscarPlanoAtivo = async (animalId) => {
  const plano = await prisma.planoDieta.findFirst({
    where: { animalId: Number(animalId), ativo: true },
    orderBy: { dataCriacao: 'desc' },
  });
  return plano;
};

const buscarItensDieta = async (planoDietaId) => {
  return prisma.dieta.findMany({
    where: { planoDietaId: Number(planoDietaId) },
    include: {
      alimento: {
        include: {
          composicoes: {
            include: { nutriente: true },
          },
        },
      },
    },
  });
};

const buscarExigenciasNRC = async (animal) => {
  const pesoAproximado = aproximarPesoNRC(animal.peso || 500);

  const exigencias = await prisma.exigenciasNRC.findMany({
    where: {
      peso:            pesoAproximado,
      categoriaAnimal: animal.categoriaAnimal ?? undefined,
      tipoExercicio:   animal.tipoExercicio   ?? undefined,
    },
    include: { nutriente: true },
  });

  // Mapa: nomeNutriente → { valorExigido, unidade }
  return exigencias.reduce((acc, ex) => {
    acc[ex.nutriente.nome] = {
      valorExigido: ex.valorExigido,
      unidade:      ex.unidade ?? ex.nutriente.unidadePadrao ?? '',
    };
    return acc;
  }, {});
};

// -------------------------------------------------------------------
// Computação do relatório
// -------------------------------------------------------------------

const computarRelatorio = async (animalId) => {
  const animal = await buscarAnimal(animalId);
  const plano  = await buscarPlanoAtivo(animalId);

  if (!plano) {
    return {
      animal: {
        id:              animal.id,
        nome:            animal.nome,
        peso:            animal.peso,
        categoriaAnimal: animal.categoriaAnimal,
        tipoExercicio:   animal.tipoExercicio,
      },
      plano:     null,
      alimentos: [],
      linhas:    [],
      aviso:     'Nenhum plano de dieta ativo encontrado para este animal.',
      geradoEm:  new Date().toISOString(),
    };
  }

  const [itensDieta, mapExigencias] = await Promise.all([
    buscarItensDieta(plano.id),
    buscarExigenciasNRC(animal),
  ]);

  // -------------------------------------------------------------------
  // Pivot: nutriente → { porAlimento, total }
  // -------------------------------------------------------------------
  const alimentosOrdenados = [];
  const tabelaNutrientes   = {};

  for (const item of itensDieta) {
    const nomeAlimento = item.alimento?.nome;
    if (!nomeAlimento) continue;

    if (!alimentosOrdenados.includes(nomeAlimento)) {
      alimentosOrdenados.push(nomeAlimento);
    }

    // Converte gramas/dia para kg (composição é por kg de alimento)
    const qtdKg = (item.qtdGramasDia || 0) / 1000;

    for (const comp of item.alimento?.composicoes ?? []) {
      const nomeNutriente = comp.nutriente?.nome;
      if (!nomeNutriente) continue;

      const valorProporcional = Number(comp.valorPorKg) * qtdKg;

      if (!tabelaNutrientes[nomeNutriente]) {
        tabelaNutrientes[nomeNutriente] = {
          nutriente:   nomeNutriente,
          unidade:     comp.nutriente.unidadePadrao || '',
          porAlimento: {},
          total:       0,
        };
      }

      tabelaNutrientes[nomeNutriente].porAlimento[nomeAlimento] =
        (tabelaNutrientes[nomeNutriente].porAlimento[nomeAlimento] || 0) + valorProporcional;
      tabelaNutrientes[nomeNutriente].total += valorProporcional;
    }
  }

  // -------------------------------------------------------------------
  // Monta linhas finais com colunas dinâmicas por alimento
  // -------------------------------------------------------------------
  const linhas = Object.values(tabelaNutrientes).map((entrada) => {
    const exigencia  = mapExigencias[entrada.nutriente];
    const exigido    = exigencia?.valorExigido ?? null;
    const saldo      = exigido !== null ? entrada.total - exigido : null;
    const percentual = exigido !== null && exigido > 0
      ? Number(((entrada.total / exigido) * 100).toFixed(2))
      : null;

    const linha = {
      nutriente: entrada.nutriente,
      unidade:   entrada.unidade,
    };

    // Colunas dinâmicas — um valor por alimento na dieta
    for (const nomeAlimento of alimentosOrdenados) {
      linha[nomeAlimento] = Number((entrada.porAlimento[nomeAlimento] || 0).toFixed(4));
    }

    linha.Total_Dieta         = Number(entrada.total.toFixed(4));
    linha.Exigido_NRC         = exigido;
    linha.Saldo               = saldo !== null ? Number(saldo.toFixed(4)) : null;
    linha.Percentual_Atendido = percentual;
    linha.status_nutricional  = resolverStatus(percentual);

    return linha;
  });

  return {
    animal: {
      id:              animal.id,
      nome:            animal.nome,
      peso:            animal.peso,
      categoriaAnimal: animal.categoriaAnimal,
      tipoExercicio:   animal.tipoExercicio,
    },
    plano: {
      id:   plano.id,
      nome: plano.nome,
      ativo: plano.ativo,
    },
    alimentos: alimentosOrdenados,
    linhas,
    geradoEm: new Date().toISOString(),
  };
};

module.exports = { computarRelatorio, resolverStatus };
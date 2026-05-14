// backend/src/services/relatorioNutricional.service.js
'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// -------------------------------------------------------------------
// Status nutricional
// -------------------------------------------------------------------

const resolverStatus = (percentual) => {
  if (percentual === null) return 'SEM REFERÊNCIA';
  if (percentual <= 70)   return 'DEFICIÊNCIA CRÍTICA';
  if (percentual <= 90)   return 'DEFICIÊNCIA';
  if (percentual <= 120)  return 'ADEQUADO';
  if (percentual <= 200)  return 'EXCESSO';
  return 'EXCESSO CRÍTICO';
};

const aproximarPesoNRC = (peso) => {
  const buckets = [200, 400, 500];
  return buckets.reduce((prev, curr) =>
    Math.abs(curr - peso) < Math.abs(prev - peso) ? curr : prev
  );
};

/**
 * Normaliza o nome do nutriente para agrupamento case-insensitive.
 * 'enxofre', 'Enxofre', 'ENXOFRE' → 'enxofre'
 * 'vitamina A', 'Vitamina A', 'VITAMINA A' → 'vitamina a'
 */
const normalizarNomeNutriente = (nome) =>
  (nome || '').trim().toLowerCase().normalize('NFC');

/**
 * Capitaliza apenas a primeira letra para exibição.
 * 'enxofre' → 'Enxofre' | 'Ácido Aspártico' → 'Ácido Aspártico'
 */
const capitalizarNome = (nome) => {
  if (!nome) return '';
  const n = nome.trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
};

// -------------------------------------------------------------------
// Conversão da quantidade de alimento na dieta → kg
// -------------------------------------------------------------------
const converterDietaParaKg = (qtd, unidade) => {
  const u = (unidade || '').toLowerCase().trim();

  if (u === 'kg'  || u === 'quilograma'  || u === 'quilogramas') return qtd;
  if (u === 'g'   || u === 'grama'       || u === 'gramas')      return qtd / 1000;
  if (u === 'mg'  || u === 'miligrama'   || u === 'miligramas')  return qtd / 1_000_000;
  if (u === 'l'   || u === 'litro'       || u === 'litros')      return qtd;
  if (u === 'ml'  || u === 'mililitro'   || u === 'mililitros')  return qtd / 1000;

  if (u === 'feixe' || u === 'feixe de capim')                   return qtd * 3;
  if (
    u === 'pão'           || u === 'pao'           ||
    u === 'pão de alfafa' || u === 'pao de alfafa' ||
    u === 'pão de feno'   || u === 'pao de feno'
  )                                                               return qtd * 3;

  console.warn(
    `[Relatório] Unidade de dieta não reconhecida: "${unidade}" (qtd=${qtd}) — tratando como kg.`
  );
  return qtd;
};

// -------------------------------------------------------------------
// Normalização de unidades de nutrientes
//
// REGRA GENERALISTA: sempre use normalizarUnidade() para comparar.
// Nunca compare strings brutas de unidade.
//
// Exemplos que normalizam para o mesmo token:
//   'UI', 'U.I.', 'U.I', 'IU'        → 'ui'
//   'mg', 'Mg', 'MG', 'Miligrama'    → 'mg'
//   'g', 'G', 'Grama', 'Gramas'      → 'g'
//   'Mcal', 'mcal', 'MCAL'           → 'mcal'
// -------------------------------------------------------------------
const normalizarUnidade = (unidade) => {
  // Remove pontos e espaços, lowercase: 'U.I.' → 'ui', 'Mcal' → 'mcal'
  const u = (unidade || '').toLowerCase().trim().replace(/\./g, '');

  if (['kg', 'quilograma', 'quilogramas'].includes(u))                return 'kg';
  if (['kg/dia', 'kg/day'].includes(u))                              return 'kg';
  if (['g', 'grama', 'gramas'].includes(u))                          return 'g';
  if (['mg', 'miligrama', 'miligramas'].includes(u))                 return 'mg';
  if (['mcg', 'µg', 'micrograma', 'microgramas', 'ug'].includes(u)) return 'mcg';
  if (['ui', 'iu', 'ui/kg'].includes(u))                            return 'ui';
  if (['mcal', 'mcal/kg'].includes(u))                               return 'mcal';
  if (['kcal'].includes(u))                                          return 'kcal';
  if (['ml', 'mililitro', 'mililitros'].includes(u))                 return 'ml';
  if (['l', 'litro', 'litros'].includes(u))                          return 'l';
  return u;
};

// Expoentes de massa (base 10): kg=3, g=0, mg=-3, mcg=-6
const MASSA_EXP = { kg: 3, g: 0, mg: -3, mcg: -6 };

// Unidades sem conversão inter-escala (UI, Mcal, ml, L)
const UNIDADES_SEM_CONVERSAO = new Set(['ui', 'mcal', 'kcal', 'ml', 'l']);

/**
 * Converte `valor` de `deUnidade` para `paraUnidade`.
 * Retorna null se a conversão não for possível.
 * Aceita unidades brutas (não normalizadas) — normaliza internamente.
 */
const converterUnidade = (valor, deUnidade, paraUnidade) => {
  if (valor === null || valor === undefined) return null;

  const de   = normalizarUnidade(deUnidade);
  const para = normalizarUnidade(paraUnidade);

  if (de === para) return valor;

  if (MASSA_EXP[de] !== undefined && MASSA_EXP[para] !== undefined) {
    return valor * Math.pow(10, MASSA_EXP[de] - MASSA_EXP[para]);
  }

  if (de === 'mcal' && para === 'kcal') return valor * 1000;
  if (de === 'kcal' && para === 'mcal') return valor / 1000;

  console.warn(`[Relatório] Conversão impossível: ${valor} ${deUnidade} → ${paraUnidade}`);
  return null;
};

/**
 * Determina a unidade canônica para acumular os valores de um nutriente.
 * Retorna o TOKEN NORMALIZADO (não a string bruta).
 *
 * Prioridade:
 *   1. Unidade normalizada do NRC (se compatível com a do nutriente)
 *   2. Token normalizado da unidade original do nutriente
 */
const resolverUnidadeCanonica = (unidadeNutriente, chaveNutriente, mapExigencias) => {
  const exigencia = mapExigencias[chaveNutriente];

  if (exigencia?.unidadeNRC) {
    const nrcNorm = normalizarUnidade(exigencia.unidadeNRC);
    const nutNorm = normalizarUnidade(unidadeNutriente);
    const ambosEmMassa = MASSA_EXP[nrcNorm] !== undefined && MASSA_EXP[nutNorm] !== undefined;
    const ambosEnergia = ['mcal', 'kcal'].includes(nrcNorm) && ['mcal', 'kcal'].includes(nutNorm);

    if (ambosEmMassa || ambosEnergia || nrcNorm === nutNorm) {
      return nrcNorm; // token normalizado da unidade NRC
    }
  }

  return normalizarUnidade(unidadeNutriente); // token normalizado da unidade original
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
  return prisma.planoDieta.findFirst({
    where:   { animalId: Number(animalId), ativo: true },
    orderBy: { dataCriacao: 'desc' },
  });
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

  // Indexa pelo nome normalizado para busca case-insensitive
  return exigencias.reduce((acc, ex) => {
    const chave = normalizarNomeNutriente(ex.nutriente.nome);
    acc[chave] = {
      valorExigido: ex.valorExigido,
      unidadeNRC:   ex.unidade ?? ex.nutriente.unidadePadrao ?? '',
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
  // Passo 1 — Soma o total diário de cada alimento em kg
  // -------------------------------------------------------------------
  const totalDiarioPorAlimento = new Map();

  for (const item of itensDieta) {
    const nomeAlimento = item.alimento?.nome;
    if (!nomeAlimento) continue;

    const qtdKg = converterDietaParaKg(item.qtdGramasDia || 0, item.unidade);

    if (!totalDiarioPorAlimento.has(item.alimentoId)) {
      totalDiarioPorAlimento.set(item.alimentoId, {
        alimentoId: item.alimentoId,
        nome:       nomeAlimento,
        totalKg:    0,
        alimento:   item.alimento,
      });
    }

    totalDiarioPorAlimento.get(item.alimentoId).totalKg += qtdKg;
  }

  // -------------------------------------------------------------------
  // Passo 2 — Pivot: nutriente → consumo por alimento e total diário
  //
  // REGRA GENERALISTA de unidades mistas:
  //
  //   A unidade do acumulador (`entrada.unidade`) é sempre um TOKEN
  //   NORMALIZADO (ex: 'ui', 'g', 'mg'). A comparação entre unidades
  //   SEMPRE usa tokens normalizados — nunca strings brutas.
  //
  //   Isso resolve:
  //     'UI' vs 'U.I.' vs 'IU'      → todos normalizam para 'ui' → mesma unidade
  //     'mg' vs 'Mg' vs 'Miligrama' → todos normalizam para 'mg' → mesma unidade
  //     'g'  vs 'mg'                → unidades diferentes de massa → converte para 'g'
  //
  //   Quando tokens normalizados diferem:
  //     Ambos de massa (kg/g/mg/mcg) → converte tudo para 'g'
  //     UI, Mcal, ml, L             → incompatível → loga e ignora
  // -------------------------------------------------------------------
  const alimentosOrdenados = [];
  const tabelaNutrientes   = {};

  for (const { nome: nomeAlimento, totalKg, alimento } of totalDiarioPorAlimento.values()) {
    if (!alimentosOrdenados.includes(nomeAlimento)) {
      alimentosOrdenados.push(nomeAlimento);
    }

    for (const comp of alimento?.composicoes ?? []) {
      const nomeNutriente    = comp.nutriente?.nome;
      const unidadeNutriente = comp.nutriente?.unidadePadrao ?? '';
      if (!nomeNutriente) continue;

      // Chave normalizada para agrupamento (case-insensitive)
      const chaveNutriente = normalizarNomeNutriente(nomeNutriente);

      // Token normalizado da unidade canônica para esta composição
      const tokenCanonico = resolverUnidadeCanonica(
        unidadeNutriente,
        chaveNutriente,
        mapExigencias,
      );

      // Converte valorPorKg da unidade original para o token canônico
      const valorPorKgCanonical = converterUnidade(
        Number(comp.valorPorKg),
        unidadeNutriente,
        tokenCanonico,
      );

      if (valorPorKgCanonical === null) {
        console.warn(
          `[Relatório] Não foi possível converter ${nomeNutriente}: ` +
          `${comp.valorPorKg} ${unidadeNutriente} → ${tokenCanonico}. ` +
          `Alimento: ${nomeAlimento}`
        );
        continue;
      }

      // Consumo desta composição no token canônico
      let consumo      = valorPorKgCanonical * totalKg;
      let tokenAtual   = tokenCanonico;

      if (!tabelaNutrientes[chaveNutriente]) {
        // Primeira vez — cria entrada com token normalizado como unidade
        tabelaNutrientes[chaveNutriente] = {
          nutriente:   capitalizarNome(nomeNutriente),
          unidade:     tokenAtual,  // já normalizado
          porAlimento: {},
          total:       0,
        };
      } else {
        // Entrada já existe — compara tokens normalizados (nunca strings brutas)
        const entrada   = tabelaNutrientes[chaveNutriente];
        const tokenAcc  = entrada.unidade; // já está normalizado

        if (tokenAcc !== tokenAtual) {
          // Tokens diferentes — aplica regra de reconciliação
          const ambosEmMassa =
            MASSA_EXP[tokenAcc] !== undefined && MASSA_EXP[tokenAtual] !== undefined;

          if (ambosEmMassa) {
            // ── Massa vs massa diferente → converte TUDO para 'g' ──

            // 1. Converte o que já foi acumulado para 'g'
            if (tokenAcc !== 'g') {
              const fator = Math.pow(10, MASSA_EXP[tokenAcc]); // tokenAcc → g
              entrada.total *= fator;
              for (const k of Object.keys(entrada.porAlimento)) {
                entrada.porAlimento[k] = (entrada.porAlimento[k] || 0) * fator;
              }
              entrada.unidade = 'g';
            }

            // 2. Converte o consumo atual para 'g'
            const fatorCur = Math.pow(10, MASSA_EXP[tokenAtual]); // tokenAtual → g
            consumo    = consumo * fatorCur;
            tokenAtual = 'g';

          } else if (UNIDADES_SEM_CONVERSAO.has(tokenAcc) || UNIDADES_SEM_CONVERSAO.has(tokenAtual)) {
            // UI, Mcal, ml, L — sem conversão entre escalas diferentes
            console.warn(
              `[Relatório] Unidades incompatíveis para "${nomeNutriente}": ` +
              `acumulador="${tokenAcc}", novo="${tokenAtual}" (${nomeAlimento}). ` +
              `Valor ignorado.`
            );
            continue;

          } else {
            // Tenta converter para a unidade do acumulador
            const converted = converterUnidade(consumo, tokenAtual, tokenAcc);
            if (converted !== null) {
              consumo    = converted;
              tokenAtual = tokenAcc;
            } else {
              console.warn(
                `[Relatório] Não foi possível reconciliar "${nomeNutriente}": ` +
                `"${tokenAtual}" → "${tokenAcc}". Valor ignorado.`
              );
              continue;
            }
          }
        }
        // Se tokenAcc === tokenAtual → mesma unidade, soma diretamente
      }

      const entrada = tabelaNutrientes[chaveNutriente];
      entrada.porAlimento[nomeAlimento] =
        (entrada.porAlimento[nomeAlimento] || 0) + consumo;
      entrada.total += consumo;
    }
  }

  // -------------------------------------------------------------------
  // Passo 3 — Cruza com NRC
  // A unidade do acumulador já está normalizada, então a comparação
  // com NRC também usa tokens normalizados via converterUnidade().
  // -------------------------------------------------------------------
  const linhas = Object.values(tabelaNutrientes).map((entrada) => {
    const chave     = normalizarNomeNutriente(entrada.nutriente);
    const exigencia = mapExigencias[chave];

    let exigidoNaUnidadeNutriente = null;
    let exigidoExibicao           = null;

    if (exigencia) {
      const convertido = converterUnidade(
        exigencia.valorExigido,
        exigencia.unidadeNRC,
        entrada.unidade,
      );

      if (convertido !== null) {
        exigidoNaUnidadeNutriente = convertido;
      } else {
        exigidoExibicao = `${exigencia.valorExigido} ${exigencia.unidadeNRC}`;
      }
    }

    const saldo = exigidoNaUnidadeNutriente !== null
      ? Number((entrada.total - exigidoNaUnidadeNutriente).toFixed(4))
      : null;

    const percentual = exigidoNaUnidadeNutriente !== null && exigidoNaUnidadeNutriente > 0
      ? Number(((entrada.total / exigidoNaUnidadeNutriente) * 100).toFixed(2))
      : null;

    const linha = {
      nutriente: entrada.nutriente,
      unidade:   entrada.unidade,
    };

    for (const nomeAlimento of alimentosOrdenados) {
      linha[nomeAlimento] = Number(
        (entrada.porAlimento[nomeAlimento] || 0).toFixed(4)
      );
    }

    linha.Total_Dieta         = Number(entrada.total.toFixed(4));
    linha.Exigido_NRC         = exigidoNaUnidadeNutriente !== null
      ? Number(exigidoNaUnidadeNutriente.toFixed(4))
      : exigidoExibicao ?? null;
    linha.Saldo               = saldo;
    linha.Percentual_Atendido = percentual;
    linha.status_nutricional  = resolverStatus(percentual);

    return linha;
  });

  // Ordena alfabeticamente pelo nome do nutriente (pt-BR, ignora acentos)
  linhas.sort((a, b) =>
    a.nutriente.localeCompare(b.nutriente, 'pt-BR', { sensitivity: 'base' })
  );

  return {
    animal: {
      id:              animal.id,
      nome:            animal.nome,
      peso:            animal.peso,
      categoriaAnimal: animal.categoriaAnimal,
      tipoExercicio:   animal.tipoExercicio,
    },
    plano: {
      id:    plano.id,
      nome:  plano.nome,
      ativo: plano.ativo,
    },
    alimentos: alimentosOrdenados,
    linhas,
    geradoEm: new Date().toISOString(),
  };
};

module.exports = { computarRelatorio, resolverStatus };
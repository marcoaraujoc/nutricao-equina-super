// backend/src/services/relatorioNutricional.service.js
'use strict';

const { PrismaClient } = require('@prisma/client');
const { getCalculator } = require('./speciesCalculatorRegistry');

const prisma = new PrismaClient();

// ─── Status nutricional ───────────────────────────────────────────────────────

const resolverStatus = (percentual) => {
  if (percentual === null) return 'SEM REFERÊNCIA';
  if (percentual < 70)    return 'DEFICIÊNCIA CRÍTICA';
  if (percentual < 90)    return 'DEFICIÊNCIA';
  if (percentual <= 120)  return 'ADEQUADO';
  if (percentual <= 200)  return 'EXCESSO';
  return 'EXCESSO CRÍTICO';
};

// ─── Helpers de normalização ──────────────────────────────────────────────────

const normalizarNomeNutriente = (nome) =>
  (nome || '').trim().toLowerCase().normalize('NFC');

const capitalizarNome = (nome) => {
  if (!nome) return '';
  const n = nome.trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
};

// ─── Conversão quantidade de dieta → kg ──────────────────────────────────────

const converterDietaParaKg = (qtd, unidade) => {
  const u = (unidade || '').toLowerCase().trim();
  if (['kg', 'quilograma', 'quilogramas'].includes(u))  return qtd;
  if (['g', 'grama', 'gramas'].includes(u))             return qtd / 1000;
  if (['mg', 'miligrama', 'miligramas'].includes(u))    return qtd / 1_000_000;
  if (['l', 'litro', 'litros'].includes(u))             return qtd;
  if (['ml', 'mililitro', 'mililitros'].includes(u))    return qtd / 1000;
  if (u === 'feixe' || u === 'feixe de capim')          return qtd * 3;
  if (['pão', 'pao', 'pão de alfafa', 'pao de alfafa',
       'pão de feno', 'pao de feno'].includes(u))       return qtd * 3;
  console.warn(`[Relatório] Unidade não reconhecida: "${unidade}" — tratando como kg.`);
  return qtd;
};

// ─── Normalização de unidades ─────────────────────────────────────────────────

const normalizarUnidade = (unidade) => {
  const u = (unidade || '').toLowerCase().trim().replace(/\./g, '');
  if (['kg', 'quilograma', 'quilogramas'].includes(u))                return 'kg';
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

const MASSA_EXP = { kg: 3, g: 0, mg: -3, mcg: -6 };
const UNIDADES_SEM_CONVERSAO = new Set(['ui', 'mcal', 'kcal', 'ml', 'l']);

const converterUnidade = (valor, deUnidade, paraUnidade) => {
  if (valor === null || valor === undefined) return null;
  const de   = normalizarUnidade(deUnidade);
  const para = normalizarUnidade(paraUnidade);
  if (de === para) return valor;
  if (MASSA_EXP[de] !== undefined && MASSA_EXP[para] !== undefined)
    return valor * Math.pow(10, MASSA_EXP[de] - MASSA_EXP[para]);
  if (de === 'mcal' && para === 'kcal') return valor * 1000;
  if (de === 'kcal' && para === 'mcal') return valor / 1000;
  console.warn(`[Relatório] Conversão impossível: ${valor} ${deUnidade} → ${paraUnidade}`);
  return null;
};

const resolverUnidadeCanonica = (unidadeNutriente, chaveNutriente, mapExigencias) => {
  const exigencia = mapExigencias[chaveNutriente];
  if (exigencia?.unidadeNRC) {
    const nrcNorm = normalizarUnidade(exigencia.unidadeNRC);
    const nutNorm = normalizarUnidade(unidadeNutriente);
    const ambosEmMassa = MASSA_EXP[nrcNorm] !== undefined && MASSA_EXP[nutNorm] !== undefined;
    const ambosEnergia = ['mcal','kcal'].includes(nrcNorm) && ['mcal','kcal'].includes(nutNorm);
    if (ambosEmMassa || ambosEnergia || nrcNorm === nutNorm) return nrcNorm;
  }
  return normalizarUnidade(unidadeNutriente);
};

// ─── Busca de dados ───────────────────────────────────────────────────────────

const buscarAnimal = async (animalId) => {
  const animal = await prisma.animal.findUnique({
    where:   { id: Number(animalId) },
    include: {
      raca:    { select: { nome: true } },
      especie: { select: { id: true, nome: true } },
      user:    { select: { fullName: true, email: true } },
    },
  });
  if (!animal) throw new Error(`Animal ${animalId} não encontrado`);
  return animal;
};

const buscarPlanoAtivo = async (animalId) =>
  prisma.planoDieta.findFirst({
    where:   { animalId: Number(animalId), ativo: true },
    orderBy: { dataCriacao: 'desc' },
  });

const buscarItensDieta = async (planoDietaId) =>
  prisma.dieta.findMany({
    where:   { planoDietaId: Number(planoDietaId) },
    include: {
      alimento: {
        include: { composicoes: { include: { nutriente: true } } },
      },
    },
  });

// ─── Resolução de exigências — multi-espécie ──────────────────────────────────

/**
 * Retorna o mapa de exigências no formato:
 *   { [nomeNutrienteNormalizado]: { valorExigido: number, unidadeNRC: string } }
 *
 * Prioridade:
 *   1. Calculadora dinâmica (ex: NRC 2007 para equinos)
 *   2. Tabela tb_exigencias_nrc (fallback para outras espécies)
 */
const resolverExigencias = async (animal) => {
  const especieNome  = animal.especie?.nome || '';
  const calculadora  = getCalculator(especieNome);

  if (calculadora) {
    const map = calculadora.calcular(animal);
    return { map, fonte: calculadora.FONTE };
  }

  // Fallback: tabela estática (outras espécies)
  const exigencias = await prisma.exigenciasNRC.findMany({
    where: {
      especieId:       animal.especie?.id ?? undefined,
      categoriaAnimal: animal.categoriaAnimal ?? undefined,
      tipoExercicio:   animal.tipoExercicio   ?? undefined,
    },
    include: { nutriente: true },
  });

  const map = exigencias.reduce((acc, ex) => {
    const chave = normalizarNomeNutriente(ex.nutriente.nome);
    acc[chave] = {
      valorExigido: ex.valorExigido,
      unidadeNRC:   ex.unidade ?? ex.nutriente.unidadePadrao ?? '',
    };
    return acc;
  }, {});

  return { map, fonte: 'TABELA' };
};

// ─── Salvar snapshot ──────────────────────────────────────────────────────────

/**
 * Salva o relatório como snapshot histórico em tb_relatorios_salvos.
 * Falha silenciosamente — não deve interromper a geração do relatório.
 */
const salvarSnapshot = async (animalId, planoDietaId, resultado, fonteCalculo, animal) => {
  try {
    await prisma.relatorioSalvo.create({
      data: {
        animalId:      Number(animalId),
        planoDietaId:  planoDietaId ? Number(planoDietaId) : null,
        payload:       JSON.stringify(resultado),
        fonteCalculo,
        pesoCalculado: animal.peso,
        categoriaUsada: animal.categoriaAnimal,
        especieNome:   animal.especie?.nome,
      },
    });
  } catch (err) {
    // Tabela pode não existir ainda (migration pendente) — silencioso
    if (!err.message?.includes('does not exist') && !err.code === 'P2021') {
      console.warn('[Relatório] Não foi possível salvar snapshot:', err.message);
    }
  }
};

// ─── Computação principal ─────────────────────────────────────────────────────

const computarRelatorio = async (animalId, { salvar = true } = {}) => {
  const animal = await buscarAnimal(animalId);
  const plano  = await buscarPlanoAtivo(animalId);

  if (!plano) {
    return {
      animal:    { id: animal.id, nome: animal.nome, peso: animal.peso,
                   especie: animal.especie?.nome, categoriaAnimal: animal.categoriaAnimal },
      plano:     null,
      alimentos: [],
      linhas:    [],
      aviso:     'Nenhum plano de dieta ativo encontrado para este animal.',
      geradoEm:  new Date().toISOString(),
    };
  }

  const [itensDieta, { map: mapExigencias, fonte: fonteCalculo }] = await Promise.all([
    buscarItensDieta(plano.id),
    resolverExigencias(animal),
  ]);

  // ── Passo 1: total diário por alimento em kg ──────────────────────────────

  const totalDiarioPorAlimento = new Map();
  for (const item of itensDieta) {
    const nomeAlimento = item.alimento?.nome;
    if (!nomeAlimento) continue;
    const qtdKg = converterDietaParaKg(item.qtdGramasDia || 0, item.unidade);
    if (!totalDiarioPorAlimento.has(item.alimentoId)) {
      totalDiarioPorAlimento.set(item.alimentoId, {
        alimentoId: item.alimentoId, nome: nomeAlimento, totalKg: 0, alimento: item.alimento,
      });
    }
    totalDiarioPorAlimento.get(item.alimentoId).totalKg += qtdKg;
  }

  // ── Passo 2: pivot nutriente × alimento ──────────────────────────────────

  const alimentosOrdenados = [];
  const tabelaNutrientes   = {};

  for (const { nome: nomeAlimento, totalKg, alimento } of totalDiarioPorAlimento.values()) {
    if (!alimentosOrdenados.includes(nomeAlimento)) alimentosOrdenados.push(nomeAlimento);

    for (const comp of alimento?.composicoes ?? []) {
      const nomeNutriente    = comp.nutriente?.nome;
      const unidadeNutriente = comp.nutriente?.unidadePadrao ?? '';
      if (!nomeNutriente) continue;

      const chaveNutriente = normalizarNomeNutriente(nomeNutriente);
      const tokenCanonico  = resolverUnidadeCanonica(unidadeNutriente, chaveNutriente, mapExigencias);

      const valorPorKgCanonical = converterUnidade(Number(comp.valorPorKg), unidadeNutriente, tokenCanonico);
      if (valorPorKgCanonical === null) {
        console.warn(`[Relatório] Conversão impossível: ${nomeNutriente} ${comp.valorPorKg} ${unidadeNutriente} → ${tokenCanonico}`);
        continue;
      }

      let consumo    = valorPorKgCanonical * totalKg;
      let tokenAtual = tokenCanonico;

      if (!tabelaNutrientes[chaveNutriente]) {
        tabelaNutrientes[chaveNutriente] = {
          nutriente: capitalizarNome(nomeNutriente),
          unidade:   tokenAtual, porAlimento: {}, total: 0,
        };
      } else {
        const entrada  = tabelaNutrientes[chaveNutriente];
        const tokenAcc = entrada.unidade;
        if (tokenAcc !== tokenAtual) {
          const ambosEmMassa = MASSA_EXP[tokenAcc] !== undefined && MASSA_EXP[tokenAtual] !== undefined;
          if (ambosEmMassa) {
            if (tokenAcc !== 'g') {
              const fator = Math.pow(10, MASSA_EXP[tokenAcc]);
              entrada.total *= fator;
              for (const k of Object.keys(entrada.porAlimento)) entrada.porAlimento[k] = (entrada.porAlimento[k] || 0) * fator;
              entrada.unidade = 'g';
            }
            consumo    = consumo * Math.pow(10, MASSA_EXP[tokenAtual]);
            tokenAtual = 'g';
          } else if (UNIDADES_SEM_CONVERSAO.has(tokenAcc) || UNIDADES_SEM_CONVERSAO.has(tokenAtual)) {
            console.warn(`[Relatório] Unidades incompatíveis: "${nomeNutriente}" acc="${tokenAcc}" novo="${tokenAtual}". Ignorado.`);
            continue;
          } else {
            const converted = converterUnidade(consumo, tokenAtual, tokenAcc);
            if (converted !== null) { consumo = converted; tokenAtual = tokenAcc; }
            else { console.warn(`[Relatório] Reconciliação impossível "${nomeNutriente}". Ignorado.`); continue; }
          }
        }
      }

      const entrada = tabelaNutrientes[chaveNutriente];
      entrada.porAlimento[nomeAlimento] = (entrada.porAlimento[nomeAlimento] || 0) + consumo;
      entrada.total += consumo;
    }
  }

  // ── Passo 3: cruzamento com exigências NRC ────────────────────────────────

  const linhas = Object.values(tabelaNutrientes).map((entrada) => {
    const chave     = normalizarNomeNutriente(entrada.nutriente);
    const exigencia = mapExigencias[chave];

    let exigidoNaUnidade = null;
    let exigidoExibicao  = null;

    if (exigencia) {
      const convertido = converterUnidade(exigencia.valorExigido, exigencia.unidadeNRC, entrada.unidade);
      if (convertido !== null) exigidoNaUnidade = convertido;
      else exigidoExibicao = `${exigencia.valorExigido} ${exigencia.unidadeNRC}`;
    }

    const saldo      = exigidoNaUnidade !== null
      ? Number((entrada.total - exigidoNaUnidade).toFixed(4))
      : null;
    const percentual = exigidoNaUnidade !== null && exigidoNaUnidade > 0
      ? Number(((entrada.total / exigidoNaUnidade) * 100).toFixed(2))
      : null;

    const linha = { nutriente: entrada.nutriente, unidade: entrada.unidade };
    for (const nomeAlimento of alimentosOrdenados) {
      linha[nomeAlimento] = Number((entrada.porAlimento[nomeAlimento] || 0).toFixed(4));
    }
    linha.Total_Dieta         = Number(entrada.total.toFixed(4));
    linha.Exigido_NRC         = exigidoNaUnidade !== null
      ? Number(exigidoNaUnidade.toFixed(4))
      : (exigidoExibicao ?? null);
    linha.Saldo               = saldo;
    linha.Percentual_Atendido = percentual;
    linha.status_nutricional  = resolverStatus(percentual);
    return linha;
  });

  linhas.sort((a, b) => a.nutriente.localeCompare(b.nutriente, 'pt-BR', { sensitivity: 'base' }));

  const resultado = {
    animal: {
      id: animal.id, nome: animal.nome, peso: animal.peso,
      especie: animal.especie?.nome, categoriaAnimal: animal.categoriaAnimal,
      tipoExercicio: animal.tipoExercicio,
    },
    plano:     { id: plano.id, nome: plano.nome, ativo: plano.ativo },
    fonteCalculo,
    alimentos: alimentosOrdenados,
    linhas,
    geradoEm:  new Date().toISOString(),
  };

  // ── Salvar snapshot histórico ─────────────────────────────────────────────
  if (salvar && linhas.length > 0) {
    await salvarSnapshot(animalId, plano.id, resultado, fonteCalculo, animal);
  }

  return resultado;
};

// ─── Buscar histórico de snapshots ───────────────────────────────────────────

const listarSnapshots = async (animalId, limite = 10) => {
  try {
    const registros = await prisma.relatorioSalvo.findMany({
      where:   { animalId: Number(animalId) },
      orderBy: { geradoEm: 'desc' },
      take:    limite,
      select:  {
        id: true, geradoEm: true, fonteCalculo: true,
        pesoCalculado: true, categoriaUsada: true, especieNome: true,
      },
    });
    return registros;
  } catch {
    return [];
  }
};

const buscarSnapshot = async (snapshotId) => {
  try {
    const reg = await prisma.relatorioSalvo.findUnique({ where: { id: Number(snapshotId) } });
    if (!reg) return null;
    return { ...reg, payload: JSON.parse(reg.payload) };
  } catch {
    return null;
  }
};

module.exports = { computarRelatorio, resolverStatus, listarSnapshots, buscarSnapshot };
// backend/src/services/financeiroLLMService.js
// IA FINANCEIRA — análise gerencial do período para a empresa do contexto ativo.
//
// Não persiste nada por cliente: lê os indicadores já apurados por
// RelatoriosController.computarFinanceiro (fonte única de cálculo — desconto de
// item, escopo por empresa e janela do período já vêm resolvidos de lá) e
// devolve highlights + análise textual.
//
// A IA aqui DESCREVE e COMPARA números. Ela é proibida de recomendar ação,
// projetar cenário ou qualificar o resultado (ver prompt 'analise_financeira').
'use strict';

const { callAI, MODULOS_IA } = require('../ai');
const { buildPrompt }        = require('../ai/prompts');

const TIPOS_HIGHLIGHT = new Set(['FATURAMENTO', 'INADIMPLENCIA', 'CONCENTRACAO', 'MARGEM', 'TICKET']);
const DIRECOES        = new Set(['aumento', 'reducao', 'estavel', 'nao_aplicavel']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(2)) : 0);

// Compacta os indicadores para o prompt: só o que a análise usa, arredondado.
// Enviar o payload inteiro do relatório encareceria a chamada sem ganho.
function compactar(dados) {
  const top = (lista, chave) => (Array.isArray(lista) ? lista : [])
    .slice(0, 6)
    .map(x => ({ [chave]: x[chave], receita: num(x.receita) }));

  return {
    faturamentoPeriodo:  num(dados.faturamento?.periodo),
    faturamentoAno:      num(dados.faturamento?.ano),
    granularidade:       dados.faturamento?.granularidade ?? null,
    ticketPorAtendimento: num(dados.ticketMedio?.porAtendimento),
    ticketPorCliente:     num(dados.ticketMedio?.porCliente),
    atendimentosPeriodo:  dados.ticketMedio?.atendimentosPeriodo ?? 0,
    clientesPeriodo:      dados.ticketMedio?.clientesPeriodo ?? 0,
    receitaPorCategoria:     top(dados.porCategoria, 'categoria'),
    receitaPorEspecialidade: top(dados.porEspecialidade, 'especialidade'),
    contasReceber:   num(dados.contasReceber),
    contasVencidas:  num(dados.contasVencidas),
    inadimplenciaPct: num(dados.inadimplencia),
    custoProdutos:   num(dados.lucroBruto?.custoProdutos),
    lucroBruto:      num(dados.lucroBruto?.lucro),
    margemPct:       num(dados.lucroBruto?.margemPct),
  };
}

// Comparativo com os meses já recebidos (fluxo de caixa realizado) — dá ao
// modelo uma base factual de variação sem precisar de nova query.
function comparativo(dados) {
  const historico = Array.isArray(dados.fluxoCaixa?.historico) ? dados.fluxoCaixa.historico : [];
  return {
    mediaMensalRecebida: num(dados.fluxoCaixa?.mediaMensal),
    mesesRecebidos: historico.map(h => ({ mes: h.mes, valor: num(h.valor) })),
  };
}

function normalizarHighlights(brutos) {
  const saida = [];
  for (const h of Array.isArray(brutos) ? brutos : []) {
    const texto = String(h?.texto ?? '').trim();
    if (!texto) continue;
    saida.push({
      texto:   texto.slice(0, 200),
      tipo:    TIPOS_HIGHLIGHT.has(h?.tipo) ? h.tipo    : 'FATURAMENTO',
      direcao: DIRECOES.has(h?.direcao)     ? h.direcao : 'nao_aplicavel',
      valor:   typeof h?.valor === 'number' && Number.isFinite(h.valor) ? h.valor : null,
    });
    if (saida.length === 5) break;
  }
  return saida;
}

/**
 * Gera a análise financeira do período.
 *
 * @param {Object} req            — request (para escopo, contexto e log)
 * @param {Object} dados          — saída de RelatoriosController.computarFinanceiro
 * @param {string} periodoLabel   — descrição do período analisado
 * @returns {Promise<{ highlights: Array, analise: string[] }>}
 */
async function analisarFinanceiro(req, dados, periodoLabel) {
  const indicadores = compactar(dados);

  // Sem movimento no período não há o que analisar — evita gastar IA para
  // receber "não houve registro".
  if (indicadores.faturamentoPeriodo === 0 && indicadores.contasReceber === 0) {
    return { highlights: [], analise: [], semDados: true };
  }

  const { operacaoVers, prompt } = buildPrompt('analise_financeira', {
    periodo:     periodoLabel,
    indicadores,
    comparativo: comparativo(dados),
  });

  const respostaTexto = await callAI({
    operacao:    operacaoVers,
    modulo:      MODULOS_IA.FINANCEIRO,
    prompt,
    maxTokens:   1200,
    temperature: 0.2,
    userId:      req.user?.id ?? null,
    empresaId:   req.empresaId ?? null,
  });

  const jsonMatch = (respostaTexto ?? '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM não retornou JSON');

  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch { throw new Error('LLM retornou JSON inválido'); }

  const analise = (Array.isArray(parsed.analise) ? parsed.analise : [])
    .map(p => String(p ?? '').trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    highlights: normalizarHighlights(parsed.highlights),
    analise,
    semDados:   false,
  };
}

module.exports = { analisarFinanceiro };

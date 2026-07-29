// src/services/aiLogger.service.js
// Logging centralizado de uso de LLM. Toda chamada de IA do S2Vet passa por aqui
// — é a fonte do relatório de consumo em /ai-usage.
//
// Provider único: Google Gemini (ver src/ai/geminiClient.ts).

const prisma = require('../lib/prisma').default;

// ─── Tabela de preços por modelo (USD por 1M tokens) ─────────────────────────
// Atualizar conforme o pricing do Google.

const PRECOS = {
  'gemini-1.5-flash':      { entrada: 0.075, saida: 0.30  },
  'gemini-1.5-flash-8b':   { entrada: 0.0375, saida: 0.15 },
  'gemini-1.5-pro':        { entrada: 1.25,  saida: 5.00  },
  'gemini-2.0-flash':      { entrada: 0.10,  saida: 0.40  },
  'gemini-2.5-flash':      { entrada: 0.15,  saida: 0.60  },
  'gemini-2.5-pro':        { entrada: 1.25,  saida: 10.00 },

  // ⚠️ CONFIRMAR na tabela oficial antes de confiar no custo em R$ do dashboard.
  // Valores abaixo assumem o tier "flash-lite". Enquanto não confirmados, o
  // número de CHAMADAS e de TOKENS no relatório continua exato — só a coluna de
  // custo depende desta tabela.
  'gemini-3.1-flash-lite': { entrada: 0.10,  saida: 0.40  },
  'gemini-flash-lite-latest': { entrada: 0.10, saida: 0.40 },

  // Fallback para modelos não mapeados
  'default':               { entrada: 0.10,  saida: 0.40  },
};

// ─── Estimativa de tokens ─────────────────────────────────────────────────────
// Aproximação: 1 token ≈ 3,5 caracteres em português.
// Usada apenas quando a API não devolve a contagem exata.

const estimarTokens = (texto) => {
  if (!texto) return 0;
  return Math.ceil(texto.length / 3.5);
};

// ─── Cálculo de custo ─────────────────────────────────────────────────────────

const calcularCustoUsd = (modelo, tokensEntrada, tokensSaida) => {
  const preco = PRECOS[modelo] ?? PRECOS['default'];
  const custoEntrada = (tokensEntrada / 1_000_000) * preco.entrada;
  const custoSaida   = (tokensSaida  / 1_000_000) * preco.saida;
  return Number((custoEntrada + custoSaida).toFixed(8));
};

// ─── Função principal de logging ──────────────────────────────────────────────

/**
 * Registra uma chamada de LLM no banco de dados.
 *
 * @param {Object}  params
 * @param {string}  params.operacao      — chave do prompt + versão (ex: 'parse_laudo@v5')
 * @param {string}  params.modulo        — módulo de origem (ver MODULOS_IA em src/ai)
 * @param {string}  params.modelo        — nome do modelo usado
 * @param {string}  [params.provedor]    — 'google'
 * @param {string}  params.promptTexto   — texto do prompt (estima tokens se a API não devolver)
 * @param {string}  params.respostaTexto — texto da resposta
 * @param {number}  [params.tokensEntradaApi] — tokens devolvidos pela API (mais preciso)
 * @param {number}  [params.tokensSaidaApi]   — tokens devolvidos pela API (mais preciso)
 * @param {number}  params.latenciaMs    — tempo da chamada em ms
 * @param {number}  [params.userId]
 * @param {number}  [params.animalId]
 * @param {number}  [params.empresaId] — cliente (tenant) a quem o consumo é atribuído
 * @param {boolean} [params.sucesso]
 * @param {string}  [params.erroMensagem]
 */
const logAiUsage = async ({
  operacao,
  modulo    = 'OUTROS',
  modelo,
  provedor  = 'google',
  promptTexto,
  respostaTexto,
  tokensEntradaApi,
  tokensSaidaApi,
  latenciaMs,
  userId    = null,
  animalId  = null,
  empresaId = null,
  sucesso   = true,
  erroMensagem = null,
}) => {
  try {
    const tokensEntrada = tokensEntradaApi ?? estimarTokens(promptTexto);
    const tokensSaida   = tokensSaidaApi   ?? estimarTokens(respostaTexto);
    const tokensTotal   = tokensEntrada + tokensSaida;
    const custoUsd      = calcularCustoUsd(modelo, tokensEntrada, tokensSaida);

    await prisma.aiUsageLog.create({
      data: {
        operacao,
        modulo,
        modelo,
        provedor,
        tokensEntrada,
        tokensSaida,
        tokensTotal,
        custoUsd,
        latenciaMs,
        userId,
        animalId,
        empresaId,
        sucesso,
        erroMensagem,
      },
    });
  } catch (err) {
    // Logging nunca pode quebrar o fluxo principal
    console.error('[aiLogger] Erro ao salvar log de uso de IA:', err.message);
  }
};

module.exports = { logAiUsage, estimarTokens, calcularCustoUsd, PRECOS };

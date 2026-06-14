// src/services/aiLogger.service.js
// Helper centralizado para logging de uso de LLM
// Usar em qualquer serviço que chame uma LLM

const prisma = require('../lib/prisma').default;

// ─── Tabela de preços por modelo (USD por 1M tokens) ─────────────────────────
// Atualizar conforme mudanças de pricing dos provedores

const PRECOS = {
  // Groq
  'llama-3.3-70b-versatile':  { entrada: 0.59,  saida: 0.79  },
  'llama-3.1-70b-versatile':  { entrada: 0.59,  saida: 0.79  },
  'llama-3.1-8b-instant':     { entrada: 0.05,  saida: 0.08  },
  'llama3-70b-8192':          { entrada: 0.59,  saida: 0.79  },
  'llama3-8b-8192':           { entrada: 0.05,  saida: 0.08  },
  'mixtral-8x7b-32768':       { entrada: 0.24,  saida: 0.24  },
  'gemma2-9b-it':             { entrada: 0.20,  saida: 0.20  },

  // OpenAI
  'gpt-4o':                   { entrada: 2.50,  saida: 10.00 },
  'gpt-4o-mini':              { entrada: 0.15,  saida: 0.60  },
  'gpt-4-turbo':              { entrada: 10.00, saida: 30.00 },
  'gpt-3.5-turbo':            { entrada: 0.50,  saida: 1.50  },

  // Anthropic
  'claude-3-haiku-20240307':  { entrada: 0.25,  saida: 1.25  },
  'claude-3-sonnet-20240229': { entrada: 3.00,  saida: 15.00 },
  'claude-3-opus-20240229':   { entrada: 15.00, saida: 75.00 },

  // Anthropic (modelos recentes)
  'claude-haiku-4-5-20251001':  { entrada: 0.80,  saida: 4.00  },
  'claude-sonnet-4-6':          { entrada: 3.00,  saida: 15.00 },
  'claude-opus-4-8':            { entrada: 15.00, saida: 75.00 },

  // OpenAI (modelos recentes)
  'gpt-4o-mini':               { entrada: 0.15,  saida: 0.60  },

  // Google Gemini
  'gemini-2.5-flash':          { entrada: 0.15,  saida: 0.60  },
  'gemini-2.5-pro':            { entrada: 1.25,  saida: 10.00 },
  'gemini-1.5-flash':          { entrada: 0.075, saida: 0.30  },
  'gemini-1.5-pro':            { entrada: 1.25,  saida: 5.00  },
  'gemini-2.0-flash':          { entrada: 0.10,  saida: 0.40  },

  // Fallback para modelos não mapeados
  'default':                  { entrada: 0.59,  saida: 0.79  },
};

// ─── Estimativa de tokens ─────────────────────────────────────────────────────
// Aproximação: 1 token ≈ 4 caracteres em inglês / 3 em português
// Usar quando a API não retorna contagem exata de tokens

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
 * @param {Object} params
 * @param {'parse_laudo'|'relatorio_nutricional'|'parse_composicao'|string} params.operacao
 * @param {string}  params.modelo        — nome do modelo usado
 * @param {string}  [params.provedor]    — 'groq' | 'openai' | 'anthropic' | 'ollama'
 * @param {string}  params.promptTexto   — texto do prompt (para estimar tokens se API não retornar)
 * @param {string}  params.respostaTexto — texto da resposta
 * @param {number}  [params.tokensEntradaApi] — tokens retornados pela API (mais preciso)
 * @param {number}  [params.tokensSaidaApi]   — tokens retornados pela API (mais preciso)
 * @param {number}  params.latenciaMs    — tempo da chamada em ms
 * @param {number}  [params.userId]
 * @param {number}  [params.animalId]
 * @param {boolean} [params.sucesso]
 * @param {string}  [params.erroMensagem]
 */
const logAiUsage = async ({
  operacao,
  modelo,
  provedor = 'groq',
  promptTexto,
  respostaTexto,
  tokensEntradaApi,
  tokensSaidaApi,
  latenciaMs,
  userId    = null,
  animalId  = null,
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
        modelo,
        provedor,
        tokensEntrada,
        tokensSaida,
        tokensTotal,
        custoUsd,
        latenciaMs,
        userId,
        animalId,
        sucesso,
        erroMensagem,
      },
    });
  } catch (err) {
    // Logging nunca pode quebrar o fluxo principal
    console.error('[aiLogger] Erro ao salvar log de uso de IA:', err.message);
  }
};

// ─── Wrapper para chamadas Groq ───────────────────────────────────────────────
// Envolve uma chamada fetch ao Groq e loga automaticamente

/**
 * Executa uma chamada à API Groq e loga o uso automaticamente.
 *
 * @param {Object} params
 * @param {string} params.operacao
 * @param {string} params.prompt
 * @param {string} [params.modelo]
 * @param {number} [params.maxTokens]
 * @param {number} [params.temperature]
 * @param {number} [params.userId]
 * @param {number} [params.animalId]
 * @returns {Promise<string>} — texto da resposta
 */
const chamarGroqComLog = async ({
  operacao,
  prompt,
  modelo       = 'llama-3.3-70b-versatile',
  maxTokens    = 2000,
  temperature  = 0.1,
  userId       = null,
  animalId     = null,
}) => {
  const inicio = Date.now();
  let sucesso      = true;
  let erroMensagem = null;
  let respostaTexto = '';
  let tokensEntradaApi = null;
  let tokensSaidaApi   = null;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:       modelo,
        messages:    [{ role: 'user', content: prompt }],
        temperature,
        max_tokens:  maxTokens,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Groq API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    respostaTexto    = data.choices?.[0]?.message?.content ?? '';
    tokensEntradaApi = data.usage?.prompt_tokens     ?? null;
    tokensSaidaApi   = data.usage?.completion_tokens ?? null;

    return respostaTexto;

  } catch (err) {
    sucesso      = false;
    erroMensagem = err.message;
    throw err;

  } finally {
    const latenciaMs = Date.now() - inicio;
    await logAiUsage({
      operacao,
      modelo,
      provedor: 'groq',
      promptTexto:      prompt,
      respostaTexto,
      tokensEntradaApi,
      tokensSaidaApi,
      latenciaMs,
      userId,
      animalId,
      sucesso,
      erroMensagem,
    });
  }
};

module.exports = { logAiUsage, chamarGroqComLog, estimarTokens, calcularCustoUsd };
// src/ai/geminiClient.ts
// Cliente único do Google Gemini — TODO acesso a LLM do S2Vet passa por aqui
// (texto, visão e áudio). Trocar de modelo = alterar MODELO_PADRAO.
//
// Não usar `fetch` direto para a API do Gemini em nenhum outro arquivo: o log de
// uso (AiUsageLog) depende dos tokens que só este cliente devolve normalizados.

// Modelo único de toda a aplicação, sobrescrevível por ambiente (GEMINI_MODEL).
//
// ATENÇÃO — 'gemini-1.5-flash' foi RETIRADO da API pelo Google: chaves novas
// recebem 404 "is not found for API version v1beta". O default abaixo é o flash
// estável equivalente. Se a sua chave ainda tiver acesso à família 1.5 (projetos
// legados), basta definir GEMINI_MODEL=gemini-1.5-flash no .env — nenhum código
// precisa mudar. Ao trocar o modelo, acrescente o preço dele em
// services/aiLogger.service.js#PRECOS, senão o custo cai no fallback 'default'.
export const MODELO_PADRAO = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
export const PROVEDOR      = 'google';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiPart {
  text?:       string;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiOpcoes {
  modelo?:      string;
  maxTokens?:   number;
  temperature?: number;
  /** Teto por chamada, em ms. Ver TIMEOUT_MS. */
  timeoutMs?:   number;
}

/**
 * Teto de uma chamada ao provedor.
 *
 * 🔴 SEM ELE O `fetch` NÃO TINHA TETO NENHUM (2026-09-19). Quando o Gemini satura, a
 * resposta 503 chega LENTA: o log de IA registrou 91,8 s numa leitura de documento
 * que, minutos antes, levara 12,4 s — eram duas chamadas de ~45 s esperando por um
 * erro. Sem teto não há pior caso, e quem paga a espera é a pessoa parada na tela.
 * ⚠️ Folgado de propósito: a leitura de 4 páginas é o caminho mais caro do sistema e
 * roda em ~12 s. O teto existe para conter o provedor travado, não para cortar
 * trabalho legítimo — apertá-lo transformaria documento grande em falha.
 * ⚠️ Estourar o teto é FALHA TRANSITÓRIA (`ai/retentativa.js` reconhece o
 * `TimeoutError`): é o mesmo evento do 503, visto do nosso lado do fio.
 */
export const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 60_000;

export interface GeminiResultado {
  text:          string;
  tokensEntrada: number | null;
  tokensSaida:   number | null;
  modelo:        string;
  provedor:      string;
}

interface GeminiResposta {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Chamada crua ao generateContent. `parts` aceita texto e/ou inlineData
 * (imagem, áudio) — é o mesmo endpoint para as três modalidades.
 */
export async function gerarConteudo(
  parts: GeminiPart[],
  opts:  GeminiOpcoes = {},
): Promise<GeminiResultado> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');

  const modelo = opts.modelo ?? MODELO_PADRAO;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${modelo}:generateContent?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      // Provedor travado não pode prender a requisição da pessoa para sempre.
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature:     opts.temperature ?? 0.1,
          maxOutputTokens: opts.maxTokens   ?? 2000,
        },
      }),
    });
  } catch (err) {
    // A mensagem do abort ("The operation was aborted due to timeout") não diz quem
    // demorou nem quanto. Quem investiga o log precisa dos dois.
    const e = err as { name?: string };
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      const t = new Error(`Gemini API timeout: o provedor demorou demais para responder (${opts.timeoutMs ?? TIMEOUT_MS}ms, modelo ${modelo})`);
      t.name = 'TimeoutError';
      throw t;
    }
    throw err;
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as GeminiResposta;

  return {
    text:          data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    tokensEntrada: data.usageMetadata?.promptTokenCount     ?? null,
    tokensSaida:   data.usageMetadata?.candidatesTokenCount ?? null,
    modelo,
    provedor:      PROVEDOR,
  };
}

/** Atalho para completions de texto puro. */
export function gerarTexto(prompt: string, opts: GeminiOpcoes = {}): Promise<GeminiResultado> {
  return gerarConteudo([{ text: prompt }], opts);
}

/** Transcrição de áudio (substitui o Whisper). `buffer` é o arquivo já em memória. */
export function transcreverAudio(
  buffer:   Buffer,
  mimeType: string,
  opts:     GeminiOpcoes = {},
): Promise<GeminiResultado> {
  return gerarConteudo(
    [
      { text: 'Transcreva o áudio em português do Brasil. Devolva apenas a transcrição literal, sem comentários, sem marcação de tempo, sem identificação de locutor.' },
      { inlineData: { mimeType, data: buffer.toString('base64') } },
    ],
    { temperature: 0, maxTokens: 4000, ...opts },
  );
}

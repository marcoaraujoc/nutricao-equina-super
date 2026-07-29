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
}

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

  const response = await fetch(`${API_BASE}/${modelo}:generateContent?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature:     opts.temperature ?? 0.1,
        maxOutputTokens: opts.maxTokens   ?? 2000,
      },
    }),
  });

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

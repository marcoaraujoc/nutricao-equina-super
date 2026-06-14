// src/ai/providers/GeminiProvider.ts
import type { AIProvider, AICompletionOptions, AICompletionResult } from '../types';

export class GeminiProvider implements AIProvider {
  readonly name         = 'gemini';
  readonly defaultModel = 'gemini-2.0-flash';

  async complete(prompt: string, opts: AICompletionOptions = {}): Promise<AICompletionResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');

    const modelo      = opts.modelo      ?? this.defaultModel;
    const maxTokens   = opts.maxTokens   ?? 2000;
    const temperature = opts.temperature ?? 0.1;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    return {
      text,
      tokensEntradaApi:  data.usageMetadata?.promptTokenCount     ?? null,
      tokensSaidaApi:    data.usageMetadata?.candidatesTokenCount ?? null,
      provedor:          this.name,
      modelo,
    };
  }
}

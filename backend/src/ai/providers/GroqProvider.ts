// src/ai/providers/GroqProvider.ts
import type { AIProvider, AICompletionOptions, AICompletionResult } from '../types';

export class GroqProvider implements AIProvider {
  readonly name         = 'groq';
  readonly defaultModel = 'llama-3.3-70b-versatile';

  async complete(prompt: string, opts: AICompletionOptions = {}): Promise<AICompletionResult> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY não configurada');

    const modelo     = opts.modelo      ?? this.defaultModel;
    const maxTokens  = opts.maxTokens   ?? 2000;
    const temperature = opts.temperature ?? 0.1;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
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

    const data = await response.json() as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      text:              data.choices?.[0]?.message?.content ?? '',
      tokensEntradaApi:  data.usage?.prompt_tokens     ?? null,
      tokensSaidaApi:    data.usage?.completion_tokens ?? null,
      provedor:          this.name,
      modelo,
    };
  }
}
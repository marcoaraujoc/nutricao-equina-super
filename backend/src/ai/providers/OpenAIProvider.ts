// src/ai/providers/OpenAIProvider.ts
import type { AIProvider, AICompletionOptions, AICompletionResult } from '../types';

export class OpenAIProvider implements AIProvider {
  readonly name         = 'openai';
  readonly defaultModel = 'gpt-4o-mini';

  async complete(prompt: string, opts: AICompletionOptions = {}): Promise<AICompletionResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY não configurada');

    const modelo      = opts.modelo      ?? this.defaultModel;
    const maxTokens   = opts.maxTokens   ?? 2000;
    const temperature = opts.temperature ?? 0.1;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
      throw new Error(`OpenAI API error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?:  { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      text:             data.choices?.[0]?.message?.content ?? '',
      tokensEntradaApi: data.usage?.prompt_tokens     ?? null,
      tokensSaidaApi:   data.usage?.completion_tokens ?? null,
      provedor:         this.name,
      modelo,
    };
  }
}

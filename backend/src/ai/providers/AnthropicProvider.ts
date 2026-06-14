// src/ai/providers/AnthropicProvider.ts
import type { AIProvider, AICompletionOptions, AICompletionResult } from '../types';

export class AnthropicProvider implements AIProvider {
  readonly name         = 'anthropic';
  readonly defaultModel = 'claude-haiku-4-5-20251001';

  async complete(prompt: string, opts: AICompletionOptions = {}): Promise<AICompletionResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');

    const modelo      = opts.modelo      ?? this.defaultModel;
    const maxTokens   = opts.maxTokens   ?? 2000;
    const temperature = opts.temperature ?? 0.1;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      modelo,
        max_tokens: maxTokens,
        temperature,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
      usage?:  { input_tokens?: number; output_tokens?: number };
    };

    const text = data.content?.find(c => c.type === 'text')?.text ?? '';

    return {
      text,
      tokensEntradaApi: data.usage?.input_tokens  ?? null,
      tokensSaidaApi:   data.usage?.output_tokens ?? null,
      provedor:         this.name,
      modelo,
    };
  }
}

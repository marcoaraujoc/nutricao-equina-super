// src/ai/providers/GeminiProvider.ts
// Único provider ativo do S2Vet. Toda a inferência roda no Google Gemini —
// ver src/ai/geminiClient.ts (modelo, tokens e endpoint ficam lá).

import type { AIProvider, AICompletionOptions, AICompletionResult } from '../types';
import { gerarTexto, MODELO_PADRAO, PROVEDOR } from '../geminiClient';

export class GeminiProvider implements AIProvider {
  readonly name         = PROVEDOR;
  readonly defaultModel = MODELO_PADRAO;

  async complete(prompt: string, opts: AICompletionOptions = {}): Promise<AICompletionResult> {
    const r = await gerarTexto(prompt, {
      modelo:      opts.modelo,
      maxTokens:   opts.maxTokens,
      temperature: opts.temperature,
    });

    return {
      text:             r.text,
      tokensEntradaApi: r.tokensEntrada,
      tokensSaidaApi:   r.tokensSaida,
      provedor:         r.provedor,
      modelo:           r.modelo,
    };
  }
}

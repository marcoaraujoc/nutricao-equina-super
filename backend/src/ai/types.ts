// src/ai/types.ts
// Interface que todos os provedores de IA devem implementar.
// Trocar de Groq para OpenAI/Gemini/Anthropic = implementar esta interface.

export interface AICompletionOptions {
  modelo?:      string;
  maxTokens?:   number;
  temperature?: number;
}

export interface AICompletionResult {
  text:              string;
  tokensEntradaApi?: number | null;
  tokensSaidaApi?:   number | null;
  provedor:          string;
  modelo:            string;
}

export interface AIProvider {
  readonly name: string;
  readonly defaultModel: string;
  complete(prompt: string, opts?: AICompletionOptions): Promise<AICompletionResult>;
}
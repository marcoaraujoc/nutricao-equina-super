// src/ai/types.ts
// Interface que todos os provedores de IA devem implementar.
// Provider ativo: Google Gemini. Para trocar/empilhar outro fornecedor,
// implemente esta interface e registre-o em src/ai/index.ts (buildChain).

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
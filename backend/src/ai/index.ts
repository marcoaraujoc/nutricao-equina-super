// src/ai/index.ts
// Factory + callAI() — ponto único de entrada para inferência de texto.
//
// Para adicionar um novo provider:
//   1. Criar src/ai/providers/XyzProvider.ts implementando AIProvider
//   2. Adicionar case 'xyz' em getProvider()
//   3. Definir AI_PROVIDER=xyz no .env

import type { AIProvider, AICompletionOptions } from './types';
import { GroqProvider } from './providers/GroqProvider';
import { logAiUsage }  from '../services/aiLogger.service';

// ── Singleton do provider ──────────────────────────────────────────────────────

let _provider: AIProvider | null = null;

export function getProvider(): AIProvider {
  if (_provider) return _provider;

  const driver = (process.env.AI_PROVIDER ?? 'groq').toLowerCase();
  switch (driver) {
    case 'groq':
      _provider = new GroqProvider();
      break;
    default:
      throw new Error(`AI_PROVIDER "${driver}" não reconhecido. Providers disponíveis: groq`);
  }
  return _provider;
}

// ── callAI() — wrapper com logging automático ──────────────────────────────────

export interface CallAIOptions extends AICompletionOptions {
  operacao:  string;
  prompt:    string;
  userId?:   number | null;
  animalId?: number | null;
}

/**
 * Executa uma chamada de texto ao provider ativo e loga automaticamente em AiUsageLog.
 * Substitui chamarGroqComLog() — provider-agnostic.
 *
 * @returns texto da resposta do modelo
 */
export async function callAI({
  operacao,
  prompt,
  userId   = null,
  animalId = null,
  ...opts
}: CallAIOptions): Promise<string> {
  const provider   = getProvider();
  const inicio     = Date.now();
  let sucesso      = true;
  let erroMensagem: string | null = null;
  let respostaTexto = '';
  let tokensEntradaApi: number | null = null;
  let tokensSaidaApi:   number | null = null;
  let modelo = opts.modelo ?? provider.defaultModel;

  try {
    const result = await provider.complete(prompt, opts);
    respostaTexto    = result.text;
    tokensEntradaApi = result.tokensEntradaApi ?? null;
    tokensSaidaApi   = result.tokensSaidaApi   ?? null;
    modelo           = result.modelo;
    return respostaTexto;

  } catch (err: unknown) {
    sucesso      = false;
    erroMensagem = err instanceof Error ? err.message : String(err);
    throw err;

  } finally {
    await logAiUsage({
      operacao,
      modelo,
      provedor:         provider.name,
      promptTexto:      prompt,
      respostaTexto,
      tokensEntradaApi: tokensEntradaApi ?? undefined,
      tokensSaidaApi:   tokensSaidaApi   ?? undefined,
      latenciaMs:       Date.now() - inicio,
      userId:           userId           ?? undefined,
      animalId:         animalId         ?? undefined,
      sucesso,
      erroMensagem:     erroMensagem     ?? undefined,
    });
  }
}
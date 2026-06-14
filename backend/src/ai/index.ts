// src/ai/index.ts
// Ponto único de entrada para inferência de texto.
// Chain de fallback: Gemini → OpenAI → Claude → Groq
// Pula automaticamente qualquer provider sem API key configurada.

import type { AIProvider, AICompletionOptions } from './types';
import { GeminiProvider }    from './providers/GeminiProvider';
import { OpenAIProvider }    from './providers/OpenAIProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { GroqProvider }      from './providers/GroqProvider';
import { logAiUsage }        from '../services/aiLogger.service';

// ── Chain de providers ─────────────────────────────────────────────────────────
// Constrói a lista de providers configurados na ordem de preferência.
// Adicionar novo provider: criar XyzProvider.ts e adicionar condição aqui.

function buildChain(): AIProvider[] {
  const chain: AIProvider[] = [];
  if (process.env.GEMINI_API_KEY)    chain.push(new GeminiProvider());
  if (process.env.OPENAI_API_KEY)    chain.push(new OpenAIProvider());
  if (process.env.ANTHROPIC_API_KEY) chain.push(new AnthropicProvider());
  if (process.env.GROQ_API_KEY)      chain.push(new GroqProvider());
  return chain;
}

// ── callAI() ──────────────────────────────────────────────────────────────────

export interface CallAIOptions extends AICompletionOptions {
  operacao:  string;
  prompt:    string;
  userId?:   number | null;
  animalId?: number | null;
}

/**
 * Executa inferência de texto com fallback automático entre providers.
 * Ordem: Gemini → OpenAI → Claude → Groq (apenas os que tiverem API key configurada).
 * Loga o uso em AiUsageLog.
 */
export async function callAI({
  operacao,
  prompt,
  userId   = null,
  animalId = null,
  ...opts
}: CallAIOptions): Promise<string> {
  const chain = buildChain();

  if (chain.length === 0) {
    throw new Error(
      'Nenhum provider de IA configurado. ' +
      'Defina pelo menos uma chave: GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY ou GROQ_API_KEY'
    );
  }

  const inicio     = Date.now();
  const tentativas: string[] = [];

  for (const provider of chain) {
    try {
      const result = await provider.complete(prompt, opts);

      // Loga o uso do provider bem-sucedido
      await logAiUsage({
        operacao,
        modelo:           result.modelo,
        provedor:         result.provedor,
        promptTexto:      prompt,
        respostaTexto:    result.text,
        tokensEntradaApi: result.tokensEntradaApi ?? undefined,
        tokensSaidaApi:   result.tokensSaidaApi   ?? undefined,
        latenciaMs:       Date.now() - inicio,
        userId:           userId   ?? undefined,
        animalId:         animalId ?? undefined,
        sucesso:          true,
      });

      if (tentativas.length > 0) {
        console.info(
          `[AI] Fallback ativado: ${provider.name} respondeu ` +
          `(falhas anteriores: ${tentativas.join(', ')})`
        );
      }

      return result.text;

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AI] Provider "${provider.name}" falhou: ${msg}`);
      tentativas.push(provider.name);
    }
  }

  // Todos falharam — loga o erro e lança
  const erroFinal = `Todos os providers de IA falharam: [${tentativas.join(', ')}]`;

  await logAiUsage({
    operacao,
    modelo:        'none',
    provedor:      tentativas.join(','),
    promptTexto:   prompt,
    respostaTexto: '',
    latenciaMs:    Date.now() - inicio,
    userId:        userId   ?? undefined,
    animalId:      animalId ?? undefined,
    sucesso:       false,
    erroMensagem:  erroFinal,
  }).catch(() => {});

  throw new Error(erroFinal);
}

// Mantido para compatibilidade — retorna o primeiro provider configurado
export function getProvider(): AIProvider {
  const chain = buildChain();
  if (chain.length === 0) throw new Error('Nenhum provider de IA configurado');
  return chain[0];
}

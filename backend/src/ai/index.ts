// src/ai/index.ts
// Ponto único de entrada para inferência de texto.
//
// Provider ÚNICO: Google Gemini (gemini-1.5-flash) — ver geminiClient.ts.
// A interface AIProvider continua existindo para não acoplar o domínio ao
// fornecedor; para voltar a ter fallback, basta implementar outro provider e
// empilhá-lo em buildChain().

import type { AIProvider, AICompletionOptions } from './types';
import { GeminiProvider } from './providers/GeminiProvider';
import { logAiUsage }     from '../services/aiLogger.service';

// Gate de consumo por cliente (conta única + metering). require() porque o serviço
// é JS e precisa ser carregado de forma preguiçosa — evita ciclo com lib/prisma.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { garantirQuota } = require('../services/iaQuotaService');

// ── Módulos que consomem IA ───────────────────────────────────────────────────
// Toda chamada precisa declarar o módulo de origem — é o que alimenta o
// relatório de consumo (/ai-usage) com "quem chamou".

export const MODULOS_IA = {
  ATENDIMENTO:     'ATENDIMENTO',
  MEMORIA_CLINICA: 'MEMORIA_CLINICA',
  FINANCEIRO:      'FINANCEIRO',
  EXAMES:          'EXAMES',
  NUTRICAO:        'NUTRICAO',
  AGENDA:          'AGENDA',
  TRANSCRICAO:     'TRANSCRICAO',
  DOCUMENTOS:      'DOCUMENTOS',
} as const;

export type ModuloIA = typeof MODULOS_IA[keyof typeof MODULOS_IA];

// ── Chain de providers ────────────────────────────────────────────────────────

function buildChain(): AIProvider[] {
  const chain: AIProvider[] = [];
  if (process.env.GEMINI_API_KEY) chain.push(new GeminiProvider());
  return chain;
}

// ── callAI() ──────────────────────────────────────────────────────────────────

export interface CallAIOptions extends AICompletionOptions {
  operacao:   string;
  modulo:     ModuloIA | string;
  prompt:     string;
  userId?:    number | null;
  animalId?:  number | null;
  /** Cliente (tenant) a quem o consumo é atribuído. Sempre req.empresaId. */
  empresaId?: number | null;
}

/**
 * Executa inferência de texto no Gemini e loga o uso em AiUsageLog.
 */
export async function callAI({
  operacao,
  modulo,
  prompt,
  userId    = null,
  animalId  = null,
  empresaId = null,
  ...opts
}: CallAIOptions): Promise<string> {
  const chain = buildChain();

  if (chain.length === 0) {
    throw new Error('IA indisponível: defina GEMINI_API_KEY no ambiente.');
  }

  // Gate ANTES de gastar token. Lança QuotaIaExcedidaError (code IA_QUOTA_EXCEDIDA)
  // quando a empresa estourou o plano — o controller traduz para HTTP 429.
  await garantirQuota(empresaId);

  const inicio               = Date.now();
  const tentativas: string[] = [];

  for (const provider of chain) {
    try {
      const result = await provider.complete(prompt, opts);

      await logAiUsage({
        operacao,
        modulo,
        modelo:           result.modelo,
        provedor:         result.provedor,
        promptTexto:      prompt,
        respostaTexto:    result.text,
        tokensEntradaApi: result.tokensEntradaApi ?? undefined,
        tokensSaidaApi:   result.tokensSaidaApi   ?? undefined,
        latenciaMs:       Date.now() - inicio,
        userId:           userId    ?? undefined,
        animalId:         animalId  ?? undefined,
        empresaId:        empresaId ?? undefined,
        sucesso:          true,
      });

      return result.text;

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AI] Provider "${provider.name}" falhou: ${msg}`);
      tentativas.push(provider.name);
    }
  }

  const erroFinal = `Falha na chamada de IA: [${tentativas.join(', ')}]`;

  await logAiUsage({
    operacao,
    modulo,
    modelo:        'none',
    provedor:      tentativas.join(','),
    promptTexto:   prompt,
    respostaTexto: '',
    latenciaMs:    Date.now() - inicio,
    userId:        userId    ?? undefined,
    animalId:      animalId  ?? undefined,
    empresaId:     empresaId ?? undefined,
    sucesso:       false,
    erroMensagem:  erroFinal,
  }).catch(() => {});

  throw new Error(erroFinal);
}

// Mantido para compatibilidade — retorna o provider configurado
export function getProvider(): AIProvider {
  const chain = buildChain();
  if (chain.length === 0) throw new Error('IA indisponível: defina GEMINI_API_KEY no ambiente.');
  return chain[0];
}

/**
 * laudoEquinoExtracao.service — transforma o texto de uma evolução clínica equina
 * num `ResultadoSessao`/`ResumoAtendimento` validado. Camada AI ORCHESTRATION:
 * consome o prompt versionado do catálogo (`ai/prompts`) e o domínio
 * (`s2vet-clinica.model` / `resumo-atendimento.model`), nunca o contrário.
 *
 * Nota sobre o superRefine de `registroClinicoSchema`: o zod invalida o parse
 * inteiro sempre que `ctx.addIssue` roda, mesmo com `fatal:false` — então a
 * checagem de lateralidade×paridade documentada como "soft" no domínio na
 * prática DERRUBA o parse se usada como gate de aceitação. Este serviço usa um
 * schema estrutural equivalente sem o refine como gate (retry só acontece em
 * erro estrutural real) e reaplica a mesma checagem como função pura que só
 * anota `necessitaRevisao`/`avisos`, honrando a intenção original sem travar
 * ditados legítimos (ex.: "joelho" sem lado dito).
 */
import { z } from 'zod';
import * as promptsModule from '../ai/prompts';
import { callAI } from '../ai';
import {
  resultadoSessaoSchema,
  achadoExameSchema,
  avaliacaoFuncionalSchema,
  terapiaAplicadaSchema,
  type ResultadoSessao,
  type RegistroClinico,
} from '../models/anatomia-equina/s2vet-clinica.model';
import { PARTES_EQUINAS } from '../models/anatomia-equina/anatomia-equina.taxonomy';
import {
  resumoClinicoSchema,
  type ResumoAtendimento,
} from '../models/anatomia-equina/resumo-atendimento.model';

const buildPrompt = promptsModule.buildPrompt as (
  key: string,
  vars: unknown
) => { operacaoVers: string; prompt: string };

const PROMPT_KEY = 'extrair_resultado_sessao_equino';
const MAX_TENTATIVAS = 2;

// Gate estrutural — ver nota de topo sobre por que não usa `registroClinicoSchema` direto.
const registroSemRefino = z.discriminatedUnion('kind', [
  achadoExameSchema,
  avaliacaoFuncionalSchema,
  terapiaAplicadaSchema,
]);
const resultadoSessaoParser = z.object({
  registros: z.array(registroSemRefino),
  completo: z.boolean().default(true),
  avisos: z.array(z.string()).default([]),
  meta: resultadoSessaoSchema.shape.meta,
});
const resumoAtendimentoParser = z.object({
  registros: z.array(registroSemRefino),
  resumoClinico: resumoClinicoSchema.optional(),
  completo: z.boolean().default(true),
  avisos: z.array(z.string()).default([]),
  meta: resultadoSessaoSchema.shape.meta,
});

function extrairJson(texto: string): unknown {
  const match = texto.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Resposta da IA não contém um objeto JSON.');
  return JSON.parse(match[0]);
}

/**
 * Modelos frequentemente emitem `""` em campos opcionais (`lateralidade`,
 * `observacao`, `trechoOriginal`) em vez de omitir a chave. Isso falharia a
 * validação estrutural por um motivo puramente sintático — normaliza antes
 * de validar para não gastar uma tentativa de retry com um erro tão trivial.
 */
function limparCamposVaziosDoAlvo(alvo: unknown): unknown {
  if (!alvo || typeof alvo !== 'object') return alvo;
  const a = { ...(alvo as Record<string, unknown>) };
  if (a.lateralidade === '') delete a.lateralidade;
  return a;
}
function normalizarBruto(bruto: unknown): unknown {
  if (!bruto || typeof bruto !== 'object') return bruto;
  const obj = bruto as Record<string, unknown>;
  const registros = Array.isArray(obj.registros) ? obj.registros : [];
  const normalizado: Record<string, unknown> = {
    ...obj,
    registros: registros.map((r) => {
      if (!r || typeof r !== 'object') return r;
      const registro = { ...(r as Record<string, unknown>) };
      if (registro.alvo) registro.alvo = limparCamposVaziosDoAlvo(registro.alvo);
      if (registro.observacao === '') delete registro.observacao;
      const prov = registro.proveniencia;
      if (prov && typeof prov === 'object') {
        const p = { ...(prov as Record<string, unknown>) };
        if (p.trechoOriginal === '') delete p.trechoOriginal;
        registro.proveniencia = p;
      }
      return registro;
    }),
  };
  // resumoClinico vazio ({} ou com strings vazias) deve ser omitido, não validado como dado real
  const rc = obj.resumoClinico;
  if (rc && typeof rc === 'object') {
    const r = { ...(rc as Record<string, unknown>) };
    if (r.simetria === '') delete r.simetria;
    if (r.observacaoFechamento === '') delete r.observacaoFechamento;
    const claud = r.claudicacao;
    if (claud && typeof claud === 'object') {
      const c = { ...(claud as Record<string, unknown>) };
      if (c.observacao === '') delete c.observacao;
      r.claudicacao = c;
    }
    const semDados = Object.keys(r).length === 0;
    normalizado.resumoClinico = semDados ? undefined : r;
  }
  return normalizado;
}

/** Reaplica a checagem lateralidade×paridade sem invalidar o registro — só sinaliza. */
function verificarLateralidade(r: RegistroClinico): string | null {
  if (r.alvo.tipo !== 'parte') return null;
  const parte = PARTES_EQUINAS[r.alvo.parteId];
  if (parte.paridade === 'bilateral' && !r.alvo.lateralidade) {
    return `Parte bilateral "${parte.nome['pt-BR']}" sem lado indicado — revisar.`;
  }
  if (parte.paridade === 'axial' && r.alvo.lateralidade) {
    return `Parte axial "${parte.nome['pt-BR']}" não deveria ter lado — revisar.`;
  }
  return null;
}

/** Aplica a checagem de lateralidade a cada registro, retornando os avisos gerados. */
function normalizarRegistros(registros: RegistroClinico[]): {
  registros: RegistroClinico[];
  avisosExtra: string[];
} {
  const avisosExtra: string[] = [];
  const normalizados = registros.map((r) => {
    const alerta = verificarLateralidade(r);
    if (!alerta) return r;
    avisosExtra.push(alerta);
    return { ...r, proveniencia: { ...r.proveniencia, necessitaRevisao: true } };
  });
  return { registros: normalizados, avisosExtra };
}

type ResultadoTentativa<T> = { ok: true; data: T } | { ok: false; erro: string };

/** Chama a IA, valida contra `schema`, e re-tenta uma vez anexando o erro de validação. */
async function tentarExtrairEValidar<S extends z.ZodTypeAny>(
  promptBase: string,
  operacaoVers: string,
  schema: S,
  opts: { userId: number | null; animalId: number | null; maxTokens: number }
): Promise<ResultadoTentativa<z.infer<S>>> {
  let promptTentativa = promptBase;
  let ultimoErro = '';

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const resposta = await callAI({
        operacao: operacaoVers,
        prompt: promptTentativa,
        maxTokens: opts.maxTokens,
        temperature: 0.1,
        userId: opts.userId,
        animalId: opts.animalId,
      });

      const bruto = normalizarBruto(extrairJson(resposta));
      const validado = schema.safeParse(bruto);

      if (validado.success) return { ok: true, data: validado.data };

      ultimoErro = validado.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
    } catch (err) {
      ultimoErro = err instanceof Error ? err.message : String(err);
    }

    console.warn(`[laudoEquinoExtracao] tentativa ${tentativa} falhou: ${ultimoErro}`);
    promptTentativa =
      `${promptBase}\n\n# CORREÇÃO NECESSÁRIA\n` +
      `Sua resposta anterior não seguiu o formato pedido (JSON inválido ou fora do schema). ` +
      `Erros reportados: ${ultimoErro}\n` +
      `Gere o JSON novamente do zero, corrigindo esses pontos e seguindo TODAS as regras acima.`;
  }

  return { ok: false, erro: ultimoErro };
}

export interface ExtrairResultadoSessaoOptions {
  texto: string;
  userId?: number | null;
  animalId?: number | null;
}

/**
 * Extrai um `ResultadoSessao` (só o body-map) a partir do texto/ditado do veterinário.
 * Fallback gracioso (nunca lança): em falha após os retries, retorna
 * `completo:false` com o motivo em `avisos`, para revisão manual.
 */
export async function extrairResultadoSessao(
  opts: ExtrairResultadoSessaoOptions
): Promise<ResultadoSessao> {
  const { texto, userId = null, animalId = null } = opts;
  if (!texto?.trim()) return { registros: [], completo: true, avisos: [] };

  const { operacaoVers, prompt } = buildPrompt(PROMPT_KEY, texto);
  const resultado = await tentarExtrairEValidar(prompt, operacaoVers, resultadoSessaoParser, {
    userId,
    animalId,
    // Groq on-demand: prompt + maxTokens contam juntos no teto de 12k tokens/min
    maxTokens: 2500,
  });

  if (!resultado.ok) {
    console.error('[laudoEquinoExtracao] extrairResultadoSessao falhou:', resultado.erro);
    return {
      registros: [],
      completo: false,
      avisos: [`Extração automática indisponível — revise manualmente. (${resultado.erro})`],
    };
  }

  const { registros, avisosExtra } = normalizarRegistros(resultado.data.registros as RegistroClinico[]);
  return {
    registros,
    completo: resultado.data.completo,
    avisos: [...resultado.data.avisos, ...avisosExtra],
    meta: { ...resultado.data.meta, promptVersao: operacaoVers, idioma: 'pt-BR' },
  };
}

export interface ExtrairResumoAtendimentoOptions {
  texto: string;
  userId?: number | null;
  animalId?: number | null;
}

/**
 * Extrai um `ResumoAtendimento` (body-map + scores clínicos comparáveis entre
 * sessões) a partir do texto de uma evolução de QUALQUER especialidade. Usado
 * pelo relatório comparativo de atendimento (`EvolucaoController.relatorioAtendimento`).
 * Mesma garantia de fallback gracioso de `extrairResultadoSessao`.
 */
export async function extrairResumoAtendimento(
  opts: ExtrairResumoAtendimentoOptions
): Promise<ResumoAtendimento> {
  const { texto, userId = null, animalId = null } = opts;
  if (!texto?.trim()) return { registros: [], completo: true, avisos: [] };

  const { operacaoVers, prompt } = buildPrompt(PROMPT_KEY, texto);
  const resultado = await tentarExtrairEValidar(prompt, operacaoVers, resumoAtendimentoParser, {
    userId,
    animalId,
    // Groq on-demand: prompt + maxTokens contam juntos no teto de 12k tokens/min
    maxTokens: 2500,
  });

  if (!resultado.ok) {
    console.error('[laudoEquinoExtracao] extrairResumoAtendimento falhou:', resultado.erro);
    return {
      registros: [],
      completo: false,
      avisos: [`Extração automática indisponível — revise manualmente. (${resultado.erro})`],
    };
  }

  const { registros, avisosExtra } = normalizarRegistros(resultado.data.registros as RegistroClinico[]);
  return {
    registros,
    resumoClinico: resultado.data.resumoClinico,
    completo: resultado.data.completo,
    avisos: [...resultado.data.avisos, ...avisosExtra],
    meta: { ...resultado.data.meta, promptVersao: operacaoVers, idioma: 'pt-BR' },
  };
}

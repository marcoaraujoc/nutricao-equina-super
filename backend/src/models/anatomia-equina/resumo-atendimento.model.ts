/**
 * ResumoAtendimento — DOMÍNIO. Estende ResultadoSessao (body-map) com um bloco
 * opcional de scores clínicos comparáveis entre sessões ("resumoClinico"), usado
 * pelo relatório comparativo de evolução. Aplica-se a QUALQUER especialidade —
 * por isso todo campo é opcional: a maioria das evoluções não vai preencher nada
 * aqui, e o relatório deve omitir os cards correspondentes quando ausente.
 *
 * Camadas: consumido pelo prompt de extração (AI orchestration) e pelo endpoint
 * de relatório (EvolucaoController). Não conhece HTML/impressão.
 */
import { z } from "zod";
import { registroClinicoSchema } from "./s2vet-clinica.model";

export const claudicacaoSchema = z.object({
  grauAAEP: z.number().min(0).max(5), // escala AAEP 0–5
  observacao: z.string().optional(),
});
export type Claudicacao = z.infer<typeof claudicacaoSchema>;

export const dorSchema = z.object({
  valor: z.number().min(0).max(10), // escala 0–10
});
export type Dor = z.infer<typeof dorSchema>;

export const tensaoMuscularItemSchema = z.object({
  regiao: z.string(), // texto livre, ex: "Cervical (braquiocefálico)"
  valor: z.number().min(0).max(3), // 0=normal .. 3=severa (contratura)
});
export type TensaoMuscularItem = z.infer<typeof tensaoMuscularItemSchema>;

export const romItemSchema = z.object({
  teste: z.string(), // ex: "Flexão lateral · esq."
  resultado: z.string(), // descrição livre do estado atual, ex: "alcança o flanco"
});
export type RomItem = z.infer<typeof romItemSchema>;

export const treinoItemSchema = z.object({
  status: z.enum(["liberado", "restrito", "suspenso"]),
  titulo: z.string(),
  detalhe: z.string(),
});
export type TreinoItem = z.infer<typeof treinoItemSchema>;

export const resumoClinicoSchema = z.object({
  claudicacao: claudicacaoSchema.optional(),
  dor: dorSchema.optional(),
  tensaoMuscular: z.array(tensaoMuscularItemSchema).optional(),
  simetria: z.string().optional(), // ex: "Simétrica", "Assimétrica à direita"
  rom: z.array(romItemSchema).optional(),
  treino: z.array(treinoItemSchema).optional(),
  observacaoFechamento: z.string().optional(), // síntese/citação de fechamento gerada a partir do texto
});
export type ResumoClinico = z.infer<typeof resumoClinicoSchema>;

export const resumoAtendimentoSchema = z.object({
  registros: z.array(registroClinicoSchema), // body-map — mesmo contrato de ResultadoSessao
  resumoClinico: resumoClinicoSchema.optional(),
  completo: z.boolean().default(true),
  avisos: z.array(z.string()).default([]),
  meta: z
    .object({
      modeloIA: z.string().optional(),
      promptVersao: z.string().optional(),
      idioma: z.string().optional(),
    })
    .optional(),
});
export type ResumoAtendimento = z.infer<typeof resumoAtendimentoSchema>;

/** True se há QUALQUER dado de resumoClinico preenchido (para decidir se mostra os cards). */
export const temResumoClinico = (r: ResumoClinico | undefined): boolean =>
  !!r &&
  (r.claudicacao !== undefined ||
    r.dor !== undefined ||
    (r.tensaoMuscular?.length ?? 0) > 0 ||
    r.simetria !== undefined ||
    (r.rom?.length ?? 0) > 0 ||
    (r.treino?.length ?? 0) > 0 ||
    r.observacaoFechamento !== undefined);

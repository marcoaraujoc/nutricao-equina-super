/**
 * S2Vet · Modelo de domínio clínico equino (DDD, agnóstico de UI e de provider de IA).
 *
 * Unifica o que antes eram três contratos ad-hoc (ZonaTerapia, ZonaAchado,
 * AnotacaoNaoLocalizada) em UMA discriminated union — `RegistroClinico` — sobre
 * um sistema de alvo anatômico único (`AlvoAnatomico`). Generaliza os quatro
 * laudos reais analisados: terapias, achados de palpação e avaliação neurológica.
 *
 * Camadas: este arquivo é DOMÍNIO puro. Geometria/pintura (presentation) e o
 * prompt de extração (AI orchestration) consomem estes tipos, nunca o contrário.
 */
import { z } from "zod";
import {
  parteAnatomicaIdSchema,
  lateralidadeSchema,
  PARTES_EQUINAS,
  type Locale,
} from "./anatomia-equina.taxonomy";
import { GRUPO_IDS } from "./anatomia-equina.grupos";
import { PARTE_CASCO_IDS, MEMBROS_CASCO } from "../anatomia-casco/casco.model";
import { PARTE_DENTE_IDS } from "../anatomia-dental/dental.model";

/* ────────────────────────────────────────────────────────────────────────── *
 * 1. ALVO ANATÔMICO — a abstração que unifica ponto, região, vértebra, grupo,
 *    sistema funcional e "sem local". É o que resolve "joelho", "C3",
 *    "membros pélvicos", "a coluna", "garupas" e "pontos de acupuntura".
 * ────────────────────────────────────────────────────────────────────────── */
export const grupoAnatomicoIdSchema = z.enum(GRUPO_IDS);
export const sistemaFuncionalSchema = z.enum([
  "neurologico",
  "musculoesqueletico",
  "vascular",
  "tegumentar",
]);

export const alvoAnatomicoSchema = z.discriminatedUnion("tipo", [
  // parte concreta (ponto/região/vértebra); lado validado adiante contra paridade
  z.object({
    tipo: z.literal("parte"),
    parteId: parteAnatomicaIdSchema,
    lateralidade: lateralidadeSchema.optional(),
  }),
  // macro-alvo que expande para partes (membro pélvico, coluna, espádua…)
  z.object({
    tipo: z.literal("grupo"),
    grupoId: grupoAnatomicoIdSchema,
    lateralidade: lateralidadeSchema.optional(),
  }),
  // sistema sem localização pontual (ex.: "avaliação neurológica")
  z.object({ tipo: z.literal("sistema"), sistemaId: sistemaFuncionalSchema }),
  // parte do CASCO (laudo de ferrageamento — pintado sobre casco.png);
  // membro = qual casco: AE/AD/PE/PD (anterior/posterior + esquerdo/direito)
  z.object({
    tipo: z.literal("casco"),
    parteId: z.enum(PARTE_CASCO_IDS),
    membro: z.enum(MEMBROS_CASCO).optional(),
  }),
  // dente (laudo odontológico — pintado sobre odontologia.png);
  // parteId = "d<quadrante>_<posição 2 dígitos>" (Triadan 208 → d2_08)
  z.object({ tipo: z.literal("dente"), parteId: z.enum(PARTE_DENTE_IDS) }),
  // sem sítio anatômico (pontos de acupuntura, terapia sistêmica)
  z.object({ tipo: z.literal("nao_localizado"), descricao: z.string().min(1) }),
]);
export type AlvoAnatomico = z.infer<typeof alvoAnatomicoSchema>;

/* ────────────────────────────────────────────────────────────────────────── *
 * 2. MODALIDADES DE TERAPIA — registry aberto (NÃO enum fechado). Adicionar
 *    uma terapia = uma entrada aqui; painter e i18n derivam disto. Cobre o
 *    "terapia manual sutil" que apareceu no laudo 2.
 * ────────────────────────────────────────────────────────────────────────── */
export interface ModalidadeTerapiaDef {
  readonly id: string;
  readonly i18nKey: string;
  readonly exigeLocal: boolean; // false — tende a virar registro não-localizado
  readonly cor: { readonly fill: string; readonly stroke: string };
  readonly nome: Readonly<Record<Locale, string>>; // usado na legenda do body-map
}

export const MODALIDADES_TERAPIA = {
  laser_led: { id: "laser_led", i18nKey: "terapia.laser_led", exigeLocal: true, cor: { fill: "248,113,113", stroke: "#dc2626" },
    nome: { "pt-BR": "Laser + LED", "en-US": "Laser + LED", "es-ES": "Láser + LED" } },
  campo_magnetico: { id: "campo_magnetico", i18nKey: "terapia.campo_magnetico", exigeLocal: true, cor: { fill: "74,222,128", stroke: "#16a34a" },
    nome: { "pt-BR": "Campo magnético", "en-US": "Magnetic field", "es-ES": "Campo magnético" } },
  eletroacupuntura: { id: "eletroacupuntura", i18nKey: "terapia.eletroacupuntura", exigeLocal: false, cor: { fill: "250,204,21", stroke: "#ca8a04" },
    nome: { "pt-BR": "Eletroacupuntura", "en-US": "Electroacupuncture", "es-ES": "Electroacupuntura" } },
  terapia_manual: { id: "terapia_manual", i18nKey: "terapia.terapia_manual", exigeLocal: true, cor: { fill: "129,140,248", stroke: "#4f46e5" },
    nome: { "pt-BR": "Terapia manual", "en-US": "Manual therapy", "es-ES": "Terapia manual" } },
  procedimento: { id: "procedimento", i18nKey: "terapia.procedimento", exigeLocal: true, cor: { fill: "16,185,129", stroke: "#059669" },
    nome: { "pt-BR": "Procedimento", "en-US": "Procedure", "es-ES": "Procedimiento" } },
} as const satisfies Record<string, ModalidadeTerapiaDef>;

export const MODALIDADE_IDS = Object.keys(MODALIDADES_TERAPIA) as [keyof typeof MODALIDADES_TERAPIA];
export const modalidadeTerapiaSchema = z.enum(MODALIDADE_IDS);
export type ModalidadeTerapiaId = z.infer<typeof modalidadeTerapiaSchema>;

/* ────────────────────────────────────────────────────────────────────────── *
 * 3. RESULTADO ESTRUTURADO DE TESTE — para avaliação funcional/neurológica.
 *    Cobre "positivo no teste de cauda" e "diminuição de reflexo".
 * ────────────────────────────────────────────────────────────────────────── */
export const resultadoTesteSchema = z.discriminatedUnion("escala", [
  z.object({ escala: z.literal("binario"), valor: z.enum(["positivo", "negativo"]) }),
  z.object({ escala: z.literal("graduado"), valor: z.enum(["ausente", "diminuido", "normal", "aumentado"]) }),
  z.object({ escala: z.literal("presenca"), valor: z.enum(["presente", "ausente"]) }),
]);
export type ResultadoTeste = z.infer<typeof resultadoTesteSchema>;

/* ────────────────────────────────────────────────────────────────────────── *
 * 4. PROVENIÊNCIA — rastreabilidade da extração por IA (obrigatória em todo
 *    registro): confiança, trecho de origem e sinal de revisão humana.
 * ────────────────────────────────────────────────────────────────────────── */
export const proveniencaSchema = z.object({
  confianca: z.number().min(0).max(1),
  trechoOriginal: z.string().optional(),
  necessitaRevisao: z.boolean().default(false),
});
export type Proveniencia = z.infer<typeof proveniencaSchema>;

/* ────────────────────────────────────────────────────────────────────────── *
 * 5. REGISTRO CLÍNICO — discriminated union dos três tipos de registro.
 * ────────────────────────────────────────────────────────────────────────── */
const baseRegistro = { alvo: alvoAnatomicoSchema, proveniencia: proveniencaSchema, observacao: z.string().optional() };

export const achadoExameSchema = z.object({
  kind: z.literal("achado_exame"),
  achado: z.enum([
    "reatividade_palpacao", "fasciculacao", "dor", "edema",
    "assimetria", "restricao_articular", "hipertonia", "atrofia",
  ]),
  intensidade: z.number().min(0).max(1).optional(),
  ...baseRegistro,
});

export const avaliacaoFuncionalSchema = z.object({
  kind: z.literal("avaliacao_funcional"),
  teste: z.string(), // i18nKey: "teste.proprioceptivo" | "teste.cauda" | "reflexo.elevacao_cauda"…
  resultado: resultadoTesteSchema,
  ...baseRegistro,
});

export const terapiaAplicadaSchema = z.object({
  kind: z.literal("terapia_aplicada"),
  modalidade: modalidadeTerapiaSchema,
  intensidade: z.number().min(0).max(1).optional(),
  parametros: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  ...baseRegistro,
});

export const registroClinicoSchema = z
  .discriminatedUnion("kind", [achadoExameSchema, avaliacaoFuncionalSchema, terapiaAplicadaSchema])
  .superRefine((r, ctx) => {
    // Lateralidade coerente com a paridade da parte — SOFT: sinaliza, não derruba.
    if (r.alvo.tipo === "parte") {
      const parte = PARTES_EQUINAS[r.alvo.parteId];
      if (parte.paridade === "bilateral" && !r.alvo.lateralidade) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ["alvo", "lateralidade"], fatal: false,
          message: `Parte bilateral "${r.alvo.parteId}" sem lado — marcar necessitaRevisao.`,
        });
      }
      if (parte.paridade === "axial" && r.alvo.lateralidade) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ["alvo", "lateralidade"], fatal: false,
          message: `Parte axial "${r.alvo.parteId}" não aceita lado.`,
        });
      }
    }
  });
export type RegistroClinico = z.infer<typeof registroClinicoSchema>;
export type AchadoExame = z.infer<typeof achadoExameSchema>;
export type AvaliacaoFuncional = z.infer<typeof avaliacaoFuncionalSchema>;
export type TerapiaAplicada = z.infer<typeof terapiaAplicadaSchema>;

/* ────────────────────────────────────────────────────────────────────────── *
 * 6. RESULTADO DA SESSÃO — saída completa da AI orchestration layer.
 *    `completo:false` cobre ditado truncado/interrompido (como o laudo 3).
 * ────────────────────────────────────────────────────────────────────────── */
export const resultadoSessaoSchema = z.object({
  registros: z.array(registroClinicoSchema),
  completo: z.boolean().default(true),
  avisos: z.array(z.string()).default([]),
  meta: z
    .object({
      modeloIA: z.string().optional(),
      promptVersao: z.string().optional(),
      idioma: z.custom<Locale>().optional(),
    })
    .optional(),
});
export type ResultadoSessao = z.infer<typeof resultadoSessaoSchema>;

/** Só os registros pintáveis (têm alvo concreto: parte, grupo, casco ou dente). */
export const ehPintavel = (r: RegistroClinico): boolean =>
  r.alvo.tipo === "parte" || r.alvo.tipo === "grupo" ||
  r.alvo.tipo === "casco" || r.alvo.tipo === "dente";

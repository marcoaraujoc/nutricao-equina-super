/**
 * Grupos anatômicos (macro-alvos) — resolvem "membro pélvico", "a coluna", "garupas", "espádua".
 * Um grupo expande para partes constituintes na hora de pintar. DOMÍNIO.
 */
import type { ParteAnatomicaId, Paridade, Locale } from "./anatomia-equina.taxonomy";

export const GRUPO_IDS = ["membro_toracico", "membro_pelvico", "coluna", "espadua", "nuca", "cervical"] as const;
export type GrupoAnatomicoId = (typeof GRUPO_IDS)[number];

export interface GrupoAnatomico {
  readonly id: GrupoAnatomicoId;
  readonly paridade: Paridade;
  readonly i18nKey: string;
  readonly nome: Readonly<Record<Locale, string>>;
  readonly partes: ReadonlyArray<ParteAnatomicaId>;
}

export const GRUPOS_EQUINOS: Readonly<Record<GrupoAnatomicoId, GrupoAnatomico>> = {
  membro_toracico: { id: "membro_toracico", paridade: "bilateral", i18nKey: "anatomia.grupo.membro_toracico",
    nome: { "pt-BR": "Membro torácico", "en-US": "Thoracic limb", "es-ES": "Miembro torácico" },
    partes: ["escapula", "art_ombro", "umero", "cotovelo", "antebraco", "carpo_ant", "metacarpo", "boleto_ant", "casco_ant"] },
  membro_pelvico: { id: "membro_pelvico", paridade: "bilateral", i18nKey: "anatomia.grupo.membro_pelvico",
    nome: { "pt-BR": "Membro pélvico", "en-US": "Pelvic limb", "es-ES": "Miembro pélvico" },
    partes: ["tuber_coxae", "art_coxofemoral", "femur", "soldra", "perna_tibia", "jarrete_tarso", "metatarso", "boleto_post", "casco_post"] },
  coluna: { id: "coluna", paridade: "mediano", i18nKey: "anatomia.grupo.coluna",
    nome: { "pt-BR": "Coluna vertebral", "en-US": "Vertebral column", "es-ES": "Columna vertebral" },
    partes: ["vertebra_cd1", "vertebra_t10", "vertebra_c4", "vertebra_t8", "vertebra_l5", "vertebra_t16", "vertebra_l2", "vertebra_s3", "vertebra_t15", "vertebra_t2", "vertebra_l3", "vertebra_c3", "vertebra_cd3", "vertebra_s1", "vertebra_t5", "vertebra_t7", "vertebra_c5", "vertebra_l1", "vertebra_t17", "vertebra_t11", "vertebra_cd5", "vertebra_t1", "vertebra_c2", "vertebra_s4", "vertebra_l6", "vertebra_t6", "vertebra_t9", "vertebra_cd2", "vertebra_t3", "vertebra_c7", "vertebra_l4", "vertebra_t4", "vertebra_t12", "vertebra_c1", "vertebra_t14", "vertebra_t13", "vertebra_t18", "vertebra_s5", "vertebra_c6", "vertebra_cd4", "vertebra_s2"] },
  espadua: { id: "espadua", paridade: "bilateral", i18nKey: "anatomia.grupo.espadua",
    nome: { "pt-BR": "Espádua (escápula)", "en-US": "Shoulder region (scapula)", "es-ES": "Espalda (escápula)" },
    partes: ["escapula", "art_ombro"] },
  nuca: { id: "nuca", paridade: "mediano", i18nKey: "anatomia.grupo.nuca",
    nome: { "pt-BR": "Nuca", "en-US": "Poll / nape", "es-ES": "Nuca" },
    partes: ["vertebra_c1", "vertebra_c2"] },
  cervical: { id: "cervical", paridade: "mediano", i18nKey: "anatomia.grupo.cervical",
    nome: { "pt-BR": "Região cervical", "en-US": "Cervical region", "es-ES": "Región cervical" },
    partes: ["vertebra_c1", "vertebra_c2", "vertebra_c3", "vertebra_c4", "vertebra_c5", "vertebra_c6", "vertebra_c7", "regiao_cervical"] },
} as const;

/** Expande um grupo (+ lado opcional) para as partes que devem ser pintadas. */
export const expandirGrupo = (id: GrupoAnatomicoId): ReadonlyArray<ParteAnatomicaId> =>
  GRUPOS_EQUINOS[id].partes;

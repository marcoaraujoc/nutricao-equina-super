/**
 * pintarLaudoEquino — compõe o SVG PINTADO de um laudo para RELATÓRIO.
 * Evolui pintarAnatomiaEquina para o modelo unificado (RegistroClinico[]).
 *
 * Agnóstico de framework/engine: fill/fill-opacity/stroke inline (sem color-mix/CSS/JS)
 * — idêntico em Chrome/Puppeteer, print, cairosvg e wkhtmltoimage. Camada PRESENTATION.
 *
 * Linguagem visual por tipo de registro (decisão de produto, mesmo desenho):
 *   • terapia_aplicada    — cor da modalidade (+ badge D/E/? bilateral)
 *   • achado_exame        — contorno/faixa TRACEJADA âmbar
 *   • avaliacao_funcional — contorno/faixa TRACEJADA índigo (grupo/membro destacado)
 *
 * Regiões do eixo vertebral (cervical, dorso, lombo, garupa, nuca, coluna) —
 * pintadas como FAIXA contínua sobre as vértebras do segmento (como o desenho
 * manual do fisioterapeuta), NÃO vértebra a vértebra. Quando mais de um método
 * atinge o mesmo segmento, cada faixa adicional é deslocada em paralelo para
 * que todas fiquem visíveis (traços lado a lado, como no laudo real).
 *
 * Legenda embutida no SVG: um item por modalidade/achado/avaliação presente.
 */
import {
  PARTES_EQUINAS,
  listarVertebras,
  type ParteAnatomicaId,
  type SegmentoVertebral,
  type VistaAnatomica,
} from "./anatomia-equina.taxonomy";
import { GEOMETRIA_EQUINA, type Placement } from "./anatomia-equina.geometry";
import { GRUPOS_EQUINOS, type GrupoAnatomicoId } from "./anatomia-equina.grupos";
import {
  MODALIDADES_TERAPIA,
  ehPintavel,
  type RegistroClinico,
  type AlvoAnatomico,
} from "./s2vet-clinica.model";

const AMBER = { fill: "217,119,6", stroke: "#d97706" };
const INDIGO = { fill: "79,70,229", stroke: "#4f46e5" };
const BADGE_LADO: Record<string, string> = { direito: "D", esquerdo: "E", bilateral: "D+E" };
const VISTAS: readonly VistaAnatomica[] = ["lateral", "dorsal_esqueleto"];

const ACHADO_LABEL: Record<string, string> = {
  reatividade_palpacao: "Reatividade à palpação",
  fasciculacao: "Fasciculação",
  dor: "Dor",
  edema: "Edema",
  assimetria: "Assimetria",
  restricao_articular: "Restrição articular",
  hipertonia: "Hipertonia",
  atrofia: "Atrofia",
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const opac = (i = 1): number => Math.round((0.3 + 0.35 * Math.min(1, Math.max(0, i))) * 100) / 100;

/** Resolve o alvo em partes concretas a pintar (grupo → expande; parte → ela mesma). */
function partesDoAlvo(alvo: AlvoAnatomico): ReadonlyArray<ParteAnatomicaId> {
  if (alvo.tipo === "parte") return [alvo.parteId];
  if (alvo.tipo === "grupo") return GRUPOS_EQUINOS[alvo.grupoId].partes;
  return [];
}
function ladoDoAlvo(alvo: AlvoAnatomico): string | undefined {
  return alvo.tipo === "parte" || alvo.tipo === "grupo" ? alvo.lateralidade : undefined;
}

function shape(p: Placement, fill: string, stroke: string, op: number, w = 2.5, dash = ""): string {
  const d = dash ? ` stroke-dasharray="${dash}"` : "";
  const base = `fill="rgb(${fill})" fill-opacity="${op}" stroke="${stroke}" stroke-width="${w}"${d}`;
  return p.shape === "ellipse"
    ? `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}" ${base}/>`
    : `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.rx}" ${base}/>`;
}
function badge(p: Placement, letra: string, stroke: string): string {
  const cx = p.shape === "ellipse" ? p.cx : p.x + p.w / 2;
  const cy = p.shape === "ellipse" ? p.cy : p.y;
  const rx = p.shape === "ellipse" ? p.rx : p.w / 2;
  const bx = cx + rx * 0.85 + 4, by = cy - 4;
  return (
    `<circle cx="${bx}" cy="${by}" r="11" fill="#fff" stroke="${stroke}" stroke-width="2"/>` +
    `<text x="${bx}" y="${by + 4}" font-family="sans-serif" font-size="13" font-weight="700" fill="${stroke}" text-anchor="middle">${letra}</text>`
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * FAIXAS DO EIXO VERTEBRAL — regiões da linha superior pintam como uma faixa
 * contínua sobre as vértebras do segmento (cervical inteira, dorso = torácicas,
 * lombo = lombares, garupa = sacrais), igual ao traço manual do laudo real.
 * ────────────────────────────────────────────────────────────────────────── */

/** Partes "região da linha superior" que pintam como faixa de segmento. */
const SEGMENTO_POR_PARTE: Partial<Record<ParteAnatomicaId, SegmentoVertebral>> = {
  regiao_cervical: "cervical",
  dorso: "toracica",
  lombo: "lombar",
  garupa: "sacral",
};

const VERTEBRAS_ORDENADAS: ParteAnatomicaId[] = Object.values(PARTES_EQUINAS)
  .filter((p) => p.tipo === "vertebra")
  .map((p) => p.id);

const vertebrasDoSegmento = (seg: SegmentoVertebral): ParteAnatomicaId[] =>
  listarVertebras(seg)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((p) => p.id);

/** Resolve um alvo em faixa vertebral (key p/ deslocamento paralelo + vértebras). */
function faixaDoAlvo(alvo: AlvoAnatomico): { key: string; ids: ParteAnatomicaId[] } | null {
  if (alvo.tipo === "grupo") {
    if (alvo.grupoId === ("coluna" as GrupoAnatomicoId)) return { key: "coluna", ids: VERTEBRAS_ORDENADAS };
    if (alvo.grupoId === ("cervical" as GrupoAnatomicoId)) return { key: "cervical", ids: vertebrasDoSegmento("cervical") };
    if (alvo.grupoId === ("nuca" as GrupoAnatomicoId)) return { key: "nuca", ids: ["vertebra_c1", "vertebra_c2"] };
    return null;
  }
  if (alvo.tipo === "parte") {
    const seg = SEGMENTO_POR_PARTE[alvo.parteId];
    if (seg) return { key: seg, ids: vertebrasDoSegmento(seg) };
  }
  return null;
}

/**
 * Correção de calibração da vista lateral: os placements das vértebras
 * torácicas/lombares/sacrais estão levemente ACIMA da linha do dorso no
 * desenho base — a faixa desce por segmento para assentar na linha superior
 * (como o traço manual do laudo real).
 */
const SEG_DY_LATERAL: Record<SegmentoVertebral, number> = {
  cervical: 0,
  toracica: 28,
  lombar: 34,
  sacral: 26,
  caudal: 12,
};

/**
 * Traçados customizados por faixa (vista lateral). Os placements de C1–C7
 * cobrem só o trecho médio do pescoço (x≈778–878) — curto demais para ler
 * como "toda a cervical". A faixa cervical usa um traçado próprio que percorre
 * o pescoço INTEIRO, da nuca (atrás das orelhas) até a base junto à escápula,
 * seguindo a diagonal do pescoço como o traço manual do fisioterapeuta.
 */
const PONTOS_FAIXA_LATERAL: Partial<Record<string, ReadonlyArray<readonly [number, number]>>> = {
  cervical: [[756, 292], [792, 320], [828, 346], [862, 366], [896, 384]],
};

/**
 * Polyline contínua sobre as vértebras do segmento. `nivel` desloca faixas
 * subsequentes em paralelo (lateral: para baixo; dorsal: para a direita) para
 * que dois métodos na mesma região fiquem ambos visíveis.
 */
function faixaVertebral(
  vista: VistaAnatomica,
  ids: ReadonlyArray<ParteAnatomicaId>,
  corFill: string,
  op: number,
  nivel: number,
  opts: { dash?: string; width?: number; key?: string } = {}
): string {
  const dx = vista === "dorsal_esqueleto" ? nivel * 26 : 0;
  const dy = vista === "lateral" ? nivel * 30 : 0;
  const custom = vista === "lateral" && opts.key ? PONTOS_FAIXA_LATERAL[opts.key] : undefined;
  const pts = custom
    ? custom.map(([x, y]) => `${x + dx},${y + dy}`)
    : ids.flatMap((id) =>
        (GEOMETRIA_EQUINA[id] ?? [])
          .filter((pl) => pl.vista === vista && pl.shape === "ellipse")
          .map((pl) => {
            if (pl.shape !== "ellipse") return "";
            const seg = PARTES_EQUINAS[id].segmento;
            const dyCalibracao = vista === "lateral" && seg ? SEG_DY_LATERAL[seg] : 0;
            return `${pl.cx + dx},${pl.cy + dy + dyCalibracao}`;
          })
      );
  if (pts.length < 2) return "";
  const dash = opts.dash ? ` stroke-dasharray="${opts.dash}"` : "";
  const w = opts.width ?? 26;
  return `<polyline points="${pts.join(" ")}" fill="none" stroke="rgb(${corFill})" stroke-opacity="${op}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
}

function pintarRegistro(r: RegistroClinico, niveis: Map<string, number>): string {
  const alvo = r.alvo;
  if (!ehPintavel(r)) return "";

  // Regiões do eixo vertebral → faixa contínua (com deslocamento paralelo por método)
  const faixa = faixaDoAlvo(alvo);
  if (faixa) {
    const nivel = niveis.get(faixa.key) ?? 0;
    niveis.set(faixa.key, nivel + 1);
    if (r.kind === "terapia_aplicada") {
      const cor = MODALIDADES_TERAPIA[r.modalidade].cor;
      return VISTAS.map((v) => faixaVertebral(v, faixa.ids, cor.fill, opac(r.intensidade) * 0.85, nivel, { key: faixa.key })).join("");
    }
    if (r.kind === "achado_exame") {
      return VISTAS.map((v) => faixaVertebral(v, faixa.ids, AMBER.fill, 0.55, nivel, { dash: "16 10", width: 18, key: faixa.key })).join("");
    }
    // avaliacao_funcional
    return VISTAS.map((v) => faixaVertebral(v, faixa.ids, INDIGO.fill, 0.45, nivel, { dash: "4 8", width: 18, key: faixa.key })).join("");
  }

  const partes = partesDoAlvo(alvo);
  const lado = ladoDoAlvo(alvo);

  return partes
    .flatMap((pid) => {
      const bilateral = PARTES_EQUINAS[pid].paridade === "bilateral";
      const placements = GEOMETRIA_EQUINA[pid] ?? [];
      return placements.map((p) => {
        if (r.kind === "terapia_aplicada") {
          const cor = MODALIDADES_TERAPIA[r.modalidade].cor;
          const letra = bilateral ? (lado ? BADGE_LADO[lado] : "?") : undefined;
          return shape(p, cor.fill, cor.stroke, opac(r.intensidade)) + (letra ? badge(p, letra, cor.stroke) : "");
        }
        if (r.kind === "achado_exame") {
          const b = lado === "direito" || lado === "esquerdo" ? badge(p, BADGE_LADO[lado], AMBER.stroke) : "";
          return shape(p, AMBER.fill, AMBER.stroke, 0.12, 3, "9 5") + b;
        }
        // avaliacao_funcional
        return shape(p, INDIGO.fill, INDIGO.stroke, 0.1, 3, "3 6");
      });
    })
    .join("");
}

/* ────────────────────────────────────────────────────────────────────────── *
 * LEGENDA — um item por método/achado presente nos registros pintáveis,
 * na cor exata usada na pintura (como a legenda manual do laudo real).
 * ────────────────────────────────────────────────────────────────────────── */
function legenda(registros: ReadonlyArray<RegistroClinico>): string {
  const entradas: Array<{ fill: string; stroke: string; dash: boolean; label: string }> = [];
  const modalidadesVistas = new Set<string>();
  const achadosVistos = new Set<string>();
  let temAvaliacao = false;

  for (const r of registros) {
    if (!ehPintavel(r)) continue;
    if (r.kind === "terapia_aplicada" && !modalidadesVistas.has(r.modalidade)) {
      modalidadesVistas.add(r.modalidade);
      const m = MODALIDADES_TERAPIA[r.modalidade];
      entradas.push({ fill: m.cor.fill, stroke: m.cor.stroke, dash: false, label: m.nome["pt-BR"] });
    } else if (r.kind === "achado_exame" && !achadosVistos.has(r.achado)) {
      achadosVistos.add(r.achado);
      entradas.push({ fill: AMBER.fill, stroke: AMBER.stroke, dash: true, label: ACHADO_LABEL[r.achado] ?? r.achado });
    } else if (r.kind === "avaliacao_funcional" && !temAvaliacao) {
      temAvaliacao = true;
      entradas.push({ fill: INDIGO.fill, stroke: INDIGO.stroke, dash: true, label: "Avaliação funcional" });
    }
  }
  if (entradas.length === 0) return "";

  return entradas
    .map((e, i) => {
      const y = 82 + i * 32;
      const dash = e.dash ? ` stroke-dasharray="6 4"` : "";
      return (
        `<circle cx="1132" cy="${y}" r="10" fill="rgb(${e.fill})" fill-opacity="${e.dash ? 0.2 : 0.65}" stroke="${e.stroke}" stroke-width="2.5"${dash}/>` +
        `<text x="1154" y="${y + 6}" font-family="sans-serif" font-size="17" font-weight="600" fill="#0f172a">${esc(e.label)}</text>`
      );
    })
    .join("");
}

export interface PintarLaudoOptions {
  registros: ReadonlyArray<RegistroClinico>;
  baseInner: string;
  titulo: string;
  completo?: boolean;
}

export function pintarLaudoEquino(opts: PintarLaudoOptions): string {
  const { registros, baseInner, titulo, completo = true } = opts;
  const niveis = new Map<string, number>();
  const pintura = registros.map((r) => pintarRegistro(r, niveis)).join("");
  const avisoIncompleto = completo
    ? ""
    : `<text x="1120" y="944" font-family="sans-serif" font-size="14" font-weight="700" fill="#b45309">${esc(
        "⚠ Sessão incompleta (ditado truncado)"
      )}</text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1625 968" width="100%" preserveAspectRatio="xMidYMid meet">` +
    `<rect width="1625" height="968" fill="#ffffff"/>` +
    `<text x="1120" y="40" font-family="sans-serif" font-size="24" font-weight="700" fill="#0f172a">${esc(titulo)}</text>` +
    `<g id="camada-base" fill="#1e293b" stroke="none">${baseInner}</g>` +
    `<g id="camada-pintura">${pintura}</g>` +
    `<g id="camada-legenda">${legenda(registros)}</g>` +
    avisoIncompleto +
    `</svg>`
  );
}

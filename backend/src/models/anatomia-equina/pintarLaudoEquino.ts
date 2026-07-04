/**
 * pintarLaudoEquino — compõe o SVG PINTADO de um laudo para RELATÓRIO.
 * Evolui pintarAnatomiaEquina para o modelo unificado (RegistroClinico[]).
 *
 * Agnóstico de framework/engine: fill/fill-opacity/stroke inline (sem color-mix/CSS/JS)
 * — idêntico em Chrome/Puppeteer, print, cairosvg e wkhtmltoimage. Camada PRESENTATION.
 *
 * Linguagem visual por tipo de registro (decisão de produto, mesmo desenho):
 *   • terapia_aplicada    — preenchimento por cor da modalidade (+ badge D/E/? bilateral)
 *   • achado_exame        — contorno TRACEJADO âmbar
 *   • avaliacao_funcional — contorno TRACEJADO índigo (grupo/membro destacado)
 * Grupo "coluna" — FAIXA contínua sobre o eixo vertebral (não vértebra a vértebra).
 */
import {
  PARTES_EQUINAS,
  type ParteAnatomicaId,
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

/** Polyline do eixo vertebral por vista (para a FAIXA da "coluna"), derivada da geometria. */
const VERTEBRAS_ORDENADAS: ParteAnatomicaId[] = Object.values(PARTES_EQUINAS)
  .filter((p) => p.tipo === "vertebra")
  .map((p) => p.id);
function bandaColuna(vista: VistaAnatomica, fill: string, op: number): string {
  const pts = VERTEBRAS_ORDENADAS.flatMap((id) =>
    (GEOMETRIA_EQUINA[id] ?? []).filter((pl) => pl.vista === vista && pl.shape === "ellipse").map((pl) =>
      pl.shape === "ellipse" ? `${pl.cx},${pl.cy}` : ""
    )
  );
  return `<polyline points="${pts.join(" ")}" fill="none" stroke="rgb(${fill})" stroke-opacity="${op}" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function pintarRegistro(r: RegistroClinico): string {
  const alvo = r.alvo;
  if (!ehPintavel(r)) return "";

  // "coluna" tem tratamento especial: faixa, não partes
  if (alvo.tipo === "grupo" && alvo.grupoId === ("coluna" as GrupoAnatomicoId)) {
    if (r.kind !== "terapia_aplicada") return "";
    const cor = MODALIDADES_TERAPIA[r.modalidade].cor;
    return VISTAS.map((v) => bandaColuna(v, cor.fill, opac(r.intensidade) * 0.6)).join("");
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

export interface PintarLaudoOptions {
  registros: ReadonlyArray<RegistroClinico>;
  baseInner: string;
  titulo: string;
  completo?: boolean;
}

export function pintarLaudoEquino(opts: PintarLaudoOptions): string {
  const { registros, baseInner, titulo, completo = true } = opts;
  const pintura = registros.map(pintarRegistro).join("");
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
    avisoIncompleto +
    `</svg>`
  );
}

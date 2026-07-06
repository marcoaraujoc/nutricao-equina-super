/**
 * pintarLaudoRaster — pinta registros clínicos SOBRE uma imagem raster (PNG),
 * com a MESMA linguagem visual do body-map equino (pintarLaudoEquino):
 *   • terapia_aplicada    — preenchimento na cor da modalidade
 *   • achado_exame        — contorno tracejado âmbar
 *   • avaliacao_funcional — contorno tracejado índigo
 * + legenda de cores e badge de membro (AE/AD/PE/PD) quando aplicável.
 *
 * Usado pelos laudos de FERRAGEAMENTO (casco.png) e ODONTOLOGIA
 * (odontologia.png). A geometria vem dos catálogos em % do canvas.
 * Se o PNG ainda não existir na pasta do modelo, retorna null (o relatório
 * mostra "Sem mapa disponível").
 */
import * as fs from "fs";
import * as path from "path";
import {
  MODALIDADES_TERAPIA,
  type RegistroClinico,
} from "./anatomia-equina/s2vet-clinica.model";
import { PARTES_CASCO, type ParteCascoId, type PlacementPct } from "./anatomia-casco/casco.model";
import { PARTES_DENTE } from "./anatomia-dental/dental.model";

const AMBER  = { fill: "217,119,6",  stroke: "#d97706" };
const INDIGO = { fill: "79,70,229",  stroke: "#4f46e5" };

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

/** Lê largura/altura do IHDR de um PNG (bytes 16-23, big-endian). */
function dimensoesPng(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

interface ParteRaster { nome: string; placements: ReadonlyArray<PlacementPct> }

interface PintarRasterOptions {
  pngPath: string;
  partes: Readonly<Record<string, ParteRaster>>;
  tipoAlvo: "casco" | "dente";
  registros: ReadonlyArray<RegistroClinico>;
  titulo: string;
  completo?: boolean;
}

function pintarLaudoRaster(opts: PintarRasterOptions): string | null {
  const { pngPath, partes, tipoAlvo, registros, titulo, completo = true } = opts;

  if (!fs.existsSync(pngPath)) return null;
  const buf = fs.readFileSync(pngPath);
  const { w, h } = dimensoesPng(buf);
  const base64 = buf.toString("base64");

  const HEADER  = 44;
  const legenda: Array<{ fill: string; stroke: string; dash: boolean; label: string }> = [];
  const modalidadesVistas = new Set<string>();
  const achadosVistos     = new Set<string>();
  let temAvaliacao = false;

  const px = (p: PlacementPct) => ({
    cx: (p.cx / 100) * w, cy: HEADER + (p.cy / 100) * h,
    rx: (p.rx / 100) * w, ry: (p.ry / 100) * h,
  });

  const shapes: string[] = [];
  for (const r of registros) {
    if (r.alvo.tipo !== tipoAlvo) continue;
    const parte = partes[(r.alvo as { parteId: string }).parteId];
    if (!parte) continue;

    let fill = "", stroke = "", op = 0.5, dash = "";
    if (r.kind === "terapia_aplicada") {
      const cor = MODALIDADES_TERAPIA[r.modalidade].cor;
      fill = cor.fill; stroke = cor.stroke; op = opac(r.intensidade);
      if (!modalidadesVistas.has(r.modalidade)) {
        modalidadesVistas.add(r.modalidade);
        legenda.push({ fill: cor.fill, stroke: cor.stroke, dash: false, label: MODALIDADES_TERAPIA[r.modalidade].nome["pt-BR"] });
      }
    } else if (r.kind === "achado_exame") {
      fill = AMBER.fill; stroke = AMBER.stroke; op = 0.18; dash = "9 5";
      if (!achadosVistos.has(r.achado)) {
        achadosVistos.add(r.achado);
        legenda.push({ fill: AMBER.fill, stroke: AMBER.stroke, dash: true, label: ACHADO_LABEL[r.achado] ?? r.achado });
      }
    } else {
      fill = INDIGO.fill; stroke = INDIGO.stroke; op = 0.14; dash = "3 6";
      if (!temAvaliacao) {
        temAvaliacao = true;
        legenda.push({ fill: INDIGO.fill, stroke: INDIGO.stroke, dash: true, label: "Avaliação funcional" });
      }
    }

    const membro = tipoAlvo === "casco" ? (r.alvo as { membro?: string }).membro : undefined;
    for (const pl of parte.placements) {
      const g = px(pl);
      shapes.push(
        `<ellipse cx="${g.cx.toFixed(1)}" cy="${g.cy.toFixed(1)}" rx="${g.rx.toFixed(1)}" ry="${g.ry.toFixed(1)}" ` +
        `fill="rgb(${fill})" fill-opacity="${op}" stroke="${stroke}" stroke-width="2.5"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`
      );
      if (membro) {
        const bx = g.cx + g.rx * 0.85 + 6, by = g.cy - g.ry * 0.6 - 4;
        shapes.push(
          `<rect x="${(bx - 15).toFixed(1)}" y="${(by - 10).toFixed(1)}" width="30" height="18" rx="9" fill="#fff" stroke="${stroke}" stroke-width="1.8"/>` +
          `<text x="${bx.toFixed(1)}" y="${(by + 4).toFixed(1)}" font-family="sans-serif" font-size="11" font-weight="700" fill="${stroke}" text-anchor="middle">${esc(membro)}</text>`
        );
      }
    }
  }

  const LEGENDA_LINHA = 26;
  const legendaAltura = legenda.length > 0 ? legenda.length * LEGENDA_LINHA + 14 : 0;
  const total_h = HEADER + h + legendaAltura + (completo ? 0 : 24);

  const legendaSvg = legenda.map((e, i) => {
    const y = HEADER + h + 20 + i * LEGENDA_LINHA;
    const dashAttr = e.dash ? ` stroke-dasharray="5 4"` : "";
    return (
      `<circle cx="18" cy="${y}" r="8" fill="rgb(${e.fill})" fill-opacity="${e.dash ? 0.2 : 0.65}" stroke="${e.stroke}" stroke-width="2"${dashAttr}/>` +
      `<text x="34" y="${y + 5}" font-family="sans-serif" font-size="14" font-weight="600" fill="#0f172a">${esc(e.label)}</text>`
    );
  }).join("");

  const avisoIncompleto = completo ? "" :
    `<text x="10" y="${total_h - 8}" font-family="sans-serif" font-size="13" font-weight="700" fill="#b45309">${esc("⚠ Sessão incompleta (ditado truncado)")}</text>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${total_h}" width="100%" preserveAspectRatio="xMidYMid meet">` +
    `<rect width="${w}" height="${total_h}" fill="#ffffff"/>` +
    `<text x="10" y="28" font-family="sans-serif" font-size="20" font-weight="700" fill="#0f172a">${esc(titulo)}</text>` +
    `<image x="0" y="${HEADER}" width="${w}" height="${h}" href="data:image/png;base64,${base64}"/>` +
    `<g id="camada-pintura">${shapes.join("")}</g>` +
    `<g id="camada-legenda">${legendaSvg}</g>` +
    avisoIncompleto +
    `</svg>`
  );
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export interface PintarLaudoPresetOptions {
  registros: ReadonlyArray<RegistroClinico>;
  titulo: string;
  completo?: boolean;
}

/** Laudo de FERRAGEAMENTO — pinta sobre casco.png. */
export function pintarLaudoCasco(opts: PintarLaudoPresetOptions): string | null {
  const partes: Record<string, ParteRaster> = {};
  for (const p of Object.values(PARTES_CASCO)) partes[p.id as ParteCascoId] = { nome: p.nome, placements: p.placements };
  return pintarLaudoRaster({
    pngPath: path.join(__dirname, "anatomia-casco", "casco.png"),
    partes, tipoAlvo: "casco", ...opts,
  });
}

/** Laudo ODONTOLÓGICO — pinta sobre odontologia.png. */
export function pintarLaudoDental(opts: PintarLaudoPresetOptions): string | null {
  const partes: Record<string, ParteRaster> = {};
  for (const p of Object.values(PARTES_DENTE)) partes[p.id] = { nome: p.nome, placements: p.placements };
  return pintarLaudoRaster({
    pngPath: path.join(__dirname, "anatomia-dental", "odontologia.png"),
    partes, tipoAlvo: "dente", ...opts,
  });
}

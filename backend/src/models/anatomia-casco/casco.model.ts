/**
 * Anatomia do casco equino — partes + geometria sobre a imagem `casco.png`
 * (mesma pasta). Coordenadas em PORCENTAGEM do canvas da imagem (0–100),
 * calibráveis visualmente. A imagem tem 3 vistas: solar (superior esquerda),
 * lateral simples (inferior esquerda) e lateral oblíqua (inferior direita).
 *
 * Usado quando a evolução é de FERRAGEAMENTO: a IA extrai registros com alvo
 * { tipo:'casco', parteId, membro? } e o painter pinta sobre a imagem.
 */

export const PARTE_CASCO_IDS = [
  'bulbos', 'sulco_central_ranilha', 'angulo_inflexao_muralha', 'barras',
  'sulco_lateral_ranilha', 'vertice_ranilha', 'ranilha', 'sola', 'quartos',
  'muralha', 'parede', 'talao', 'coroa', 'linha_branca', 'pincas',
] as const;
export type ParteCascoId = (typeof PARTE_CASCO_IDS)[number];

export interface PlacementPct { cx: number; cy: number; rx: number; ry: number }

export interface ParteCasco {
  readonly id: ParteCascoId;
  readonly nome: string; // pt-BR — vai para o prompt e para a legenda
  readonly placements: ReadonlyArray<PlacementPct>;
}

export const PARTES_CASCO: Readonly<Record<ParteCascoId, ParteCasco>> = {
  // ── Vista solar (superior, x≈17–50 / y≈3–55) ────────────────────────────────
  bulbos: { id: 'bulbos', nome: 'Bulbos do talão',
    placements: [{ cx: 33.5, cy: 7, rx: 9.5, ry: 4.5 }] },
  sulco_central_ranilha: { id: 'sulco_central_ranilha', nome: 'Sulco central da ranilha',
    placements: [{ cx: 34, cy: 14.5, rx: 3.5, ry: 5 }] },
  angulo_inflexao_muralha: { id: 'angulo_inflexao_muralha', nome: 'Ângulo de inflexão da muralha',
    placements: [{ cx: 46.5, cy: 17.5, rx: 2.5, ry: 2.5 }, { cx: 21, cy: 17.5, rx: 2.5, ry: 2.5 }] },
  barras: { id: 'barras', nome: 'Barras',
    placements: [{ cx: 26, cy: 24, rx: 3, ry: 6 }, { cx: 42, cy: 24, rx: 3, ry: 6 }] },
  sulco_lateral_ranilha: { id: 'sulco_lateral_ranilha', nome: 'Sulco lateral da ranilha',
    placements: [{ cx: 29.5, cy: 28, rx: 2.5, ry: 6.5 }, { cx: 38.5, cy: 28, rx: 2.5, ry: 6.5 }] },
  vertice_ranilha: { id: 'vertice_ranilha', nome: 'Vértice da ranilha',
    placements: [{ cx: 34, cy: 38, rx: 3.5, ry: 3.5 }] },
  ranilha: { id: 'ranilha', nome: 'Ranilha',
    placements: [{ cx: 34, cy: 25, rx: 7, ry: 13 }] },
  sola: { id: 'sola', nome: 'Sola',
    placements: [{ cx: 34, cy: 41, rx: 12, ry: 8 }] },
  quartos: { id: 'quartos', nome: 'Quartos',
    placements: [{ cx: 18.5, cy: 30, rx: 3, ry: 10 }, { cx: 49, cy: 30, rx: 3, ry: 10 }] },
  muralha: { id: 'muralha', nome: 'Muralha do casco',
    placements: [{ cx: 33.5, cy: 31, rx: 16.5, ry: 23 }] },

  // ── Vista lateral simples (inferior esquerda, x≈8–38 / y≈62–92) ─────────────
  parede: { id: 'parede', nome: 'Parede do casco',
    placements: [{ cx: 15, cy: 81, rx: 7, ry: 7 }] },
  talao: { id: 'talao', nome: 'Talão',
    placements: [{ cx: 30, cy: 87, rx: 4, ry: 4.5 }] },

  // ── Vista lateral oblíqua (inferior direita, x≈48–95 / y≈55–95) ─────────────
  coroa: { id: 'coroa', nome: 'Coroa (banda coronária)',
    placements: [{ cx: 73, cy: 65, rx: 10, ry: 3.5 }] },
  linha_branca: { id: 'linha_branca', nome: 'Linha branca',
    placements: [{ cx: 60, cy: 86, rx: 6, ry: 3 }] },
  pincas: { id: 'pincas', nome: 'Pinças (frente do casco)',
    placements: [{ cx: 52, cy: 80, rx: 4, ry: 7 }] },
} as const;

/** Membros: qual casco foi tratado (badge no desenho). */
export const MEMBROS_CASCO = ['AE', 'AD', 'PE', 'PD'] as const;
export type MembroCasco = (typeof MEMBROS_CASCO)[number];

export const MEMBRO_LABEL: Record<MembroCasco, string> = {
  AE: 'Anterior esquerdo',
  AD: 'Anterior direito',
  PE: 'Posterior esquerdo',
  PD: 'Posterior direito',
};

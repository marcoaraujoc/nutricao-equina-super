/**
 * Anatomia dentária equina — dentes por quadrante + geometria sobre a imagem
 * `odontologia.png` (mesma pasta). Coordenadas em % do canvas, calibráveis.
 *
 * Quadrantes (padrão Triadan, como na imagem):
 *   #1 = superior direito do cavalo (crânio à ESQUERDA na imagem, fileira de cima)
 *   #2 = superior esquerdo (crânio à DIREITA, fileira de cima)
 *   #3 = inferior esquerdo (crânio à DIREITA, fileira de baixo)
 *   #4 = inferior direito  (crânio à ESQUERDA, fileira de baixo)
 * Posições 1–11: 1-3 incisivos, 4 canino, 5 1º pré-molar (dente de lobo),
 * 6-8 pré-molares, 9-11 molares. Triadan: 208 = quadrante 2, posição 08.
 *
 * Usado quando a evolução é de ODONTOLOGIA: alvo { tipo:'dente', parteId }.
 */

import type { PlacementPct } from '../anatomia-casco/casco.model';

export type Quadrante = 1 | 2 | 3 | 4;

export interface ParteDente {
  readonly id: string;          // ex: "d2_08" (quadrante 2, posição 08)
  readonly nome: string;        // ex: "Dente 208 (pré-molar sup. esq.)"
  readonly placements: ReadonlyArray<PlacementPct>;
}

const CLASSE: Record<number, string> = {
  1: 'incisivo', 2: 'incisivo', 3: 'incisivo', 4: 'canino',
  5: 'dente de lobo', 6: 'pré-molar', 7: 'pré-molar', 8: 'pré-molar',
  9: 'molar', 10: 'molar', 11: 'molar',
};
const LADO_Q: Record<Quadrante, string> = { 1: 'sup. dir.', 2: 'sup. esq.', 3: 'inf. esq.', 4: 'inf. dir.' };

// ── Geometria (estimada sobre odontologia.png; calibrar visualmente) ─────────
// Crânio ESQUERDO (quadrantes 1 e 4): fileiras de dentes 5..11 correm da direita
// (posição 5, perto do focinho) para a esquerda (posição 11).
// Crânio DIREITO (quadrantes 2 e 3): espelhado.
// Incisivos (1-3): no quadro central superior (fileiras 3-2-1 | 1-2-3).

// Coordenadas calibradas sobre odontologia.png (761x284) com grade percentual.
// Incisivos (1-3): quadro central. Fileiras 5-11: sobre os números nos crânios
// (fileiras inclinadas — cada dente tem seu par x/y). Caninos (4): no focinho.
const INCISIVOS: Record<Quadrante, ReadonlyArray<[number, number]>> = {
  1: [[46.6, 25], [43.9, 25], [41.7, 25]],   // pos 1,2,3 — quadro superior, metade esquerda
  2: [[50.4, 25], [52.9, 25], [55.2, 25]],   // quadro superior, metade direita
  3: [[50.2, 43], [52.6, 43], [54.9, 43]],   // quadro inferior, metade direita
  4: [[46.2, 43], [43.7, 43], [41.6, 43]],   // quadro inferior, metade esquerda
};
const CANINOS: Record<Quadrante, [number, number]> = {
  1: [39.8, 78.5], 2: [60.2, 78.5], 3: [63.7, 94], 4: [36.3, 94],
};
const FILEIRAS: Record<Quadrante, ReadonlyArray<[number, number]>> = {
  // pos 5, 6, 7, 8, 9, 10, 11
  1: [[34.3, 72],   [31.9, 70.5], [29.9, 69], [27.3, 67], [24.9, 65.5], [22.6, 64],   [20.4, 62.5]],
  4: [[30.9, 84.5], [28.2, 82],   [26.2, 81], [24.2, 80], [22.0, 79],   [19.9, 77.5], [17.8, 75.5]],
  2: [[65.7, 72],   [68.1, 70.5], [70.1, 69], [72.7, 67], [75.1, 65.5], [77.4, 64],   [79.6, 62.5]],
  3: [[69.1, 84.5], [71.8, 82],   [73.8, 81], [75.8, 80], [78.0, 79],   [80.1, 77.5], [82.2, 75.5]],
};

function geomDente(q: Quadrante, pos: number): PlacementPct[] {
  if (pos <= 3) {
    const [cx, cy] = INCISIVOS[q][pos - 1];
    return [{ cx, cy, rx: 1.3, ry: 4 }];
  }
  if (pos === 4) {
    const [cx, cy] = CANINOS[q];
    return [{ cx, cy, rx: 1.2, ry: 2.8 }];
  }
  const [cx, cy] = FILEIRAS[q][pos - 5];
  return [{ cx, cy, rx: 1.3, ry: 3.2 }];
}

function montarPartes(): Record<string, ParteDente> {
  const partes: Record<string, ParteDente> = {};
  for (const q of [1, 2, 3, 4] as Quadrante[]) {
    for (let pos = 1; pos <= 11; pos++) {
      const id  = `d${q}_${String(pos).padStart(2, '0')}`;
      const num = `${q}${String(pos).padStart(2, '0')}`;       // Triadan: 208, 411...
      partes[id] = {
        id,
        nome: `Dente ${num} (${CLASSE[pos]} ${LADO_Q[q]})`,
        placements: geomDente(q, pos),
      };
    }
  }
  return partes;
}

export const PARTES_DENTE: Readonly<Record<string, ParteDente>> = montarPartes();
export const PARTE_DENTE_IDS = Object.keys(PARTES_DENTE) as [string, ...string[]];

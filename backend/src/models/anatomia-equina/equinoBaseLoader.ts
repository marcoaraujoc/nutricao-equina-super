/**
 * Carrega o conteúdo interno de `equino-base.svg` (tudo dentro do `<svg>` raiz —
 * hoje um único `<path>` já em coordenadas absolutas no viewBox 0 0 1625 968,
 * sem transform) para uso como `baseInner` em `pintarLaudoEquino`. O `<path>`
 * não define `fill` próprio de propósito, para herdar a cor de
 * `#camada-base` (`fill="#1e293b"`) no SVG final. Lido uma vez e memoizado.
 *
 * Gerado a partir da imagem de referência (3 vistas: dorsal, posterior, lateral)
 * via `scripts/gerar-equino-base-svg.js` (potrace, threshold 180, turdSize 2) —
 * rodar aquele script de novo caso a arte de referência mude.
 */
import fs from 'fs';
import path from 'path';

let cache: string | null = null;

export function carregarBaseInnerEquino(): string {
  if (cache !== null) return cache;

  const svgPath = path.join(__dirname, 'equino-base.svg');
  const raw = fs.readFileSync(svgPath, 'utf8');

  const inicioTag = raw.indexOf('<svg');
  const aberturaFechada = raw.indexOf('>', inicioTag);
  const fechamento = raw.lastIndexOf('</svg>');
  if (inicioTag === -1 || aberturaFechada === -1 || fechamento === -1) {
    throw new Error('equino-base.svg: não foi possível localizar o conteúdo interno do <svg>.');
  }

  cache = raw.slice(aberturaFechada + 1, fechamento).trim();
  return cache;
}

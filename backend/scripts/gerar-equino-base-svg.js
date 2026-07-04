// Gera backend/src/models/anatomia-equina/equino-base.svg a partir de uma imagem
// de referência (PNG/JPG, idealmente 1625x968 — mesmo viewBox usado por
// pintarLaudoEquino.ts) via potrace. Uso:
//
//   npm install --no-save potrace   (não é dependência de runtime)
//   node scripts/gerar-equino-base-svg.js <caminho-da-imagem> [threshold] [turdSize]
//
// threshold (padrão 180) e turdSize (padrão 2) controlam a vetorização —
// aumentar o threshold captura traços mais claros/finos (hachuras, pelagem),
// diminuir remove ruído. O <path> gerado NÃO recebe fill próprio de propósito:
// ele herda a cor de `#camada-base` em pintarLaudoEquino.ts.
const potrace = require('potrace');
const fs = require('fs');
const path = require('path');

const [, , inputImage, thresholdArg, turdSizeArg] = process.argv;
if (!inputImage) {
  console.error('Uso: node scripts/gerar-equino-base-svg.js <imagem> [threshold=180] [turdSize=2]');
  process.exit(1);
}

const threshold = thresholdArg ? Number(thresholdArg) : 180;
const turdSize = turdSizeArg ? Number(turdSizeArg) : 2;
const destino = path.join(__dirname, '..', 'src', 'models', 'anatomia-equina', 'equino-base.svg');

potrace.trace(inputImage, {
  threshold,
  turdSize,
  optCurve: true,
  optTolerance: 0.2,
  blackOnWhite: true,
  color: 'black',
  background: 'white',
}, (err, svg) => {
  if (err) { console.error('Erro no potrace:', err); process.exit(1); }

  const m = svg.match(/<path\s+d="([^"]+)"[^>]*fill-rule="([^"]+)"/);
  if (!m) { console.error('Não encontrou <path> no SVG gerado pelo potrace.'); process.exit(1); }
  const [, d, fillRule] = m;

  const wm = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const [, w, h] = wm ?? [, '1625', '968'];

  const final =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">\n` +
    `<path d="${d}" fill-rule="${fillRule}"/>\n` +
    `</svg>\n`;

  fs.writeFileSync(destino, final);
  console.log(`OK: ${destino} (${final.length} bytes)`);
});

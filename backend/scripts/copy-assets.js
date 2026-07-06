// Copia assets não-TS (ex: equino-base.svg) de src/ para dist/ após o build,
// já que o tsc só copia .ts/.js — arquivos como .svg ficam de fora por padrão.
'use strict';
const fs = require('fs');
const path = require('path');

const ASSETS = [
  'models/anatomia-equina/equino-base.svg',
  'models/anatomia-casco/casco.png',          // laudo de ferrageamento
  'models/anatomia-dental/odontologia.png',   // laudo odontológico
];

for (const rel of ASSETS) {
  const src = path.join(__dirname, '..', 'src', rel);
  const dest = path.join(__dirname, '..', 'dist', rel);
  if (!fs.existsSync(src)) { console.warn(`[copy-assets] AUSENTE (pulado): ${rel}`); continue; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[copy-assets] ${rel}`);
}

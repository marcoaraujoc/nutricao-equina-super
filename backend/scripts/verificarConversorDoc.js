// backend/scripts/verificarConversorDoc.js
'use strict';

/**
 * Diagnóstico do conversor de documentos (.doc → .docx) — `npm run doc:check`.
 *
 * POR QUE EXISTE: o LibreOffice é a única dependência de SISTEMA da aplicação (todo o
 * resto é npm + Postgres), e ela degrada com gracia: sem o binário, o upload de um
 * laudo `.doc` continua funcionando e apenas não ganha pré-visualização. Isso é bom
 * para o usuário e péssimo para quem opera — o servidor não reclama, o log solta um
 * `console.warn` no meio de um upload qualquer, e a falta só aparece quando alguém
 * tenta abrir um laudo antigo e vê "pré-visualização indisponível".
 *
 * Este script responde a pergunta direta: ESTE ambiente converte `.doc` ou não?
 * Vale igual na máquina de desenvolvimento e no servidor de backend em produção.
 *
 * Ele exercita o MESMO caminho de código do upload (`normalizarDocLegado`), não uma
 * simulação: se aqui passar, o laudo `.doc` do prontuário converte.
 *
 *   node scripts/verificarConversorDoc.js            # usa um .doc mínimo embutido
 *   node scripts/verificarConversorDoc.js laudo.doc  # usa um laudo real seu
 *
 * Sai com código 0 quando converte e 1 quando não — dá para usar em healthcheck de
 * deploy sem precisar ler a saída.
 */

const fs   = require('fs');
const path = require('path');

const {
  normalizarDocLegado,
  converterDocParaDocx,
  MIME_DOCX,
} = require('../src/lib/documentoConversao');

// `process.stdout.write` e não `console.log`: `server.ts` redireciona o console para o
// Winston, e um script de diagnóstico não pode sair picado entre linhas de log
// (mesmo motivo do `scripts/rodarJob.js`).
const out = (linha = '') => process.stdout.write(`${linha}\n`);

/**
 * `.doc` de VERDADE para a amostra, gerado pelo próprio LibreOffice a partir de um texto.
 *
 * 🔴 (2026-10-08) Até aqui a amostra era um cabeçalho OLE2 sem conteúdo, montado à mão.
 * O LibreOffice do Linux RECUSA esse arquivo e sai com código 0 sem gerar nada — e o
 * diagnóstico acusava "CONVERSÃO INDISPONÍVEL" num servidor em que a conversão funciona
 * (medido na VPS de produção: o mesmo ambiente converteu um `.doc` real em 1,3 s). Um
 * diagnóstico que acusa falha falsa ensina a ignorá-lo.
 * Gerar a amostra com o LibreOffice não esconde problema nenhum: se o binário não roda,
 * a geração falha e o diagnóstico diz ISSO, com a saída dele.
 */
async function docDeAmostra() {
  const os = require('os');
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const { pathToFileURL } = require('url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's2vet-amostra-'));
  try {
    const txt = path.join(dir, 'amostra.txt');
    fs.writeFileSync(txt, 'Laudo de teste do conversor de documentos do S2Vet.\n');
    let saidaSoffice = '';
    try {
      const r = await promisify(execFile)(
        process.env.LIBREOFFICE_BIN || 'soffice',
        [`-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`,
         '--headless', '--norestore', '--convert-to', 'doc', '--outdir', dir, txt],
        { timeout: Number(process.env.LIBREOFFICE_TIMEOUT_MS) || 30000, windowsHide: true },
      );
      saidaSoffice = `${r.stdout}${r.stderr}`.trim();
    } catch (err) {
      saidaSoffice = `${err.message}\n${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    }
    const doc = path.join(dir, 'amostra.doc');
    if (!fs.existsSync(doc)) {
      throw new Error(`o LibreOffice não gerou a amostra .doc.${saidaSoffice ? `\n    Saída: ${saidaSoffice}` : ''}`);
    }
    return fs.readFileSync(doc);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const alvo = process.argv[2];

  out('');
  out('  Conversor de documentos .doc → .docx');
  out('  ────────────────────────────────────────────────────────');
  out(`  LIBREOFFICE_BIN         ${process.env.LIBREOFFICE_BIN || 'soffice (padrão)'}`);
  out(`  LIBREOFFICE_TIMEOUT_MS  ${process.env.LIBREOFFICE_TIMEOUT_MS || '30000 (padrão)'}`);
  out(`  Plataforma              ${process.platform}`);
  out('');

  let buffer;
  let nome;
  if (alvo) {
    const caminho = path.resolve(alvo);
    if (!fs.existsSync(caminho)) {
      out(`  ✗ Arquivo não encontrado: ${caminho}`);
      process.exit(1);
    }
    buffer = fs.readFileSync(caminho);
    nome   = path.basename(caminho);
    out(`  Amostra: ${nome} (${buffer.length} bytes)`);
  } else {
    try {
      buffer = await docDeAmostra();
    } catch (err) {
      out(`  ✗ CONVERSÃO INDISPONÍVEL — ${err.message}`);
      out('');
      out('  Confira: `soffice --version` responde? O diagnóstico roda com um HOME e uma');
      out('  pasta atual que o usuário consegue acessar? (ex.: `export HOME=/opt/s2vet/home`)');
      out('');
      process.exit(1);
    }
    nome = 'amostra.doc';
    out(`  Amostra: .doc gerado pelo LibreOffice (${buffer.length} bytes) — ou passe um laudo real como argumento`);
  }
  out('');

  const inicio = Date.now();
  try {
    const docx = await converterDocParaDocx(buffer);
    const ms = Date.now() - inicio;
    out(`  ✓ CONVERSÃO OK — ${docx.length} bytes de .docx em ${ms} ms`);
    out('');
    out('  A pré-visualização de laudo .doc funciona neste ambiente, e a IA');
    out('  consegue ler o laudo .doc anexado ao resultado do exame.');
    out('');
    process.exit(0);
  } catch (err) {
    const ms = Date.now() - inicio;
    out(`  ✗ CONVERSÃO INDISPONÍVEL (${ms} ms)`);
    out(`    ${err.message}`);
    out('');

    // Confirma que a degradação está de pé: é ela que impede a falta do LibreOffice
    // de derrubar o lançamento de um resultado clínico. Se ESTA parte falhar, o
    // problema deixou de ser cosmético.
    const original = { originalname: nome, mimetype: 'application/msword', buffer, size: buffer.length };
    const saida = await normalizarDocLegado(original);
    const degradou = saida === original && saida.mimetype !== MIME_DOCX;
    out(degradou
      ? '  ✓ Degradação OK — o upload de .doc continua funcionando (arquivo guardado\n    como veio, apenas sem pré-visualização).'
      : '  ✗ ATENÇÃO: a degradação não se comportou como esperado — investigar antes de subir.');
    out('');
    out('  Para habilitar a conversão:');
    out('    Docker/Linux  → a camada já está no backend/Dockerfile (libreoffice-writer)');
    out('    Debian/Ubuntu → apt-get install -y libreoffice-writer fonts-liberation');
    out('    Windows       → instale o LibreOffice e defina no .env:');
    out('                    LIBREOFFICE_BIN=C:\\Program Files\\LibreOffice\\program\\soffice.exe');
    out('');
    process.exit(1);
  }
}

main().catch(err => {
  out(`  ✗ Erro inesperado: ${err?.stack ?? err}`);
  process.exit(1);
});

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
 * `.doc` MÍNIMO de verdade (contêiner OLE2/CFB do Word 97-2003) para o teste não
 * depender de o operador ter um laudo à mão. É só o cabeçalho + a estrutura que o
 * LibreOffice precisa para reconhecer o formato: o conteúdo é irrelevante — o que se
 * mede é se o binário existe, roda e escreve a saída.
 * ⚠️ Se o LibreOffice recusar este arquivo por ser mínimo demais, passe um `.doc` real
 * como argumento: o diagnóstico continua válido, só muda a amostra.
 */
function docMinimo() {
  const buf = Buffer.alloc(1536, 0);
  // Assinatura OLE2 (D0 CF 11 E0 A1 B1 1A E1) — é por ela que o LibreOffice
  // identifica o contêiner do Word 97-2003.
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buf, 0);
  buf.writeUInt16LE(0x003e, 24);   // versão menor
  buf.writeUInt16LE(0x0003, 26);   // versão maior
  buf.writeUInt16LE(0xfffe, 28);   // byte order (little endian)
  buf.writeUInt16LE(9, 30);        // tamanho do setor: 2^9 = 512
  return buf;
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
    buffer = docMinimo();
    nome   = 'amostra.doc';
    out('  Amostra: .doc mínimo embutido (passe um laudo real como argumento para testar com ele)');
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

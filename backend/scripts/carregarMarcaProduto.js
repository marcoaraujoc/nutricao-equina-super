// backend/scripts/carregarMarcaProduto.js
//
// Carrega a MARCA DO PRODUTO para o banco (tb_midia_arquivos, pasta 'marca',
// publico=true), servida por `GET /api/marca`.
//
// POR QUÊ no banco, se ela é pública de qualquer jeito: não é por segurança — a rota
// tem de ser aberta porque a marca aparece na tela de login, antes de existir sessão.
// É para NÃO SOBRAR nenhum código servindo arquivo do filesystem: com ela no banco o
// `express.static`/`sendFile` desaparece por completo, e não há mais um caminho de
// disco para alguém reabrir por descuido. De quebra, deploy deixa de exigir volume
// compartilhado — a marca viaja no dump do banco.
//
// Idempotente: substitui a linha anterior (a marca é única).
//
//   node scripts/carregarMarcaProduto.js [caminho/para/logo.png]
'use strict';

const fs     = require('fs/promises');
const path   = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PADRAO = path.join(__dirname, '../uploads/empresas/s2vet-logo.png');

const MIME_POR_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

(async () => {
  const origem = process.argv[2] ? path.resolve(process.argv[2]) : PADRAO;

  let conteudo;
  try {
    conteudo = await fs.readFile(origem);
  } catch {
    console.error(`Arquivo não encontrado: ${origem}`);
    console.error('Passe o caminho como argumento: node scripts/carregarMarcaProduto.js caminho/logo.png');
    await prisma.$disconnect();
    process.exit(1);
  }

  const ext = path.extname(origem).toLowerCase();
  const mime = MIME_POR_EXT[ext];
  if (!mime) {
    console.error(`Extensão não suportada para a marca: ${ext}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // A marca é única: remove a anterior para não acumular versões órfãs.
  const removidas = await prisma.midiaArquivo.deleteMany({ where: { pasta: 'marca' } });

  const chave = crypto.randomBytes(24).toString('hex');
  await prisma.midiaArquivo.create({
    data: {
      chave,
      conteudo,
      mimeType:     mime,
      nomeOriginal: path.basename(origem).slice(0, 255),
      tamanho:      conteudo.length,
      pasta:        'marca',
      empresaId:    null,
      animalId:     null,
      criadoPorId:  null,
      publico:      true,
    },
    select: { id: true },
  });

  console.log(`Marca carregada: ${origem}`);
  console.log(`  ${(conteudo.length / 1024).toFixed(1)} KB · ${mime}`);
  if (removidas.count) console.log(`  (substituiu ${removidas.count} versão anterior)`);
  console.log('  disponível em GET /api/marca');

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

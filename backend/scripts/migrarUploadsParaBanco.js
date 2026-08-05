// backend/scripts/migrarUploadsParaBanco.js
//
// Move os arquivos que já estão em `backend/uploads/` para o banco
// (schs2vet.tb_midia_arquivos) e reescreve as URLs guardadas nas colunas que as
// referenciam. Sem isto, toda foto/laudo/logo já cadastrado quebra ao remover o
// `express.static('/uploads')`.
//
// SEGURO DE RODAR MAIS DE UMA VEZ: registro já migrado (url `/api/midia/...`) é
// ignorado, e cada arquivo é gravado uma única vez (mapa por caminho de origem).
//
// NÃO apaga nada do disco. A limpeza é manual, depois de conferir a aplicação —
// desfazer é bem mais fácil com os arquivos ainda lá.
//
//   node scripts/migrarUploadsParaBanco.js          # aplica
//   node scripts/migrarUploadsParaBanco.js --dry    # só relata
'use strict';

const fs   = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
// Client próprio (e não `src/lib/prisma`, que é TypeScript e não carrega em `node`
// puro) — mesmo padrão dos demais scripts desta pasta.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UPLOADS_ROOT = path.join(__dirname, '../uploads');
const DRY = process.argv.includes('--dry');

// A marca do PRODUTO continua em disco (asset público, servido por rota própria).
const IGNORAR = new Set(['empresas/s2vet-logo.png']);

const MIME_POR_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif',  '.webp': 'image/webp',
  '.mp4': 'video/mp4',  '.webm': 'video/webm', '.ogg': 'video/ogg',
  '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',  '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.pdf': 'application/pdf',
};

// Onde as URLs estão guardadas. `pasta` é só a categoria registrada na mídia.
const COLUNAS = [
  { modelo: 'animal',              campo: 'photoUrl',   pasta: 'animais',        empresa: 'empresaId', animal: 'id'       },
  { modelo: 'evolucaoMidia',       campo: 'url',        pasta: 'evolucoes',      empresa: null,        animal: null      },
  { modelo: 'exameNutricional',    campo: 'arquivoUrl', pasta: 'exames',         empresa: null,        animal: 'animalId' },
  { modelo: 'exameClinico',        campo: 'arquivoUrl', pasta: 'exames',         empresa: null,        animal: 'animalId' },
  { modelo: 'exameImagemAnexo',    campo: 'arquivoUrl', pasta: 'exames-imagens', empresa: null,        animal: 'animalId' },
  { modelo: 'empresaConfiguracao', campo: 'logoUrl',    pasta: 'empresas',       empresa: 'empresaId', animal: null      },
];

const migrados = new Map(); // caminho em disco -> nova url
let gravados = 0, faltando = 0, jaOk = 0;

async function gravarArquivo(url, ctx, pasta) {
  if (migrados.has(url)) return migrados.get(url);

  const rel = url.replace(/^\/uploads\/?/, '');
  if (IGNORAR.has(rel)) return null;

  const abs = path.resolve(UPLOADS_ROOT, rel);
  const root = path.resolve(UPLOADS_ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null; // traversal

  let conteudo;
  try {
    conteudo = await fs.readFile(abs);
  } catch {
    faltando++;
    console.log(`  ! arquivo inexistente em disco: ${url}`);
    return null;
  }

  const ext   = path.extname(abs).toLowerCase();
  const chave = crypto.randomBytes(24).toString('hex');
  const nova  = `/api/midia/${chave}`;

  if (!DRY) {
    await prisma.midiaArquivo.create({
      data: {
        chave,
        conteudo,
        mimeType:     MIME_POR_EXT[ext] ?? 'application/octet-stream',
        nomeOriginal: path.basename(abs).slice(0, 255),
        tamanho:      conteudo.length,
        pasta,
        empresaId:    ctx.empresaId ?? null,
        animalId:     ctx.animalId  ?? null,
        criadoPorId:  null,
        publico:      false,
      },
      select: { id: true },
    });
  }

  migrados.set(url, nova);
  gravados++;
  return nova;
}

async function migrarColuna({ modelo, campo, pasta, empresa, animal }) {
  const select = { id: true, [campo]: true };
  if (empresa) select[empresa] = true;
  if (animal)  select[animal]  = true;

  const linhas = await prisma[modelo].findMany({
    where:  { [campo]: { startsWith: '/uploads/' } },
    select,
  });

  console.log(`\n${modelo}.${campo}: ${linhas.length} registro(s) apontando para /uploads`);

  for (const linha of linhas) {
    const url = linha[campo];
    const ctx = {
      empresaId: empresa ? linha[empresa] ?? null : null,
      animalId:  animal  ? linha[animal]  ?? null : null,
    };

    const nova = await gravarArquivo(url, ctx, pasta);
    if (!nova) continue;

    if (!DRY) {
      await prisma[modelo].update({ where: { id: linha.id }, data: { [campo]: nova } });
    }
    console.log(`  ${url}  ->  ${nova}`);
  }
}

// A mídia da evolução não tem animalId próprio: vem da evolução dona.
async function completarAnimalDaEvolucao() {
  const midias = await prisma.evolucaoMidia.findMany({
    where:  { url: { startsWith: '/api/midia/' } },
    select: { url: true, evolucao: { select: { animalId: true, empresaId: true } } },
  });
  for (const m of midias) {
    const chave = m.url.split('/api/midia/')[1];
    if (!chave || !m.evolucao) continue;
    if (DRY) continue;
    await prisma.midiaArquivo.updateMany({
      where: { chave, animalId: null },
      data:  { animalId: m.evolucao.animalId, empresaId: m.evolucao.empresaId ?? null },
    });
  }
}

(async () => {
  console.log(DRY ? '=== SIMULAÇÃO (--dry): nada será gravado ===' : '=== MIGRANDO uploads -> banco ===');

  for (const col of COLUNAS) {
    try {
      await migrarColuna(col);
    } catch (err) {
      console.error(`  x falha em ${col.modelo}.${col.campo}: ${err.message}`);
    }
  }

  try {
    await completarAnimalDaEvolucao();
  } catch (err) {
    console.error(`  x falha ao amarrar mídia de evolução ao animal: ${err.message}`);
  }

  // A foto do profissional vive em UsuarioEmpresa.foto_url, lida por SQL cru no
  // resto do sistema (o client Prisma pode não conhecer a coluna) — mesmo caminho aqui.
  try {
    const fotos = await prisma.$queryRawUnsafe(
      `SELECT user_id, empresa_id, foto_url FROM schs2vet.tb_usuario_empresa
        WHERE foto_url LIKE '/uploads/%'`
    );
    console.log(`\nUsuarioEmpresa.foto_url: ${fotos.length} registro(s)`);
    for (const f of fotos) {
      const nova = await gravarArquivo(f.foto_url, { empresaId: f.empresa_id, animalId: null }, 'profissionais');
      if (!nova) continue;
      if (!DRY) {
        await prisma.$executeRawUnsafe(
          `UPDATE schs2vet.tb_usuario_empresa SET foto_url = $1 WHERE user_id = $2 AND empresa_id = $3`,
          nova, f.user_id, f.empresa_id
        );
      }
      console.log(`  ${f.foto_url}  ->  ${nova}`);
    }
  } catch (err) {
    console.error(`  x falha em UsuarioEmpresa.foto_url: ${err.message}`);
  }

  console.log(`\n=== FIM === gravados: ${gravados} · já migrados: ${jaOk} · sem arquivo em disco: ${faltando}`);
  console.log('Os arquivos NÃO foram apagados de backend/uploads/. Confira a aplicação antes de removê-los.');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

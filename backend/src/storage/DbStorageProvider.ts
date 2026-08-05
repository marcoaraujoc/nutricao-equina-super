// backend/src/storage/DbStorageProvider.ts
//
// Guarda o arquivo NO BANCO (coluna `bytea`), não no filesystem.
//
// POR QUÊ trocar: `/uploads` era servido por `express.static`, ou seja, o byte saía da
// aplicação SEM passar por autenticação — o único gate era o nome aleatório do arquivo.
// Quem tivesse o link continuava lendo a foto do paciente ou o laudo depois de perder o
// acesso, inclusive de outra empresa. Com o conteúdo no banco não EXISTE caminho que não
// passe pelo controller: o gate vira a mesma regra de acesso do resto do sistema.
//
// Ganhos colaterais: backup do banco passa a levar as mídias junto (não havia rotina de
// backup do diretório), acaba o arquivo órfão em disco quando o registro é apagado, e
// deploy/escala horizontal deixam de exigir volume compartilhado entre instâncias.
//
// A URL devolvida (`/api/midia/<chave>`) tem o MESMO formato relativo da anterior
// (`/uploads/...`), então tudo que só repassa a string — colunas do banco, `<img src>`,
// printUrl — segue funcionando sem alteração.
import crypto from 'crypto';
import fs from 'fs/promises';
import prisma from '../lib/prisma';
import { StorageProvider, UploadedFile, ContextoArquivo } from './StorageProvider';

export const PREFIXO_MIDIA = '/api/midia/';

/**
 * TETO por arquivo (150 MB), aplicado NO PROVIDER e não só no multer.
 *
 * O `limits.fileSize` do multer é por rota: rota nova que esqueça de declará-lo aceita
 * qualquer tamanho, e o binário vai parar no banco — onde dói mais (o dump do backup
 * cresce junto). Aqui é o funil por onde TODO arquivo passa, então o teto vale para
 * todas as rotas, inclusive as que ainda não existem.
 *
 * O multer continua com o seu limite: ele recusa ANTES de ler o corpo inteiro, o que
 * é mais barato. Este é a rede de segurança, não a primeira linha.
 */
export const TETO_ARQUIVO_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 150 * 1024 * 1024;

export class ArquivoGrandeDemaisError extends Error {
  code = 'ARQUIVO_GRANDE_DEMAIS';
  constructor(tamanho: number) {
    super(`Arquivo de ${(tamanho / 1048576).toFixed(1)} MB excede o limite de ${(TETO_ARQUIVO_BYTES / 1048576).toFixed(0)} MB.`);
  }
}

/** Extrai a chave de uma URL `/api/midia/<chave>`; null se não for desse formato. */
export function chaveDaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf(PREFIXO_MIDIA);
  if (i === -1) return null;
  const chave = url.slice(i + PREFIXO_MIDIA.length).split(/[?#/]/)[0];
  return chave || null;
}

function sanitizePasta(folder: string): string {
  const limpa = (folder ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  // A raiz de `/uploads` (folder '') guardava a foto do animal — mantém o rótulo
  // explícito para a categoria não ficar vazia no banco.
  return limpa || 'animais';
}

export class DbStorageProvider implements StorageProvider {
  async upload(file: UploadedFile, folder: string, contexto: ContextoArquivo = {}): Promise<string> {
    // multer memoryStorage → buffer; diskStorage → path (usado onde o parser de LLM
    // precisa do arquivo em disco). Os dois caminhos terminam no mesmo lugar.
    let conteudo: Buffer | undefined = file.buffer;
    if (!conteudo && file.path) conteudo = await fs.readFile(file.path);
    if (!conteudo) throw new Error('Arquivo sem conteúdo para gravar.');
    if (conteudo.length > TETO_ARQUIVO_BYTES) throw new ArquivoGrandeDemaisError(conteudo.length);

    const chave = crypto.randomBytes(24).toString('hex');

    await prisma.midiaArquivo.create({
      data: {
        chave,
        conteudo,
        mimeType:     (file.mimetype || 'application/octet-stream').slice(0, 150),
        nomeOriginal: (file.originalname || '').slice(0, 255) || null,
        tamanho:      conteudo.length,
        pasta:        sanitizePasta(folder),
        empresaId:    contexto.empresaId   ?? null,
        animalId:     contexto.animalId    ?? null,
        criadoPorId:  contexto.criadoPorId ?? null,
        publico:      contexto.publico === true,
      },
      select: { id: true },
    });

    return `${PREFIXO_MIDIA}${chave}`;
  }

  async delete(filePath: string): Promise<void> {
    const chave = chaveDaUrl(filePath);
    if (!chave) return; // URL legada (/uploads/...) ou vazia — nada a apagar aqui
    try {
      await prisma.midiaArquivo.delete({ where: { chave } });
    } catch {
      // já removido — não é erro crítico (mesma semântica do provider de disco)
    }
  }

  getUrl(filePath: string): string {
    return filePath; // já é relativa; o frontend resolve via proxy
  }
}

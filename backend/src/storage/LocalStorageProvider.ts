import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { StorageProvider, UploadedFile } from './StorageProvider';

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

// Só caracteres seguros em nome de pasta — bloqueia traversal via `folder`.
function sanitizeFolder(folder: string): string {
  return (folder ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

export class LocalStorageProvider implements StorageProvider {
  async upload(file: UploadedFile, folder: string): Promise<string> {
    const safeFolder = sanitizeFolder(folder);
    const dir = path.join(UPLOADS_ROOT, safeFolder);
    await fs.mkdir(dir, { recursive: true });

    // Nunca usa o nome enviado pelo cliente como nome final do arquivo (evita path
    // traversal e sobrescrita). Gera um nome imprevisível (capability URL) e
    // reaproveita apenas uma extensão limpa.
    const extRaw = path.extname(file.originalname ?? '').toLowerCase();
    const ext = /^\.[a-z0-9]{1,8}$/.test(extRaw) ? extRaw : '';
    const filename = file.filename ?? `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
    const dest = path.join(dir, filename);

    if (file.buffer) {
      await fs.writeFile(dest, file.buffer);
    } else if (file.path) {
      await fs.copyFile(file.path, dest);
    }

    return safeFolder ? `/uploads/${safeFolder}/${filename}` : `/uploads/${filename}`;
  }

  async delete(filePath: string): Promise<void> {
    // filePath é a URL pública: /uploads/folder/file.jpg
    const rel = filePath.replace(/^\/uploads\/?/, '');
    const abs = path.resolve(UPLOADS_ROOT, rel);

    // Guard de path traversal: o caminho resolvido precisa permanecer dentro de UPLOADS_ROOT.
    const root = path.resolve(UPLOADS_ROOT);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      return; // tentativa de sair da raiz — ignora silenciosamente
    }

    try {
      await fs.unlink(abs);
    } catch {
      // arquivo já removido — não é erro crítico
    }
  }

  getUrl(filePath: string): string {
    return filePath; // URL já é relativa — o frontend resolve via proxy
  }
}

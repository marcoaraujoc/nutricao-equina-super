import fs from 'fs/promises';
import path from 'path';
import { StorageProvider, UploadedFile } from './StorageProvider';

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

export class LocalStorageProvider implements StorageProvider {
  async upload(file: UploadedFile, folder: string): Promise<string> {
    const dir = path.join(UPLOADS_ROOT, folder);
    await fs.mkdir(dir, { recursive: true });

    const filename = file.filename ?? `${Date.now()}-${file.originalname}`;
    const dest = path.join(dir, filename);

    if (file.buffer) {
      await fs.writeFile(dest, file.buffer);
    } else if (file.path) {
      await fs.copyFile(file.path, dest);
    }

    return folder ? `/uploads/${folder}/${filename}` : `/uploads/${filename}`;
  }

  async delete(filePath: string): Promise<void> {
    // filePath é a URL pública: /uploads/folder/file.jpg
    const abs = path.join(UPLOADS_ROOT, filePath.replace(/^\/uploads\/?/, ''));
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
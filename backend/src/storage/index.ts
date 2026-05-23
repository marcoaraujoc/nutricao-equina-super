import { StorageProvider } from './StorageProvider';
import { LocalStorageProvider } from './LocalStorageProvider';

function createStorageProvider(): StorageProvider {
  const driver = process.env.STORAGE_DRIVER ?? 'local';

  switch (driver) {
    case 'local':
      return new LocalStorageProvider();
    // case 's3':
    //   return new S3StorageProvider();
    // case 'gcs':
    //   return new GCSStorageProvider();
    default:
      throw new Error(`Storage driver desconhecido: ${driver}`);
  }
}

// Singleton — compartilhado por toda a aplicação
export const storage: StorageProvider = createStorageProvider();
export type { StorageProvider, UploadedFile } from './StorageProvider';
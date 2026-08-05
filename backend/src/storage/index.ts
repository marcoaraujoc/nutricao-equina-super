import { StorageProvider } from './StorageProvider';
import { LocalStorageProvider } from './LocalStorageProvider';
import { DbStorageProvider } from './DbStorageProvider';

function createStorageProvider(): StorageProvider {
  // Padrão: BANCO. O driver `local` grava em `/uploads`, que era servido por
  // express.static SEM autenticação — mantido só para depuração, nunca em produção.
  const driver = process.env.STORAGE_DRIVER ?? 'db';

  switch (driver) {
    case 'db':
      return new DbStorageProvider();
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
export { PREFIXO_MIDIA, chaveDaUrl, TETO_ARQUIVO_BYTES, ArquivoGrandeDemaisError } from './DbStorageProvider';
export type { StorageProvider, UploadedFile, ContextoArquivo } from './StorageProvider';

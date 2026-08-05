export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
  path?: string;
  filename?: string;
}

/**
 * Contexto de DONO do arquivo — é o que a rota de download usa para AUTORIZAR.
 *
 * Existe porque o gate deixou de ser o segredo da URL (capability URL de arquivo em
 * disco) e passou a ser a mesma regra de acesso do resto do sistema: `animalId` cai
 * em verificarAcessoAnimal; `empresaId` exige o contexto daquela empresa.
 *
 * Opcional na interface para não quebrar drivers que ignoram contexto (o local grava
 * em disco e não tem onde guardar isso) — mas o driver de banco DEPENDE dele: arquivo
 * gravado sem contexto e sem `publico` só é acessível pelo ADMIN.
 */
export interface ContextoArquivo {
  empresaId?: number | null;
  animalId?: number | null;
  criadoPorId?: number | null;
  /** true SOMENTE para asset do produto (marca S2Vet). Nunca para dado de cliente. */
  publico?: boolean;
}

export interface StorageProvider {
  /** Persiste o arquivo e retorna a URL relativa servida pela aplicação */
  upload(file: UploadedFile, folder: string, contexto?: ContextoArquivo): Promise<string>;

  /** Remove o arquivo pelo caminho retornado por upload() */
  delete(filePath: string): Promise<void>;

  /** Retorna a URL pública dado o caminho armazenado */
  getUrl(filePath: string): string;
}

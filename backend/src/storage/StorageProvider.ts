export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
  path?: string;
  filename?: string;
}

export interface StorageProvider {
  /** Persiste o arquivo e retorna a URL pública relativa (ex: /uploads/foo.jpg) */
  upload(file: UploadedFile, folder: string): Promise<string>;

  /** Remove o arquivo pelo caminho retornado por upload() */
  delete(filePath: string): Promise<void>;

  /** Retorna a URL pública dado o caminho armazenado */
  getUrl(filePath: string): string;
}
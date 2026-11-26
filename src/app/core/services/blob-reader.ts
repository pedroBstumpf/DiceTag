/**
 * Quem lê os arquivos (imagens) mostrados numa página. Fornecido por página, como o `SheetStore`:
 * na mesa de jogo é a sessão (navegador ou, na mesa online, o servidor); no Worldbuild, o mundo
 * aberto. Assim o `BlobUrlService` (shared) não precisa conhecer nenhuma das duas features.
 */
export abstract class BlobReader {
  /** O arquivo, ou undefined se não existir. */
  abstract getBlob(blobId: string): Promise<Blob | undefined>;
}

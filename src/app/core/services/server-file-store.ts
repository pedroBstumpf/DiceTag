import { uploadName } from '../utils/file-name';
import { FileStore } from './file-store';
import { ServerApiService } from './server-api.service';

/**
 * Arquivos de uma mesa online, guardados no servidor (`/api/files`, escopo da mesa).
 *
 * O servidor confere o tipo pelos bytes (só imagens raster e áudio), aplica as cotas da conta e
 * da mesa e só entrega o arquivo a membros da mesa. O id é gerado pelo servidor. Não é um serviço
 * do Angular: a mesa online cria um por mesa aberta (`TableSessionService.connect`).
 */
export class ServerFileStore extends FileStore {
  constructor(
    private readonly api: ServerApiService,
    private readonly tableId: string,
  ) {
    super();
  }

  async put(file: Blob): Promise<string> {
    const { file: saved } = await this.api.upload<{ file: { id: string } }>(`/files?tableId=${encodeURIComponent(this.tableId)}`, file, uploadName(file));
    return saved.id;
  }

  get(id: string): Promise<Blob | undefined> {
    return this.api.getBlob(`/files/${encodeURIComponent(id)}`);
  }

  async remove(id: string): Promise<void> {
    // Jogador não apaga arquivo do mestre (403) e o arquivo pode já ter sumido (404): nada a fazer
    await this.api.delete(`/files/${encodeURIComponent(id)}`).catch(() => undefined);
  }
}

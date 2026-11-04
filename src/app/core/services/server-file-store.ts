import { uploadName } from '../utils/file-name';
import { FileStore } from './file-store';
import { ServerApiService } from './server-api.service';

/** De quem são os arquivos: de uma mesa (qualquer membro envia) ou de um mundo (só o dono envia). */
export type FileScope = { tableId: string } | { worldId: string };

/**
 * Arquivos guardados no servidor (`/api/files`), de uma mesa online ou de um mundo do servidor.
 *
 * O servidor confere o tipo pelos bytes (só imagens raster e áudio), aplica as cotas da conta e
 * da mesa e só entrega o arquivo a quem participa. O id é gerado pelo servidor. Não é um serviço
 * do Angular: cada mesa ou mundo aberto cria o seu.
 */
export class ServerFileStore extends FileStore {
  constructor(
    private readonly api: ServerApiService,
    private readonly scope: FileScope,
  ) {
    super();
  }

  async put(file: Blob): Promise<string> {
    const query = 'tableId' in this.scope ? `tableId=${encodeURIComponent(this.scope.tableId)}` : `worldId=${encodeURIComponent(this.scope.worldId)}`;
    const { file: saved } = await this.api.upload<{ file: { id: string } }>(`/files?${query}`, file, uploadName(file));
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

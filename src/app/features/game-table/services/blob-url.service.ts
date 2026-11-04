import { DestroyRef, Injectable, WritableSignal, inject, signal } from '@angular/core';
import { WorldbuildService } from '../../worldbuild/services/worldbuild.service';
import { TableSessionService } from './table-session.service';

/**
 * URLs temporárias (object URLs) para arquivos guardados, com cache.
 * Usado pelas imagens de token: vários tokens da mesma ficha compartilham
 * a mesma URL, e o arquivo é lido só uma vez.
 *
 * Na mesa, lê pela sessão (`getBlob`: no navegador ou, na mesa online, no servidor); no
 * Worldbuild (sem sessão), de onde o mundo aberto guarda as imagens.
 * Fornecido na página da mesa: ao sair dela, todas as URLs são liberadas.
 */
@Injectable()
export class BlobUrlService {
  private readonly worldbuild = inject(WorldbuildService);
  private readonly session = inject(TableSessionService, { optional: true });
  private readonly cache = new Map<string, WritableSignal<string | null>>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const url of this.cache.values()) {
        const value = url();
        if (value) URL.revokeObjectURL(value);
      }
    });
  }

  /** URL do arquivo (null enquanto carrega ou se não existir). Reativo. */
  url(blobId: string | undefined): string | null {
    if (!blobId) return null;
    let url = this.cache.get(blobId);
    if (!url) {
      const created = signal<string | null>(null);
      this.cache.set(blobId, created);
      const read = this.session ? this.session.getBlob(blobId) : this.worldbuild.getBlob(blobId);
      read.then((blob) => {
        if (blob) created.set(URL.createObjectURL(blob));
      });
      url = created;
    }
    return url();
  }
}

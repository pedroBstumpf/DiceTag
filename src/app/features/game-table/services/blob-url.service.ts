import { DestroyRef, Injectable, WritableSignal, inject, signal } from '@angular/core';
import { StorageService } from '../../../core/services/storage.service';

/**
 * URLs temporárias (object URLs) para arquivos do IndexedDB, com cache.
 * Usado pelas imagens de token: vários tokens da mesma ficha compartilham
 * a mesma URL, e o arquivo é lido só uma vez.
 *
 * Fornecido na página da mesa: ao sair dela, todas as URLs são liberadas.
 */
@Injectable()
export class BlobUrlService {
  private readonly storage = inject(StorageService);
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
      this.storage.get<Blob>(`blob:${blobId}`).then((blob) => {
        if (blob) created.set(URL.createObjectURL(blob));
      });
      url = created;
    }
    return url();
  }
}

import { DestroyRef, Injectable, WritableSignal, inject, signal } from '@angular/core';
import { BlobReader } from '../../core/services/blob-reader';

/**
 * URLs temporárias (object URLs) para arquivos guardados, com cache.
 * Usado pelas imagens de token e de ficha: vários tokens da mesma ficha compartilham
 * a mesma URL, e o arquivo é lido só uma vez.
 *
 * Lê pelo `BlobReader` que a página fornece (na mesa, a sessão: navegador ou, na mesa online,
 * o servidor; no Worldbuild, o mundo aberto). Fornecido por página: ao sair dela, todas as URLs
 * são liberadas.
 */
@Injectable()
export class BlobUrlService {
  private readonly reader = inject(BlobReader);
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
      this.reader.getBlob(blobId).then((blob) => {
        if (blob) created.set(URL.createObjectURL(blob));
      });
      url = created;
    }
    return url();
  }
}

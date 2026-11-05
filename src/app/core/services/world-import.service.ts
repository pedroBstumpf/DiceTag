import { Injectable, inject, signal } from '@angular/core';
import { WorldItem, worldItemBlobIds } from '../models/world-item.model';
import { worldbuildKey } from '../models/world.model';
import { AuthService } from './auth.service';
import { LocalFileStore } from './file-store';
import { ServerApiService, ServerError } from './server-api.service';
import { ServerFileStore } from './server-file-store';
import { StorageService } from './storage.service';

/** Resultado de um envio: o que foi e o que ficou para trás. */
export interface WorldImportResult {
  items: number;
  files: number;
  failedItems: number;
  failedFiles: number;
}

/** O servidor limita os envios por minuto: espera e tenta de novo, poucas vezes. */
const RATE_LIMIT_WAIT_MS = 30_000;
const RATE_LIMIT_RETRIES = 3;

/**
 * Envia um mundo guardado neste navegador (IndexedDB) para um mundo do servidor, para o mestre
 * levar à mesa online o que já criou. Só acrescenta: o mundo local continua aqui, intacto, e itens
 * do servidor com outros ids não são tocados. Reenviar substitui os itens de mesmo id.
 *
 * Imagens vão antes dos itens: o servidor gera ids novos, então cada item é gravado já com eles.
 */
@Injectable({ providedIn: 'root' })
export class WorldImportService {
  private readonly api = inject(ServerApiService);
  private readonly auth = inject(AuthService);
  private readonly storage = inject(StorageService);
  private readonly localFiles = inject(LocalFileStore);

  /** Andamento, para a tela ("3 de 20 itens"). Vazio = nada em andamento. */
  readonly progress = signal('');

  async run(localWorldId: string, serverWorldId: string): Promise<WorldImportResult> {
    const user = this.auth.user();
    if (!user) throw new ServerError(0, 'Ninguém está usando o app neste navegador.');
    const items = (await this.storage.get<WorldItem[]>(worldbuildKey(user.id, localWorldId))) ?? [];
    return this.send(items, (id) => this.localFiles.get(id), serverWorldId);
  }

  /** Envia itens e imagens de qualquer origem (este navegador ou uma cópia). Devolve também os ids novos das imagens. */
  async send(
    items: WorldItem[],
    fileOf: (blobId: string) => Promise<Blob | undefined>,
    serverWorldId: string,
  ): Promise<WorldImportResult & { newIds: ReadonlyMap<string, string> }> {
    const result: WorldImportResult = { items: 0, files: 0, failedItems: 0, failedFiles: 0 };
    const worldPath = `/worlds/${encodeURIComponent(serverWorldId)}/items`;
    const files = new ServerFileStore(this.api, { worldId: serverWorldId });
    try {
      // Imagens: id local → id no servidor
      const blobIds = [...new Set(items.flatMap(worldItemBlobIds))];
      const newIds = new Map<string, string>();
      for (const [i, blobId] of blobIds.entries()) {
        this.progress.set(`Enviando imagens: ${i + 1} de ${blobIds.length}`);
        const blob = await fileOf(blobId);
        const saved = blob && (await this.retry(() => files.put(blob)).catch(() => null));
        if (saved) {
          newIds.set(blobId, saved);
          result.files++;
        } else {
          result.failedFiles++;
        }
      }
      // Itens, já com os ids novos das imagens
      for (const [i, item] of items.entries()) {
        this.progress.set(`Enviando itens: ${i + 1} de ${items.length}`);
        const sent = await this.retry(() => this.api.put(`${worldPath}/${encodeURIComponent(item.id)}`, withNewBlobIds(item, newIds))).then(
          () => true,
          () => false,
        );
        if (sent) result.items++;
        else result.failedItems++;
      }
      return { ...result, newIds };
    } finally {
      this.progress.set('');
    }
  }

  /** Repete quando o servidor pede para esperar (limite de envios por minuto). */
  async retry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof ServerError) || error.status !== 429 || attempt >= RATE_LIMIT_RETRIES) throw error;
        this.progress.set('O servidor pediu uma pausa. Continuando em 30 s…');
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
      }
    }
  }
}

/** O item com os ids das imagens trocados pelos do servidor (imagem que não foi fica sem referência). */
export function withNewBlobIds(item: WorldItem, newIds: ReadonlyMap<string, string>): WorldItem {
  const swap = (id: string | undefined): string | undefined => (id ? newIds.get(id) : undefined);
  const copy: WorldItem = { ...item };
  const set = (field: 'blobId' | 'maleBlobId' | 'femaleBlobId') => {
    const next = swap(item[field]);
    if (next) copy[field] = next;
    else delete copy[field];
  };
  set('blobId');
  set('maleBlobId');
  set('femaleBlobId');
  if (item.token) {
    const { blobId, ...token } = item.token;
    const next = swap(blobId);
    copy.token = next ? { ...token, blobId: next } : token;
  }
  if (item.sheet) {
    copy.sheet = {
      ...item.sheet,
      inventory: item.sheet.inventory.map(({ blobId, ...entry }) => {
        const next = swap(blobId);
        return next ? { ...entry, blobId: next } : entry;
      }),
    };
  }
  return copy;
}

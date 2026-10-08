import { Injectable } from '@angular/core';

/**
 * Armazenamento local chave/valor sobre IndexedDB.
 *
 * Usado enquanto o app não tem backend: guarda usuários, mesas,
 * itens do worldbuild e arquivos (imagens/mapas) no próprio navegador.
 * IndexedDB foi escolhido no lugar do localStorage porque suporta
 * Blobs e volumes grandes (mapas em alta resolução).
 *
 * Quando houver uma API, basta trocar a implementação deste serviço.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly dbName = 'dicetag'; // nome antigo do projeto, mantido para não perder os dados salvos
  private readonly storeName = 'kv';
  private dbPromise?: Promise<IDBDatabase>;

  /** Lê um valor (ou undefined se não existir). */
  async get<T>(key: string): Promise<T | undefined> {
    const store = await this.store('readonly');
    return this.request<T | undefined>(store.get(key));
  }

  /** Grava (ou substitui) um valor. */
  async set<T>(key: string, value: T): Promise<void> {
    const store = await this.store('readwrite');
    await this.request(store.put(value, key));
  }

  /** Remove um valor. */
  async delete(key: string): Promise<void> {
    const store = await this.store('readwrite');
    await this.request(store.delete(key));
  }

  // --- Internos ------------------------------------------------------------

  /** Abre o banco uma única vez e reaproveita a conexão. */
  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(this.storeName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  /** Converte uma IDBRequest em Promise. */
  private request<T>(req: IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }
}

import { Injectable, inject } from '@angular/core';
import { newId } from '../utils/id';
import { StorageService } from './storage.service';

/**
 * Arquivos binários (mapas, imagens de token e de itens, áudios) guardados por id — o
 * "FilesRepository" do SPEC.md §2. Os objetos de domínio guardam só o id (`blobId`).
 *
 * Implementações: `LocalFileStore` (IndexedDB, mesas locais e Worldbuild) e `ServerFileStore`
 * (servidor, mesa online).
 */
export abstract class FileStore {
  /** Guarda o arquivo e devolve o id dele. Pode falhar (ex.: servidor recusou o tipo ou a cota acabou). */
  abstract put(file: Blob): Promise<string>;
  /** O arquivo, ou undefined se não existir (ou não estiver acessível). */
  abstract get(id: string): Promise<Blob | undefined>;
  /** Apaga o arquivo (sem erro se já não existir ou se a conta não puder apagá-lo). */
  abstract remove(id: string): Promise<void>;

  /** Duplica o arquivo (cada cópia de ficha ou de item cuida da sua). undefined = original não existe. */
  async copy(id: string): Promise<string | undefined> {
    const blob = await this.get(id);
    return blob ? this.put(blob) : undefined;
  }
}

/** Arquivos no IndexedDB do navegador, nas chaves `blob:<id>`. */
@Injectable({ providedIn: 'root' })
export class LocalFileStore extends FileStore {
  private readonly storage = inject(StorageService);

  async put(file: Blob): Promise<string> {
    const id = newId();
    await this.storage.set(`blob:${id}`, file);
    return id;
  }

  get(id: string): Promise<Blob | undefined> {
    return this.storage.get<Blob>(`blob:${id}`);
  }

  remove(id: string): Promise<void> {
    return this.storage.delete(`blob:${id}`);
  }
}

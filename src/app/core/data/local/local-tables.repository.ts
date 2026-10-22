import { Injectable, inject } from '@angular/core';
import { GameTable, NewGameTable } from '../../models/game-table.model';
import { TableState } from '../../models/table-session.model';
import { User } from '../../models/user.model';
import { StorageService } from '../../services/storage.service';
import { newId } from '../../utils/id';
import type { TablesRepository } from '../tables.repository';

const TABLES_KEY = 'tables';

/**
 * Mesas do modo offline: todas as contas deste navegador na chave `tables` do IndexedDB,
 * filtradas pelo dono. Excluir apaga também `table-state:<id>` e os arquivos da mesa.
 */
@Injectable({ providedIn: 'root' })
export class LocalTablesRepository implements TablesRepository {
  private readonly storage = inject(StorageService);

  async list(user: User): Promise<GameTable[]> {
    return (await this.all()).filter((t) => t.ownerId === user.id);
  }

  async create(user: User, data: NewGameTable): Promise<GameTable> {
    const table: GameTable = { ...data, id: newId(), ownerId: user.id, createdAt: Date.now() };
    await this.storage.set(TABLES_KEY, [...(await this.all()), table]);
    this.storage.requestPersistence();
    return table;
  }

  async remove(user: User, id: string): Promise<void> {
    await this.storage.set(
      TABLES_KEY,
      (await this.all()).filter((t) => !(t.id === id && t.ownerId === user.id)),
    );
    await this.purgeTableData(id);
  }

  private async all(): Promise<GameTable[]> {
    return (await this.storage.get<GameTable[]>(TABLES_KEY)) ?? [];
  }

  /** Apaga "table-state:<id>" e os Blobs referenciados por ele. */
  private async purgeTableData(id: string): Promise<void> {
    const key = `table-state:${id}`;
    const state = await this.storage.get<TableState>(key);
    if (state) {
      const blobIds = [
        ...state.scenes.flatMap((s) => [s.blobId, ...(s.drops ?? []).map((d) => d.item.blobId)]),
        ...state.entries.flatMap((e) => [e.blobId, e.token?.blobId]),
        ...(state.items ?? []).map((i) => i.blobId),
      ].filter((b): b is string => !!b);
      await Promise.all(blobIds.map((b) => this.storage.delete(`blob:${b}`)));
    }
    await this.storage.delete(key);
  }
}

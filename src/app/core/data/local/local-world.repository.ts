import { Injectable, inject } from '@angular/core';
import { User } from '../../models/user.model';
import { WorldItem, worldItemBlobIds } from '../../models/world-item.model';
import { DEFAULT_WORLD_ID, DEFAULT_WORLD_NAME, World, worldbuildKey } from '../../models/world.model';
import { StorageService } from '../../services/storage.service';
import { newId } from '../../utils/id';
import type { WorldRepository } from '../world.repository';

/**
 * Mundos do modo offline: a lista em `worlds:<usuário>` no IndexedDB. Sem lista salva, a conta
 * tem só o primeiro mundo (`DEFAULT_WORLD_ID`), que usa a chave do Worldbuild de antes dos
 * mundos — nada foi migrado. Excluir apaga os itens, os arquivos e a mesa de trabalho do mundo.
 */
@Injectable({ providedIn: 'root' })
export class LocalWorldRepository implements WorldRepository {
  private readonly storage = inject(StorageService);

  async worlds(user: User): Promise<World[]> {
    const saved = await this.storage.get<World[]>(this.key(user));
    return saved?.length ? saved : [{ id: DEFAULT_WORLD_ID, name: DEFAULT_WORLD_NAME, createdAt: Date.now() }];
  }

  async createWorld(user: User, name: string): Promise<World> {
    const world: World = { id: newId(), name, createdAt: Date.now() };
    await this.storage.set(this.key(user), [...(await this.worlds(user)), world]);
    this.storage.requestPersistence();
    return world;
  }

  async renameWorld(user: User, id: string, name: string): Promise<void> {
    const worlds = await this.worlds(user);
    await this.storage.set(this.key(user), worlds.map((w) => (w.id === id ? { ...w, name } : w)));
  }

  async removeWorld(user: User, id: string): Promise<void> {
    const key = worldbuildKey(user.id, id);
    const items = (await this.storage.get<WorldItem[]>(key)) ?? [];
    await Promise.all(items.flatMap(worldItemBlobIds).map((b) => this.storage.delete(`blob:${b}`)));
    await this.storage.delete(key);
    // Janelas salvas da mesa de trabalho deste mundo (WorldbuildService.saveDesk)
    await this.storage.delete(`desk:${user.id}:${id}`);
    await this.storage.set(this.key(user), (await this.worlds(user)).filter((w) => w.id !== id));
  }

  private key(user: User): string {
    return `worlds:${user.id}`;
  }
}

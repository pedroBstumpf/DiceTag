import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { GameTable, NewGameTable } from '../models/game-table.model';
import { newId } from '../utils/id';
import { AuthService } from './auth.service';
import { StorageService } from './storage.service';

const TABLES_KEY = 'tables';

/**
 * Mesas de jogo do usuário logado.
 * Recarrega automaticamente quando o usuário entra ou sai.
 */
@Injectable({ providedIn: 'root' })
export class GameTablesService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);

  // --- Estado --------------------------------------------------------------
  private readonly all = signal<GameTable[]>([]);
  readonly loaded = signal(false);

  /** Mesas do usuário atual, mais recentes primeiro. */
  readonly tables = computed(() => {
    const userId = this.auth.user()?.id;
    return this.all()
      .filter((t) => t.ownerId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  });

  constructor() {
    // Carrega as mesas sempre que o usuário muda
    effect(() => {
      if (this.auth.user()) this.load();
    });
  }

  // --- Ações públicas ------------------------------------------------------

  async create(data: NewGameTable): Promise<GameTable> {
    const user = this.auth.user();
    if (!user) throw new Error('É preciso estar logado para criar uma mesa.');

    const table: GameTable = { ...data, id: newId(), ownerId: user.id, createdAt: Date.now() };
    this.all.update((list) => [...list, table]);
    await this.persist();
    return table;
  }

  /** Busca uma mesa do usuário atual pelo id. */
  getById(id: string): GameTable | undefined {
    return this.tables().find((t) => t.id === id);
  }

  async remove(id: string): Promise<void> {
    this.all.update((list) => list.filter((t) => t.id !== id));
    await this.persist();
  }

  // --- Persistência --------------------------------------------------------

  private async load(): Promise<void> {
    this.all.set((await this.storage.get<GameTable[]>(TABLES_KEY)) ?? []);
    this.loaded.set(true);
  }

  private persist(): Promise<void> {
    return this.storage.set(TABLES_KEY, this.all());
  }
}

import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { DEFAULT_WORLD_ID, DEFAULT_WORLD_NAME, MAX_WORLDS, World, worldbuildKey } from '../models/world.model';
import { WorldItem, worldItemBlobIds } from '../models/world-item.model';
import { newId } from '../utils/id';
import { AuthService } from './auth.service';
import { GameTablesService } from './game-tables.service';
import { StorageService } from './storage.service';

/** Preferência do último mundo aberto (por usuário). */
const ACTIVE_KEY = 'dicetag.world.';

/**
 * Mundos do usuário: cada um é um Worldbuild separado (até MAX_WORLDS).
 *
 * Guarda a lista em `worlds:<usuário>` e qual está aberto (`activeId`). O WorldbuildService
 * carrega os itens do mundo aberto; a mesa abre o mundo dela (`GameTable.worldId`).
 * Sem lista salva, o usuário tem só o primeiro mundo, que usa a chave do Worldbuild antigo.
 */
@Injectable({ providedIn: 'root' })
export class WorldsService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly tables = inject(GameTablesService);

  // --- Estado --------------------------------------------------------------
  private readonly _worlds = signal<World[]>([]);
  readonly worlds = this._worlds.asReadonly();
  readonly loaded = signal(false);
  private readonly _activeId = signal(DEFAULT_WORLD_ID);
  /** Mundo aberto (o que o Worldbuild e a mesa usam). */
  readonly activeId = this._activeId.asReadonly();
  readonly active = computed(() => this._worlds().find((w) => w.id === this._activeId()) ?? this._worlds()[0] ?? null);
  /** Ainda cabe outro mundo? */
  readonly canCreate = computed(() => this._worlds().length < MAX_WORLDS);

  private userId: string | null = null;

  constructor() {
    // Recarrega os mundos quando o usuário muda
    effect(() => {
      const user = this.auth.user();
      untracked(() => void this.load(user?.id ?? null));
    });
  }

  // --- Ações ---------------------------------------------------------------

  /** Abre outro mundo (o Worldbuild recarrega os itens dele). Id desconhecido é ignorado. */
  select(id: string): void {
    if (!this._worlds().some((w) => w.id === id)) return;
    this._activeId.set(id);
    if (this.userId) localStorage.setItem(ACTIVE_KEY + this.userId, id);
  }

  /** Cria um mundo (respeita o limite) e o abre. Retorna null se não coube. */
  async create(name = ''): Promise<World | null> {
    if (!this.userId || !this.canCreate()) return null;
    const world: World = { id: newId(), name: name.trim() || `Mundo ${this._worlds().length + 1}`, createdAt: Date.now() };
    this._worlds.update((list) => [...list, world]);
    await this.persist();
    this.storage.requestPersistence();
    this.select(world.id);
    return world;
  }

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    this._worlds.update((list) => list.map((w) => (w.id === id ? { ...w, name: trimmed } : w)));
    await this.persist();
  }

  /** Mesas do usuário que se passam no mundo. */
  tablesIn(worldId: string) {
    return this.tables.tables().filter((t) => (t.worldId ?? DEFAULT_WORLD_ID) === worldId);
  }

  /**
   * Exclui o mundo e todos os itens e arquivos dele. Só se nenhuma mesa usa o mundo e se
   * sobrar pelo menos um. Retorna o motivo quando não pode excluir (null = excluído).
   */
  async remove(id: string): Promise<string | null> {
    if (!this.userId) return 'Ninguém está usando o app.';
    if (this._worlds().length <= 1) return 'É preciso ter pelo menos um mundo.';
    const used = this.tablesIn(id).length;
    if (used) return `${used} mesa(s) se passam neste mundo. Exclua-as antes.`;

    const key = worldbuildKey(this.userId, id);
    const items = (await this.storage.get<WorldItem[]>(key)) ?? [];
    await Promise.all(items.flatMap(worldItemBlobIds).map((b) => this.storage.delete(`blob:${b}`)));
    await this.storage.delete(key);
    // Janelas salvas da mesa de trabalho deste mundo (WorldbuildService.saveDesk)
    await this.storage.delete(`desk:${this.userId}:${id}`);
    this._worlds.update((list) => list.filter((w) => w.id !== id));
    await this.persist();
    if (this._activeId() === id) this.select(this._worlds()[0].id);
    return null;
  }

  // --- Internos ------------------------------------------------------------

  private async load(userId: string | null): Promise<void> {
    this.userId = userId;
    this.loaded.set(false);
    if (!userId) {
      this._worlds.set([]);
      return;
    }
    const saved = await this.storage.get<World[]>(`worlds:${userId}`);
    // O usuário mudou durante o carregamento: descarta o resultado antigo
    if (this.userId !== userId) return;
    const worlds = saved?.length ? saved : [{ id: DEFAULT_WORLD_ID, name: DEFAULT_WORLD_NAME, createdAt: Date.now() }];
    this._worlds.set(worlds);
    const last = localStorage.getItem(ACTIVE_KEY + userId);
    this._activeId.set(worlds.some((w) => w.id === last) ? last! : worlds[0].id);
    this.loaded.set(true);
  }

  private persist(): Promise<void> {
    return this.userId ? this.storage.set(`worlds:${this.userId}`, this._worlds()) : Promise.resolve();
  }
}

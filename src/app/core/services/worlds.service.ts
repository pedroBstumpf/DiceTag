import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { WorldRepository } from '../data/world.repository';
import { User } from '../models/user.model';
import { DEFAULT_WORLD_ID, MAX_WORLDS, World } from '../models/world.model';
import { AuthService } from './auth.service';
import { GameTablesService } from './game-tables.service';

/** Preferência do último mundo aberto (por usuário). */
const ACTIVE_KEY = 'dicetag.world.';

/**
 * Mundos da conta: cada um é um Worldbuild separado (até MAX_WORLDS).
 *
 * Os dados vêm do `WorldRepository` do modo em uso (IndexedDB offline; servidor online). Guarda
 * qual mundo está aberto (`activeId`, lembrado neste navegador): o WorldbuildService carrega os
 * itens dele e a mesa abre o mundo dela (`GameTable.worldId`).
 */
@Injectable({ providedIn: 'root' })
export class WorldsService {
  private readonly repository = inject(WorldRepository);
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

  private user: User | null = null;
  /** Carregamento mais recente (os anteriores são descartados ao terminar). */
  private loading = 0;

  constructor() {
    // Recarrega os mundos quando a conta muda
    effect(() => {
      const user = this.auth.user();
      untracked(() => void this.load(user));
    });
  }

  // --- Ações ---------------------------------------------------------------

  /** Abre outro mundo (o Worldbuild recarrega os itens dele). Id desconhecido é ignorado. */
  select(id: string): void {
    if (!this._worlds().some((w) => w.id === id)) return;
    this._activeId.set(id);
    if (this.user) localStorage.setItem(ACTIVE_KEY + this.user.id, id);
  }

  /** Cria um mundo (respeita o limite) e o abre. Retorna null se não coube. */
  async create(name = ''): Promise<World | null> {
    if (!this.user || !this.canCreate()) return null;
    const world = await this.repository.createWorld(this.user, name.trim() || `Mundo ${this._worlds().length + 1}`);
    this._worlds.update((list) => [...list, world]);
    this.select(world.id);
    return world;
  }

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || !this.user) return;
    await this.repository.renameWorld(this.user, id, trimmed);
    this._worlds.update((list) => list.map((w) => (w.id === id ? { ...w, name: trimmed } : w)));
  }

  /** Mesas da conta que se passam no mundo. */
  tablesIn(worldId: string) {
    return this.tables.tables().filter((t) => (t.worldId ?? DEFAULT_WORLD_ID) === worldId);
  }

  /**
   * Exclui o mundo e todos os itens e arquivos dele. Só se nenhuma mesa usa o mundo e se
   * sobrar pelo menos um. Retorna o motivo quando não pode excluir (null = excluído).
   */
  async remove(id: string): Promise<string | null> {
    if (!this.user) return 'Ninguém está usando o app.';
    if (this._worlds().length <= 1) return 'É preciso ter pelo menos um mundo.';
    const used = this.tablesIn(id).length;
    if (used) return `${used} mesa(s) se passam neste mundo. Exclua-as antes.`;
    try {
      await this.repository.removeWorld(this.user, id);
    } catch (err) {
      return err instanceof Error ? err.message : 'Não foi possível excluir o mundo.';
    }
    this._worlds.update((list) => list.filter((w) => w.id !== id));
    if (this._activeId() === id) this.select(this._worlds()[0].id);
    return null;
  }

  // --- Internos ------------------------------------------------------------

  private async load(user: User | null): Promise<void> {
    const current = ++this.loading;
    this.user = user;
    this.loaded.set(false);
    if (!user) {
      this._worlds.set([]);
      return;
    }
    let worlds: World[];
    try {
      worlds = await this.repository.worlds(user);
    } catch {
      // Servidor fora do ar: sem mundos (as telas avisam ao tentar usar)
      worlds = [];
    }
    // A conta mudou durante o carregamento: descarta o resultado antigo
    if (current !== this.loading) return;
    this._worlds.set(worlds);
    const last = localStorage.getItem(ACTIVE_KEY + user.id);
    this._activeId.set(worlds.some((w) => w.id === last) ? last! : (worlds[0]?.id ?? DEFAULT_WORLD_ID));
    this.loaded.set(true);
  }
}
